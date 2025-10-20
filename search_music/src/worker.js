import 'dotenv/config';
import pkg from 'bullmq';
const { Worker, QueueEvents } = pkg;
import IORedis from 'ioredis';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Telegraf } from 'telegraf';

import { downloadToFile, toWav, makeRecognitionSample } from './utils/audio.js';
import { recognizeWithAudD, extractSpotifyUrlFromAudD, extractTitleArtistFromAudD } from './services/audd.js';
import { searchSpotifyTracks, getTrackByUrl } from './services/spotify.js';
import { downloadSpotifyTrack } from './services/spotifyDownloader.js';


const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    // BullMQ talab qiladi:
    maxRetriesPerRequest: null,
    // Agar Redis TLS (Upstash/Cloud) bo'lsa, .env dan REDIS_TLS=1 qilib:
    ...(process.env.REDIS_TLS ? { tls: {} } : {}),
    // (ixtiyoriy) tezroq start uchun:
    enableReadyCheck: false,
});
const queueName = 'musicQueue';
const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '3', 10);

const telegram = new Telegraf(process.env.BOT_TOKEN).telegram; // sending only

// Worker: processes two job types
// 1) downloadBySpotify { chatId, replyTo, title, artist, spotifyUrl?, id? }
// 2) recognizeAndDownload { chatId, replyTo, fileId, extGuess }

const worker = new Worker(queueName, async (job) => {
    const data = job.data || {};
    const type = data.type;

    if (type === 'downloadBySpotify') {
        const { chatId, replyTo, title, artist } = data;
        
        let { spotifyUrl, id } = data;

        if (!spotifyUrl && id) spotifyUrl = `https://open.spotify.com/track/${id}`;
        if (!spotifyUrl) throw new Error('No spotifyUrl or id');

        const outPath = path.join(os.tmpdir(), `${artist || 'unknown'} - ${title || 'track'}.mp3`);

        await telegram.sendChatAction(chatId, 'upload_document');
        await downloadSpotifyTrack(spotifyUrl, outPath);

        const stats = fs.statSync(outPath);

        if (stats.size <= 49 * 1024 * 1024)
            await telegram.sendAudio(chatId, { source: outPath }, { title, performer: artist, reply_to_message_id: replyTo });
        else await telegram.sendDocument(chatId, { source: outPath }, { caption: `${artist || ''} — ${title || ''}`, reply_to_message_id: replyTo });
        console.log('[worker] replayTo:', replyTo);

        fs.unlinkSync(outPath);
        return { ok: true };
    }

    if (type === 'recognizeAndDownload') {
        const { chatId, replyTo, fileId, extGuess = 'ogg' } = data;

        const fileLink = await telegram.getFileLink(fileId);

        const inPath = path.join(os.tmpdir(), `input_${Date.now()}.${extGuess}`);
        const wavPath = path.join(os.tmpdir(), `rec_${Date.now()}.wav`);
        const samplePath = path.join(os.tmpdir(), `sample_${Date.now()}.mp3`);

        await downloadToFile(fileLink.href, inPath);
        await toWav(inPath, wavPath);
        await makeRecognitionSample(wavPath, samplePath);

        const audd = await recognizeWithAudD(samplePath);

        let spotifyUrl = extractSpotifyUrlFromAudD(audd);
        let info = null;

        if (!spotifyUrl) {
            const { artist, title } = extractTitleArtistFromAudD(audd);
            if (!artist || !title) throw new Error('AudD found no artist/title');
            const candidates = await searchSpotifyTracks(`${artist} ${title}`, { limit: 5 });
            if (!candidates.length) throw new Error('Spotify search empty');
            info = candidates[0];
            spotifyUrl = info.spotifyUrl || (info.id ? `https://open.spotify.com/track/${info.id}` : null);
            if (!spotifyUrl) throw new Error('Cannot build spotifyUrl');
        }
        if (!info) info = await getTrackByUrl(spotifyUrl);
        if (!info) throw new Error('getTrackByUrl returned null');

        const outPath = path.join(os.tmpdir(), `${info.artist} - ${info.title}.mp3`);

        await telegram.sendChatAction(chatId, 'upload_document');
        await downloadSpotifyTrack(info.spotifyUrl || spotifyUrl, outPath);

        const stats = fs.statSync(outPath);
        if (stats.size <= 49 * 1024 * 1024)
            await telegram.sendAudio(chatId, { source: outPath }, { title: info.title, performer: info.artist, reply_to_message_id: replyTo });
        else await telegram.sendDocument(chatId, { source: outPath }, { caption: `${info.artist} — ${info.title}`, reply_to_message_id: replyTo });

        fs.unlinkSync(inPath); fs.unlinkSync(wavPath); fs.unlinkSync(samplePath); fs.unlinkSync(outPath);
        return { ok: true };
    }

    throw new Error('Unknown job type');
}, { connection, concurrency });

const events = new QueueEvents(queueName, { connection });
events.on('completed', ({ jobId }) => console.log('[worker] completed', jobId));
events.on('failed', ({ jobId, failedReason }) => console.error('[worker] failed', jobId, failedReason));

console.log('Worker started with concurrency=', concurrency);