import { randomUUID } from 'node:crypto';
import { formatKey, normalizeUrl } from '../common/utils.js';
import { pickProgressiveMp4, ytInfo, ffmpegTranscodeToH264, ytDownloadByItag } from '../common/ytdlp.js';
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

    // faqat progressive mp4 formatlar (video+audio) — itag bilan
    const fmts = pickProgressiveMp4(info);
    if (!fmts.length) return ctx.reply('Format topilmadi. Qaytadan urinib ko‘ring.');

    // Callback data: qisqa bo‘lsin: yt2|<id>|<itag>|<h>
    const buttons = fmts.map(f => ({
        label: `${f.height || '??'}p`,
        data: `yt2|${video_id}|${f.itag}|${f.height || 0}`
    }));
    return ctx.reply(
        `YouTube: formati tanlang\n${info.title || ''}`,
        ytFormatsKeyboard(buttons)
    );
}

export async function handleYoutubeChoice(ctx, data) {
    // services/youtube.js (handleYoutubeChoice ichidagi asosiy blok)
    console.log('Callback query:', data); // ex: yt2|VIDEOID|301|1080
    const [kind, video_id, itagStr, heightStr] = (data || '').split('|');
    const itag = Number(itagStr);
    const height = Number(heightStr);

    if (kind !== 'yt2' || !video_id || !itag || !height) {
        await ctx.answerCbQuery('Format xatosi', { show_alert: true });
        return;
    }

    const fkey = formatKey({ source: 'yt', height, ext: 'mp4' });
    console.log('YT itag choice:', { video_id, itag, height, fkey });

    // 1) Kesh
    const cached = await getVideoFile({ platform: 'youtube', video_id, format_key: fkey });
    if (cached?.telegram_file_id) {
        await ctx.answerCbQuery('Keshdan');
        await ctx.replyWithVideo(cached.telegram_file_id, { supports_streaming: true, caption: `YouTube ${height}p` });
        return;
    }

    await ctx.answerCbQuery('Yuklanmoqda…');
    const statusMsg = await ctx.reply(`⌛ YouTube: ${height}p tayyorlanmoqda…`);

    const watchUrl = `https://www.youtube.com/watch?v=${video_id}`;
    const outPath = `/tmp/${video_id}_${height}.mp4`;
    const fixedPath = `/tmp/${video_id}_${height}_fixed.mp4`;

    try {
        // 2) To‘g‘ri argument tartibi: url, itag, height, outPath
        await ytDownloadByItag(watchUrl, itag, height, outPath);

        // 3) (ixtiyoriy) SAR normalize – square/kichrayish muammolari uchun
        await ffmpegTranscodeToH264(outPath, fixedPath);

        const sent = await ctx.replyWithVideo(
            { source: fixedPath, filename: `${video_id}_${height}p.mp4` },
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
                itag,
                abr_kbps: null,
                filesize: sent?.video?.file_size || null,
                telegram_file_id: file_id
            });
        }
        try { await ctx.deleteMessage(statusMsg.message_id); } catch { }
    } catch (e) {
        console.error('YT itag dl error:', e?.stderr || e?.message || e);
        try { await ctx.editMessageText?.('Xatolik: bu sifat mavjud emas. Boshqa sifatni tanlang.'); } catch { }
        try { await ctx.answerCbQuery('Xatolik', { show_alert: true }); } catch { }
    } finally {
        const fs = await import('node:fs/promises');
        fs.unlink(outPath).catch(() => { });
        fs.unlink(fixedPath).catch(() => { });
    }
}