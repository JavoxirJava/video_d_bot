import { randomUUID } from 'node:crypto';
import { formatKey, normalizeUrl } from '../common/utils.js';
import { ytDownloadByHeightSmart, ytInfo } from '../common/ytdlp.js';
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

export async function handleYoutubeChoice(ctx, data, bot) {
    const loadingMsg = await ctx.answerCbQuery('Yuklanmoqda…');
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
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
        return ctx.replyWithVideo(
            cached.telegram_file_id,
            { supports_streaming: true, caption: `YouTube ${height}p` }
        );
    }

    await ctx.answerCbQuery('Yuklanmoqda…');
    const msg = await bot.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, `⌛ YouTube: ${height}p tayyorlanmoqda…`);


    const watchUrl = `https://www.youtube.com/watch?v=${video_id}`;
    const outPath = `/tmp/${video_id}_${height}.mp4`;

    try {
        await ytDownloadByHeightSmart(watchUrl, height, outPath);
    } catch (e) {
        console.error('YT smart download failed:', e?.stderr || e);
        await ctx.answerCbQuery('Format topilmadi. Boshqa sifatni tanlab ko‘ring.', { show_alert: true });
        return;
    }

    const sent = await ctx.replyWithVideo(
        { source: outPath, filename: `${video_id}_${height}p.mp4` },
        { supports_streaming: true, caption: `YouTube ${height}p` }
    );
    ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id);

    const file_id = sent?.video?.file_id || sent?.document?.file_id;
    if (file_id) await saveVideoFile({
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

function normHeight(h) {
    const bins = [144, 240, 360, 480, 720, 1080, 1440, 2160];
    let best = bins[0], dmin = Infinity;
    for (const b of bins) {
        const d = Math.abs(h - b);
        if (d < dmin) { dmin = d; best = b; }
    }
    return best;
}
