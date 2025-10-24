import { enqueueRecognizeAndDownload } from "../search_music/src/queue/queue.js";

export async function handleRecHere(ctx) {
    try {
        await ctx.answerCbQuery("Qidirish navbatga qo‘yildi"); // foydalanuvchiga tez ack yuboramiz

        const cbMsg = ctx.callbackQuery.message;
        if (!cbMsg) {
            await ctx.reply('Xato: xabar topilmadi.');
            return;
        }

        // 1) Agar tugma alohida xabarda (reply_to_message orqali) yuborilgan bo'lsa —
        //    asl video file id ni reply_to_message dan olamiz.

        const orig = cbMsg; // tugma xabarining reply qismi yoki o'zi

        // 2) Hamma mumkin bo'lgan joylarni tekshiramiz: video, document (video doc), audio, voice
        let fileId = null;
        let extGuess = 'mp4'; // default video uchun


        if (orig.video) {
            fileId = orig.video.file_id;
            extGuess = 'mp4';
        } else if (orig.document && orig.document.mime_type && /video/i.test(orig.document.mime_type)) {
            // Telegram ba'zida video'ni document sifatida yuboradi
            fileId = orig.document.file_id;
            // ext: derive from filename or mime
            const mime = orig.document.mime_type || '';
            if (mime.includes('mp4')) extGuess = 'mp4';
            else if (mime.includes('mkv')) extGuess = 'mkv';
            else extGuess = 'mp4';
        } else if (orig.audio) {
            fileId = orig.audio.file_id;
            extGuess = 'mp3';
        } else if (orig.voice) {
            fileId = orig.voice.file_id;
            extGuess = 'ogg';
        } else if (orig.photo && orig.photo.length) {
            // surat bo'lsa — musiqani tanib olish ma'nosiz, lekin biz fallback qilsak:
            return ctx.reply('Bu video emas — ovoz tanib olinmaydi.');
        } else {
            return ctx.reply('Original video yoki audio topilmadi (xabar videoni o‘z ichiga olmaydi).');
        }

        if (!fileId) return ctx.reply('Fayl identifikatori topilmadi.');

        // 3) Navbatga qo'yamiz — replyTo: original message id (tugma joylashgan message emas)
        const replyTo = orig.message_id || cbMsg.message_id;

        // 4) Qo'shimcha: foydalanuvchi cheklovlari yoki litsenziya tekshiruvi qilmoqchi bo'lsangiz shu yerda tekshiring.
        await enqueueRecognizeAndDownload({ chatId: ctx.chat.id, replyTo, fileId, extGuess });

        // 5) Xabar beramiz
        await ctx.reply('🔎 Musiqa tanib olish uchun navbatga olindi — biroz kuting...');

        // 6) Tugmani olib tashlash (ixtiyoriy)
        try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch (e) { /* ignore */ }

    } catch (e) {
        console.error('handleRecHere error', e);
        try { await ctx.answerCbQuery('Xatolik yuz berdi'); } catch (err) { }
    }
}
