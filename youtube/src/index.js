import pino from 'pino';
import { config } from './config.js';
import { createServer } from './server.js';
import { bot } from './youtubeControl.js';

const log = pino({ level: 'info' });

(async () => {
    const app = await createServer();

    // Webhook o'rnatish (PUBLIC_URL kerak)
    if (!config.publicUrl) {
        log.warn('PUBLIC_URL ko‘rsatilmagan. Uzoq muddatda webhook tavsiya etiladi. Hozir polling yoqiladi.');
        await bot.launch();
    } else {
        const { path } = (await import('./youtubeControl.js')).telegrafWebhookConfig();
        const url = `${config.publicUrl}${path}`;
        await bot.telegram.setWebhook(url);
        log.info({ url }, 'Webhook o‘rnatildi');
    }

    app.listen(config.port, () => log.info(`HTTP ${config.port} da ishlayapti`));

    // Xavfsiz to'xtash
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
})();
