import axios from "axios";

const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();

export async function askAI(prompt) {
    if (provider === "grok") return await askGrok(prompt);
    else return await askOpenAI(prompt);
}

// OpenAI using Chat Completions (gpt-4o-mini default)
async function askOpenAI(prompt) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512
    };

    const res = await axios.post("https://api.openai.com/v1/chat/completions", payload, {
        headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json"
        },
        timeout: 20000
    });

    const content = res.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("No content from OpenAI");
    return content.trim();
}

// Placeholder Grok function - adapt to actual Grok API
async function askGrok(prompt) {
    const key = process.env.GROK_API_KEY;
    if (!key) throw new Error("GROK_API_KEY is not set");

    // Example Grok endpoint — replace with the correct one from Grok provider
    // This is a template; check Grok docs and update.
    const url = process.env.GROK_API_URL || "https://api.grok.ai/v1/chat/completions";

    const payload = {
        model: process.env.GROK_MODEL || "grok-4-fast-reasoning",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512
    };

    const res = await axios.post(url, payload, {
        headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json"
        },
        timeout: 20000
    });

    // Adjust based on Grok response shape
    const content = res.data?.choices?.[0]?.message?.content || res.data?.choices?.[0]?.text;
    if (!content) throw new Error("No content from Grok");
    return content.trim();
}
