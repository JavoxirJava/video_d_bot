import { genericToMp4, igDownloadRaw, ffmpegTranscodeToH264 } from '../common/ytdlp.js';
import { formatKey } from '../common/utils.js';
import { getVideoFile, saveVideoFile, upsertVideo } from '../repositories/videos.js';


export async function handleInstagram(ctx, url, opts = { tier: 'free' }) {
    console.log('Instagram URL:', url, 'Tier:', opts.tier);

    // ID ni tozalab oling (fayl nomida xatoga yo'l qo'ymaslik uchun)
    const m = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([\w-]+)/i);
    const rawId = m?.[1] || String(Date.now());
    const video_id = rawId.replace(/[^a-zA-Z0-9_-]/g, "");

    const fkey = formatKey({ source: 'ig', height: null, ext: 'mp4' });

    const cached = await getVideoFile({ platform: 'instagram', video_id, format_key: fkey });
    console.log('Cached IG video:', cached);
    if (cached?.telegram_file_id)
        return ctx.replyWithVideo(cached.telegram_file_id, { supports_streaming: true });

    // 1) avval raw faylni yuklab olamiz (yt-dlp, postprocesssiz)
    const tmpRaw = `/tmp/ig_${video_id}_raw.mp4`;
    await igDownloadRaw(url, tmpRaw);

    // 2) keyin H.264 ga transkod qilamiz (barqaror playback)
    const out = `/tmp/ig_${video_id}.mp4`;
    await ffmpegTranscodeToH264(tmpRaw, out);

    // yuborish
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

    // vaqtinchalik fayllarni tozalash (best-effort)
    try { await fs.unlink(tmpRaw); } catch { }
    try { await fs.unlink(out); } catch { }
}