import { askAI } from "./aiClient.js";
import { canUse, incrementUsage } from "./rateLimiter.js";

export function chooseAIHandler(ctx, session) {
    ctx.reply('AI bo‘limiga xush kelibsiz! Savolingizni yuboring.');
    session.set(ctx.from.id, 'ai');
}

export async function ai(ctx) {
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
}