import fetch from 'node-fetch';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

ffmpeg.setFfmpegPath(ffmpegPath);

export async function downloadToFile(url, outPath) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    await new Promise((resolve, reject) => {
        const w = fs.createWriteStream(outPath);
        res.body.pipe(w);
        res.body.on('error', reject);
        w.on('finish', resolve);
    });
    return outPath;
}

export async function toWav(inputPath, outputPath) {
    await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat('wav')
            .audioFrequency(44100)
            .audioChannels(2)
            .save(outputPath)
            .on('end', resolve)
            .on('error', reject);
    });
    return outputPath;
}

export async function makeRecognitionSample(inputPath, outputPath, {
    durationSec = parseInt(process.env.RECO_DURATION_SEC || '12', 10),
    bitrate = process.env.RECO_BITRATE || '64k',
    sampleRate = parseInt(process.env.RECO_SAMPLE_RATE || '16000', 10),
    channels = parseInt(process.env.RECO_CHANNELS || '1', 10),
} = {}) {
    await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .audioChannels(channels)
            .audioFrequency(sampleRate)
            .audioBitrate(bitrate)
            .duration(durationSec)
            .audioCodec('libmp3lame')
            .format('mp3')
            .save(outputPath)
            .on('end', resolve)
            .on('error', reject);
    });
    return outputPath;
}