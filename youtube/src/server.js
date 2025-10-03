import express from 'express';
import { bot } from './youtubeControl.js';

export async function createServer() {
    const app = express();

    app.get('/health', (_, res) => res.json({ ok: true }));

    const { path } = (await import('./youtubeControl.js')).telegrafWebhookConfig();
    app.use(express.json());

    // Telegraf webhook (raw body talab qilinmaydi)
    app.use(path, (req, res, next) => bot.webhookCallback(path)(req, res, next));

    return app;
}
