import axios from 'axios';

const BASE = process.env.RAPIDAPI_BASE_URL;       // masalan: https://instagram-story-downloader-media-downloader.p.rapidapi.com
const HOST = process.env.RAPIDAPI_HOST;           // instagram-story-downloader-media-downloader.p.rapidapi.com
const KEY = process.env.RAPIDAPI_KEY;            // RapidAPI key
const EP = process.env.RAPIDAPI_ENDPOINT || '/index';

// KIRITILMAGAN ENV bo‘lsa, aniq xato bering
for (const [k, v] of Object.entries({ RAPIDAPI_BASE_URL: BASE, RAPIDAPI_HOST: HOST, RAPIDAPI_KEY: KEY })) {
    if (!v) throw new Error(`${k} .env da yo‘q`);
}

const http = axios.create({
    baseURL: BASE,
    headers: {
        'X-RapidAPI-Key': KEY,
        'X-RapidAPI-Host': HOST,
    },
    timeout: 30000,
});

// URLdan media/video/foto URL larini normalizatsiya
function typeFromUrl(url) {
    if (/\.(mp4|m3u8)(\?|$)/i.test(url)) return 'video';
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(url)) return 'photo';
    return 'video';
}

export async function scorpFetch(igUrl) {
    const { data } = await http.get(EP, { params: { url: igUrl } });

    const out = [];
    const pushOne = (obj) => {
        const u = obj?.media || obj?.url || obj?.download_url || obj?.link;
        if (!u) return;
        out.push({
            type: typeFromUrl(u),
            url: u,
            thumb: obj?.thumbnail || obj?.thumb || obj?.preview,
            title: obj?.title || obj?.caption,
        });
    };

    // 1) yagona obyekt
    if (data && (data.media || data.url || data.link)) pushOne(data);

    // 2) massiv bo‘lishi mumkin bo‘lgan maydonlar
    for (const k of ['result', 'results', 'media', 'medias', 'items', 'data']) {
        const arr = Array.isArray(data?.[k]) ? data[k] : null;
        if (arr) arr.forEach(pushOne);
    }

    return out;
}

// IG canonical URL (reel/p/<id>/ ko‘rinishga keltirish)
export function canonicalIg(url) {
    try {
        const uObj = new URL(url);
        const m = uObj.pathname.match(/\/(reel|p)\/([A-Za-z0-9_-]+)\/?/);
        if (!m) return url;
        return `https://www.instagram.com/${m[1]}/${m[2]}/`;
    } catch {
        return url;
    }
}