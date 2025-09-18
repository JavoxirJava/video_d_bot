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

    await upsertVideo({ platform: 'youtube', video_id, title: info?.title, duration_sec: info?.duration, thumb_url: info?.thumbnail });

    const cand = buildCandidates(info);
    if (!cand.length) return ctx.reply('Format topilmadi. Qaytadan urinib ko‘ring.');

    // const buttons = h264.map(f => ({
    //     label: `${f.height}p`,
    //     data: `yt|${video_id}|itag:${f.format_id}|h:${f.height}`
    // }));
    const buttons = cand.map(f => ({
        label: `${f.height}p`,
        // fspec callback ichida URL-safe bo‘lishi uchun base64 qildik
        data: `yt|${video_id}|fspec:${Buffer.from(f.fspec).toString('base64')}|h:${f.height}`
    }));

    return ctx.reply(`YouTube: formati tanlang\n${info.title || ''}`, ytFormatsKeyboard(buttons));
}

export async function handleYoutubeChoice(ctx, data) {
    // data: yt|<vid>|itag:NNN|h:720
    // console.log('YT choice data:', data);
    // const [, video_id, itagPart, hPart] = data.split('|');
    // const itag = Number((itagPart.split(':')[1] || '').trim());
    // if (!itag || Number.isNaN(itag)) {
    //     await ctx.answerCbQuery('Format xatosi. Yana birini tanlang.', { show_alert: true });
    //     return;
    // }
    // const height = Number((hPart.split(':')[1] || '').trim());
    // const fkey = formatKey({ source: 'yt', itag, height, ext: 'mp4' });
    const parts = data.split('|');
    const video_id = parts[1];
    const fspecB64 = (parts.find(p => p.startsWith('fspec:')) || '').slice(6);
    const height = Number((parts.find(p => p.startsWith('h:')) || '').slice(2));
    if (!fspecB64) return ctx.answerCbQuery('Format xatosi', { show_alert: true });
    const fspec = Buffer.from(fspecB64, 'base64').toString('utf8');
    const fkey = formatKey({ source: 'yt', height, ext: 'mp4' }); // itag o‘rniga height+mp4

    console.log('YT choice:', { video_id, itag, height, fkey });

    // fast path: DB cached telegram file
    const cached = await getVideoFile({ platform: 'youtube', video_id, format_key: fkey });
    if (cached?.telegram_file_id) {
        await ctx.answerCbQuery('Keshdan');
        return ctx.replyWithVideo(cached.telegram_file_id, { supports_streaming: true, caption: `YouTube ${height}p` });
    }

    await ctx.answerCbQuery('Yuklanmoqda…');

    // need original watch url to download; reconstruct from id
    const watchUrl = `https://www.youtube.com/watch?v=${video_id}`;
    const outPath = `/tmp/${video_id}_${itag}.mp4`;

    try {
        await ytDownloadByFormatSpec(watchUrl, fspec, outPath);
    } catch (e) {
        // fallback: <=H bilan urinib ko‘ramiz
        const fallback = `bestvideo[height<=${height}][vcodec*=avc1][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4][height<=${height}]`;
        console.error('Primary fspec failed, retry with fallback:', fallback);
        await ytDownloadByFormatSpec(watchUrl, fallback, outPath);
    }
    const sent = await ctx.replyWithVideo({ source: outPath, filename: `${video_id}_${height}p.mp4` }, { supports_streaming: true, caption: `YouTube ${height}p` });
    const file_id = sent?.video?.file_id || sent?.document?.file_id;
    if (file_id)
        await saveVideoFile({ platform: 'youtube', video_id, format_key: fkey, height, width: null, ext: 'mp4', itag, abr_kbps: null, filesize: sent?.video?.file_size || null, telegram_file_id: file_id });
}

function normHeight(h) {
    if (!h) return null;
    const bins = [144, 240, 360, 480, 720, 1080, 1440, 2160];
    let best = bins[0], mind = Infinity;
    for (const b of bins) {
        const d = Math.abs(h - b);
        if (d < mind) { mind = d; best = b; }
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
