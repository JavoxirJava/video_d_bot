import { randomUUID } from 'node:crypto';
import { formatKey, normalizeUrl } from '../common/utils.js';
import { pickProgressiveMp4, ytInfo, ffmpegTranscodeToH264 } from '../common/ytdlp.js';
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
    // data: yt2|<id>|<itag>|<h>
    const [, video_id, itagStr, hStr] = data.split('|');
    const itag = Number(itagStr);
    const height = Number(hStr) || null;
    if (!video_id || !itag) {
        await ctx.answerCbQuery('Format xatosi', { show_alert: true });
        return;
    }

    const fkey = formatKey({ source: 'yt', height, ext: 'mp4', itag });
    // kesh
    const cached = await getVideoFile({ platform: 'youtube', video_id, format_key: fkey });
    if (cached?.telegram_file_id) {
        await ctx.answerCbQuery('Keshdan');
        await ctx.replyWithVideo(
            cached.telegram_file_id,
            { supports_streaming: true, caption: `YouTube ${height ? height + 'p' : ''}` }
        );
        return;
    }
    await ctx.answerCbQuery('Yuklanmoqda…');
    const statusMsg = await ctx.reply(`⌛ YouTube: ${height ? height + 'p' : ''} tayyorlanmoqda… 0%`);

    const watchUrl = `https://www.youtube.com/watch?v=${video_id}`;
    const outPath = `/tmp/${video_id}_${itag}.mp4`;
    const fixedPath = `/tmp/${video_id}_${itag}_fixed.mp4`;

    let lastShown = 0;
    const show = async (p) => {
        if (!Number.isFinite(p)) return;
        // 5% dan oshganda yangilaymiz
        if (p - lastShown >= 5) {
            lastShown = p;
            try {
                await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined,
                    `⌛ YouTube: ${height ? height + 'p' : ''} tayyorlanmoqda… ${Math.floor(p)}%`);
            } catch { }
        }
    };
    try {
        // aniq itag bo‘yicha yuklash (progress bilan)
        await ytDownloadByItag(watchUrl, itag, outPath, show);

        // SAR=1 bilan normalizatsiya (kvadrat/ensiz muammolar uchun ehtiyot chorasi)
        await ffmpegTranscodeToH264(outPath, fixedPath);

        const sent = await ctx.replyWithVideo(
            { source: fixedPath, filename: `${video_id}_${height || 'mp4'}.mp4` },
            { supports_streaming: true, caption: `YouTube ${height ? height + 'p' : ''}` }
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
    } catch (e) {
        console.error('YT itag dl error:', e?.stderr || e);
        // anti-bot/sign-in xatolari uchun foydali ogohlantirish
        if ((e?.stderr || '').includes('confirm you’re not a bot')) {
            await ctx.reply('Google anti-bot tekshiruvi sababli format olinmadi. Cookies yoqilganiga ishonch hosil qiling.');
        } else {
            await ctx.reply('Formatni olishning iloji bo‘lmadi. Boshqa sifatni tanlab ko‘ring.');
        }
    } finally {
        try { await ctx.deleteMessage(statusMsg.message_id); } catch { }
        const fs = await import('node:fs/promises');
        fs.unlink(outPath).catch(() => { });
        fs.unlink(fixedPath).catch(() => { });
    }
}