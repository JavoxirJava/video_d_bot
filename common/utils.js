export function detectPlatform(rawUrl) {
    try {
        const host = new URL(rawUrl).host.replace(/^www\./, '');
        if (/youtu\.be|youtube\.com$/i.test(host)) return 'youtube';
        if (/instagram\.com$/i.test(host)) return 'instagram';
        if (/tiktok\.com$/i.test(host)) return 'tiktok';
        return 'unknown';
    } catch { return 'unknown'; }
}

export function normalizeUrl(u) {
    try {
        const url = new URL(u);
        if (/(youtube\.com|youtu\.be)/i.test(url.hostname)) {
            const v = url.hostname.includes('youtu.be') ? url.pathname.slice(1) : url.searchParams.get('v');
            const canon = new URL('https://www.youtube.com/watch');
            if (v) canon.searchParams.set('v', v);
            return canon.toString();
        }
        ['utm_source', 'utm_medium', 'utm_campaign', 'si', 't', '_t', 's'].forEach(p => url.searchParams.delete(p));
        return url.toString();
    } catch { return u; }
}

export function formatKey({ source = 'yt', itag, height, ext = 'mp4' }) {
    // stable key used in DB for per-format cache
    if (itag) return `${source}:itag:${itag}`;
    if (height) return `${source}:h:${height}:${ext}`;
    return `${source}:default:${ext}`;
}