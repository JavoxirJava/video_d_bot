import { scorpFetch } from '../providers/scorp.js';
import { canonicalIg } from '../utils.js';

/**
 * Try to download media from multiple providers
 * Return list of {type,url,thumb?,title?}
 * Throw if no media
 */
export async function downloadMedia(igUrl) {
    const variants = [igUrl, canonicalIg(igUrl)];
    const errors = [];
    for (const v of variants) {
        try {
            const list = await scorpFetch(v);
            if (list?.length) return list;
            errors.push({ variant: v, note: 'empty list' });
        } catch (e) {
            errors.push({ variant: v, status: e?.response?.status, data: e?.response?.data || e.message });
        }
    }
    const err = new Error('No media from providers');
    err.debug = errors;
    throw err;
}