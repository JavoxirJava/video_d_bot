import 'dotenv/config';
import fs from 'fs';

export const config = {
    botToken: process.env.V_BOT_TOKEN,
    webhookSecret: process.env.WEBHOOK_SECRET || 'webhook',
    publicUrl: process.env.PUBLIC_URL,
    port: Number(process.env.PORT || 8080),
    redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    pg: {
        host: process.env.PGHOST || '127.0.0.1',
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || 'videodbot',
        user: process.env.PGUSER || 'videodbot',
        password: process.env.PGPASSWORD || ''
    },
    paths: {
        ytDlp: process.env.YTDLP_PATH || 'yt-dlp',
        ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
        tmpDir: process.env.TMPDIR || '/tmp/video_d_bot'
    },
    cookiesFromBrowser: "chromium:" + process.env.CHROME_PROFILE_PATH || '',
    limits: {
        // Telegram limit — botlar 50MB gacha faylga ruxsat beradi (o'zgarishi mumkin).
        // Katta fayllarda document sifatida yuboramiz.
        maxVideoBytes: 50 * 1024 * 1024
    }
};

if (!fs.existsSync(config.paths.tmpDir)) {
    fs.mkdirSync(config.paths.tmpDir, { recursive: true });
}
