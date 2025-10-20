import { ensureLimit, spend } from '../middlewares/limitsMW.js';
import { enqueueRecognizeAndDownload } from '../queue/queue.js';

export async function handleRecognition(ctx, fileId, extGuess = 'ogg') {
    if (!ensureLimit(ctx)) return;
    await enqueueRecognizeAndDownload({ chatId: ctx.chat.id, replyTo: ctx.message.message_id, fileId, extGuess });
    const left = spend(ctx);
    await ctx.reply('🔎 Tanib olish va yuklab berish — navbatga qo‘yildi. Qolgan: ' + left);
}