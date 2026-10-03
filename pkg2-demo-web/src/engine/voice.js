// Голосовые команды — порт pkg1-sim-vm/core/arcore/voice/commands.py (держать в синхроне, тест сверяет словарь).
// В демо распознаёт Web Speech API браузера (Chrome, нужен интернет); на очках — офлайн Vosk.

export const WAKE = 'сборка';
export const COMMANDS = {
  next: ['дальше', 'далее', 'следующий', 'готово', 'есть'],
  prev: ['назад', 'предыдущий'],
  repeat: ['повтори', 'ещё раз', 'еще раз'],
  slower: ['медленнее', 'тише'],
  faster: ['быстрее', 'скорее'],
  kd: ['покажи кд', 'чертёж', 'чертеж', 'лист'],
  chat: ['покажи чат', 'чат', 'сообщения'],
  panel: ['панель', 'развернуть', 'свернуть'],
  photo: ['фото', 'снимок', 'сфотографируй'],
  ok: ['норма', 'годно'],
  reject: ['брак', 'не годно', 'негодно'],
  call: ['позвать технолога', 'написать технологу', 'вопрос'],
};
const UNITS = { ноль: 0, один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8,
  девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12, пятнадцать: 15, двадцать: 20, тридцать: 30 };
const POINT = new Set(['и', 'точка', 'запятая', 'целых']);

export function parseNumber(words) {
  const m = words.join(' ').match(/\d+(?:[.,]\d+)?/);
  if (m) return parseFloat(m[0].replace(',', '.'));
  let whole = 0, frac = '', inFrac = false, seen = false;
  for (const w of words) {
    if (POINT.has(w) && seen) { inFrac = true; continue; }
    if (w in UNITS) { seen = true; if (inFrac) frac += String(UNITS[w]); else whole += UNITS[w]; }
  }
  if (!seen) return null;
  return frac ? parseFloat(`${whole}.${frac}`) : whole;
}

/** Фраза → [команда, значение] или null. requireWake: фраза должна начинаться со слова «сборка». */
export function parse(text, requireWake = true) {
  let t = text.toLowerCase().replaceAll('ё', 'е').trim();
  t = t.replace(/[^\p{L}\p{N}\s,.]/gu, ' ').replace(/(?<!\d)[,.]|[,.](?!\d)/g, ' ');
  let words = t.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (requireWake) {
    if (words[0] !== WAKE) return null;
    words = words.slice(1);
  }
  const rest = words.join(' ');
  const num = parseNumber(words);
  for (const [cmd, syns] of Object.entries(COMMANDS)) {
    for (const s of [...syns].sort((a, b) => b.length - a.length)) {
      if (rest.startsWith(s.replaceAll('ё', 'е'))) return [cmd, null];
    }
  }
  return num != null ? ['value', num] : null;
}

/** Обёртка Web Speech API. onCommand([cmd, value], text). Возвращает null, если браузер не умеет. */
export function createBrowserListener(onCommand, onText = () => {}) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'ru-RU';
  rec.continuous = true;
  rec.interimResults = false;
  rec.onresult = (e) => {
    const text = e.results[e.results.length - 1][0].transcript;
    onText(text);
    const p = parse(text, true) || parse(text, false);
    if (p) onCommand(p, text);
  };
  let on = false;
  rec.onend = () => { if (on) rec.start(); };
  return {
    start() { on = true; rec.start(); },
    stop() { on = false; rec.stop(); },
    get active() { return on; },
  };
}
