import { Markup } from 'telegraf';
import { searchSpotifyTracks } from '../services/spotify.js';
import { mmss } from '../utils/helpers.js';
import { setPicks } from '../store/picks.js';
import { ensureLimit } from '../middlewares/limitsMW.js';

export async function handleSongCommand(ctx) {
    // const q = ctx.message.text.replace(/^\/song\s*/i, '').trim();
    // if (!q) return ctx.reply('Format: `/song artist - title`', { parse_mode: 'Markdown' });
    const q = ctx.message.text;
    if (!ensureLimit(ctx)) return;
    try {
        await ctx.replyWithChatAction('typing');
        const items = await searchSpotifyTracks(q, { limit: 5 });
        if (!items.length) return ctx.reply('Topilmadi.');

        const rows = items.map((r, i) => [
            Markup.button.callback(`${i + 1}) ${r.artist} — ${r.title} ${r.durationMs ? '(' + mmss(r.durationMs) + ')' : ''}`, `pick:${i}:${ctx.from.id}`)
        ]);

        const sent = await ctx.reply(`Natijalar: “${q}”`, Markup.inlineKeyboard(rows));
        setPicks(ctx.chat.id, sent.message_id, items);
    } catch (e) {
        console.error(e);
        ctx.reply('❌ Xatolik: ' + (e?.response?.status || e.message || 'nomalum'));
    }
}