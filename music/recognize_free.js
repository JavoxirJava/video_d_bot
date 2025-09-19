import { execFile } from 'child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const FP = process.env.FPCALC_PATH || '/usr/bin/fpcalc';
const ACOUSTID_KEY = process.env.ACOUSTID_API_KEY;
const SNIPPET_SEC = 12;

function sh(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { maxBuffer: 64e6, ...opts }, (err, stdout, stderr) => {
            if (err) { err.stderr = stderr; return reject(err); }
            resolve({ stdout, stderr });
        });
    });
}

export async function probeDurationSec(inPath) {
    const { stdout } = await sh(
        process.env.FFPROBE_PATH || 'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of',
            'default=noprint_wrappers=1:nokey=1', inPath]
    );
    const v = parseFloat(String(stdout).trim());
    return Number.isFinite(v) ? v : 0;
}

async function makeSnippet(inPath, outPath, ss, t = SNIPPET_SEC) {
    const args = [
        '-y', '-ss', String(Math.max(0, ss)), '-t', String(t),
        '-i', inPath,
        '-vn', '-ac', '1', '-ar', '16000',
        '-f', 'wav',
        outPath
    ];
    await sh(FFMPEG, args);
    return outPath;
}

async function fpcalcJson(wavPath) {
    const { stdout } = await sh(FP, ['-json', '-length', String(SNIPPET_SEC), wavPath]);
    return JSON.parse(stdout);
}

async function acoustIdIdentify(fingerprint, durationSec) {
    if (!ACOUSTID_KEY) throw new Error('ACOUSTID_API_KEY yo‘q');
    const body = new URLSearchParams({
        client: ACOUSTID_KEY,
        duration: String(Math.round(durationSec || SNIPPET_SEC)),
        fingerprint,
        meta: 'recordings+releasegroups+compress'
    });
    const res = await fetch('https://api.acoustid.org/v2/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    if (!res.ok) throw new Error(`acoustid http ${res.status}`);
    return res.json();
}

function mapAcoustIdResults(json) {
    // JSON → {title, artist, album, duration_sec, external_id}
    const out = [];
    const arr = json?.results || [];
    for (const r of arr) {
        const score = r?.score || 0;
        const recs = r?.recordings || [];
        for (const rec of recs) {
            const title = rec?.title || '';
            const arts = (rec?.artists || []).map(a => a?.name).filter(Boolean);
            const artist = arts.join(', ');
            const rg = (rec?.releasegroups || [])[0];
            const album = rg?.title || '';
            const duration = rec?.duration || null;
            const external_id = rec?.id || '';
            out.push({ title, artist, album, duration_sec: duration, score, external_id });
        }
    }
    // score bo‘yicha tartibla, takrorlarni yo‘qot
    const uniq = new Map();
    for (const x of out.sort((a, b) => (b.score || 0) - (a.score || 0))) {
        const key = (x.title + '|' + x.artist).toLowerCase();
        if (!uniq.has(key)) uniq.set(key, x);
    }
    return [...uniq.values()];
}

/**
 * Free recognition pipeline.
 * @param {string} inPath - Telegramdan yuklangan audio/video fayl yo‘li
 * @param {(s:string)=>Promise<void>} onStatus - statusni yangilash uchun callback (editMessageText)
 * @returns {Array<{title,artist,album,duration_sec,score,external_id}>}
 */
export async function recognizeFree(inPath, onStatus = async () => { }) {
    await onStatus('⏳ Tekshirilyapti: fayl tahlili…');
    const dur = await probeDurationSec(inPath);

    // snippet pozitsiyalari: o‘rta → bosh → oxir
    const positions = [];
    if (dur && dur > SNIPPET_SEC + 2) {
        positions.push(Math.max(0, dur / 2 - SNIPPET_SEC / 2));
        positions.push(0);
        positions.push(Math.max(0, dur - SNIPPET_SEC - 0.1));
    } else positions.push(0);

    const tmpdir = '/tmp';
    let best = [];
    for (let i = 0; i < positions.length; i++) {
        const pos = Math.max(0, Math.floor(positions[i]));
        await onStatus(`🎧 Snippet ${i + 1}/${positions.length} (${pos}s) tayyorlanmoqda…`);
        const wav = path.join(tmpdir, `snippet_${Date.now()}_${i}.wav`);
        await makeSnippet(inPath, wav, pos);
        await onStatus(`🔎 Snippet ${i + 1}: fingerprint…`);
        const fpj = await fpcalcJson(wav);
        await fs.unlink(wav).catch(() => { });
        const fp = fpj?.fingerprint;
        const dd = fpj?.duration || SNIPPET_SEC;
        if (!fp) continue;
        await onStatus(`🌐 Snippet ${i + 1}: AcoustID so‘rovi…`);
        const json = await acoustIdIdentify(fp, dd);
        const mapped = mapAcoustIdResults(json);
        if (mapped.length) best = best.length ? best : mapped; // birinchi muvaffaqiyat
        // “yaxshi match” bo‘lsa to‘xtatamiz
        if (mapped[0]?.score >= 0.65) {
            best = mapped;
            break;
        }
    }
    return best.slice(0, 6);
}
