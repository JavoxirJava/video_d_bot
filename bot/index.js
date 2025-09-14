import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { migrate } from '../db/index.js';
import { ensureSubscribed } from '../middlewares/subscription.js';
import { detectPlatform } from '../common/utils.js';
import { askYoutubeFormat, handleYoutubeChoice } from '../services/youtube.js';
import { handleInstagram } from '../services/instagram.js';
import { mainMenu, premiumCTA } from '../keyboards.js';
import { makeHttp } from '../http/server.js';

const bot = new Telegraf(process.env.BOT_TOKEN, { handlerTimeout: Infinity });

bot.start(async (ctx) => {
    await ctx.reply('Salom! Yuklamoqchi bo‘lgan linkni yuboring yoki menyudan tanlang.', mainMenu());
});

bot.use(ensureSubscribed);

// Callback handler for YouTube format buttons
bot.on('callback_query', async (ctx) => {
    console.log('Callback query:', ctx.callbackQuery);
    const data = ctx.callbackQuery?.data || '';
    try {
        if (data.startsWith('yt|')) return await handleYoutubeChoice(ctx, data);
        if (data === 'buy_premium') return ctx.reply('Premium sotib olish tez orada…', premiumCTA());
        if (data === 'menu_video') return ctx.reply('Link yuboring.');
        if (data === 'menu_music') return ctx.reply('Musiqa qidirish tez orada…');
        if (data === 'menu_ai') return ctx.reply('AI yordam tez orada…');
    } catch (e) {
        console.error('cb error', e); await ctx.answerCbQuery('Xatolik');
    }
});

// Text messages: detect URL(s)
bot.on('text', async (ctx) => {
    const text = ctx.message.text || '';
    const urls = (text.match(/https?:\/\/[\w%\-_.?&=#/]+/gi) || []).slice(0, 2);
    if (!urls.length) return ctx.reply('URL topilmadi.');


    for (const url of urls) {
        const p = detectPlatform(url);
        console.log('Platform:', p);
        try {
            if (p === 'youtube') await askYoutubeFormat(ctx, url);
            else if (p === 'instagram') await handleInstagram(ctx, url, { tier: 'free' });
            else ctx.reply('Hozircha YouTube/Instagram.');
        } catch (e) {
            console.error('Download error:', e?.stderr || e?.message || e);
            await ctx.reply('Yuklashda xatolik. Keyinroq urinib ko‘ring.');
        }
    }
});

(async function main() {
    await migrate();
    await bot.launch();
    console.log('Bot ishga tushdi ✅');
    makeHttp();
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();