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

function baseArgs() {
    return ['-4', '--no-warnings', '--no-check-certificates', '--no-playlist', '--ffmpeg-location', FFMPEG];
}

export function execYtDlp(args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile(
            YTDLP,
            [...baseArgs(), ...args],
            // qat’iyroq timeout beramiz (override qilsa bo‘ladi)
            { maxBuffer: 256e6, timeout: 300000, ...opts },
            (err, stdout, stderr) => {
                if (err) { err.stderr = stderr; return reject(err); }
                resolve({ stdout, stderr });
            }
        );
    });
}

export async function ytInfo(url) {
    const { stdout } = await execYtDlp(['-J', ...ytCookieArgs(), '--add-header', 'Referer: https://www.youtube.com/', url]);
    return JSON.parse(stdout);
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
        '--postprocessor-args',
        // ✅ majburiy re-encode H.264
        'ffmpeg:-c:v libx264 -pix_fmt yuv420p -r 30 -vsync 2 -c:a aac -b:a 160k -ar 48000 -movflags +faststart',
        url
    ];

    await execYtDlp(args);
}

// ytdlp.js — qo'shing
export async function igDownloadRaw(url, outPath) {
    const args = [
        ...igCookieArgs(),
        '--add-header', 'Accept-Language: en-US,en;q=0.9',
        // avval MP4 oqimlarini urinamiz, bo'lmasa best ga tushamiz
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '-o', outPath,
        '--merge-output-format', 'mp4'
    ];
    log('[IG raw dl] outPath:', outPath);
    await execYtDlp([...args, url]);
}

export async function ffmpegTranscodeToH264(inPath, outPath) {
    const args = [
        '-y',
        '-i', inPath,
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        outPath
    ];
    await new Promise((resolve, reject) => {
        execFile(FFMPEG, args, { maxBuffer: 64e6 }, (err, stdout, stderr) => {
            if (err) { err.stderr = stderr; return reject(err); }
            resolve({ stdout, stderr });
        });
    });
}

export async function ytDownloadByHeightSmart(url, height, outPath) {
    const common = [
        '--add-header', 'Referer: https://www.youtube.com/',
        '--no-continue',
        '--force-overwrites',
        '-N', '4',
        '--concurrent-fragments', '8',
        '-o', outPath,
        '--merge-output-format', 'mp4',
        '--postprocessor-args', 'ffmpeg:-movflags +faststart'
    ];

    const clients = [
        [], // default
        ['--extractor-args', 'youtube:player_client=web_safari'],
        ['--extractor-args', 'youtube:player_client=web'],
        ['--extractor-args', 'youtube:player_client=android'],
        ['--extractor-args', 'youtube:player_client=ios'],
    ];

    const primaryFmt = (height <= 360)
        ? ['-f', `b[ext=mp4][vcodec*=avc1][height<=${height}]/b[ext=mp4][height<=${height}]`]
        : ['-f', 'bv*+ba/b', '-S', `res:${height},ext:mp4,vcodec:avc1,acodec:m4a`];

    const fallback1 = ['-f', 'bv*+ba/b', '-S', `res:${height}`];
    const fallback2 = ['-f', `best[height<=${height}]`, '--recode-video', 'mp4'];

    let lastErr;
    for (const c of clients) {
        try {
            console.log('[YT smart try]', [...ytCookieArgs(), ...c, ...primaryFmt, ...common, url].join(' '));
            await execYtDlp([...ytCookieArgs(), ...c, ...primaryFmt, ...common, url], { timeout: 120000 });
            return;
        } catch (e) {
            lastErr = e; console.error('YT primary failed:', e?.stderr || e);
        }
        try {
            console.log('[YT smart try F1]', [...ytCookieArgs(), ...c, ...fallback1, ...common, url].join(' '));
            await execYtDlp([...ytCookieArgs(), ...c, ...fallback1, ...common, url], { timeout: 150000 });
            return;
        } catch (e) {
            lastErr = e; console.error('YT fallback1 failed:', e?.stderr || e);
        }
        try {
            console.log('[YT smart try F2]', [...ytCookieArgs(), ...c, ...fallback2, ...common, url].join(' '));
            await execYtDlp([...ytCookieArgs(), ...c, ...fallback2, ...common, url], { timeout: 180000 });
            return;
        } catch (e) {
            lastErr = e; console.error('YT fallback2 failed:', e?.stderr || e);
        }
    }
    throw lastErr || new Error('yt-dlp selection failed');
}
