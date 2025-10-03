// src/middleware/checkMembership.js
import { CFG } from '../config.js';
import { Markup } from 'telegraf';

export function checkMembership(bot) {
    const raw = (CFG.REQUIRED_CHANNELS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    if (!raw.length) {
        console.log('[CHECK] REQUIRED_CHANNELS bo‘sh, membership check o‘chirilgan.');
        return (ctx, next) => next();
    }

    // join tugmalari uchun faqat public @kanallarni tutib olamiz
    const joinButtons = raw
        .filter(c => /^@/.test(c))
        .map(c => Markup.button.url(c, `https://t.me/${c.replace(/^@/, '')}`));

    return async (ctx, next) => {
        const userId = ctx.from?.id;
        if (!userId) return next(); // bot service messages va h.k.

        try {
            for (const chan of raw) {
                try {
                    const member = await bot.telegram.getChatMember(chan, userId);
                    const ok = ['member', 'administrator', 'creator'].includes(member.status);
                    if (!ok) {
                        // hali a'zo emas
                        return ctx.reply(
                            `❗ Botdan foydalanish uchun quyidagi kanal(lar)ga obuna bo‘ling:`,
                            joinButtons.length
                                ? Markup.inlineKeyboard(joinButtons.map(b => [b]))
                                : undefined
                        );
                    }
                } catch (e) {
                    // Bu xatolar odatda: bot kanalga qo‘shilmagan / admin emas / kanal topilmadi
                    console.error('getChatMember error on', chan, e.message || e);
                    // Foydalanuvchiga tushunarli xabar + join tugmalari (agar public bo‘lsa)
                    return ctx.reply(
                        `⚠️ Kanalni tekshirib bo‘lmadi.\n` +
                        `Iltimos, botni *kanalga admin* qilib qo‘shing va @username to‘g‘ri ekanini tekshiring.\n` +
                        `Kanal: ${chan}`,
                        joinButtons.length
                            ? Markup.inlineKeyboard(joinButtons.map(b => [b]))
                            : undefined
                    );
                }
            }

            // Hammasiga a'zo bo‘lsa
            return next();
        } catch (err) {
            console.error('checkMembership fatal:', err);
            return ctx.reply('⚠️ Obuna tekshirishda xatolik yuz berdi. Keyinroq urinib ko‘ring.');
        }
    };
}
