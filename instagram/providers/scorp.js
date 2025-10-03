import { rapid } from '../config.js';
import { typeFromUrl } from '../utils.js';

/**
* Fetch single media using 7scorp provider
* API: GET /index?url=<IG_URL>
* Response example: { media: "https://...mp4", thumbnail: "https://...jpg", Type: "Post-Video", title: "..." }
*/

export async function scorpFetch(igUrl) {
    const { data } = await rapid.get(process.env.RAPIDAPI_ENDPOINT || '/index', {
        params: { url: igUrl },
    });
    // Normalize to list of {type,url,thumb?,title?}
    const list = [];
    const mediaUrl = data?.media || data?.link || data?.url;
    const thumbUrl = data?.thumbnail || data?.thumb || data?.preview;
    const title = data?.title || data?.caption || undefined;
    if (mediaUrl) list.push({ type: typeFromUrl(mediaUrl), url: mediaUrl, thumb: thumbUrl, title });


    // Ba’zi hollarda carousel bo‘lishi mumkin — qo‘shimcha maydonlar
    const arrays = ['result', 'results', 'media', 'medias', 'items', 'data'];
    for (const k of arrays) {
        const arr = Array.isArray(data?.[k]) ? data[k] : null;
        if (arr) for (const it of arr) {
            const u = it?.media || it?.url || it?.download_url || it?.link;
            if (u) list.push({ type: typeFromUrl(u), url: u, thumb: it?.thumbnail || it?.preview, title: it?.title });
        }
    }
    return list;
}