import { Markup } from 'telegraf';
import pino from 'pino';
import { config } from './config.js';
import { getFormats, extractVideoId } from './utils/yt.js';
import { upsertVideo, findCachedFile } from './db.js';
import { downloadQueue } from './queue.js';

const log = pino({ level: 'info' });


// ---------- helpers ----------
const MAX_BYTES = 50 * 1024 * 1024; // 50MB policy

function escapeV2(s = '') {
    return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}
function bytesToMB(b) {
    return (b / (1024 * 1024));
}
function formatMB(b) {
    if (!b || b <= 0) return '—';
    const x = bytesToMB(b);
    return (x >= 100) ? `${Math.round(x)}MB` : `${x.toFixed(1)}MB`;
}
/** Bitrate-based size estimate (kbit/s × 125 × duration) */
function estimateBytesByBitrate(fmt, durationSec) {
    const kbps = (fmt?.tbr ?? fmt?.vbr ?? fmt?.abr);
    if (!kbps || !durationSec) return null;
    const bytesPerSec = Number(kbps) * 125; // kbit/s → byte/s
    const est = Math.floor(bytesPerSec * Number(durationSec));
    return est > 0 ? est : null;
}

export async function ytLink(ctx, text) {
    const waitMsg = await ctx.reply('🔎 Formatlar olinmoqda...');
    await ctx.sendChatAction('typing');

    try {
        const meta = await getFormats(text);
        if (!meta?.formats) {
            await ctx.reply('❌ Formatlarni olishning imkoni bo‘lmadi.');
            return;
        }

        const videoId = extractVideoId(text) || meta.id;
        const title = meta.title || 'video';
        const channel = meta.uploader || '';
        const duration = meta.duration || null;

        // DB: video metadata (Redis yoki PG – sizdagi db.js sovg‘a)
        await upsertVideo({
            yt_video_id: videoId,
            title,
            channel,
            duration_seconds: duration
        });

        // ---- Formatlarni tanlab olish ----
        const all = meta.formats || [];

        // Video (progressive mp4; agar bo‘lmasa, ext=mp4 + vcodec!=none)
        let videoCands = all.filter(f =>
            f.ext === 'mp4' && f.vcodec !== 'none' && f.acodec !== 'none' &&
            !String(f.protocol || '').includes('m3u8') &&
            !String(f.protocol || '').includes('dash')
        );
        if (!videoCands.length) {
            videoCands = all.filter(f => f.ext === 'mp4' && f.vcodec !== 'none' && f.acodec !== 'none');
        }

        // Har bir format uchun size (real yoki taxminiy)
        const vFormats = videoCands
            .map(f => {
                const size = f.filesize || f.filesize_approx || estimateBytesByBitrate(f, duration) || null;
                return {
                    itag: f.format_id ? parseInt(String(f.format_id), 10) : null,
                    height: f.height || null,
                    protocol: f.protocol || '',
                    size,
                    label: `${f.height || '??'}p`,
                };
            })
            .filter(f => f.itag);

        // Bir balandlikdan bittadan (eng yuqori sifatni qoldiramiz)
        const seenHeights = new Set();
        const videosUniq = [];
        for (const f of vFormats.sort((a, b) => (b.height || 0) - (a.height || 0))) {
            const key = f.height || '??';
            if (seenHeights.has(key)) continue;
            seenHeights.add(key);
            videosUniq.push(f);
        }

        // Audio-only (m4a/opus) — eng ommabopi itag 140 (m4a)
        const aCands = all.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
        const aBest = aCands
            .map(f => {
                const size = f.filesize || f.filesize_approx || estimateBytesByBitrate(f, duration) || null;
                return {
                    itag: f.format_id ? parseInt(String(f.format_id), 10) : null,
                    abr: f.abr || null, // kbps
                    ext: f.ext || 'm4a',
                    size
                };
            })
            .filter(f => f.itag)
            .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0] || null;

        if (!videosUniq.length && !aBest) {
            await ctx.reply('Kechirasiz, mos format topilmadi.');
            return;
        }

        // ---- Chiroyli matn (rasmdagidek) ----
        const lines = [];
        for (const f of videosUniq) {
            lines.push(`🚀 ${f.label}:  ${formatMB(f.size)}`);
        }
        if (aBest) {
            lines.push(`🎧 MP3:  ${formatMB(aBest.size)} (source: ${aBest.ext.toUpperCase()}${aBest.abr ? ` • ${aBest.abr}kbps` : ''})`);
        }

        const caption =
            `🎬 *${escapeV2(title)}*\n` +
            `👤 ${escapeV2(channel || '-')}\n` +
            `${duration ? `⏱ ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}\n` : ''}\n` +
            lines.map(escapeV2).join('\n');

        // ---- Inline keyboard (labelda MB bor, callbackda size ham bor) ----
        const rows = [];
        for (const f of videosUniq) {
            const size = f.size ? Math.max(0, Math.floor(f.size)) : 0; // null -> 0
            const mb = formatMB(size).replace('MB', '');
            const btnText = `${f.label} • ${mb}MB`;
            // data: d:<ytid>:<itag>:<size_bytes>:v
            rows.push([Markup.button.callback(btnText, `d:${videoId}:${f.itag}:${size}:v`)]);
        }
        if (aBest) {
            const aSize = aBest.size ? Math.max(0, Math.floor(aBest.size)) : 0;
            const aText = `MP3 • ${formatMB(aSize)}`;
            rows.push([Markup.button.callback(aText, `d:${videoId}:${aBest.itag}:${aSize}:a`)]);
        }

        await ctx.replyWithMarkdownV2(caption, Markup.inlineKeyboard(rows, { columns: 3 }));
    } catch (e) {
        log.error({ err: e.message, stderr: e.stderr, stdout: e.stdout }, 'getFormats error');
        await ctx.reply('❌ Formatlarni olishda xatolik. Keyinroq urinib ko‘ring.');
    } finally {
        try { await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id); } catch { }
    }
}

export async function ytButton(ctx, data) {
    // if (!data.startsWith('d:')) return ctx.answerCbQuery('Noto‘g‘ri tanlov');
    const parts = data.split(':'); // ['d', ytid, itag, sizeBytes, kind]
    const ytid = parts[1];
    const itag = Number(parts[2]);
    const sizeBytes = Number(parts[3] || 0);
    const kind = parts[4] || 'v'; // 'v' video, 'a' audio

    await ctx.answerCbQuery('Qabul qilindi ✅');

    // 0) 50MB limiti – oldindan to‘xtatamiz
    if (sizeBytes && sizeBytes > MAX_BYTES) {
        return ctx.reply(
            `⚠️ Tanlangan format hajmi ~${bytesToMB(sizeBytes).toFixed(1)} MB.\n` +
            `Biz 50MB dan kattalarni yuklamay olmaymiz. Iltimos kichikroq format tanlang.`
        );
    }

    // 1) Cache (faqat video uchun; audio uchun ham saqlasak bo‘ladi)
    const cached = await findCachedFile(ytid, itag);
    if (cached?.telegram_file_id) {
        if (cached.telegram_type === 'video') await ctx.replyWithVideo(cached.telegram_file_id);
        else await ctx.replyWithDocument(cached.telegram_file_id);
        return;
    }

    // 2) Navbatga qo‘shamiz (workerga oldindan size/kind ham beramiz)
    await ctx.reply(kind === 'a' ? '⬇️ Audio serverga yuklanmoqda…' : '⬇️ Video serverga yuklanmoqda…');

    await downloadQueue.add('download', {
        chatId: ctx.chat.id,
        messageId: ctx.callbackQuery.message?.message_id,
        ytid,
        itag,
        sizeBytes: sizeBytes || 0,
        kind // 'v' | 'a'
    }, { removeOnComplete: 1000, removeOnFail: 5000 });
}

export function telegrafWebhookConfig() {
    const path = `/bot/${config.webhookSecret}`;
    return { path };
}