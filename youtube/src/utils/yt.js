import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { cleanFilename } from './sanitize.js';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';

// URL dan YouTube videoId ni ajratish
export function extractVideoId(url) {
    try {
        const u = new URL(url);
        if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
        if (u.searchParams.get('v')) return u.searchParams.get('v');
        // shorts yoki embed
        const parts = u.pathname.split('/');
        const idx = parts.findIndex(p => ['shorts', 'embed', 'live'].includes(p));
        if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    } catch { }
    return null;
}

// Formatlar ro'yxatini olish (JSON)
export function getFormats(url) {
    return new Promise((resolve, reject) => {
        const args = [
            '-J', url,
            '--no-warnings',
            '--skip-download'
        ];

        if (config.cookiesFromBrowser) {
            args.push('--cookies-from-browser', config.cookiesFromBrowser);
        }

        const p = spawn(config.paths.ytDlp, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        p.stdout.on('data', d => out += d.toString());
        p.stderr.on('data', d => err += d.toString());
        p.on('close', code => {
            if (code === 0) {
                try {
                    const json = JSON.parse(out);
                    resolve(json);
                } catch (e) { reject(e); }
            } else reject(new Error(err || `yt-dlp exited ${code}`));
        });
    });
}

// Tanlangan format uchun download arg'lari
export function buildDownloadArgs({ url, itag, titleForFile }) {
    const tmpId = nanoid();
    const outBase = cleanFilename(titleForFile || 'video');
    const outPath = path.join(config.paths.tmpDir, `${tmpId}_${outBase}.%(ext)s`);

    const args = [
        url,
        '-f', String(itag),
	'--remux-video', 'mp4',
        '--no-part',
        '--concurrent-fragments', '8', // -N 8
        '--newline',
        '--ffmpeg-location', config.paths.ffmpeg,
        '--no-restrict-filenames',
	'-o', outPath
    ];

    if (config.cookiesFromBrowser) {
        args.push('--cookies-from-browser', config.cookiesFromBrowser);
    }

    return { args, outTemplate: outPath };
}

// Tugagan faylni topish (*.mp4 yoki boshqa)
export function resolveFinalPath(template) {
    const dir = path.dirname(template);
    const base = path.basename(template).replace('.%(ext)s', '');
    const files = fs.readdirSync(dir);
    const match = files.find(f => f.startsWith(path.basename(base)));
    return match ? path.join(dir, match) : null;
}
