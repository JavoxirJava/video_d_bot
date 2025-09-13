import { genericToMp4 } from '../common/ytdlp.js';
import { formatKey } from '../common/utils.js';
import { getVideoFile, saveVideoFile, upsertVideo } from '../repositories/videos.js';


export async function handleInstagram(ctx, url, opts = { tier: 'free' }) {
    // extract id from url path (best-effort)
    const m = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([\w-]+)/i);
    const video_id = m?.[1] || String(Date.now());
    const fkey = formatKey({ source: 'ig', height: null, ext: 'mp4' });


    const cached = await getVideoFile({ platform: 'instagram', video_id, format_key: fkey });
    if (cached?.telegram_file_id) return ctx.replyWithVideo(cached.telegram_file_id, { supports_streaming: true });


    const out = `/tmp/ig_${video_id}.mp4`;
    await genericToMp4(url, out, 'instagram');


    // check size (simulate, Telegraf returns size only after send)
    const sent = await ctx.replyWithVideo({ source: out, filename: `${video_id}.mp4` }, { supports_streaming: true });
    const size = sent?.video?.file_size || 0;
    if (opts.tier === 'free' && size > 10 * 1024 * 1024) {
        await ctx.reply('>10MB. Premium kerak.');
    }
    const file_id = sent?.video?.file_id || sent?.document?.file_id;
    if (file_id) {
        await saveVideoFile({ platform: 'instagram', video_id, format_key: fkey, height: null, width: null, ext: 'mp4', itag: null, abr_kbps: null, filesize: size, telegram_file_id: file_id });
        await upsertVideo({ platform: 'instagram', video_id });
    }
}