// src/queue/queue.js
import pkg from 'bullmq';
const { Queue } = pkg;              // <-- MUHIM: CJS dan destructure
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
    ...(process.env.REDIS_TLS ? { tls: {} } : {}),
    enableReadyCheck: false,
});

const queueName = 'musicQueue';

export const musicQueue = new Queue(queueName, { connection });

export async function enqueueDownloadBySpotify({ chatId, replyTo, title, artist, spotifyUrl, id }) {
    return musicQueue.add(
        'downloadBySpotify',
        { type: 'downloadBySpotify', chatId, replyTo, title, artist, spotifyUrl, id },
        { removeOnComplete: 200, removeOnFail: 200 }
    );
}

export async function enqueueRecognizeAndDownload({ chatId, replyTo, fileId, extGuess }) {
    return musicQueue.add(
        'recognizeAndDownload',
        { type: 'recognizeAndDownload', chatId, replyTo, fileId, extGuess },
        { removeOnComplete: 200, removeOnFail: 200 }
    );
}
