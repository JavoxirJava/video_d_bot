import { randomUUID } from 'node:crypto';
import { formatKey, normalizeUrl } from '../common/utils.js';
import { ytDownloadByHeightSmart, ytInfo, ffmpegTranscodeToH264 } from '../common/ytdlp.js';
import { ytFormatsKeyboard } from '../keyboards.js';
import { getVideoFile, saveVideoFile, upsertVideo } from '../repositories/videos.js';

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

    const heights = Array.from(
        new Set(
            (info.formats || [])
                .map(f => f.height)
                .filter(h => typeof h === 'number' && h > 0)
                .map(h => normHeight(h))
        )
    ).sort((a, b) => a - b).slice(0, 6);

    if (!heights.length) return ctx.reply('Format topilmadi. Qaytadan urinib ko‘ring.');

    const buttons = heights.map(h => ({
        label: `${h}p`,
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

    // DB cache
    const cached = await getVideoFile({ platform: 'youtube', video_id, format_key: fkey });
    if (cached?.telegram_file_id) {
        await ctx.answerCbQuery('Keshdan');
        await ctx.replyWithVideo(
            cached.telegram_file_id,
            { supports_streaming: true, caption: `YouTube ${height}p` }
        );
        return;
    }
    
    await ctx.answerCbQuery('Yuklanmoqda…');       // callback timeout’ni oldini oladi
    const statusMsg = await ctx.reply(`⌛ YouTube: ${height}p tayyorlanmoqda…`); // keyin delete qilamiz

    const watchUrl = `https://www.youtube.com/watch?v=${video_id}`;
    const outPath = `/tmp/${video_id}_${height}.mp4`;
    const fixedPath = `/tmp/${video_id}_${height}_fixed.mp4`;

    try {
        // 1) Yuklab olish (smart tanlov)
        await ytDownloadByHeightSmart(watchUrl, height, outPath);

        // 2) SAR/DAR normalizatsiya (ensiz/kvadrat muammosi uchun)
        //    H.264 + yuv420p + setsar=1 + faststart (telegram playback uchun muhim)
        await ffmpegTranscodeToH264(outPath, fixedPath);

        // 3) Yuborish
        const sent = await ctx.replyWithVideo(
            { source: fixedPath, filename: `${video_id}_${height}p.mp4` },
            { supports_streaming: true, caption: `YouTube ${height}p` }
        );

        // 4) Cache saqlash
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
        // Holatni tozalash
        try { await ctx.deleteMessage(statusMsg.message_id); } catch { }
    } catch (e) {
        console.error('YT download/transcode error:', e?.stderr || e?.message || e);

        // Foydalanuvchiga ko‘rinadigan tushunarli xabar
        try {
            await ctx.editMessageText?.(`Xatolik: formatni olishning iloji bo‘lmadi. Boshqa sifatni tanlab ko‘ring.`);
        } catch { }
        try {
            await ctx.answerCbQuery('Xatolik', { show_alert: true });
        } catch { }
        try {
            await ctx.editMessageText?.(`Xatolik: formatni olishning iloji bo‘lmadi. Boshqa sifatni tanlab ko‘ring.`, {
                chat_id: ctx.chat.id,
                message_id: statusMsg?.message_id
            });
        } catch { }
    } finally {
        // Tozalash
        const fs = await import('node:fs/promises');
        fs.unlink(outPath).catch(() => { });
        fs.unlink(fixedPath).catch(() => { });
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