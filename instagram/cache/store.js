import { connection } from '../queue/connection.js';

const client = connection.client; // ioredis instance

function key(code) {
    return `ig:cache:${code}`;
}

// type = 'video' | 'photo'
// payload = { file_id, type, thumb_id? }
export async function cacheGet(code) {
    if (!code) return null;
    const data = await client.hgetall(key(code));
    if (!data || !data.file_id) return null;
    return { file_id: data.file_id, type: data.type || 'video', thumb_id: data.thumb_id || null };
}

export async function cacheSet(code, payload) {
    if (!code || !payload?.file_id) return;
    const k = key(code);
    await client.hset(k, {
        file_id: payload.file_id,
        type: payload.type || 'video',
        thumb_id: payload.thumb_id || '',
    });
    const ttl = Number(process.env.CACHE_TTL || '0');
    if (ttl > 0) await client.expire(k, ttl);
}
