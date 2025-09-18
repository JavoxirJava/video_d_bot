import { normalizeUrl, formatKey } from '../common/utils.js';
import { ytInfo, ytDownloadByFormatSpec } from '../common/ytdlp.js';
import { upsertVideo, getVideoFile, saveVideoFile } from '../repositories/videos.js';
import { ytFormatsKeyboard } from '../keyboards.js';
import { randomUUID } from 'node:crypto';


function pickH264Mp4Formats(info) {
    // const fmts = (info.formats || []).filter(f => {
    //     const vOk = f.vcodec && /avc1|h264/i.test(f.vcodec);
    //     const aOk = f.acodec && /mp4a|aac/i.test(f.acodec);
    //     const extOk = f.ext === 'mp4';
    //     return extOk && vOk && aOk && (f.height || 0) > 0 && f.url;
    // });

    const fmts = (info.formats || []).filter(f => {
        const itagNum = Number(f.format_id);
        if (!itagNum || Number.isNaN(itagNum)) return false;
        if (f.ext !== 'mp4') return false;
        if (!f.vcodec || !/avc1|h264/i.test(f.vcodec)) return false;
        if (!f.acodec || !/mp4a|aac/i.test(f.acodec)) return false;
        if (!f.height || !f.url) return false;
        return true;
    });
    // unique by height, prefer higher tbr/itag
    const byH = new Map();
    for (const f of fmts) {
        const prev = byH.get(f.height);
        if (!prev || (f.tbr || 0) > (prev.tbr || 0)) byH.set(f.height, f);
    }
    return [...byH.values()].sort((a, b) => a.height - b.height);
}

export async function askYoutubeFormat(ctx, url) {
    const canon = normalizeUrl(url);
    const info = await ytInfo(canon);
    const video_id = info?.id || randomUUID();

    await upsertVideo({
        platform: 'youtube',
        video_id,
        title: info?.title,
        duration_sec: info?.duration,
        thumb_url: info?.thumbnail
    });

    // Mavjud formatlardan balandliklarni yig‘amiz (10 tagacha)
    const heights = Array.from(
        new Set(
            (info.formats || [])
                .map(f => f.height)
                .filter(h => typeof h === 'number' && h > 0)
                .map(h => normHeight(h)) // pastdagi helper
        )
    ).sort((a, b) => a - b).slice(0, 6);

    if (!heights.length) return ctx.reply('Format topilmadi. Qaytadan urinib ko‘ring.');

    const buttons = heights.map(h => ({
        label: `${h}p`,
        // ⚠️ qisqa data, 64 baytdan oshmaydi
        data: `yt|${video_id}|h:${h}`
    }));

    return ctx.reply(
        `YouTube: formati tanlang\n${info.title || ''}`,
        ytFormatsKeyboard(buttons)
    );
}

export async function handleYoutubeChoice(ctx, data) {
    console.log('YT choice data:', data);
    const [, video_id, hPart] = data.split('|');
    const height = Number((hPart?.split(':')[1] || '').trim());
    if (!video_id || !height) {
        await ctx.answerCbQuery('Format xatosi', { show_alert: true });
        return;
    }

    const fkey = formatKey({ source: 'yt', height, ext: 'mp4' });
    console.log('YT choice:', { video_id, height, fkey });

    // 1) kesh
    const cached = await getVideoFile({ platform: 'youtube', video_id, format_key: fkey });
    if (cached?.telegram_file_id) {
        await ctx.answerCbQuery('Keshdan');
        return ctx.replyWithVideo(
            cached.telegram_file_id,
            { supports_streaming: true, caption: `YouTube ${height}p` }
        );
    }

    await ctx.answerCbQuery('Yuklanmoqda…');

    const watchUrl = `https://www.youtube.com/watch?v=${video_id}`;
    const outPath = `/tmp/${video_id}_${height}.mp4`;

    // 1) Progressive mp4 (avc1+mp4a) aynan shu balandlikda
    const fspecPrimary =
        `[ext=mp4][vcodec*=avc1][acodec*=mp4a][height=${height}]/best[ext=mp4][height=${height}]`;

    // 2) Adaptive avc1 video + m4a audio, <=H
    const fspecFallback1 =
        `bestvideo[height<=${height}][vcodec*=avc1][ext=mp4]+bestaudio[ext=m4a]`
        + `/best[ext=mp4][height<=${height}]`;

    // 3) Juda moslashuvchan: istalgan kodek/konteyner (vp9/webm bo‘lsa ham) — keyin mp4 ga recode
    const fspecFallback2 =
        `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`;

    try {
        await ytDownloadByFormatSpec(watchUrl, fspecPrimary, outPath);
    } catch (e1) {
        console.error('Primary failed:', e1?.stderr || e1);
        try {
            await ytDownloadByFormatSpec(watchUrl, fspecFallback1, outPath);
        } catch (e2) {
            console.error('Fallback1 failed:', e2?.stderr || e2);
            // oxirgi urinish: keng fspec + recode mp4
            await ytDownloadByFormatSpec(watchUrl, fspecFallback2, outPath, { recode: true });
        }
    }

    const sent = await ctx.replyWithVideo(
        { source: outPath, filename: `${video_id}_${height}p.mp4` },
        { supports_streaming: true, caption: `YouTube ${height}p` }
    );

    const file_id = sent?.video?.file_id || sent?.document?.file_id;
    if (file_id) {
        await saveVideoFile({
            platform: 'youtube',
            video_id,
            format_key: fkey,
            height,
            width: null,
            ext: 'mp4',
            itag: null,
            abr_kbps: null,
            filesize: sent?.video?.file_size || null,
            telegram_file_id: file_id
        });
    }
}

function normHeight(h) {
    const bins = [144, 240, 360, 480, 720, 1080, 1440, 2160];
    let best = bins[0], dmin = Infinity;
    for (const b of bins) {
        const d = Math.abs(h - b);
        if (d < dmin) { dmin = d; best = b; }
    }
    return best;
}

function buildCandidates(info) {
    const fmts = (info.formats || []).filter(f => {
        // faqat video formatlar (audio-only emas), url bor
        return f.vcodec && f.url && f.ext && f.height;
    });

    // height bo‘yicha eng yaxshi (tbr/abr ga qarab) variantni olamiz
    const byH = new Map();
    for (const f of fmts) {
        const H = normHeight(f.height);
        if (!H) continue;
        const prev = byH.get(H);
        const score = (f.tbr || 0) + (f.abr || 0);
        const prevScore = prev ? ((prev.tbr || 0) + (prev.abr || 0)) : -1;
        if (!prev || score > prevScore) byH.set(H, f);
    }

    // har bir H uchun fspec yasaymiz:
    // 1) avc1/mp4 bo‘lsa progressive: [ext=mp4][vcodec*=avc1][acodec*=mp4a][height=H]
    // 2) bo‘lmasa adaptive juftlik: bestvideo[h=H][vcodec*=avc1][ext=mp4]+bestaudio[ext=m4a]
    const res = [];
    for (const [H, f] of [...byH.entries()].sort((a, b) => a[0] - b[0])) {
        const isProgressive = (f.ext === 'mp4') && /avc1|h264/i.test(f.vcodec || '') && /mp4a|aac/i.test(f.acodec || '');
        const fspec = isProgressive
            ? `[ext=mp4][vcodec*=avc1][acodec*=mp4a][height=${H}]/best[ext=mp4][height=${H}]`
            : `bestvideo[height=${H}][vcodec*=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${H}][vcodec*=avc1][ext=mp4]+bestaudio[ext=m4a]`;

        res.push({ height: H, fspec });
    }
    return res;
}
