import { db } from '../db/index.js';

export async function upsertVideo({ platform, video_id, title, duration_sec, thumb_url }) {
    await db.query(
        `INSERT INTO videos(platform, video_id, title, duration_sec, thumb_url)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (platform, video_id)
DO UPDATE SET title=COALESCE(EXCLUDED.title, videos.title),
duration_sec=COALESCE(EXCLUDED.duration_sec, videos.duration_sec),
thumb_url=COALESCE(EXCLUDED.thumb_url, videos.thumb_url)`,
        [platform, video_id, title || null, duration_sec || null, thumb_url || null]
    );
}

export async function getVideoFile({ platform, video_id, format_key }) {
    const { rows } = await db.query(
        `SELECT * FROM video_files WHERE platform=$1 AND video_id=$2 AND format_key=$3 LIMIT 1`,
        [platform, video_id, format_key]
    );
    return rows[0] || null;
}

export async function saveVideoFile({ platform, video_id, format_key, height, width, ext, itag, abr_kbps, filesize, telegram_file_id }) {
    await db.query(
        `INSERT INTO video_files(platform, video_id, format_key, height, width, ext, itag, abr_kbps, filesize, telegram_file_id)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (platform, video_id, format_key)
DO UPDATE SET telegram_file_id=EXCLUDED.telegram_file_id, filesize=EXCLUDED.filesize`,
        [platform, video_id, format_key, height || null, width || null, ext || 'mp4', itag || null, abr_kbps || null, filesize || null, telegram_file_id]
    );
}