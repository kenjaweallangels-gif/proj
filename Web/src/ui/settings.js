// Пользовательские настройки (язык, субтитры, режим голоса, показ родной строки, громкость) — хранятся в localStorage.
// Заполняют game.settings: subSize 'S'|'M'|'L', subBg, voice, volume{master,music,sfx,amb,vo}.
const KEY = 'rakis.web.settings.v1';
export const VOICE_MODES = ['auto', 'off'];   // TTS браузера и формантный синтезатор в игре не используются (Ред. 3)
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
  // Голос: 'auto' | 'tts' | 'synth' | 'off'. По умолчанию включён (в автотесте выключен). s.voice — производный флаг (режим ≠ off).
  s.voiceMode = s.autotest ? 'off' : (VOICE_MODES.includes(saved.voiceMode) ? saved.voiceMode : (saved.voice === false ? 'off' : 'auto'));
  s.voice = s.voiceMode !== 'off';
  s.showNative = saved.showNative ?? true;      // строка на языке мира над переводом в субтитрах
  s.hintsSeen = { ...(saved.hintsSeen || {}) };
  s.volume = { ...DEFAULT_VOLUME, ...(saved.volume || {}) };
  // Язык из URL (?lang=) важнее сохранённого.
  if (s.lang) game.lang = String(s.lang).toUpperCase() === 'EN' ? 'EN' : 'RU';
  else if (saved.lang === 'RU' || saved.lang === 'EN') game.lang = saved.lang;
}

export function saveSettings(game) {
  if (game.settings.autotest) return;
  const s = game.settings;
  try {
    localStorage.setItem(KEY, JSON.stringify({ lang: game.lang, subSize: s.subSize, subBg: s.subBg, voiceMode: s.voiceMode, showNative: s.showNative, hintsSeen: s.hintsSeen, volume: s.volume }));
  } catch { /* приватный режим — не критично */ }
}

export function setVoiceMode(game, mode) {
  const s = game.settings;
  s.voiceMode = VOICE_MODES.includes(mode) ? mode : 'auto';
  s.voice = s.voiceMode !== 'off';
  if (!s.voice) game.audio?.voice?.stop?.();
  saveSettings(game);
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
