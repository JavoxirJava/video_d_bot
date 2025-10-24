import { Worker } from 'bullmq';
import { CFG } from '../config.js';
import { connection } from './connection.js';
import { processJob } from '../workers/processJob.js';

const QNAME = (CFG.QUEUE_NAME || 'ig_download').replace(/:/g, '-');
console.log('[QUEUE][Instagram] Worker QNAME =', QNAME);

export function startWorker() {
    const worker = new Worker(QNAME, processJob, {
        connection,
        concurrency: CFG.WORKER_CONCURRENCY,
    });

    worker.on('ready', () => console.log('[QUEUE][Instagram] 🛠️  Worker ready'));
    worker.on('active', (job) => console.log('[QUEUE][Instagram] ▶️ active', job.id));
    worker.on('completed', (job) => console.log('[QUEUE][Instagram] ✔️ completed', job.id));
    worker.on('failed', (job, err) => console.error('[QUEUE][Instagram] ❌ failed', job?.id, err?.message));
    worker.on('error', (err) => console.error('[QUEUE][Instagram] 💥 worker error', err));

    return worker;
}