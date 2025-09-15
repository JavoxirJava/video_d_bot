import { normalizeUrl, formatKey } from '../common/utils.js';
import { ytInfo, ytDownloadByItag } from '../common/ytdlp.js';
import { upsertVideo, getVideoFile, saveVideoFile } from '../repositories/videos.js';
import { ytFormatsKeyboard } from '../keyboards.js';
import { randomUUID } from 'node:crypto';


function pickH264Mp4Formats(info) {
    const fmts = (info.formats || []).filter(f => {
        const vOk = f.vcodec && /avc1|h264/i.test(f.vcodec);
        const aOk = f.acodec && /mp4a|aac/i.test(f.acodec);
        const extOk = f.ext === 'mp4';
        return extOk && vOk && aOk && (f.height || 0) > 0 && f.url;
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

    const h264 = pickH264Mp4Formats(info);
    if (!h264.length)
        return ctx.reply('Format topilmadi. Qaytadan urinib ko‘ring.');

    const buttons = h264.map(f => ({
        label: `${f.height}p`,
        data: `yt|${video_id}|itag:${f.format_id}|h:${f.height}`
    }));
    return ctx.reply(`YouTube: formati tanlang\n${info.title || ''}`, ytFormatsKeyboard(buttons));
}

export async function handleYoutubeChoice(ctx, data) {
    // data: yt|<vid>|itag:NNN|h:720
    console.log('YT choice data:', data);
    const [, video_id, itagPart, hPart] = data.split('|');
    const itag = Number((itagPart.split(':')[1] || '').trim());
    const height = Number((hPart.split(':')[1] || '').trim());
    const fkey = formatKey({ source: 'yt', itag, height, ext: 'mp4' });

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

    await ytDownloadByItag(watchUrl, itag, outPath);
    const sent = await ctx.replyWithVideo({ source: outPath, filename: `${video_id}_${height}p.mp4` }, { supports_streaming: true, caption: `YouTube ${height}p` });
    const file_id = sent?.video?.file_id || sent?.document?.file_id;
    if (file_id) 
        await saveVideoFile({ platform: 'youtube', video_id, format_key: fkey, height, width: null, ext: 'mp4', itag, abr_kbps: null, filesize: sent?.video?.file_size || null, telegram_file_id: file_id });
}