// yt-dlp --newline chiqishini oddiy regex bilan parse qilamiz.
// Masalan: "[download]  42.3% of 50.00MiB at 2.50MiB/s ETA 00:30"
const dlRegex = /\[download\]\s+(\d+(?:\.\d+)?)%.*?of\s+([\d.]+)([KMG]i?B).*?ETA\s+(\d{2}:\d{2})/i;

export function parseProgressLine(line) {
    const m = line.match(dlRegex);
    if (!m) return null;
    const percent = parseFloat(m[1]);
    return { percent };
}
