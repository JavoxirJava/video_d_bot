import { Worker } from 'bullmq';
import { CFG } from '../config.js';
import { connection } from './connection.js';
import { processJob } from '../workers/processJob.js';

const QNAME = (CFG.QUEUE_NAME || 'ig_download').replace(/:/g, '-');
console.log('[ InstagramQUEUE] Worker QNAME =', QNAME);

export function startWorker() {
    const worker = new Worker(QNAME, processJob, {
        connection,
        concurrency: CFG.WORKER_CONCURRENCY,
    });

    worker.on('ready', () => console.log('🛠️ Instagram  Worker ready'));
    worker.on('active', (job) => console.log('▶️ Instagram active', job.id));
    worker.on('completed', (job) => console.log('✔️ Instagram completed', job.id));
    worker.on('failed', (job, err) => console.error('❌ Instagram failed', job?.id, err?.message));
    worker.on('error', (err) => console.error('💥 Instagram worker error', err));

    return worker;
}