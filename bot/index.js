import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { detectPlatform } from '../common/utils.js';
import { migrate } from '../db/index.js';
import { makeHttp } from '../http/server.js';
import { checkMembership } from '../instagram/middleware/checkMembership.js';
import { mainMenu, premiumCTA } from '../keyboards.js';
import { handleInstagram } from '../services/instagram.js';
import { ytButton, ytLink } from '../youtube/src/youtubeControl.js';
import { buttonMusic, buttonMusicPager, clickMusic, handleFindMusicFromVideo, handleVoiceMusic, registerMusicHandlers } from './music.js';
import { instagramDownload } from '../instagram/instagramDownload.js';

const bot = new Telegraf(process.env.BOT_TOKEN, { handlerTimeout: Infinity });
const session = new Map();

bot.start(async (ctx) => {
    await ctx.reply('Salom! Yuklamoqchi bo‘lgan linkni yuboring yoki menyudan tanlang.', mainMenu());
});

bot.use(checkMembership(bot));


// Callback handler for YouTube format buttons
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery?.data || '';
    console.log('Callback query:', data);

    try {
        if (data.startsWith('mpage|')) return buttonMusicPager(ctx);
        if (data.startsWith('music|')) await buttonMusic(ctx, data, bot); // clear loading state
        if (data.startsWith('d:')) return await ytButton(ctx, data);
        if (data.startsWith('aud|')) return handleFindMusicFromVideo(ctx, data);
        if (data === 'buy_premium') return ctx.reply('Premium sotib olish tez orada…', premiumCTA());
        if (data === 'menu_video') return ctx.reply('Link yuboring.');
        if (data === 'menu_music') return clickMusic(ctx, session);
        if (data === 'menu_ai') return ctx.reply('AI yordam tez orada…');
    } catch (e) {
        console.error('cb error', e); await ctx.answerCbQuery('Xatolik');
    }
});

// Text messages: detect URL(s)
bot.on('message', async (ctx) => {
    if (ctx.message?.voice || ctx.message?.audio) handleVoiceMusic(ctx, bot);
    if (!ctx.message?.text) return;
    if (session.get(ctx.from.id) === 'musicText') {
        registerMusicHandlers(ctx);
        return;
    }
    const text = ctx.message.text || '';
    const urls = (text.match(/https?:\/\/[\w%\-_.?&=#/]+/gi) || []).slice(0, 2);
    if (!urls.length) return ctx.reply('URL topilmadi.');


    for (const url of urls) {
        const p = detectPlatform(url);
        console.log('Platform:', p);
        try {
            if (p === 'youtube') await ytLink(ctx, url);
            else if (p === 'instagram') instagramDownload(ctx, url);
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