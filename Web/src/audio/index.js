// game.audio — процедурный звук на WebAudio (без файлов). Запускается по первому жесту пользователя / событию 'start'.
// API: event(id, pos?), setMusic(state), finalChord(), setVolume(bus, v), resume(), ready, musicState, voice (речь на языке Ракиса: speak/stop/renderOffline).
// Если AudioContext недоступен — все методы безопасно ничего не делают.
import { createEngine } from './engine.js';
import { createAmbience } from './ambience.js';
import { createSfx } from './sfx.js';
import { createMusic } from './music.js';
import { createVoice, renderOffline } from './voice.js';

export function create(game) {
  const { bus } = game;
  let eng = null, amb = null, sfx = null, music = null, voice = null;
  let pendingMusic = null, failed = false, acc = 0;
  let duckTarget = 1, harvRunning = false;

  function ensure() {
    if (eng || failed) return eng;
    try {
      eng = createEngine(game);
      if (!eng) { failed = true; return null; }
      amb = createAmbience(game, eng);
      sfx = createSfx(game, eng);
      music = createMusic(game, eng);
      music.start();
      voice = createVoice(game, eng);
      api.voice = voice;
      eng.resume();
      if (pendingMusic) music.set(pendingMusic);
      if (harvRunning) sfx.play('Harvester.Run');
      applyAll();
    } catch (e) {
      console.error('[audio] не удалось построить граф:', e);
      failed = true; eng = null;
    }
    return eng;
  }
  function applyAll() {
    const v = game.settings.volume;
    if (!eng || !v) return;
    for (const k of Object.keys(v)) eng.setVolume(k, v[k]);
  }

  // Автозапуск: контекст нельзя запускать без жеста пользователя.
  const gestures = ['pointerdown', 'keydown', 'touchstart'];
  const onGesture = () => {
    ensure();
    eng?.resume();
    if (eng?.running) for (const g of gestures) removeEventListener(g, onGesture, true);
  };
  for (const g of gestures) addEventListener(g, onGesture, true);
  bus.on('start', () => { ensure(); eng?.resume(); });
  bus.on('boot', () => { if (game.settings.autotest) ensure(); });

  // Дакинг музыки под диалоги.
  bus.on('subtitle', (s) => {
    if (s?.kind === 'line') duckTarget = 0.5;
    else if (s?.kind === 'lore') duckTarget = 0.75;
    if (s?.id === 'DLG_B5_001' && s.kind === 'line') amb?.chant(Math.min(s.duration || 4, 6));
  });
  bus.on('chain:end', () => { duckTarget = 1; });
  bus.on('harvester', ({ state } = {}) => { harvRunning = /^(running|run)$/i.test(String(state || '')); });
  bus.on('ritual', () => { if (amb) amb.ritualOn = true; });
  bus.on('pause', () => { if (eng) eng.ramp(eng.duck.gain, game.paused ? 0.6 : duckTarget, 0.15); });
  bus.on('worm:state', ({ to } = {}) => {
    if (to === 'Listening') sfx?.ui.tick();
  });

  const api = {
    alwaysUpdate: true,
    get ready() { return !!eng; },
    get running() { return !!eng?.running; },
    get musicState() { return music?.state ?? pendingMusic ?? 'Silence'; },
    get engine() { return eng; },
    resume() { ensure(); eng?.resume(); },
    /** Уровень на выходе (dBFS) — для автотестов: {rms, peak}. */
    level() { return eng ? eng.level() : { rms: -120, peak: -120 }; },
    /** Событие из AudioEvents (EventID): 'Foot.Sand', 'Door.SealHiss', 'UI.Hint', 'Music.SietchLife'… */
    event(id, pos) {
      if (!ensure() || !id) return;
      if (id.startsWith('Music.')) { api.setMusic(id.slice(6)); return; }
      sfx.play(id, pos);
    },
    setMusic(state) {
      pendingMusic = state;
      if (ensure()) music.set(state);
    },
    finalChord() { if (ensure()) music.finalChord(); },
    /** Прощальное нарастание хора (червь уходит). */
    swell() { if (ensure()) music.swell(); },
    setVolume(name, v) { if (eng) eng.setVolume(name, v); else if (game.settings.volume) game.settings.volume[name] = v; },
    applyVolumes: applyAll,
    /** Офлайн-рендер реплики синтезатором (проверка графа): → {rms, peak, speechRms}. */
    renderOffline,
    update(dt) {
      if (!eng || !eng.running) return;
      acc += dt;
      if (acc < 1 / 15) return;
      const d = acc; acc = 0;
      try {
        eng.updateListener();
        amb.update(d);
        sfx.update(d);
        voice?.update();
        eng.ramp(eng.duck.gain, game.paused ? 0.6 : duckTarget, duckTarget < 1 ? 0.25 : 1.0);
      } catch (e) { console.error('[audio] update:', e); }
    },
  };
  return game.add('audio', api);
}
