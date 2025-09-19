// bot/music.js
import { searchItunesSongs } from '../music/itunes.js';
import { downloadMp3ByQuery } from '../music/download.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
    send = await ctx.reply(`Yuklanmoqda (${kbps} kbps)… Iltimos kuting.`);
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

export async function registerMusicHandlers(ctx) {

    const q = ctx.message.text.trim();
    if (!q) return;

    const results = await searchItunesSongs(q, 6);
    if (!results.length) return ctx.reply('Hech narsa topilmadi.');

    // natijalarni tugmalar bilan chiqazamiz
    const rows = results.map(r => ([
        { text: `🎵 ${r.title} — ${r.artist}`, callback_data: `msel|${r.external_id}` }
    ].filter(Boolean)));

    // cache tracks jadvaliga (best-effort)
    for (const r of results) {
        pool.query(
            `INSERT INTO tracks(source, query, external_id, title, artist, album, duration_sec, thumb_url)
           VALUES('itunes',$1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
            [q, r.external_id, r.title, r.artist, r.album, r.duration_sec, r.thumb_url]
        ).catch(() => { });
    }

    await ctx.reply('Natijalar:', { reply_markup: { inline_keyboard: rows } });
}
