const PICKS = new Map();
export function setPicks(chatId, messageId, list) { PICKS.set(`${chatId}:${messageId}`, list); }
export function getPicks(chatId, messageId) { return PICKS.get(`${chatId}:${messageId}`); }
export function delPicks(chatId, messageId) { PICKS.delete(`${chatId}:${messageId}`); }