// services/instagram.js
import fs from 'node:fs/promises';
import { formatKey } from '../common/utils.js';
import { getVideoFile, saveVideoFile, upsertVideo } from '../repositories/videos.js';
import { igDownloadRaw, ffmpegTranscodeToH264 } from '../common/ytdlp.js';
import { scorpFetch, canonicalIg } from './providers/ig_scorp.js'; // ← yangi provider

export async function handleInstagram(ctx, url, opts = { tier: 'free' }) {
    console.log('Instagram URL:', url, 'Tier:', opts.tier);

    // ID
    const m = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([\w-]+)/i);
    const video_id = (m?.[1] || String(Date.now())).replace(/[^a-zA-Z0-9_-]/g, '');

    // DB kesh
    const fkey = formatKey({ source: 'ig', height: null, ext: 'mp4' });
    const cached = await getVideoFile({ platform: 'instagram', video_id, format_key: fkey });
    if (cached?.telegram_file_id)
        return ctx.replyWithVideo(cached.telegram_file_id, { supports_streaming: true });

    // 1) RAPIDAPI PROVIDER (birinchi urinish)
    try {
        const list = await (async () => {
            try { return await scorpFetch(url); } catch { return await scorpFetch(canonicalIg(url)); }
        })();

        if (list?.length) {
            const first = list[0];

            // Avval URL’ni bevosita yuborib ko‘ramiz (Telegram o‘zi yuklasin)
            try {
                if (first.type === 'photo') {
                    const msg = await ctx.replyWithPhoto({ url: first.url }, { caption: url });
                    await upsertVideo({ platform: 'instagram', video_id });
                    return msg;
                } else {
                    const msg = await ctx.replyWithVideo({ url: first.url }, { caption: url, supports_streaming: true });
                    const file_id = msg?.video?.file_id || msg?.document?.file_id;
                    if (file_id) {
                        await saveVideoFile({
                            platform: 'instagram', video_id, format_key: fkey,
                            height: null, width: null, ext: 'mp4', itag: null, abr_kbps: null,
                            filesize: msg?.video?.file_size || null, telegram_file_id: file_id
                        });
                        await upsertVideo({ platform: 'instagram', video_id });
                    }
                    return msg;
                }
            } catch (e) {
                console.warn('Telegram URL send failed, fallback to buffer:', e.message);
                // URL orqali yuborish bo‘lmadi — buf/filename bilan yuboramiz
                const res = await fetch(first.url);
                const buf = Buffer.from(await res.arrayBuffer());
                const tmp = `/tmp/ig_${video_id}.mp4`;
                await fs.writeFile(tmp, buf);
                const msg = await ctx.replyWithVideo({ source: tmp, filename: `ig_${video_id}.mp4` }, { caption: url, supports_streaming: true });
                const file_id = msg?.video?.file_id || msg?.document?.file_id;
                if (file_id) {
                    await saveVideoFile({
                        platform: 'instagram', video_id, format_key: fkey,
                        height: null, width: null, ext: 'mp4', itag: null, abr_kbps: null,
                        filesize: msg?.video?.file_size || null, telegram_file_id: file_id
                    });
                    await upsertVideo({ platform: 'instagram', video_id });
                }
                try { await fs.unlink(tmp); } catch { }
                return msg;
            }
        }
    } catch (e) {
        console.error('RapidAPI IG error:', e?.response?.data || e?.message || e);
        // davomida yt-dlp fallbackga tushamiz
    }

    // 2) FALLBACK: yt-dlp (faqat provider hech narsa qaytarmasa)
    const tmpRaw = `/tmp/ig_${video_id}_raw.mp4`;
    try {
        await igDownloadRaw(url, tmpRaw);
    } catch (e) {
        console.error('yt-dlp IG error:', e?.stderr || e?.message || e);
        return ctx.reply('Xato: Instagram media olinmadi (private yoki rate-limit).');
    }

    const out = `/tmp/ig_${video_id}.mp4`;
    await ffmpegTranscodeToH264(tmpRaw, out);

    const sent = await ctx.replyWithVideo({ source: out, filename: `${video_id}.mp4` }, { supports_streaming: true });
    const size = sent?.video?.file_size || 0;
    if (opts.tier === 'free' && size > 10 * 1024 * 1024)
        await ctx.reply('>10MB. Premium kerak.');

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
    try { await fs.unlink(tmpRaw); } catch { }
    try { await fs.unlink(out); } catch { }
}