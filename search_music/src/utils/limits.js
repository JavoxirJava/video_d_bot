import fs from 'fs';
import fse from 'fs-extra';
import path from 'path';

const DATA_DIR = 'data';
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const PREMIUM_FILE = path.join(DATA_DIR, 'premium.json');

function loadJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; } }
function saveJson(p, obj) { fse.ensureFileSync(p); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }
function todayKey() { const d = new Date(); const y = d.getUTCFullYear(); const m = String(d.getUTCMonth() + 1).padStart(2, '0'); const day = String(d.getUTCDate()).padStart(2, '0'); return `${y}-${m}-${day}`; }

export function isPremium(userId) { const map = loadJson(PREMIUM_FILE, {}); return !!map[userId]; }
export function setPremium(userId, value) { const map = loadJson(PREMIUM_FILE, {}); if (value) map[userId] = true; else delete map[userId]; saveJson(PREMIUM_FILE, map); }
export function getTodayUsage(userId) { const usage = loadJson(USAGE_FILE, {}); const k = todayKey(); return usage[k]?.[userId] || 0; }
export function canConsume(userId, limit) { return getTodayUsage(userId) < limit; }
export function consume(userId) { const usage = loadJson(USAGE_FILE, {}); const k = todayKey(); usage[k] = usage[k] || {}; usage[k][userId] = (usage[k][userId] || 0) + 1; saveJson(USAGE_FILE, usage); }