import express from 'express';
export function makeHttp() {
    const app = express();
    app.get('/health', (req, res) => res.json({ ok: true }));
    // TODO: add admin endpoints (auth, set tier, list channels, etc.)
    const port = process.env.PORT || 8080;
    app.listen(port, () => console.log('HTTP listening on', port));
}