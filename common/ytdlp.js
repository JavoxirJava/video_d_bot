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
        // O‘lchamni saqlaymiz, faqat SAR=1 va juft pikselga tekislaymiz
        '-vf', 'setsar=1,scale=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        // rotate/displaymatrix metadatasini yo‘qotib, “asosiy” orientatsiyada saqlash
        '-metadata:s:v:0', 'rotate=0',
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

    // 1) Har doim avval DASH (video+audio) – H.264/M4A ga preferensiya
    const dashPreferH264 = ['-f', 'bv*+ba/b', '-S', `res:${height},vcodec:avc1,acodec:m4a,ext:mp4`];

    // 2) DASH – codec cheklovisiz (faqat resolyutsiya bo‘yicha), keyin mp4 ga recode
    const dashAnyRecode = ['-f', 'bv*+ba/b', '-S', `res:${height}`, '--recode-video', 'mp4'];

    // 3) Progressive faqat oxirgi chora sifatida
    const progressiveLast = ['-f', `b[ext=mp4][height<=${height}]/b[height<=${height}]`];

    let lastErr;
    for (const c of clients) {
        try {
            console.log('[YT smart try A]', [...ytCookieArgs(), ...c, ...dashPreferH264, ...common, url].join(' '));
            await execYtDlp([...ytCookieArgs(), ...c, ...dashPreferH264, ...common, url], { timeout: 120000 });
            return;
        } catch (e) { lastErr = e; console.error('YT A failed:', e?.stderr || e); }

        try {
            console.log('[YT smart try B]', [...ytCookieArgs(), ...c, ...dashAnyRecode, ...common, url].join(' '));
            await execYtDlp([...ytCookieArgs(), ...c, ...dashAnyRecode, ...common, url], { timeout: 150000 });
            return;
        } catch (e) { lastErr = e; console.error('YT B failed:', e?.stderr || e); }

        try {
            console.log('[YT smart try C]', [...ytCookieArgs(), ...c, ...progressiveLast, ...common, url].join(' '));
            await execYtDlp([...ytCookieArgs(), ...c, ...progressiveLast, ...common, url], { timeout: 180000 });
            return;
        } catch (e) { lastErr = e; console.error('YT C failed:', e?.stderr || e); }
    }
    throw lastErr || new Error('yt-dlp selection failed');
}