// game.audio — процедурный звук на WebAudio (без файлов). Запускается по первому жесту пользователя / событию 'start'.
// Слои (звук Ред. 3: сэмплы банка + гранулярные/текстурные петли, SFX-шина с лимитером и дакингом): ветер/интерьер с плавным смешением по расстоянию до проёмов, сад (garden:enter/leave), поедание харвестера (worm:devour {phase}).
// Музыка: сценарий задаёт базовое состояние (setMusic), аудио уточняет его — в саду (зона C1_Garden) DesertCalm/DesertDrone → Garden,
// ночью в пустыне → Night; поедание харвестера → Devour.
// API: event(id, pos?), setMusic(state), finalChord(), setVolume(bus, v), resume(), ready, musicState, voice (речь на языке Ракиса: speak/stop/renderOffline).
// Если AudioContext недоступен — все методы безопасно ничего не делают.
import { createEngine } from './engine.js';
import { createAmbience } from './ambience.js';
import { createSfx } from './sfx.js';
import { createMusic } from './music.js';
import { createVoice, renderOffline } from './voice.js';
import { SFX } from '../assets/sfx_bank.js';

export function create(game) {
  const { bus } = game;
  let eng = null, amb = null, sfx = null, music = null, voice = null;
  let pendingMusic = null, failed = false, acc = 0;
  let duckTarget = 1, ambTarget = 1, sfxTarget = 1, harvRunning = false, gardenPending = false;
  let baseMusic = null, effMusic = null, resolveAcc = 0;
  // Базовые «уличные» состояния, которые аудио подменяет по месту/времени суток.
  const OUTDOOR_BASE = new Set(['DesertCalm', 'DesertDrone']);
  function resolveMusic(base) {
    if (!OUTDOOR_BASE.has(base)) return base;
    if (game.space !== 'sietch' && (game.zone === 'C1_Garden' || amb?.gardenFlag)) return 'Garden';
    if (game.weather?.isNight && game.space !== 'sietch') return 'Night';
    return base;
  }
  function applyMusic() {
    if (!music || !baseMusic) return;
    const eff = resolveMusic(baseMusic);
    if (eff === effMusic) return;
    effMusic = eff; music.set(eff);
  }

  function ensure() {
    if (eng || failed) return eng;
    try {
      eng = createEngine(game);
      if (!eng) { failed = true; return null; }
      eng.loadSamples(SFX).catch((e) => console.warn('[audio] банк SFX:', e));   // асинхронно: до готовности шаги идут запасным шумом
      amb = createAmbience(game, eng);
      sfx = createSfx(game, eng);
      music = createMusic(game, eng);
      music.start();
      voice = createVoice(game, eng);
      api.voice = voice;
      eng.resume();
      if (pendingMusic) { baseMusic = pendingMusic; applyMusic(); }
      if (harvRunning) sfx.play('Harvester.Run');
      if (gardenPending) amb.gardenFlag = true;
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
    if (s?.kind === 'line') { duckTarget = 0.6; ambTarget = 0.6; sfxTarget = 0.65; }
    else if (s?.kind === 'lore') { duckTarget = 0.85; ambTarget = 0.85; sfxTarget = 0.85; }
    if (s?.id === 'DLG_B5_001' && s.kind === 'line') amb?.chant(Math.min(s.duration || 4, 6));
  });
  bus.on('chain:end', () => { duckTarget = 1; ambTarget = 1; sfxTarget = 1; });
  bus.on('dialogue:stop', () => { duckTarget = 1; ambTarget = 1; sfxTarget = 1; });
  bus.on('harvester', ({ state } = {}) => { harvRunning = /^(running|run)$/i.test(String(state || '')); });
  bus.on('ritual', () => { if (amb) amb.ritualOn = true; });
  bus.on('pause', () => { if (eng) { eng.ramp(eng.duck.gain, game.paused ? 0.6 : duckTarget, 0.15); eng.ramp(eng.ambDuck.gain, game.paused ? 0.6 : ambTarget, 0.15); eng.ramp(eng.sfxDuck.gain, game.paused ? 0.6 : sfxTarget, 0.15); } });
  bus.on('worm:state', ({ to } = {}) => {
    if (to === 'Listening') sfx?.ui.tick();
  });

  // Сад: птицы, насекомые, ручей. Основной признак — зона C1_Garden (game.zone), события шины — подстраховка.
  bus.on('garden:enter', () => { if (amb) amb.gardenFlag = true; gardenPending = true; });
  bus.on('garden:leave', () => { if (amb) amb.gardenFlag = false; gardenPending = false; });

  // Сценарий «червь пожирает харвестер»: подписка на события шины с разными именами (имена фаз сверяются по README модуля червя).
  // Событие: {phase, x?, z?, duration?}. Классификация фазы по ключевым словам; неизвестные фазы игнорируются (debug-лог).
  const DEVOUR_RULES = [
    ['end', /^(end|done|finish|complete|over|aftermath-end)$/],
    ['alarm', /klaxon|alarm|horn|alert|siren|warn/],
    ['carryall', /carryall|lift|engine|rescue|airborne|strain|tow|haul/],
    ['swallow', /swallow|devour|engulf|bite|strike|breach|emerge|surface|rise|attack|eat|maw|jaw|gulp/],
    ['debris', /debris|collapse|crash|fall|crumble|wreck|sink|dive|aftermath|settle|crunch|rubble/],
    ['rumble', /wormsign|rumble|tremor|approach|sign|stalk|build|start|begin|detect|sense|listen|hunt/],
  ];
  let lastDevourAt = 0;
  function onDevour(e, hint) {
    const ph = String(e?.phase ?? e?.state ?? e?.name ?? e?.id ?? hint ?? '').toLowerCase().trim();
    const rule = DEVOUR_RULES.find(([, re]) => re.test(ph));
    if (!rule || !ensure()) { if (!rule) console.debug(`[audio] неизвестная фаза поедания '${ph}'`); return; }
    const pos = e && e.x !== undefined && e.z !== undefined ? { x: e.x, y: game.heightAt?.(e.x, e.z) ?? 0, z: e.z } : undefined;
    const dur = Number.isFinite(e?.duration) ? e.duration : undefined;
    lastDevourAt = performance.now();
    switch (rule[0]) {
      case 'rumble': sfx.devourRumble(pos, dur); api.setMusic('WormThreat'); break;
      case 'alarm': sfx.devourAlarm(pos); break;
      case 'carryall': sfx.devourCarryall(pos, dur); break;
      case 'swallow': sfx.devourSwallow(pos); api.setMusic('Devour'); break;
      case 'debris': sfx.devourDebris(pos, dur); api.setMusic('Silence'); break;
      case 'end': api.setMusic('DesertDrone'); break;
      default: break;
    }
  }
  for (const name of ['worm:devour', 'devour', 'worm:devour:phase', 'harvester:devour']) bus.on(name, (e) => onDevour(e));
  bus.on('worm:devour:end', () => onDevour({ phase: 'end' }));
  bus.on('worm:devour:start', (e) => onDevour({ ...e, phase: e?.phase ?? 'rumble' }));
  bus.on('worm:devour:swallow', (e) => onDevour({ ...e, phase: 'swallow' }));

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
      pendingMusic = state; baseMusic = state;
      if (ensure()) applyMusic();
    },
    /** Базовое (сценарное) состояние музыки; musicState — фактическое (с учётом сада/ночи). */
    get baseMusicState() { return baseMusic ?? 'Silence'; },
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
      resolveAcc += dt;
      if (resolveAcc > 1) { resolveAcc = 0; applyMusic(); }
      if (acc < 1 / 15) return;
      const d = acc; acc = 0;
      try {
        eng.updateListener();
        eng.pump();
        amb.update(d);
        sfx.update(d);
        voice?.update();
        eng.ramp(eng.duck.gain, game.paused ? 0.6 : duckTarget, duckTarget < 1 ? 0.25 : 1.0);
        eng.ramp(eng.ambDuck.gain, game.paused ? 0.6 : ambTarget, ambTarget < 1 ? 0.25 : 1.0);
        eng.ramp(eng.sfxDuck.gain, game.paused ? 0.6 : sfxTarget, sfxTarget < 1 ? 0.25 : 1.0);
      } catch (e) { console.error('[audio] update:', e); }
    },
  };
  return game.add('audio', api);
}
