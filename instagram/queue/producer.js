import { Queue } from 'bullmq';
import { CFG } from '../config.js';
import { connection } from './connection.js';
import { igCodeFromUrl } from '../utils.js';

const QNAME = (CFG.QUEUE_NAME || 'ig_download').replace(/:/g, '-');
console.log('[QUEUE][Instagram] Producer QNAME =', QNAME);

export const downloadQueue = new Queue(QNAME, {
    connection,
    defaultJobOptions: {
        attempts: 4,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,   // completed’larni darhol tozalaydi
        removeOnFail: 500,
    },
});

// --- yangi: jobId uchun faqat "safe" belgilar foydalanamiz ---
function makeJobId(chatId, igUrl) {
    const code = igCodeFromUrl(igUrl) || igUrl;
    const safe = String(code).replace(/[^a-zA-Z0-9_-]/g, '-'); // ":" va boshqalar -> "-"
    return `${chatId}-${safe}-${Date.now()}`;
}

// (ixtiyoriy) — agar waiting/active bo‘lsa dedupe
async function hasSimilarInFlight(chatId, igUrl) {
    const code = igCodeFromUrl(igUrl) || igUrl;
    const base = `${chatId}:${code}`;
    const jobs = await downloadQueue.getJobs(['waiting', 'active', 'delayed'], 0, 200);
    return jobs.some(j => {
        const d = j.data || {};
        const c = igCodeFromUrl(d.igUrl) || d.igUrl;
        return `${d.chatId}:${c}` === base;
    });
}

export async function enqueueDownload({ chatId, igUrl, replyToMessageId }) {
    if (await hasSimilarInFlight(chatId, igUrl)) {
        console.log('[QUEUE][Instagram] Skip duplicate in-flight for', chatId, igUrl);
        return null;
    }

    const jobId = makeJobId(chatId, igUrl);

    const job = await downloadQueue.add(
        'download',
        { chatId, igUrl, replyToMessageId },
        { jobId }
    );
    console.log('[QUEUE][Instagram] Enqueued job', job.id);
    return job;
}
