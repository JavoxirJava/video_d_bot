export function canonicalIg(url) {
    try {
        const u = new URL(url);
        const m = u.pathname.match(/\/(reel|p)\/([A-Za-z0-9_-]+)\/?/);
        if (!m) return url;
        return `https://www.instagram.com/${m[1]}/${m[2]}/`;
    } catch { return url; }
}

export function typeFromUrl(u) {
    if (/\.(mp4|m3u8)(\?|$)/i.test(u)) return 'video';
    if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(u)) return 'photo';
    return 'video';
}

export function safeFilename(name = 'file') {
    return String(name).replace(/[^a-z0-9._-]/gi, '_').slice(0, 64);
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function igCodeFromUrl(url) {
    try {
        const u = new URL(url);
        const m = u.pathname.match(/\/(reel|p)\/([A-Za-z0-9_-]+)\//);
        return m ? `${m[1]}:${m[2]}` : null; // masalan: "reel:DOp2NPOjM6g"
    } catch {
        return null;
    }
}