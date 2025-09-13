export async function ensureSubscribed(ctx, next) {
    const req = (process.env.REQUIRED_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!req.length) return next();
    // TODO: call getChatMember for each channel and verify 'member'|... statuses.
    // For now pass-through.
    return next();
}