import { execYtDlp } from './execYtDlp.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { probeCodecs } from './codecs.js';
import fs from 'node:fs';
import path from 'node:path';

const pexec = promisify(execFile);

function pickOutput(stdout) {
    // yt-dlp ning -o ga qo‘ygan pattern bo‘yicha oxirgi yuklangan faylni topish
    // Oddiy usul: stdout ichida ".mp4" ni qidirish yoki TMPDIR ni skanerlash.
    const tmp = process.env.TMPDIR || '/tmp';
    // Eng ishonchli usul: oxirgi o‘zgargan .mp4 ni olish
    const files = fs.readdirSync(tmp)
        .filter(f => f.endsWith('.mp4'))
        .map(f => ({ f, t: fs.statSync(path.join(tmp, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
    if (!files[0]) throw new Error('Yuklangan mp4 topilmadi');
    return path.join(tmp, files[0].f);
}

export async function muxOrTranscode({ url, formatKey, preferMux }) {
    // 1) yuklab olish (formatKey = h:360 va hokazo bo‘lsa, —S res:360 kabi)
    const sortHeight = formatKey?.startsWith('h:')
        ? ['-S', `res:${formatKey.split(':')[1]}`]
        : [];

    await execYtDlp(url, sortHeight);
    const downloaded = pickOutput('');

    // 2) preferMux=true bo‘lsa, avval “copy + faststart”ga urin
    if (preferMux) {
        const { vcodec, acodec } = await probeCodecs(downloaded);
        if (vcodec.includes('h264') && (acodec.includes('aac') || acodec === '')) {
            // Ko‘pincha IG/YT allaqachon mos bo‘ladi — tez mux
            const fast = downloaded.replace(/\.mp4$/, '.fast.mp4');
            await pexec('ffmpeg', [
                '-y', '-i', downloaded,
                '-c', 'copy',
                '-movflags', '+faststart',
                fast
            ]);
            fs.rmSync(downloaded, { force: true });
            return fast;
        }
    }

    // 3) Fallback re-encode (tezzz, lekin sifat biroz kamayishi mumkin)
    const preset = process.env.FFMPEG_PRESET || 'veryfast';
    const crf = process.env.FFMPEG_CRF || '23';

    const out = downloaded.replace(/\.mp4$/, '.re.mp4');
    // IG vertikal kabi muammolarda juft piksel scale (faqat kerak bo‘lsa)
    await pexec('ffmpeg', [
        '-y', '-i', downloaded,
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libx264', '-preset', preset, '-crf', crf,
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        out
    ]);
    fs.rmSync(downloaded, { force: true });
    return out;
}