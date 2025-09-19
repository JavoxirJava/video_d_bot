// music/identify.js  (skelet)
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { execFile } from 'child_process';

const FFMPEG = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';

export async function cutAudioSnippet(inputPath, outWav, seconds = 12) {
    return new Promise((resolve, reject) => {
        execFile(FFMPEG, ['-y', '-i', inputPath, '-t', String(seconds), '-ac', '1', '-ar', '16000', outWav],
            { maxBuffer: 32e6 }, (err) => err ? reject(err) : resolve());
    });
}

// identifyACR(filePath): wav yuborib natija qaytarish (keyin to‘ldiramiz)
export async function identifyACR(wavPath) {
    // ACR HOST/KEY/SECRET bilan sign → multipart yuborish → JSON qaytarish
    // return { title, artist, album, isrc, confidence }
}
