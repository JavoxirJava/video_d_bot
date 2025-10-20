import { redisClient } from "./redisClient.js";

function todayString() {
    const d = new Date();
    // Use YYYY-MM-DD in server local timezone or UTC based on your preference
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

const DEFAULT_FREE_LIMIT = 3;
const DEFAULT_PREMIUM_LIMIT = 100;

export async function getUserRecord(userId) {
    const key = `user:${userId}`;
    const data = await redisClient.hgetall(key);
    if (!data || Object.keys(data).length === 0) {
        // create default
        const rec = {
            plan: "free",
            count: "0",
            lastReset: todayString()
        };
        await redisClient.hset(key, rec);
        return { userId, plan: rec.plan, count: 0, lastReset: rec.lastReset };
    }
    return {
        userId,
        plan: data.plan || "free",
        count: Number(data.count || 0),
        lastReset: data.lastReset || todayString()
    };
}

export async function canUse(userId) {
    const rec = await getUserRecord(userId);
    const today = todayString();
    if (rec.lastReset !== today) {
        // reset
        const key = `user:${userId}`;
        await redisClient.hset(key, "count", 0, "lastReset", today);
        rec.count = 0;
        rec.lastReset = today;
    }

    const limit = rec.plan === "premium" ? DEFAULT_PREMIUM_LIMIT : DEFAULT_FREE_LIMIT;
    return { allowed: rec.count < limit, remaining: Math.max(0, limit - rec.count), limit };
}

export async function incrementUsage(userId) {
    const key = `user:${userId}`;
    // ensure key exists
    await getUserRecord(userId);
    const newCount = await redisClient.hincrby(key, "count", 1);
    return Number(newCount);
}

export async function setPlan(userId, plan) {
    const key = `user:${userId}`;
    await redisClient.hset(key, "plan", plan);
    return true;
}

export async function getUsage(userId) {
    const rec = await getUserRecord(userId);
    const limit = rec.plan === "premium" ? DEFAULT_PREMIUM_LIMIT : DEFAULT_FREE_LIMIT;
    return { plan: rec.plan, count: rec.count, remaining: Math.max(0, limit - rec.count), limit, lastReset: rec.lastReset };
}
