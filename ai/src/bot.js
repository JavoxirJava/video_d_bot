import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import { canUse, incrementUsage, setPlan, getUsage } from "./rateLimiter.js";
import { askAI } from "./aiClient.js";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required in .env");

export async function initBot() {
    const bot = new Telegraf(BOT_TOKEN);

    bot.start(async (ctx) => {
        const welcome = `👋 Salom, ${ctx.from.first_name || ""}!

Men AI yordamchiman. Siz uchun oddiy yozishmalar va savollarni javoblayman.

Tariflar:
• Oddiy: kuniga 3 so'rov
• Premium: kuniga 100 so'rov

Buyruqlar:
/plan - sizning hozirgi rejangizni ko‘rsatadi
/usage - bugungi foydalanish
/upgrade - premiumga o‘tish (test)
// Agar admin bo‘lsangiz, /setplan <userId> <free|premium>
`;
        await ctx.reply(welcome);
    });

    bot.command("plan", async (ctx) => {
        const u = await getUsage(ctx.from.id);
        await ctx.reply(`Sizning rejangiz: ${u.plan}\nKunlik limit: ${u.limit}\nBugungi ishlatilgan: ${u.count}\nQoldiq: ${u.remaining}`);
    });

    bot.command("usage", async (ctx) => {
        const u = await getUsage(ctx.from.id);
        await ctx.reply(`Bugungi ishlatilgan: ${u.count}\nQoldiq: ${u.remaining} / ${u.limit}`);
    });

    bot.command("upgrade", async (ctx) => {
        // NOTE: here we just switch the plan without payment integration.
        await setPlan(ctx.from.id, "premium");
        await ctx.reply("🎉 Siz Premium rejaga o‘tdingiz (test). Kunlik limit 100 ta so‘rov.");
    });

    // Admin helper to set plans for other users
    bot.command("setplan", async (ctx) => {
        const adminId = process.env.ADMIN_TELEGRAM_ID;
        if (!adminId || String(ctx.from.id) !== String(adminId)) {
            return ctx.reply("Sizda bu buyruqni ishlatish huquqi yo'q.");
        }
        const parts = ctx.message.text.split(/\s+/);
        if (parts.length < 3) return ctx.reply("Foydalanish: /setplan <userId> <free|premium>");
        const target = parts[1];
        const plan = parts[2] === "premium" ? "premium" : "free";
        await setPlan(target, plan);
        ctx.reply(`Foydalanuvchi ${target} uchun plan ${plan} ga o‘zgartirildi.`);
    });

    // main text handler
    bot.on("text", async (ctx) => {
        const userId = ctx.from.id;
        const text = ctx.message.text;

        try {
            const status = await canUse(userId);
            if (!status.allowed) 
                return ctx.reply(`🚫 Bugungi limitingiz tugadi. Rejangiz: ${status.limit}. Premiumga o'ting yoki kutib turing.`);

            // Optionally: echo a "typing" action
            await ctx.sendChatAction("typing");

            // Call AI
            const aiResp = await askAI(text);

            // Increment usage after successful AI call
            await incrementUsage(userId);

            // Reply with AI's answer
            await ctx.reply(aiResp);
        } catch (err) {
            console.error("Error handling message:", err);
            await ctx.reply("❌ Xatolik yuz berdi. Keyinroq urinib ko‘ring.");
        }
    });

    // Launch with long-polling (default)
    await bot.launch();
    console.log("Telegraf bot launched.");

    // graceful stop
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
