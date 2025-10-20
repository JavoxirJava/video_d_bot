import axios from 'axios';
import qs from 'qs';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
let cached = { token: null, expiresAt: 0 };

async function getToken() {
    const id = process.env.SPOTIFY_CLIENT_ID;
    const secret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !secret) throw new Error('Missing SPOTIFY_CLIENT_ID/SECRET');
    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const now = Date.now();
    if (cached.token && cached.expiresAt - 30000 > now) return cached.token;
    const { data } = await axios.post(TOKEN_URL, qs.stringify({ grant_type: 'client_credentials' }), {
        headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
    });
    cached.token = data.access_token;
    cached.expiresAt = now + (data.expires_in * 1000);
    return cached.token;
}

export async function searchSpotifyTracks(query, { limit = 5, market = 'US' } = {}) {
    const token = await getToken();
    const { data } = await axios.get(`${API_BASE}/search`, {
        params: { q: query, type: 'track', limit, market },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
    });
    const items = data?.tracks?.items || [];
    return items.map(t => ({
        id: t.id,
        title: t.name,
        artist: t.artists?.map(a => a.name).join(', '),
        durationMs: t.duration_ms,
        spotifyUrl: t.external_urls?.spotify,
    }));
}

export async function getTrackByUrl(spotifyUrl) {
    const m = /track\/([A-Za-z0-9]+)/.exec(spotifyUrl);
    if (!m) return null;
    const id = m[1];
    const token = await getToken();
    const { data } = await axios.get(`${API_BASE}/tracks/${id}`, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
    return { id: data.id, title: data.name, artist: data.artists?.map(a => a.name).join(', '), durationMs: data.duration_ms, spotifyUrl: data.external_urls?.spotify };
}