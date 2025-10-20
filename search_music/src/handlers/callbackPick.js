import { getPicks } from '../store/picks.js';
import { ensureLimit, spend } from '../middlewares/limitsMW.js';
import { enqueueDownloadBySpotify } from '../queue/queue.js';

export async function handleCallbackPick(ctx) {
    const d = ctx.callbackQuery?.data || '';
    const m = /^pick:(\d+):(\d+)$/.exec(d);
    if (!m) return ctx.answerCbQuery('Noto‘g‘ri so‘rov');

    const idx = parseInt(m[1], 10);
    const ownerId = m[2];
    if (String(ctx.from.id) !== ownerId) return ctx.answerCbQuery('Bu ro‘yxat siz uchun emas');

    const msg = ctx.callbackQuery.message;
    const list = getPicks(ctx.chat.id, msg.message_id);
    const item = list?.[idx];
    if (!item) return ctx.answerCbQuery('Topilmadi');

    await ctx.answerCbQuery('Navbatga qo‘yildi');
    if (!ensureLimit(ctx)) return;

    await enqueueDownloadBySpotify({
        chatId: ctx.chat.id,
        replyTo: msg.message_id,
        title: item.title,
        artist: item.artist,
        spotifyUrl: item.spotifyUrl,
        id: item.id,
    });

    const left = spend(ctx);
    await ctx.reply(`🎧 Yuklab olish navbatga qo‘yildi. Qolgan: ${left}`);
}