import 'dotenv/config';
import { Worker } from 'bullmq';
import { muxOrTranscode } from '../lib/ffmpegMuxOrTranscode.js';
import { Telegraf } from 'telegraf'; // yoki telegraf/grammy’dagi sender’ni alohida yozing

const connection = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const concurrency = Number(process.env.WORKER_CONCURRENCY || 2);

// ⛔ Bot tokenni bu yerda ishlatmaslik ham mumkin: o‘zingdagi sendLogikani import qil.
const bot = new Telegraf(process.env.BOT_TOKEN, { handlerTimeout: Infinity });

new Worker('download', async (job) => {
    const { url, formatKey, preferMux, chatId, messageId } = job.data;

    try {
        const outFilePath = await muxOrTranscode({ url, formatKey, preferMux });
        // tayyor bo‘ldi → jo‘natamiz
        await bot.sendVideo(chatId, outFilePath, { reply_to_message_id: messageId });
    } catch (e) {
        await bot.sendMessage(chatId, `❌ Xatolik: ${e.message || e}`);
        throw e;
    }
}, { connection, concurrency });
