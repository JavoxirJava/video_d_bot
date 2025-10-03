import axios from 'axios';
import { fileTypeFromBuffer } from 'file-type';
import { Telegraf } from 'telegraf';
import { cacheGet, cacheSet } from '../cache/store.js';
import { CFG } from '../config.js';
import { downloadMedia } from '../services/downloader.js';
import { igCodeFromUrl, safeFilename, sleep } from '../utils.js';

const tg = new Telegraf(CFG.BOT_TOKEN); // launch shart emas, telegram.* yetarli
const CAPTION = 'Downloaded via ' + CFG.BOT_USERNAME;

export async function processJob(job) {
    console.log('Processing job:', job.id, job.data);

    const { chatId, igUrl, replyToMessageId } = job.data;
    const code = igCodeFromUrl(igUrl);

    try {
        // 0) Cache’dan tekshirish
        if (code) {
            const cached = await cacheGet(code);
            if (cached?.file_id) {
                // bevosita file_id bilan yuboramiz
                if (cached.type === 'photo') {
                    await tg.telegram.sendPhoto(
                        chatId,
                        cached.file_id,
                        { caption: CAPTION, reply_to_message_id: replyToMessageId }
                    );
                } else {
                    await tg.telegram.sendVideo(
                        chatId,
                        cached.file_id,
                        { caption: CAPTION, supports_streaming: true, reply_to_message_id: replyToMessageId }
                    );
                }
                if (CFG.RATE_GAP_MS > 0) await sleep(CFG.RATE_GAP_MS);
                return { ok: true, cached: true };
            }
        }

        await tg.telegram.sendChatAction(chatId, 'upload_video');

        // 1) Provider’dan media olamiz
        const list = await downloadMedia(igUrl);
        const m = list[0];

        // 2) Avval URL orqali yuborib ko‘ramiz — file_id ni olaylik
        let sent;
        try {
            if (m.type === 'photo') {
                sent = await tg.telegram.sendPhoto(
                    chatId,
                    { url: m.url },
                    { caption: CAPTION, reply_to_message_id: replyToMessageId }
                );
            } else {
                sent = await tg.telegram.sendVideo(
                    chatId,
                    { url: m.url },
                    { caption: CAPTION, supports_streaming: true, reply_to_message_id: replyToMessageId }
                );
            }
        } catch {
            // 3) URL bilan bo‘lmadi — buffer qilib yuboramiz
            const resp = await axios.get(m.url, { responseType: 'arraybuffer', timeout: 120000 });
            const buf = Buffer.from(resp.data);
            const ft = await fileTypeFromBuffer(buf);
            const filename = safeFilename(`media.${ft?.ext || (m.type === 'photo' ? 'jpg' : 'mp4')}`);

            if (m.type === 'photo' || ft?.mime?.startsWith('image/')) {
                sent = await tg.telegram.sendPhoto(
                    chatId,
                    { source: buf, filename },
                    { caption: CAPTION, reply_to_message_id: replyToMessageId }
                );
            } else {
                sent = await tg.telegram.sendVideo(
                    chatId,
                    { source: buf, filename },
                    { caption: CAPTION, supports_streaming: true, reply_to_message_id: replyToMessageId }
                );
            }
        }

        // 4) Yuborilgan xabardan file_id ni keshlab qo‘yamiz
        try {
            if (code && sent) {
                // photo
                if (sent.photo?.length) {
                    const largest = sent.photo.at(-1);
                    await cacheSet(code, { type: 'photo', file_id: largest.file_id, thumb_id: null });
                }
                // video
                if (sent.video) {
                    await cacheSet(code, { type: 'video', file_id: sent.video.file_id, thumb_id: sent.video.thumb?.file_id || null });
                }
                // ba’zan Telegram video Document sifatida qaytishi mumkin:
                if (sent.document && /video/i.test(sent.document.mime_type || '')) {
                    await cacheSet(code, { type: 'video', file_id: sent.document.file_id, thumb_id: null });
                }
            }
        } catch (e) {
            console.error('cacheSet error:', e.message);
        }

        if (CFG.RATE_GAP_MS > 0) await sleep(CFG.RATE_GAP_MS);
        return { ok: true, cached: false };
    } catch (err) {
        console.error('Worker error:', err?.response?.status, err?.response?.data || err.message);
        try { await tg.telegram.sendMessage(chatId, 'Xato: media topilmadi yoki post private.'); } catch { }
        throw err;
    }
}