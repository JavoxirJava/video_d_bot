import fs from 'node:fs/promises';
import { genericToMp4, igDownloadRaw, ffmpegTranscodeToH264 } from '../common/ytdlp.js';
import { formatKey } from '../common/utils.js';
import { getVideoFile, saveVideoFile, upsertVideo } from '../repositories/videos.js';
import { scorpFetch, canonicalIg } from './providers/ig_scorp.js';

// ixtiyoriy: yuborilgandan keyin “musiqasini topish” tugmasi
function musicButton(video_id) {
    return {
        reply_markup: {
            inline_keyboard: [[{ text: '🎧 Musiqasini topish', callback_data: `audiomatch|ig|${video_id}` }]]
        }
    };
}

async function sendViaUrlOrBuffer(ctx, first, caption) {
    try {
        if (first.type === 'photo') {
            return await ctx.replyWithPhoto(first.url, { caption });
        }
        // Telegram URL’dan olishni biladi, streaming flag’ni qo‘yib yuboramiz
        return await ctx.replyWithVideo(first.url, { caption, supports_streaming: true });
    } catch {
        // URL bo‘lmasa buffer qilib yuboramiz
        const r = await fetch(first.url, { signal: AbortSignal.timeout(120_000) });
        if (!r.ok) throw new Error(`fetch ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        if (first.type === 'photo') {
            return await ctx.replyWithPhoto({ source: buf, filename: 'photo.jpg' }, { caption });
        }
        return await ctx.replyWithVideo({ source: buf, filename: 'video.mp4' }, { caption, supports_streaming: true });
    }
}

export async function handleInstagram(ctx, url, opts = { tier: 'free' }) {
    console.log('Instagram URL:', url, 'Tier:', opts.tier);
    const providerMode = (process.env.IG_PROVIDER || 'hybrid').toLowerCase();

    // ID tayyorlab olamiz (DB/kesh uchun)
    const m = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([\w-]+)/i);
    const rawId = m?.[1] || String(Date.now());
    const video_id = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
    const fkey = formatKey({ source: 'ig', height: null, ext: 'mp4' });

    // 0) Keshdan tekshirish
    const cached = await getVideoFile({ platform: 'instagram', video_id, format_key: fkey });
    console.log('Cached IG video:', cached);
    if (cached?.telegram_file_id) {
        return ctx.replyWithVideo(cached.telegram_file_id, { supports_streaming: true, ...musicButton(video_id) });
    }

    console.log('Cached IG video:', cached);
    if (cached?.telegram_file_id) {
        return ctx.replyWithVideo(cached.telegram_file_id, { supports_streaming: true, ...musicButton(video_id) });
    }

    // 1) RapidAPI (7scorp) — cookie talab qilmaydi
    if (providerMode === 'rapidapi' || providerMode === 'hybrid') {
        try {
            const canon = canonicalIg(url);
            const list = await scorpFetch(canon);
            if (list?.length) {
                const first = list[0];
                const sent = await sendViaUrlOrBuffer(ctx, first, canon);
                const size = sent?.video?.file_size || null;
                const file_id = sent?.video?.file_id || sent?.document?.file_id;

                if (file_id) {
                    await saveVideoFile({
                        platform: 'instagram',
                        video_id,
                        format_key: fkey,
                        height: null, width: null,
                        ext: 'mp4', itag: null, abr_kbps: null,
                        filesize: size, telegram_file_id: file_id
                    });
                    await upsertVideo({ platform: 'instagram', video_id });
                }
                // 10 MB bepul limiti ogohlantirish (agar kerak bo‘lsa)
                if (opts.tier === 'free' && size && size > 10 * 1024 * 1024) {
                    await ctx.reply('>10MB. Premium kerak.');
                }
                // musiqa tugmasi
                return ctx.reply('—', musicButton(video_id));
            }

        } catch (e) {
            console.error('RapidAPI IG error:', e.responseText || e.message);
            if (providerMode === 'rapidapi') {
                // faqat rapidapi rejimi bo‘lsa shu yerning o‘zida to‘xtaymiz
                return ctx.reply('Xato: media topilmadi yoki post private bo‘lishi mumkin.');
            }
            // aks holda ytdlp fallback’ga o‘tamiz
        }
    }
    // 2) Fallback: yt-dlp + ffmpeg (loginga bog‘liq bo‘lishi mumkin)
    if (providerMode === 'ytdlp' || providerMode === 'hybrid') {
        try {
            const tmpRaw = `/tmp/ig_${video_id}_raw.mp4`;
            await igDownloadRaw(url, tmpRaw);

            const out = `/tmp/ig_${video_id}.mp4`;
            await ffmpegTranscodeToH264(tmpRaw, out);

            const sent = await ctx.replyWithVideo({ source: out, filename: `${video_id}.mp4` }, { supports_streaming: true });
            const size = sent?.video?.file_size || 0;
            const file_id = sent?.video?.file_id || sent?.document?.file_id;
            if (file_id) {
                await saveVideoFile({
                    platform: 'instagram',
                    video_id,
                    format_key: fkey,
                    height: null, width: null,
                    ext: 'mp4', itag: null, abr_kbps: null,
                    filesize: size, telegram_file_id: file_id
                });
                await upsertVideo({ platform: 'instagram', video_id });
            }
            if (opts.tier === 'free' && size > 10 * 1024 * 1024) {
                await ctx.reply('>10MB. Premium kerak.');
            }
            await fs.unlink(tmpRaw).catch(() => { });
            await fs.unlink(out).catch(() => { });
            return ctx.reply('—', musicButton(video_id));
        } catch (e) {
            console.error('yt-dlp IG error:', e?.stderr || e);
            return ctx.reply('Xato: media topilmadi yoki post private bo‘lishi mumkin.');
        }
    }
}