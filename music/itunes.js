export async function searchItunesSongs(query, limit = 8) {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);
    const json = await res.json();
    return (json.results || []).map(x => ({
        provider: 'itunes',
        external_id: String(x.trackId),
        title: x.trackName,
        artist: x.artistName,
        album: x.collectionName,
        duration_sec: Math.round((x.trackTimeMillis || 0) / 1000),
        preview_url: x.previewUrl,              // 30–90s preview
        thumb_url: x.artworkUrl100?.replace('100x100', '300x300') || null
    }));
}
