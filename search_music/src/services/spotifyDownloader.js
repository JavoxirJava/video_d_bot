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

async function getDownloadUrl(spotifyUrl) {
    const m = /track\/([A-Za-z0-9]+)/.exec(spotifyUrl);
    const trackId = m ? m[1] : null;
    const encodedUrl = encodeURIComponent(spotifyUrl);

    const tries = [
        { method: 'get', url: `/downloadSong`, params: { songId: spotifyUrl }, asText: true },
        { method: 'get', url: `/downloadSong?songId=${encodedUrl}`, asText: true },
        ...(trackId ? [
            { method: 'get', url: `/downloadSong`, params: { songId: trackId }, asText: true },
            { method: 'get', url: `/downloadSong`, params: { trackId }, asText: true },
            { method: 'get', url: `/downloadSong`, params: { id: trackId }, asText: true },
            { method: 'get', url: `/downloadSong`, params: { songId: `spotify:track:${trackId}` }, asText: true },
        ] : []),
        { method: 'get', url: `/downloadSong`, params: { url: spotifyUrl }, asText: true },
        { method: 'get', url: `/downloadSong`, params: { link: spotifyUrl }, asText: true },
    ];

    let lastErr;
    for (const t of tries) {
        try {
            const { data, status } = await client.request({ method: t.method, url: t.url, params: t.params, responseType: t.asText ? 'text' : 'json', transformResponse: x => x });
            const preview = typeof data === 'string' ? data.slice(0, 400) : JSON.stringify(data)?.slice(0, 400);
            console.log('Downloader variant ok:', t.method?.toUpperCase(), t.url, t.params || '', 'status=', status, 'body~', preview);
            let parsed = null; try { parsed = typeof data === 'string' ? JSON.parse(data) : data; } catch { }
            const direct = parsed?.download_url || parsed?.url || parsed?.link || parsed?.data?.download_url || parsed?.data?.url || parsed?.data?.link || null;
            if (direct) return direct;
            const links = extractLinksFromAny(parsed ?? data);
            if (links.length) { const mp3 = links.find(u => /\.mp3($|\?)/i.test(u)); return mp3 || links[0]; }
        } catch (e) { lastErr = e; const st = e?.response?.status; const body = e?.response?.data; console.log('Downloader variant fail:', t.method?.toUpperCase(), t.url, t.params || '', 'status=', st, 'body~', typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body)?.slice(0, 300)); continue; }
    }
    throw lastErr || new Error('No valid download URL in response');
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