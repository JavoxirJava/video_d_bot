import { execFile } from 'child_process';

const YTDLP = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';

function baseArgs() { return ['-4', '--no-warnings', '--no-check-certificates', '--no-playlist']; }

function ytCookieArgs() {
    if ((process.env.YT_COOKIES_FROM_BROWSER || '').trim() === '1') {
        const p = (process.env.CHROME_PROFILE_PATH || '').trim();
        const browser = (process.env.YT_BROWSER || 'chromium').trim();
        if (p) return ['--cookies-from-browser', `${browser}:${p}`];
    }
    if (process.env.YT_COOKIES_FILE) return ['--cookies', process.env.YT_COOKIES_FILE];
    return [];
}

function execYtDlp(args) {
    return new Promise((resolve, reject) => {
        execFile(
            YTDLP, [...baseArgs(), ...args],
            { maxBuffer: 256e6, timeout: 300000 },
            (err, stdout, stderr) => {
                if (err) { err.stderr = stderr; return reject(err); }
                resolve({ stdout, stderr });
            }
        );
    });
}

// Matn qidiruv → birinchi mos rolika audio (mp3)
export async function downloadMp3ByQuery(query, outPath, kbps = 192) {
    const quality = Math.min(kbps, Number(process.env.MUSIC_FREE_MAX_BITRATE || kbps)); // free limit
    const args = [
        ...ytCookieArgs(),
        '--default-search', 'ytsearch',
        '-f', 'bestaudio/best',
        '--extract-audio', '--audio-format', 'mp3',
        '--audio-quality', String(quality),   // 0 (best) | 128 | 192 ...
        '-o', outPath,
        query
    ];
    console.log('[MP3 query]', [...args].join(' '));
    await execYtDlp(args);
}

// To‘g‘ridan YouTube URL → MP3
export async function downloadMp3ByUrl(url, outPath, kbps = 192) {
    const quality = Math.min(kbps, Number(process.env.MUSIC_FREE_MAX_BITRATE || kbps));
    const args = [
        ...ytCookieArgs(),
        '-f', 'bestaudio/best',
        '--extract-audio', '--audio-format', 'mp3',
        '--audio-quality', String(quality),
        '-o', outPath,
        url
    ];
    console.log('[MP3 url]', [...args].join(' '));
    await execYtDlp(args);
}
