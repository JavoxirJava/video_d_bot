import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { initBot } from "./bot.js";
import { redisClient } from "./redisClient.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("Telegram AI Bot is running.");
});

app.get("/health", async (req, res) => {
    try {
        await redisClient.ping();
        res.json({ status: "ok" });
    } catch (e) {
        res.status(500).json({ status: "error", message: e.message });
    }
});

const server = app.listen(PORT, () => {
    console.log(`HTTP server listening on ${PORT}`);
});

// Start bot
initBot()
    .then(() => console.log("Bot initialized"))
    .catch((err) => {
        console.error("Failed to initialize bot:", err);
        process.exit(1);
    });

// Graceful shutdown
process.on("SIGINT", async () => {
    console.log("Shutting down...");
    server.close();
    await redisClient.quit();
    process.exit(0);
});