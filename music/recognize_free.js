import { execFile } from 'child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const FP = process.env.FPCALC_PATH || '/usr/bin/fpcalc';
const FFPROBE = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';

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
        FFPROBE,
        ['-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', inPath]
    );
    const v = parseFloat(String(stdout).trim());
    return Number.isFinite(v) ? v : 0;
}

async function makeSnippet(inPath, outPath, ss, t = SNIPPET_SEC) {
    const args = [
        '-y', '-ss', String(Math.max(0, ss)), '-t', String(t),
        '-i', inPath,
        '-vn', '-ac', '1', '-ar', '44100',
        '-f', 'wav',
        outPath
    ];
    await sh(FFMPEG, args);
    return outPath;
}

async function fpcalcJson(wavPath, lengthSec = SNIPPET_SEC) {
    const { stdout } = await sh(FP, ['-json', '-length', String(Math.round(lengthSec)), wavPath]);
    return JSON.parse(stdout);
}

async function acoustIdIdentify(fingerprint, durationSec) {
    if (!ACOUSTID_KEY) throw new Error('ACOUSTID_API_KEY yo‘q');

    const form = new URLSearchParams({
        client: ACOUSTID_KEY,
        duration: String(Math.round(durationSec || SNIPPET_SEC)),
        fingerprint,
        meta: 'recordings+releasegroups+compress',
        format: 'json'
    });

    // Helper: bitta urinish (POST)
    const doPost = async (url) => {
        const res = await (globalThis.fetch ?? (await import('node-fetch')).default)(url, {
            method: 'POST',
            headers: {
                // Ba’zi konfiguratsiyalarda shu headerlar shart bo‘ladi:
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Accept': 'application/json',
                'User-Agent': 'video-d-bot/1.0 (+mailto:javoxir8177@gmail.com)'
            },
            body: form
        });
        const text = await res.text(); // xatoda ham o‘qiymiz
        if (!res.ok) {
            const err = new Error(`acoustid http ${res.status}`);
            err.responseText = text;
            throw err;
        }
        try { return JSON.parse(text); } catch { return {}; }
    };

    // 1) asosiy endpoint (POST, no trailing slash)
    try {
        return await doPost('https://api.acoustid.org/v2/identify');
    } catch (e1) {
        // 2) 404 bo‘lsa trailing slash bilan yana urinib ko‘ramiz
        if (String(e1.message).includes('404')) {
            try {
                return await doPost('https://api.acoustid.org/v2/identify/');
            } catch (e2) {
                // 3) yana 404 bo‘lsa GET-query fallback (oxirgi chora)
                if (String(e2.message).includes('404')) {
                    // oxirgi chora: /lookup (GET)
                    const url = new URL('https://api.acoustid.org/v2/lookup');
                    url.searchParams.set('client', ACOUSTID_KEY);
                    url.searchParams.set('duration', String(Math.round(durationSec || SNIPPET_SEC)));
                    url.searchParams.set('meta', 'recordings+releasegroups+compress');
                    url.searchParams.set('format', 'json');
                    url.searchParams.set('fingerprint', fingerprint);

                    const res = await (globalThis.fetch ?? (await import('node-fetch')).default)(url.toString(), {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                            'User-Agent': 'video-d-bot/1.0 (+mailto:javoxir8177@gmail.com)'
                        }
                    });
                    const text = await res.text();
                    if (!res.ok) {
                        const err = new Error(`acoustid http ${res.status}`);
                        err.responseText = text;
                        throw err;
                    }
                    return JSON.parse(text);
                }
                throw e2;
            }
        }
        throw e1;
    }
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
        // mavjud qismdan chiqib ketmaslik uchun uzunlikni moslaymiz
        const len = Math.max(4, Math.min(SNIPPET_SEC, (dur ? (dur - pos - 0.2) : SNIPPET_SEC)));
        await makeSnippet(inPath, wav, pos, len);
        await onStatus(`🔎 Snippet ${i + 1}: fingerprint…`);
        const fpj = await fpcalcJson(wav, len);
        await fs.unlink(wav).catch(() => { });
        const fp = fpj?.fingerprint;
        const dd = fpj?.duration || SNIPPET_SEC;
        if (!fp) continue;
        await onStatus(`🌐 Snippet ${i + 1}: AcoustID so‘rovi…`);
        const json = await acoustIdIdentify(fp, dd);
        const mapped = mapAcoustIdResults(json);
        if (mapped.length) best = best.length ? best : mapped; // birinchi muvaffaqiyat
        // “yaxshi match” bo‘lsa to‘xtatamiz
        if (mapped[0]?.score >= 0.70) {
            best = mapped;
            break;
        }
    }
    return best.slice(0, 6);
}