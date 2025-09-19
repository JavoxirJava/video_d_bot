import { Queue } from 'bullmq';

const connection = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const downloadQueue = new Queue('download', { connection });

export async function enqueueDownloadJob(payload) {
    // payload: { url, formatKey, preferMux, chatId, messageId }
    return downloadQueue.add('DOWNLOAD', payload, {
        removeOnComplete: 1000,
        removeOnFail: 200,
        attempts: 2,           // tarmoqli xatolarda qayta urinadi
        backoff: { type: 'exponential', delay: 2000 }
    });
}