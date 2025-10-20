import { Markup } from 'telegraf';

export function ytFormatsKeyboard(variants) {
    // variants: [{label:'360p', data:'yt|id|itag|height'}, ...]
    const rows = [];
    for (const v of variants) rows.push([Markup.button.callback(v.label, v.data)]);
    return Markup.inlineKeyboard(rows);
}

export function mainMenu() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🎬 Video yuklash', 'menu_video')],
        [Markup.button.callback('🎵 Musiqa qidirish', 'menu_music')],
        [Markup.button.callback('🤖 AI yordam', 'menu_ai')]
    ]);
}

export function premiumCTA() {
    return Markup.inlineKeyboard([
        [Markup.button.url('🚀 Premium', 'https://t.me/avgroup_ad')],
    ]);
}