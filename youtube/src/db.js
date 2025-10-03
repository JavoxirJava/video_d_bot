import { Pool } from 'pg';
import { config } from './config.js';

export const pool = new Pool(config.pg);

export async function upsertVideo(meta) {
    const { yt_video_id, title, channel, duration_seconds } = meta;
    const { rows } = await pool.query(
        `INSERT INTO videos (yt_video_id, title, channel, duration_seconds)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (yt_video_id) DO UPDATE SET
       title = COALESCE(EXCLUDED.title, videos.title),
       channel = COALESCE(EXCLUDED.channel, videos.channel),
       duration_seconds = COALESCE(EXCLUDED.duration_seconds, videos.duration_seconds)
     RETURNING *`,
        [yt_video_id, title, channel, duration_seconds]
    );
    return rows[0];
}

export async function findCachedFile(ytVideoId, itag) {
    const { rows } = await pool.query(
        `SELECT vf.*, v.id as video_db_id
       FROM video_files vf
       JOIN videos v ON v.id = vf.video_id
      WHERE v.yt_video_id = $1 AND vf.itag = $2 AND vf.status='ready'
      LIMIT 1`,
        [ytVideoId, itag]
    );
    return rows[0] || null;
}

export async function insertFile(videoId, f) {
    const { rows } = await pool.query(
        `INSERT INTO video_files
     (video_id, itag, format_label, ext, width, height, filesize, telegram_file_id, telegram_file_unique_id, telegram_type, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
        [videoId, f.itag, f.format_label, f.ext, f.width, f.height, f.filesize, f.telegram_file_id || null, f.telegram_file_unique_id || null, f.telegram_type || null, f.status || 'pending']
    );
    return rows[0];
}

export async function markFileReady(fileId, payload = {}) {
    const { telegram_file_id, telegram_file_unique_id, telegram_type, filesize } = payload;
    await pool.query(
        `UPDATE video_files
        SET status='ready',
            telegram_file_id = COALESCE($2, telegram_file_id),
            telegram_file_unique_id = COALESCE($3, telegram_file_unique_id),
            telegram_type = COALESCE($4, telegram_type),
            filesize = COALESCE($5, filesize),
            updated_at = now()
      WHERE id = $1`,
        [fileId, telegram_file_id || null, telegram_file_unique_id || null, telegram_type || null, filesize || null]
    );
}

export async function markFileFailed(fileId) {
    await pool.query(
        `UPDATE video_files
        SET status='failed', updated_at=now()
      WHERE id=$1`,
        [fileId]
    );
}
