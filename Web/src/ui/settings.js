// Пользовательские настройки (язык, субтитры, голос, громкость) — хранятся в localStorage.
// Заполняют game.settings: subSize 'S'|'M'|'L', subBg, voice, volume{master,music,sfx,amb,vo}.
const KEY = 'rakis.web.settings.v1';
const DEFAULT_VOLUME = { master: 0.9, music: 0.8, sfx: 1, amb: 1, vo: 1 };

function readStore() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export function loadSettings(game) {
  const s = game.settings;
  if (s._loaded) return;
  s._loaded = true;
  const saved = s.autotest ? {} : readStore();
  s.subSize = ['S', 'M', 'L'].includes(saved.subSize) ? saved.subSize : 'M';
  s.subBg = !!saved.subBg;
  s.voice = s.autotest ? false : (saved.voice ?? ('speechSynthesis' in globalThis));
  s.volume = { ...DEFAULT_VOLUME, ...(saved.volume || {}) };
  // Язык из URL (?lang=) важнее сохранённого.
  if (s.lang) game.lang = String(s.lang).toUpperCase() === 'EN' ? 'EN' : 'RU';
  else if (saved.lang === 'RU' || saved.lang === 'EN') game.lang = saved.lang;
}

export function saveSettings(game) {
  if (game.settings.autotest) return;
  const s = game.settings;
  try {
    localStorage.setItem(KEY, JSON.stringify({ lang: game.lang, subSize: s.subSize, subBg: s.subBg, voice: s.voice, volume: s.volume }));
  } catch { /* приватный режим — не критично */ }
}

export function setLang(game, lang) {
  if (game.lang === lang) return;
  game.lang = lang;
  saveSettings(game);
  game.bus.emit('lang', { lang });
}

/** URL текущей страницы без отладочных параметров старта (для «Выход в меню» / повтора). */
export function menuURL(keep = []) {
  const u = new URL(location.href);
  for (const k of ['skip', 'at', 'autotest']) if (!keep.includes(k)) u.searchParams.delete(k);
  return u.toString();
}
