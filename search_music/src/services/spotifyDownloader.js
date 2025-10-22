import axios from 'axios';
import fetch from 'node-fetch';
import fs from 'fs';

const HOST = process.env.RAPIDAPI_HOST || 'spotify-downloader9.p.rapidapi.com';
const KEY = process.env.RAPIDAPI_KEY;
if (!KEY) throw new Error('Missing RAPIDAPI_KEY');

const client = axios.create({ baseURL: `https://${HOST}`, headers: { 'X-RapidAPI-Key': KEY, 'X-RapidAPI-Host': HOST }, timeout: 20000 });

function extractLinksFromAny(payload) {
    const links = new Set();
    const addIfLink = (v) => {
        if (typeof v === 'string') {
            const re1 = /(https?:\/\/[^\s"'<>\\)]+(?:\.mp3|\.m4a|\.aac|\.wav)(?:\?[^\s"'<>\\)]*)?)/gi;
            let m; while ((m = re1.exec(v))) links.add(m[1]);
            const re2 = /(https?:\/\/[^\s"'<>\\)]+)/gi; while ((m = re2.exec(v))) links.add(m[1]);
        }
    };
    const walk = (x) => { if (x == null) return; if (typeof x !== 'object') return addIfLink(String(x)); if (Array.isArray(x)) return x.forEach(walk); Object.values(x).forEach(walk); };
    try { if (typeof payload === 'string') { addIfLink(payload); try { walk(JSON.parse(payload)); } catch { } return Array.from(links); } walk(payload); return Array.from(links); } catch { return []; }
}

// async function getDownloadUrl(spotifyUrl) {
//     const m = /track\/([A-Za-z0-9]+)/.exec(spotifyUrl);
//     const trackId = m ? m[1] : null;
//     const encodedUrl = encodeURIComponent(spotifyUrl);
//     console.log('[spotifyDownloader.js] Getting download URL for:', spotifyUrl, 'trackId:', trackId);
    

//     const tries = [
//         { method: 'get', url: `/downloadSong`, params: { songId: spotifyUrl }, asText: true },
//         { method: 'get', url: `/downloadSong?songId=${encodedUrl}`, asText: true },
//         ...(trackId ? [
//             { method: 'get', url: `/downloadSong`, params: { songId: trackId }, asText: true },
//             { method: 'get', url: `/downloadSong`, params: { trackId }, asText: true },
//             { method: 'get', url: `/downloadSong`, params: { id: trackId }, asText: true },
//             { method: 'get', url: `/downloadSong`, params: { songId: `spotify:track:${trackId}` }, asText: true },
//         ] : []),
//         { method: 'get', url: `/downloadSong`, params: { url: spotifyUrl }, asText: true },
//         { method: 'get', url: `/downloadSong`, params: { link: spotifyUrl }, asText: true },
//     ];

//     let lastErr;
//     for (const t of tries) {
//         try {
//             const { data, status } = await client.request({ method: t.method, url: t.url, params: t.params, responseType: t.asText ? 'text' : 'json', transformResponse: x => x });
//             const preview = typeof data === 'string' ? data.slice(0, 400) : JSON.stringify(data)?.slice(0, 400);
//             console.log('Downloader variant ok:', t.method?.toUpperCase(), t.url, t.params || '', 'status=', status, 'body~', preview);
//             let parsed = null; try { parsed = typeof data === 'string' ? JSON.parse(data) : data; } catch { }
//             const direct = parsed?.download_url || parsed?.url || parsed?.link || parsed?.data?.download_url || parsed?.data?.url || parsed?.data?.link || null;
//             if (direct) return direct;
//             const links = extractLinksFromAny(parsed ?? data);
//             if (links.length) { const mp3 = links.find(u => /\.mp3($|\?)/i.test(u)); return mp3 || links[0]; }
//         } catch (e) { lastErr = e; const st = e?.response?.status; const body = e?.response?.data; console.log('Downloader variant fail:', t.method?.toUpperCase(), t.url, t.params || '', 'status=', st, 'body~', typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)?.slice(0, 300)); continue; }
//     }
//     throw lastErr || new Error('No valid download URL in response');
// }

// o'zgartirilgan getDownloadUrl
async function getDownloadUrl(spotifyUrl) {
    const debugPrefix = '[spotifyDownloader.js]';
    // normalize incoming (accept spotify:track:ID or full URL)
    let trackId = null;
    // try spotify:track:XXXXXXXX
    const m1 = /spotify:track:([A-Za-z0-9_-]{10,})/i.exec(spotifyUrl);
    if (m1) trackId = m1[1];

    // try open.spotify.com/track/ID (ID is usually 22 chars but allow flexible)
    const m2 = /open\.spotify\.com\/track\/([A-Za-z0-9_-]{10,})/i.exec(spotifyUrl);
    if (m2) trackId = trackId || m2[1];

    // fallback: any /track/<id> pattern
    if (!trackId) {
        const m3 = /\/track\/([A-Za-z0-9_-]{10,})/i.exec(spotifyUrl);
        if (m3) trackId = m3[1];
    }

    // also remove query params if someone passed an ID with ?...
    if (trackId) trackId = trackId.split('?')[0].split('/')[0];

    const encodedUrl = encodeURIComponent(spotifyUrl);
    console.log(`${debugPrefix} Getting download URL for:`, spotifyUrl, 'trackId:', trackId);

    // Keep the tries minimal and consistent: ONLY use 'songId' param (server expects it).
    const tries = [];

    // prefer trackId numeric/short id (most servers accept that)
    if (trackId) {
        tries.push({ method: 'get', url: `/downloadSong`, params: { songId: trackId }, asText: true });
        tries.push({ method: 'get', url: `/downloadSong`, params: { songId: `spotify:track:${trackId}` }, asText: true });
    }

    // then try full URL as songId (encoded automatically by axios)
    tries.push({ method: 'get', url: `/downloadSong`, params: { songId: spotifyUrl }, asText: true });
    // also try encoded in path (some endpoints expect it)
    tries.push({ method: 'get', url: `/downloadSong?songId=${encodedUrl}`, asText: true });

    let lastErr = null;
    for (const t of tries) {
        try {
            // build request options explicitly
            const reqOpts = {
                method: t.method,
                url: t.url,
                responseType: t.asText ? 'text' : 'json',
                transformResponse: x => x,
                // only attach params if provided (avoid sending undefined)
                ...(t.params ? { params: t.params } : {})
            };
            const { data, status } = await client.request(reqOpts);
            const preview = typeof data === 'string' ? data.slice(0, 800) : JSON.stringify(data)?.slice(0, 800);
            console.log(`${debugPrefix} Downloader variant ok:`, t.method.toUpperCase(), t.url, t.params || '', 'status=', status, 'body~', preview);

            // try parse
            let parsed = null;
            try { parsed = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) {
                // not JSON, but may contain links
            }

            // If server explicitly returned success:false, log full parsed for debugging
            if (parsed && parsed.success === false) {
                console.warn(`${debugPrefix} Server returned success:false — message:`, parsed.message || parsed.error || '(no message)');
                // continue to next try (maybe other format works)
            }

            // try common fields for direct link
            const direct = parsed?.download_url || parsed?.url || parsed?.link || parsed?.data?.download_url || parsed?.data?.url || parsed?.data?.link || null;
            if (direct) return direct;

            // fallback: extract links from whatever returned
            const links = extractLinksFromAny(parsed ?? data);
            if (links.length) {
                const mp3 = links.find(u => /\.mp3($|\?)/i.test(u));
                return mp3 || links[0];
            }

            // nothing useful, continue to next variant
        } catch (e) {
            lastErr = e;
            const st = e?.response?.status;
            const body = e?.response?.data;
            // better error logging: include response body if possible
            console.log(`${debugPrefix} Downloader variant fail:`, t.method.toUpperCase(), t.url, t.params || '', 'status=', st, 'body~', typeof body === 'string' ? body.slice(0, 800) : JSON.stringify(body)?.slice(0, 800));
            // if 400 and missing songId, we should stop trying other param names — but our tries only use songId so continue
            continue;
        }
    }
    // if all fails, throw last error but with more context
    const err = lastErr || new Error('No valid download URL in response');
    err.context = { spotifyUrl, trackId };
    throw err;
}


async function downloadWithHeaders(url, outPath) {
    const headers = {
        'User-Agent': 'Mozilla/5.0',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Referer': `https://${HOST}/`,
        'Origin': `https://${HOST}`,
    };
    try {
        const resp = await import('axios').then(({ default: ax }) => ax.get(url, { responseType: 'stream', headers, timeout: 30000, maxRedirects: 5 }));
        await new Promise((resolve, reject) => { const w = fs.createWriteStream(outPath); resp.data.pipe(w); resp.data.on('error', reject); w.on('finish', resolve); });
        return outPath;
    } catch { }
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    await new Promise((resolve, reject) => { const w = fs.createWriteStream(outPath); res.body.pipe(w); res.body.on('error', reject); w.on('finish', resolve); });
    return outPath;
}

export async function downloadSpotifyTrack(spotifyUrl, outPath) {
    // Retry a couple times because some links expire
    let lastErr;
    for (let i = 0; i < 2; i++) {
        try {
            const dl = await getDownloadUrl(spotifyUrl);
            console.log('Chosen download URL:', dl);
            return await downloadWithHeaders(dl, outPath);
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Download failed after retries');
}