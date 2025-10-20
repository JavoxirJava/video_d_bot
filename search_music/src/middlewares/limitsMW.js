import { canConsume, consume, getTodayUsage, isPremium } from '../utils/limits.js';

const DAILY_LIMIT_FREE = parseInt(process.env.DAILY_LIMIT_FREE || '3', 10);
const DAILY_LIMIT_PREMIUM = parseInt(process.env.DAILY_LIMIT_PREMIUM || '50', 10);

export function userLimit(user) { return isPremium(user.id) ? DAILY_LIMIT_PREMIUM : DAILY_LIMIT_FREE; }
export function limitLeft(user) { const limit = userLimit(user); const used = getTodayUsage(user.id); return Math.max(0, limit - used); }
export function ensureLimit(ctx) { const u = ctx.from; const limit = userLimit(u); if (!canConsume(u.id, limit)) { ctx.reply(`⛔️ Limit tugagan. 0 / ${limit}`); return false; } return true; }
export function spend(ctx) { consume(ctx.from.id); return limitLeft(ctx.from); }