import 'dotenv/config';
import axios from 'axios';


export const CFG = {
    BOT_TOKEN: process.env.V_BOT_TOKEN,
    BOT_USERNAME: process.env.BOT_USERNAME,
    RAPIDAPI_KEY: process.env.RAPIDAPI_KEY,
    RAPIDAPI_HOST: process.env.RAPIDAPI_HOST,
    RAPIDAPI_BASE_URL: process.env.RAPIDAPI_BASE_URL,
    RAPIDAPI_ENDPOINT: process.env.RAPIDAPI_ENDPOINT || '/index',
    REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    QUEUE_NAME: process.env.QUEUE_NAME || 'ig:download',
    WORKER_CONCURRENCY: Number(process.env.WORKER_CONCURRENCY || 2),
    RATE_GAP_MS: Number(process.env.RATE_GAP_MS || 0),
    DEBUG_JSON: /^true$/i.test(process.env.DEBUG_JSON || ''),
    REQUIRED_CHANNELS: process.env.REQUIRED_CHANNELS || '',
};


for (const k of ['BOT_TOKEN', 'RAPIDAPI_KEY', 'RAPIDAPI_HOST', 'RAPIDAPI_BASE_URL']) {
    if (!CFG[k]) throw new Error(`${k} .env da topilmadi`);
}

export const rapid = axios.create({
    baseURL: CFG.RAPIDAPI_BASE_URL,
    headers: {
        'X-RapidAPI-Key': CFG.RAPIDAPI_KEY,
        'X-RapidAPI-Host': CFG.RAPIDAPI_HOST,
    },
    timeout: 30000,
});