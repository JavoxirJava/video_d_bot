# Telegram AI Bot (Redis storage, free/premium plans)

## Talablar
- Node.js >= 18
- Redis (local yoki remote)
- Telegram bot token (BotFather orqali oling)
- OpenAI API key yoki Grok API key

## O'rnatish
1. Klon qiling yoki fayllarni joylang.
2. `npm install`
3. `.env` faylini yarating va `BOT_TOKEN`, `REDIS_URL`, va `OPENAI_API_KEY` yoki `GROK_API_KEY` ni to‘ldiring.
4. `npm start` bilan ishga tushiring.

## Docker (Redis) tez boshlash
Agar siz lokal Redis kerak bo‘lsa, quyidagi buyruq bilan docker konteyner ishga tushiring:

docker run -p 6379:6379 --name redis-local -d redis


## Eslatmalar
- `upgrade` komandasi hozir pullik to‘lovni amalga oshirmaydi — faqat planni `premium` ga o‘zgartiradi. Sizga Stripe yoki boshqa to‘lov integratsiyasini qo‘shib berishim mumkin — so‘rang.
- Grok API endpointlari va response tuzilishi haqidagi rasmiy hujjat sizdan kerak bo‘ladi, shu asosida `askGrok` funksiyasini moslayman.
- Agar siz foydalanuvchi ma’lumotlarini uzoq muddat saqlamoqchi bo‘lsangiz va analytics kerak bo‘lsa, Redis o‘rniga Postgres + Redis kesh arxitekturasi tavsiya etiladi.

