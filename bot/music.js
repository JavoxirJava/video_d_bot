import { recognizeFree } from '../music/recognize_free.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { downloadMp3ByQuery } from '../music/download.js';
import { searchItunesSongs } from '../music/itunes.js';

const PAGE_SIZE = 6;
const CACHE_TTL_MS = 5 * 60 * 1000;
const musicSearchCache = new Map();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function pagesCount(items) { return Math.max(1, Math.ceil(items.length / PAGE_SIZE)); }

function cleanupMusicCache() {
    const now = Date.now();
    for (const [k, v] of musicSearchCache) if (v.exp < now) musicSearchCache.delete(k);
}

function buildKeyboardForPage(items, token, page) {
    const total = pagesCount(items);
    const p = Math.min(Math.max(1, page), total);
    const start = (p - 1) * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);

    const rows = slice.map(r => ([
        { text: `🎵 ${r.title} — ${r.artist}`, callback_data: `music|${r.external_id}` }
    ]));

    // pastgi ⬅️ / ➡️ navigatsiya
    const nav = [];
    if (p > 1) nav.push({ text: '⬅️', callback_data: `mpage|${token}|${p - 1}` });
    if (p < total) nav.push({ text: '➡️', callback_data: `mpage|${token}|${p + 1}` });
    if (nav.length) rows.push(nav);

    return { rows, page: p, total };
}

function makeTrackKey({ title, artist, duration_sec, kbps }) {
    const s = `${(artist || '').toLowerCase()}|${(title || '').toLowerCase()}|${duration_sec || 0}|${kbps || 0}`;
    return crypto.createHash('sha1').update(s).digest('hex');
}

export async function clickMusic(ctx, session) {
    await ctx.reply('Qo‘shiq nomi yoki ijrochi ismini yuboring. Masalan: "Eminem Lose Yourself"');
    session.set(ctx.from.id, 'musicText');
}

export async function buttonMusic(ctx, data, bot) {
    const extId = data.split('|')[1];
    let send = null;

    // tracks dan metadata olamiz
    const { rows } = await pool.query(
        'SELECT * FROM tracks WHERE source=$1 AND external_id=$2 ORDER BY id DESC LIMIT 1',
        ['itunes', extId]
    );
    const t = rows[0];
    if (!t) {
        await ctx.answerCbQuery('Ma’lumot topilmadi', { show_alert: true });
        return;
    }

    const kbps = ctx.from?.is_premium ? 192 : Number(process.env.MUSIC_FREE_MAX_BITRATE || 128);
    const key = makeTrackKey({ title: t.title, artist: t.artist, duration_sec: t.duration_sec, kbps });

    // kesh: track_files dan tekshiramiz
    const kq = await pool.query('SELECT * FROM track_files WHERE track_key=$1 LIMIT 1', [key]);
    if (kq.rows[0]?.telegram_file_id) {
        await ctx.answerCbQuery('Keshdan');
        return ctx.replyWithAudio(kq.rows[0].telegram_file_id, {
            title: t.title, performer: t.artist, caption: `${t.title} — ${t.artist}`
        });
    }
    send = await ctx.reply(`⌛️ Yuklanmoqda Iltimos kuting...`);
    await ctx.answerCbQuery('Yuklanmoqda…');

    const tmp = `/tmp/${key}.mp3`;
    try {
        // YouTube’da matn bo‘yicha eng mos audio → MP3
        await downloadMp3ByQuery(`${t.title} ${t.artist}`, tmp, kbps);

        const sent = await ctx.replyWithAudio(
            { source: tmp, filename: `${t.artist} - ${t.title}.mp3` },
            { title: t.title, performer: t.artist, caption: `${t.title} — ${t.artist}` }
        );

        ctx.telegram.deleteMessage(ctx.chat.id, send.message_id);
        const fileId = sent?.audio?.file_id || sent?.document?.file_id;

        if (fileId) {
            await pool.query(
                `INSERT INTO track_files(track_key, filesize, bitrate_kbps, telegram_file_id)
             VALUES($1,$2,$3,$4)
           ON CONFLICT (track_key) DO UPDATE SET telegram_file_id=EXCLUDED.telegram_file_id`,
                [key, sent?.audio?.file_size || null, kbps, fileId]
            );
        }
    } catch (e) {
        console.error('MP3 dl error:', e?.stderr || e);
        await await bot.telegram.editMessageText(ctx.chat.id, send.message_id, 'Yuklab bo‘lmadi. Boshqa natijani sinab ko‘ring.');
    } finally {
        fs.unlink(tmp).catch(() => { });
    }
}

export async function buttonMusicPager(ctx) {
    const data = ctx.callbackQuery?.data || '';
    if (!data.startsWith('mpage|')) return false; // boshqa handlerlarga qoldiramiz

    const [, token, pageStr] = data.split('|');
    const state = musicSearchCache.get(token);

    if (!state || state.userId !== ctx.from.id || Date.now() > state.exp) {
        await ctx.answerCbQuery('Vaqti o‘tgan. Qaytadan qidiring.', { show_alert: true });
        return true;
    }

    const page = Number(pageStr) || 1;
    const { rows, page: p, total } = buildKeyboardForPage(state.items, token, page);

    // matn + klaviaturani yangilaymiz
    try {
        await ctx.editMessageText(headerForPage(state.query, p, total), {
            reply_markup: { inline_keyboard: rows }
        });
    } catch {
        // "message is not modified" bo‘lsa faqat markupni yangilaymiz
        await ctx.editMessageReplyMarkup({ inline_keyboard: rows }).catch(() => { });
    }
    await ctx.answerCbQuery();
    return true;
}

function headerForPage(q, page, total) {
    const qq = (q || '').trim();
    const short = qq.length > 60 ? qq.slice(0, 57) + '…' : qq;
    // agar (page/total) ko‘rinmasin desangiz, oxirini olib tashlaysiz
    return `🎵 “${short}” bo‘yicha taronalar (${page}/${total}):`;
}

export async function registerMusicHandlers(ctx) {
    const q = ctx.message.text.trim();
    if (!q) return;

    // ko‘proq natija olib, keyin sahifalaymiz
    const results = await searchItunesSongs(q, 30);
    if (!results.length) return ctx.reply('Hech narsa topilmadi.');

    // token yaratamiz (callback_data 64 baytdan oshmaydi)
    const token = crypto.createHash('sha1')
        .update(`${ctx.from.id}|${q}|${Date.now()}`).digest('hex').slice(0, 12);

    musicSearchCache.set(token, {
        userId: ctx.from.id,
        query: q,
        items: results,
        exp: Date.now() + CACHE_TTL_MS
    });
    cleanupMusicCache();

    // tracks jadvaliga best-effort kech saqlash (o‘zingizdagi kod saqlanadi)
    for (const r of results) {
        pool.query(
            `INSERT INTO tracks(source, query, external_id, title, artist, album, duration_sec, thumb_url)
            VALUES('itunes',$1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
            [q, r.external_id, r.title, r.artist, r.album, r.duration_sec, r.thumb_url]
        ).catch(() => { });
    }

    // 1-sahifa
    const { rows, page, total } = buildKeyboardForPage(results, token, 1);
    await ctx.reply(headerForPage(q, page, total), {
        reply_markup: { inline_keyboard: rows }
    });
}
/**
 * Voice message (OGG/OPUS) → bepul ident → natijalar ro‘yxati
 * Har bosqichda status edit bo‘ladi. Topilmasa Premium CTA.
 */
export async function handleVoiceMusic(ctx, bot) {
    console.log('Voice message from', ctx.from.id);
    
    // 1) Telegram faylini yuklab olamiz
    const voice = ctx.message?.voice || ctx.message?.audio;
    if (!voice) return;
    const fileId = voice.file_id;
    const file = await ctx.telegram.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

    const tmpIn = path.join('/tmp', `v_${Date.now()}_${Math.random().toString(36).slice(2)}.oga`);
    const status = await ctx.reply('📥 Ovoz qabul qilindi. Yuklab olinmoqda…');

    async function edit(txt, extra = {}) {
        try {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                status.message_id,
                undefined,
                txt,
                extra
            );
        } catch { }
    }

    try {
        // download
        const res = await fetch(url);
        if (!res.ok) throw new Error(`tg file http ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(tmpIn, buf);

        await edit('🧪 Tahlil boshlanmoqda…');

        // 2) Free tanib olish
        const results = await recognizeFree(tmpIn, async (t) => edit(t));

        if (!results.length) {
            // topilmadi → Premium CTA
            const kb = {
                inline_keyboard: [
                    [{ text: '🔁 Qayta urinish', callback_data: 'music_retry' }],
                    [{ text: '🔍 Premium bilan kengroq qidirish', callback_data: 'buy_premium' }]
                ]
            };
            await edit('Topilmadi. 10–15s balandroq/aniqroq parcha yuboring.', { reply_markup: kb });
            return;
        }

        // 3) Natijalarni tugmalar bilan ko‘rsatamiz (itunes qidiruvidagi kabi)
        const rows = results.map(r => ([
            { text: `🎵 ${r.title} — ${r.artist}`, callback_data: `music|${r.external_id || crypto.randomUUID()}` }
        ]));

        // tracks jadvaliga (best-effort)
        for (const r of results) {
            ctx.telegram; // no-op to keep linter happy if pool missing
            try {
                await pool.query(
                    `INSERT INTO tracks(source, query, external_id, title, artist, album, duration_sec, thumb_url)
           VALUES('acoustid',$1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT DO NOTHING`,
                    ['voice', r.external_id || null, r.title, r.artist, r.album || null, r.duration_sec || null, null]
                );
            } catch { }
        }

        await edit('Natijalar:', { reply_markup: { inline_keyboard: rows } });
    } catch (e) {
        console.error('voice recognize error:', e?.stderr || e);
        await edit('Xatolik. Keyinroq urinib ko‘ring.');
    } finally {
        fs.unlink(tmpIn).catch(() => { });
    }
}
