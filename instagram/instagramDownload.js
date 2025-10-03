import { enqueueDownload } from './queue/producer.js';

export async function instagramDownload(ctx, url) {
    const reply = await ctx.reply('⏳ Video yuklanmoqda, biroz kuting...');
    await enqueueDownload({ chatId: ctx.chat.id, igUrl: url, replyToMessageId: reply.message_id });
}