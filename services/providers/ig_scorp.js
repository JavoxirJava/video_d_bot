import { URL } from 'node:url';

const BASE = process.env.RAPIDAPI_BASE_URL;
const HOST = process.env.RAPIDAPI_HOST;
const ENDPOINT = process.env.RAPIDAPI_ENDPOINT || '/index';
const KEY = process.env.RAPIDAPI_KEY;

function typeFromUrl(u) {
    if (/\.(mp4|m3u8)(\?|$)/i.test(u)) return 'video';
    if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) return 'photo';
    return 'video';
}

export function canonicalIg(url) {
    try {
        const u = new URL(url);
        const m = u.pathname.match(/\/(reel|p)\/([A-Za-z0-9_-]+)\/?/);
        if (!m) return url;
        return `https://www.instagram.com/${m[1]}/${m[2]}/`;
    } catch { return url; }
}

export async function scorpFetch(igUrl) {
    const res = await fetch(u.toString(), {
        method: 'GET',
        headers: {
            'X-RapidAPI-Key': KEY,
            'X-RapidAPI-Host': HOST,
            'Accept': 'application/json'
        },
        // ko‘p holatda 10–20s yetadi, biroz zaxira:
        signal: AbortSignal.timeout(30_000)
    });

    const text = await res.text();
    if (!res.ok) {
        const e = new Error(`scorp http ${res.status}`);
        e.responseText = text;
        throw e;
    }
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }

    // Tipik javob: { media, thumbnail, title/ caption ... }
    const list = [];
    const mediaUrl = data?.media || data?.link || data?.url;
    const thumbUrl = data?.thumbnail || data?.thumb || data?.preview;
    const title = data?.title || data?.caption || undefined;
    if (mediaUrl) list.push({ type: typeFromUrl(mediaUrl), url: mediaUrl, thumb: thumbUrl, title });

    // Ba’zi javoblarda massivlar bo‘ladi (carousel)
    const arrays = ['result', 'results', 'media', 'medias', 'items', 'data'];
    for (const k of arrays) {
        const arr = Array.isArray(data?.[k]) ? data[k] : null;
        if (arr) {
            for (const it of arr) {
                const u2 = it?.media || it?.url || it?.download_url || it?.link;
                if (u2) list.push({
                    type: typeFromUrl(u2),
                    url: u2,
                    thumb: it?.thumbnail || it?.preview,
                    title: it?.title
                });
            }
        }
    }
    return list;
}
