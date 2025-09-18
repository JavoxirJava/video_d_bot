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
        // execFile(YTDLP, [...baseArgs(), ...args], { maxBuffer: 256e6, timeout: 300000, ...opts }, (err, stdout, stderr) => {
        execFile(
            YTDLP,
            [...baseArgs(), ...args],
            { maxBuffer: 256e6, timeout: 300000, ...opts }, // 256MB, 5 min
            (err, stdout, stderr) => {
                if (err) { err.stderr = stderr; return reject(err); }
                resolve({ stdout, stderr });
            }
        );
        // });
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
    // CLI’da ishlagan konfiguratsiya: H.264 + AAC + faststart
    const args = [
        '-y',                 // overwrite
        '-i', inPath,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        outPath
    ];
    log('[ffmpeg transcode] in → out:', inPath, '→', outPath);
    await new Promise((resolve, reject) => {
        execFile(FFMPEG, args, { maxBuffer: 64e6 }, (err, stdout, stderr) => {
            if (err) { err.stderr = stderr; return reject(err); }
            resolve({ stdout, stderr });
        });
    });
}

export async function ytDownloadByHeightSmart(url, height, outPath) {
    // 1) bir nechta player_client bilan urinib chiqamiz
    const clientVariants = [
        [], // default (web)
        ['--extractor-args', 'youtube:player_client=web_safari'],
        ['--extractor-args', 'youtube:player_client=web'],
        ['--extractor-args', 'youtube:player_client=android'],
        ['--extractor-args', 'youtube:player_client=ios'],
    ];

    // 2) uchta format strategiyasi:
    // A) mux (video+audio): bv*+ba/b   va mp4/h264/m4a'ga preferensiya
    const stratA = (extra) => ([
        ...extra,
        ...ytCookieArgs(),
        '--add-header', 'Referer: https://www.youtube.com/',
        '-f', 'bv*+ba/b',
        '-S', `res:${height},ext:mp4,vcodec:avc1,acodec:m4a`,
        '-o', outPath,
        '--merge-output-format', 'mp4',
        '--postprocessor-args', 'ffmpeg:-movflags +faststart',
    ]);

    // B) faqat progressive (b) — ba’zi roliklarda shartli mavjud
    const stratB = (extra) => ([
        ...extra,
        ...ytCookieArgs(),
        '--add-header', 'Referer: https://www.youtube.com/',
        '-f', 'b',
        '-S', `res:${height},ext:mp4`,
        '-o', outPath,
        '--merge-output-format', 'mp4',
        '--postprocessor-args', 'ffmpeg:-movflags +faststart',
    ]);

    // C) eng mosini ol, keyin mp4 ga recode qil (webm/vp9 bo‘lsa ham)
    const stratC = (extra) => ([
        ...extra,
        ...ytCookieArgs(),
        '--add-header', 'Referer: https://www.youtube.com/',
        '-f', 'bv*+ba/b',
        '-S', `res:${height}`,
        '-o', outPath,
        '--merge-output-format', 'mp4',
        '--postprocessor-args', 'ffmpeg:-movflags +faststart',
        '--recode-video', 'mp4',
    ]);

    const strategies = [stratA, stratB, stratC];

    let lastErr;
    for (const client of clientVariants) {
        for (const makeArgs of strategies) {
            const args = makeArgs(client);
            console.log('[YT smart try]', [...args, url].join(' '));
            try {
                await execYtDlp([...args, url]);
                return; // muvaffaqiyatli – chiqamiz
            } catch (e) {
                lastErr = e;
                console.error('YT smart try failed:', e?.stderr || e);
            }
        }
    }
    // hammasi yiqilsa — shu xatoni ko‘taramiz
    throw lastErr || new Error('yt-dlp selection failed');
}