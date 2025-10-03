import sanitize from 'sanitize-filename';

export function cleanFilename(name, ext) {
    const base = sanitize(name || 'video');
    return ext ? `${base}.${ext.replace(/^\./, '')}` : base;
}
