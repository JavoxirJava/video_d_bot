// lib/execYtDlp.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexecFile = promisify(execFile);

function baseArgs() {
    const args = ['-o', `${process.env.TMPDIR || '/tmp'}/%(id)s.%(ext)s`];
    // progressiv oqimni afzal ko‘rish uchun fallback tartibi:
    // 1) progressive mp4 (b)  2) avc1+m4a mux  3) best mp4
    args.push('-f', "b[ext=mp4]/bv*[vcodec*=avc1][ext=mp4]+ba[ext=m4a]/best[ext=mp4]");
    return args;
}

export async function execYtDlp(url, extra = []) {
    const args = [...baseArgs()];

    // fragmentlarni parallel olish
    if (process.env.YTDLP_CONCURRENT_FRAGMENTS) {
        args.push('--concurrent-fragments', process.env.YTDLP_CONCURRENT_FRAGMENTS);
    }
    // aria2c
    if (process.env.YTDLP_USE_ARIA2C === '1') {
        args.push('--downloader', 'aria2c', '--downloader-args', 'aria2c:-x16 -s16 -k1M');
    }

    args.push(url);
    const { stdout, stderr } = await pexecFile('yt-dlp', [...args, ...extra], {
        env: { ...process.env, TMPDIR: process.env.TMPDIR || '/tmp' },
        maxBuffer: 1024 * 1024 * 10
    });
    return { stdout, stderr };
}
