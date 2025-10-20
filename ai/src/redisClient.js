import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
export const redisClient = new Redis(redisUrl);

redisClient.on("error", (err) => console.error("Redis error", err));
redisClient.on("connect", () => console.log("Connected to Redis"));
