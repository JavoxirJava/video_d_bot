import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pexec = promisify(execFile);

export async function probeCodecs(filePath) {
    const { stdout } = await pexec('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath
    ]);
    const vcodec = stdout.trim();

    const { stdout: aout } = await pexec('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath
    ]).catch(() => ({ stdout: '' }));
    const acodec = aout.trim();

    return { vcodec, acodec };
}
