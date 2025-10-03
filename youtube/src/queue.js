import IORedis from 'ioredis';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { config } from './config.js';

export const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export const downloadQueue = new Queue('download' , { connection });
export const downloadEvents = new QueueEvents('download', { connection });

// Worker alohida processda ishga tushadi (src/worker.js)
export { Worker };
