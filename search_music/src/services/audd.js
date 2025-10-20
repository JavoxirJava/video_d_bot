import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

const AUDD_ENDPOINT = 'https://api.audd.io/';

export async function recognizeWithAudD(filePath) {
    const token = process.env.AUDD_API_TOKEN;
    if (!token) throw new Error('Missing AUDD_API_TOKEN');
    const form = new FormData();
    form.append('api_token', token);
    form.append('return', 'spotify');
    form.append('file', fs.createReadStream(filePath)); // IMPORTANT: 'file'

    const { data } = await axios.post(AUDD_ENDPOINT, form, {
        headers: { ...form.getHeaders(), 'Accept': 'application/json' },
        timeout: 20000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
    return data;
}

export function extractSpotifyUrlFromAudD(auddData) {
    const url = auddData?.result?.spotify?.external_urls?.spotify
        || auddData?.result?.spotify?.url
        || null;
    return url;
}

export function extractTitleArtistFromAudD(auddData) {
    const artist = auddData?.result?.artist || null;
    const title = auddData?.result?.title || null;
    return { artist, title };
}