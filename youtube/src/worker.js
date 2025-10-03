import fs from 'fs';
import { spawn } from 'node:child_process';
import os from 'os';
import pino from 'pino';
import { Telegraf } from 'telegraf';
import { startWorker } from '../../instagram/queue/consumer.js';
import { config } from './config.js';
import { insertFile, markFileFailed, markFileReady, upsertVideo } from './db.js';
import { connection, Worker } from './queue.js';
import { parseProgressLine } from './utils/progress.js';
import { buildDownloadArgs, resolveFinalPath } from './utils/yt.js';


const log = pino({ level: 'info' });
const telegram = new Telegraf(config.botToken).telegram;

// Worker concurrency: CPU yadro soniga qarab (yadro-1)
const concurrency = Math.max(1, (os.cpus()?.length || 2) - 1);
log.info({ concurrency }, 'Worker concurrency');

function editProgress(chatId, baseMessageId, text) {
    return telegram.sendMessage(chatId, text).catch(() => { });
}

// ---- ffprobe helpers ----
async function probeCSV(filePath, entries) {
    return new Promise((resolve) => {
        const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'csv=s=,:p=0', filePath];
        const p = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        p.stdout.on('data', d => out += d.toString());
        p.on('close', () => resolve(out.trim()));
    });
}

async function getVideoMeta(filePath) {
    // width,height
    const wh = await probeCSV(filePath, 'stream=width,height');
    const [wStr, hStr] = (wh || '').split(',');
    const width = Number(wStr || 0);
    const height = Number(hStr || 0);

    // sample_aspect_ratio, display_aspect_ratio, rotate
    const sarDar = await probeCSV(filePath, 'stream=sample_aspect_ratio,display_aspect_ratio,rotate');
    const [sar, dar, rotateStr] = (sarDar || '').split(',');
    const rotate = Number(rotateStr || 0);
    return { width, height, sar: sar || '', dar: dar || '', rotate: Number.isFinite(rotate) ? rotate : 0 };
}

// ---- normalize / fix aspect ----
async function remuxFaststart(inputPath, outputPath) {
    await new Promise((resolve, reject) => {
        const p = spawn(config.paths.ffmpeg, [
            '-y', '-i', inputPath,
            '-c', 'copy',
            '-bsf:v', 'h264_metadata=sample_aspect_ratio=1',
            '-movflags', '+faststart',
            '-metadata:s:v:0', 'rotate=0',
            outputPath
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        p.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg remux failed')));
    });
}

async function reencodeFixAspect(inputPath, outputPath) {
    // Og‘ir, ammo aniq yechim: SAR=1, juft o‘lchamlar, rotate=0
    await new Promise((resolve, reject) => {
        const p = spawn(config.paths.ffmpeg, [
            '-y', '-i', inputPath,
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
            '-c:a', 'copy',
            '-movflags', '+faststart',
            '-metadata:s:v:0', 'rotate=0',
            outputPath
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        p.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg reencode failed')));
    });
}

export const worker = new Worker('download', async job => {
    const { chatId, ytid, itag } = job.data;
    const url = `https://www.youtube.com/watch?v=${ytid}`;

    // yt-dlp args
    const { args, outTemplate } = buildDownloadArgs({ url, itag, titleForFile: ytid });

    // video row (upsert)
    const v = await upsertVideo({ yt_video_id: ytid, title: ytid, channel: null, duration_seconds: null });

    // file row (pending)
    const fileRow = await insertFile(v.id, {
        itag, format_label: null, ext: 'mp4',
        width: null, height: null, filesize: null, status: 'pending'
    });

    // download
    const proc = spawn(config.paths.ytDlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', () => { });
    proc.stderr.on('data', async d => {
        const line = d.toString();
        const p = parseProgressLine(line);
        if (p?.percent != null) {
            await editProgress(chatId, null, `⬇️ Progress: ${p.percent.toFixed(1)}%`);
            job.updateProgress(Math.round(p.percent));
        }
    });
    const code = await new Promise(resolve => proc.on('close', resolve));
    if (code !== 0) {
        await markFileFailed(fileRow.id);
        await telegram.sendMessage(chatId, '❌ Yuklab olishda xatolik yuz berdi.');
        return;
    }

    // final file
    const finalPath = resolveFinalPath(outTemplate);
    if (!finalPath || !fs.existsSync(finalPath)) {
        await markFileFailed(fileRow.id);
        await telegram.sendMessage(chatId, '❌ Fayl topilmadi.');
        return;
    }

    // --- Aspect tekshiruv ---
    const meta0 = await getVideoMeta(finalPath);
    const needsReencode =
        !meta0.width || !meta0.height ||
        (meta0.sar && meta0.sar !== '1:1') ||
        (Number(meta0.rotate) !== 0);

    let sendPath = finalPath;

    // normalize pathlar
    const normCopy = finalPath.replace(/\.mp4$/i, '') + '.norm.mp4';
    const normReenc = finalPath.replace(/\.mp4$/i, '') + '.fix.mp4';

    try {
        if (needsReencode) {
            await reencodeFixAspect(finalPath, normReenc);
            sendPath = normReenc;
        } else {
            await remuxFaststart(finalPath, normCopy);
            sendPath = normCopy;
        }
    } catch (e) {
        // fallback — hech bo‘lmaganda asl faylni yuboramiz
        log.warn({ e: e?.message }, 'Normalize failed, fallback to original');
        sendPath = finalPath;
    }

    // yuborish
    const stat = fs.statSync(sendPath);
    const meta = await getVideoMeta(sendPath);
    const { width, height } = meta;
    const big = stat.size >= config.limits.maxVideoBytes;
    const unknownDims = !width || !height;
    const forceDocument = big || unknownDims || height >= 720; // qat’iyroq

    await editProgress(chatId, null, '📤 Telegramga yuborilmoqda…');
    await telegram.sendChatAction(chatId, forceDocument ? 'upload_document' : 'upload_video');
    const filename = sendPath.split('/').pop();

    try {
        let msg;
        if (forceDocument) {
            msg = await telegram.sendDocument(chatId, { source: sendPath, filename }, { caption: '📁 Video' });
            await markFileReady(fileRow.id, {
                telegram_file_id: msg.document.file_id,
                telegram_file_unique_id: msg.document.file_unique_id,
                telegram_type: 'document',
                filesize: stat.size
            });
        } else {
            // width/height majburan beramiz — Telegram kvadratga aylantirmasin
            msg = await telegram.sendVideo(
                chatId,
                { source: sendPath, filename },
                { width, height, supports_streaming: true }
            );
            await markFileReady(fileRow.id, {
                telegram_file_id: msg.video.file_id,
                telegram_file_unique_id: msg.video.file_unique_id,
                telegram_type: 'video',
                filesize: stat.size
            });
        }
    } catch (e) {
        log.error(e);
        await markFileFailed(fileRow.id);
        await telegram.sendMessage(chatId, '❌ Telegramga yuborishda muammo.');
    } finally {
        // tozalash
        try { if (sendPath && fs.existsSync(sendPath)) fs.unlinkSync(sendPath); } catch { }
        try { if (normCopy !== sendPath && fs.existsSync(normCopy)) fs.unlinkSync(normCopy); } catch { }
        try { if (normReenc !== sendPath && fs.existsSync(normReenc)) fs.unlinkSync(normReenc); } catch { }
        try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch { }
    }
}, { connection, concurrency });

worker.on('failed', (job, err) => {
    log.error({ jobId: job.id, err }, 'Job failed');
});

// Instagram worker start
startWorker();