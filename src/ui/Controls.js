/** Controls table for the menu / help overlay. Player.CONTROLS is used when the real player module exports it. */

export const FALLBACK_CONTROLS = [
  { key: 'W / A / S / D', ru: 'трастеры: вперёд / влево / назад / вправо' },
  { key: 'Space / Ctrl', ru: 'трастеры: вверх / вниз' },
  { key: 'Мышь', ru: 'обзор' },
  { key: 'Q / E', ru: 'крен' },
  { key: 'Shift', ru: 'форсаж' },
  { key: 'G', ru: 'схватить / отпустить поручень' },
  { key: 'Space (на поручне)', ru: 'оттолкнуться' },
  { key: 'R', ru: 'подтянуть трос' },
  { key: 'Shift + R', ru: 'отстегнуть трос' },
  { key: 'X', ru: 'стабилизация ориентации' },
  { key: 'V', ru: 'гашение движения' },
  { key: 'E', ru: 'шлюз: выход / вход' },
  { key: 'F', ru: 'камера обзора' },
  { key: 'T', ru: 'ход времени: ×1 / ×10 / ×60 / ×600 / ×3600' },
  { key: '[ / ]', ru: 'медленнее / быстрее' },
  { key: 'P', ru: 'пауза' },
  { key: 'C', ru: 'свободная камера' },
  { key: 'H', ru: 'помощь' },
  { key: 'M', ru: 'звук' },
  { key: 'Esc', ru: 'меню' },
];

/** Rows the UI itself handles; appended when the player's list lacks them. */
const UI_ROWS = [
  { key: 'H', ru: 'помощь (эта таблица)' },
  { key: 'Esc', ru: 'меню / пауза' },
  { key: 'Z', ru: 'телескоп (купол, открытый космос, камеры обзора)' },
  { key: 'N', ru: 'подсказки неба: созвездия, названия' },
];

/** Free camera rows (FreeCamera.js), appended to every list. */
const FREECAM_ROWS = [
  { key: 'СВОБ. КАМЕРА', ru: 'C — включить / выключить · F — камера обзора' },
  { key: 'W / A / S / D', ru: 'вперёд / влево / назад / вправо' },
  { key: 'Space / Ctrl', ru: 'вверх / вниз · Q / E — крен' },
  { key: 'Колесо, + / −', ru: 'скорость (от 0,1 м/с до 30 000 км/с) · Shift — ×10' },
  { key: 'B', ru: 'вернуться к станции · O — ориентация: инерциальная / местная вертикаль' },
];

let cached = null;

/** Resolves to [{key, ru}]. Never rejects. */
export async function loadControls() {
  if (cached) return cached;
  let list = null;
  try {
    const m = await import('../player/Player.js');
    const c = m?.Player?.CONTROLS;
    if (Array.isArray(c) && c.length) list = c.filter((r) => r && typeof r.key === 'string' && typeof r.ru === 'string');
  } catch (_) { /* stub player or broken module: use the fallback */ }
  if (!list || !list.length) list = FALLBACK_CONTROLS.slice();
  else {
    for (const row of UI_ROWS) {
      const has = list.some((r) => r.key.split(/[\s\/+]+/).includes(row.key));
      if (!has) list.push(row);
    }
  }
  list = list.concat(FREECAM_ROWS);
  cached = list;
  return list;
}

/** Builds a <table class="ctl"> from a controls list. */
export function controlsTable(list) {
  const table = document.createElement('table');
  table.className = 'ctl';
  const tb = document.createElement('tbody');
  for (const r of list) {
    const tr = document.createElement('tr');
    const k = document.createElement('td'); k.className = 'key'; k.textContent = r.key;
    const d = document.createElement('td'); d.textContent = r.ru;
    tr.append(k, d); tb.append(tr);
  }
  table.append(tb);
  return table;
}
