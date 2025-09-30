import { execFile, spawn } from 'child_process';
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
    if ((process.env.IG_COOKIES_FROM_BROWSER || '').trim() === '1') {
        const p = (process.env.CHROME_PROFILE_PATH || '').trim();
        const browser = (process.env.IG_BROWSER || process.env.YT_BROWSER || 'chromium').trim();
        if (p) return ['--cookies-from-browser', `${browser}:${p}`];
    }
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
            { maxBuffer: 256e6, timeout: 300000, ...opts },
            (err, stdout, stderr) => {
                if (err) { err.stderr = stderr; return reject(err); }
                resolve({ stdout, stderr });
            }
        );
    });
}

// ---- YouTube: meta olish
export async function ytInfo(url) {
    const { stdout } = await execYtDlp(['-J', ...ytCookieArgs(), '--add-header', 'Referer: https://www.youtube.com/', url]);
    return JSON.parse(stdout);
}

// ---- IG umumiylar (o‘zingsiz ham ishlayapti)
export async function igDownloadRaw(url, outPath) {
    const args = [
        ...igCookieArgs(),
        '--add-header', 'Accept-Language: en-US,en;q=0.9',
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '-o', outPath,
        '--merge-output-format', 'mp4'
    ];
    log('[IG raw dl] outPath:', outPath);
    await execYtDlp([...args, url]);
}

// Ensiz/kvadrat muammosini olib tashlaydi: SAR=1, o‘lchamni majburlamaydi
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

// 1) formatlar ichidan faqat progressive MP4 (video+audio) larni chiqaramiz
export function pickProgressiveMp4(info) {
    return (info?.formats || [])
        .filter(f => f.ext === 'mp4' && f.vcodec !== 'none' && f.acodec !== 'none' && f.format_id)
        .map(f => ({
            itag: Number(f.format_id),
            height: f.height || null,
            fps: f.fps || null,
            note: f.format_note || '',
            filesize: f.filesize || f.filesize_approx || null
        }))
        .filter(f => Number.isFinite(f.itag))
        .sort((a, b) => (a.height || 0) - (b.height || 0));
}

// 2) `--newline` progressini o‘qish uchun
function parseProgressLine(line) {
    // [download]  42.3% of 50.00MiB at 2.50MiB/s ETA 00:30
    const m = String(line).match(/\[download\]\s+(\d+(?:\.\d+)?)%/i);
    if (!m) return null;
    return { percent: parseFloat(m[1]) };
}

// 3) aniq itag bo‘yicha yuklash (progress callback bilan)
// common/ytdlp.js
export async function ytDownloadByItag(url, itag, height, outPath) {
    const base = [
        ...ytCookieArgs(),
        '--add-header', 'Referer: https://www.youtube.com/',
        '--no-continue',
        '--force-overwrites',
        '-N', '4',
        '--concurrent-fragments', '8',
        '-o', outPath,
        '--merge-output-format', 'mp4',
        '--postprocessor-args', 'ffmpeg:-movflags +faststart'
    ];

    const tries = [
        // 1) Aynan itag (progressive mp4 bo‘lsa)
        ['-f', `[itag=${itag}][ext=mp4]`],

        // 2) Aynan itag (konteynerga qaramay), agar video-only bo‘lsa audio bilan qo‘shib
        ['-f', `[itag=${itag}]+bestaudio[ext=m4a]/[itag=${itag}]`],

        // 3) Shu balandlik bo‘yicha h264/mp4 ga preferensiya
        ['-f', 'bv*+ba/b', '-S', `res:${height},ext:mp4,vcodec:avc1,acodec:m4a`],

        // 4) Faqat balandlik bo‘yicha (kodekni cheklamaymiz)
        ['-f', 'bv*+ba/b', '-S', `res:${height}`],

        // 5) Eng mosini olamiz, kerak bo‘lsa mp4 ga qayta kodlaymiz
        ['-f', `best[height<=${height}]`, '--recode-video', 'mp4'],
    ];

    let lastErr;
    for (const t of tries) {
        const args = [...t, ...base, url];
        console.log('[YT itag/fallback try]', args.join(' '));
        try {
            await execYtDlp(args, { timeout: 180000 });
            return; // muvaffaqiyat
        } catch (e) {
            lastErr = e;
            console.error('YT itag/fallback failed:', e?.stderr || e);
        }
    }
    throw lastErr || new Error('No working format found');
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