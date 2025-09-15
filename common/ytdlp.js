import { execFile } from 'child_process';
import { log } from 'console';


const YTDLP = process.env.YTDLP_PATH || '/usr/local/bin/yt-dlp';
const FFMPEG = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const EXTRACTOR_ARGS = ['--extractor-args', 'youtube:player_client=android'];

export function ytCookieArgs() {
    if ((process.env.YT_COOKIES_FROM_BROWSER || '').trim() === '1') {
        const p = (process.env.CHROME_PROFILE_PATH || '').trim();
        const browser = (process.env.YT_BROWSER || 'chromium').trim();
        if (p) return ['--cookies-from-browser', `${browser}:${p}`];
    }
    if (process.env.YT_COOKIES_FILE) return ['--cookies', process.env.YT_COOKIES_FILE];
    return [];
}

export function igCookieArgs() {
    // Prefer browser cookies (same profile as your Chromium login)
    if ((process.env.IG_COOKIES_FROM_BROWSER || '').trim() === '1') {
        const p = (process.env.CHROME_PROFILE_PATH || '').trim();
        const browser = (process.env.IG_BROWSER || process.env.YT_BROWSER || 'chromium').trim();
        if (p) return ['--cookies-from-browser', `${browser}:${p}`];
    }
    // Fallback to static cookies.txt (must be readable+WRITABLE by current user)
    if (process.env.IG_COOKIES_FILE) return ['--cookies', process.env.IG_COOKIES_FILE];
    return [];
}

function baseArgs() { return ['-4', '--no-warnings', '--no-check-certificates', '--no-playlist', '--ffmpeg-location', FFMPEG]; }

export function execYtDlp(args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile(YTDLP, [...baseArgs(), ...args], { maxBuffer: 64e6, ...opts }, (err, stdout, stderr) => {
            if (err) { err.stderr = stderr; return reject(err); }
            resolve({ stdout, stderr });
        });
    });
}

export async function ytInfo(url) {
    const { stdout } = await execYtDlp(['-J', ...ytCookieArgs(), '--add-header', 'Referer: https://www.youtube.com/', url]);
    log('YT-DLP INFO:', stdout);
    return JSON.parse(stdout);
}

export async function ytDownloadByItag(url, itag, outPath) {
    const args = [
        ...EXTRACTOR_ARGS,
        ...ytCookieArgs(),
        '--add-header', 'Referer: https://www.youtube.com/',
        '-f', String(itag),
        '-o', outPath,
        '--postprocessor-args', 'ffmpeg:-movflags +faststart',
    ];
    log('Exec yt-dlp with outPath:', outPath);
    log('Downloading with yt-dlp:', YTDLP, args.join(' '), url);
    await execYtDlp([...args, url]);
}

export async function genericToMp4(url, outPath, platform = 'instagram') {
    log('igCookieArgs:', igCookieArgs());
    log('Exec yt-dlp with outPath:', outPath);
    const args = [
        ...(platform === 'instagram' ? igCookieArgs() : []),
        '--add-header', 'Accept-Language: en-US,en;q=0.9',
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '-o', outPath,
        '--merge-output-format', 'mp4',
        '--recode-video', 'mp4',   // ✅ ffmpeg avtomatik re-encode qiladi
        '--postprocessor-args', 'ffmpeg:-movflags +faststart -pix_fmt yuv420p -r 30 -vsync 2',
        url
    ];
    await execYtDlp(args);
}