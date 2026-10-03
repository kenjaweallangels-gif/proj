// Погода и время суток: пресеты (CSV + свои) → солнце, две луны, небо, туман, ветер, буря, экспозиция.
// Публичный API (game.weather) описан в Web/src/desert/README.md.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, DEG, damp } from '../core/util.js';
import { ENV } from './env.js';

// ------------------------------------------------------------------ небесная механика
// Азимут «на солнце» (градусы от +X к +Z) по часам — художественная схема, развёрнута без разрывов на 24 ч
// (рассвет — с северо-востока, Morning_Erg — 20°: червь затмевает солнце с P4; к ночи — на «север» подземья).
const AZ_KEYS = [[0, 240], [4.5, 298], [6.667, 313], [8.5, 380], [11.5, 416], [12, 420], [15, 478], [17.5, 548], [19.5, 565], [24, 600]];
function azimuthAt(h) {
  h = ((h % 24) + 24) % 24;
  for (let i = 0; i < AZ_KEYS.length - 1; i++) {
    const [h0, a0] = AZ_KEYS[i], [h1, a1] = AZ_KEYS[i + 1];
    if (h <= h1) return lerp(a0, a1, (h - h0) / (h1 - h0));
  }
  return AZ_KEYS[AZ_KEYS.length - 1][1];
}
const PHI = 23 * DEG;
/** Часовой угол, градусы. До полудня — 15°/ч (формула docs/tech-art/lighting_weather.md §3), после — 13.5°/ч (закат ≈ 19:00). */
function hourAngle(h) {
  let d = ((h - 12) % 24 + 36) % 24 - 12;
  return 15 * d * (d > 0 ? 0.9 : 1);
}
function elevationFor(h, decDeg) {
  const dec = decDeg * DEG, H = hourAngle(h) * DEG;
  return Math.asin(clamp(Math.sin(dec) * Math.sin(PHI) + Math.cos(dec) * Math.cos(PHI) * Math.cos(H), -1, 1)) / DEG;
}
/** Высота солнца, градусы (φ = 23°, δ = +12°). */
export function sunElevation(hours) { return elevationFor(hours, 12); }
function dirFromElAz(el, azDeg, out) {
  const e = el * DEG, a = azDeg * DEG;
  return out.set(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)).normalize();
}

// Две луны Ракиса: большая (быстрая смена фаз) и малая (ещё быстрее, ниже по склонению).
const MOON_DEF = [
  { id: 'moonA', RU: 'Большая луна', EN: 'Great moon', radius: 2.5, dec: 9, synodic: 29.5, phase0: 0.47, tint: [1.0, 0.95, 0.86], bright: 1.0 },
  { id: 'moonB', RU: 'Малая луна', EN: 'Small moon', radius: 1.05, dec: -16, synodic: 9.3, phase0: 0.20, tint: [0.84, 0.9, 1.0], bright: 0.7 },
];

// ------------------------------------------------------------------ ключи цвета неба по высоте солнца
const hex = (s) => new THREE.Color(s);
// [высота °, зенит, горизонт (от солнца), горизонт (к солнцу), уровень яркости]
const SKY_KEYS = [
  [-24, '#050a22', '#10163a', '#10163a', 0.55],
  [-15, '#07102e', '#1a2048', '#241f4c', 0.55],
  [-10, '#0e1c52', '#303466', '#563f72', 0.42],
  [-6, '#1a3070', '#5d5a92', '#b85f6a', 0.34],
  [-2.5, '#2a4a92', '#a67e9e', '#f0804a', 0.5],
  [0.5, '#2c4b8f', '#d49a88', '#f89a3e', 0.62],
  [4, '#2f5198', '#d8a38a', '#f6ac5a', 0.8],
  [12, '#33589f', '#d3a994', '#f0b878', 1.0],
  [26, '#3a62a8', '#cfb496', '#e9c48e', 1.5],
  [55, '#2b58a6', '#c2b196', '#d0bea3', 2.05],
].map(([e, z, a, s, l]) => ({ e, z: hex(z), a: hex(a), s: hex(s), l }));
function skyAt(el, out) {
  const K = SKY_KEYS;
  let i = 0;
  if (el <= K[0].e) i = -1; else if (el >= K[K.length - 1].e) i = K.length - 1;
  else while (el > K[i + 1].e) i++;
  if (i < 0) { out.z.copy(K[0].z); out.a.copy(K[0].a); out.s.copy(K[0].s); out.l = K[0].l; return out; }
  if (i === K.length - 1) { const k = K[i]; out.z.copy(k.z); out.a.copy(k.a); out.s.copy(k.s); out.l = k.l; return out; }
  const k0 = K[i], k1 = K[i + 1], t = (el - k0.e) / (k1.e - k0.e);
  out.z.lerpColors(k0.z, k1.z, t); out.a.lerpColors(k0.a, k1.a, t); out.s.lerpColors(k0.s, k1.s, t); out.l = lerp(k0.l, k1.l, t);
  return out;
}

// ------------------------------------------------------------------ пресеты
const c3 = (r, g, b) => ({ r, g, b });
const EXTRA = {
  // id: [RU, EN, kind, поля]. hours < 0 — время не трогать.
  Clear_Noon: ['Ясный полдень', 'Clear noon', 'time', { hours: 12, sunLux: 125000, sunColor: c3(1, 0.98, 0.95), sky: 1.0, fogDensity: 0.004, fogFalloff: 0.06, fogColor: c3(0.78, 0.7, 0.58), volFog: 0.5, dust: 0.04, wind: 4, windYaw: 55, storm: 0, haze: 0.8, exposure: 1.3, clouds: 0.12 }],
  Haze_Noon: ['Знойное марево', 'Heat haze noon', 'time', { hours: 12.4, sunLux: 120000, sunColor: c3(1, 0.97, 0.9), sky: 1.0, fogDensity: 0.008, fogFalloff: 0.05, fogColor: c3(0.84, 0.72, 0.54), volFog: 0.6, dust: 0.22, wind: 2.5, windYaw: 50, storm: 0, haze: 1, exposure: 1.4, clouds: 0.03 }],
  Dusk_Gold: ['Золотой закат', 'Golden dusk', 'time', { hours: 18.35, sunLux: 70000, sunColor: c3(1, 0.8, 0.55), sky: 1.1, fogDensity: 0.012, fogFalloff: 0.1, fogColor: c3(0.78, 0.52, 0.34), volFog: 0.8, dust: 0.28, wind: 4.5, windYaw: 55, storm: 0, haze: 0.2, exposure: 1, clouds: 0.3 }],
  Twilight_Violet: ['Фиолетовые сумерки', 'Violet twilight', 'time', { hours: 19.7, sunLux: 40000, sunColor: c3(1, 0.7, 0.5), sky: 1.0, fogDensity: 0.01, fogFalloff: 0.1, fogColor: c3(0.5, 0.4, 0.5), volFog: 0.7, dust: 0.15, wind: 3, windYaw: 55, storm: 0, haze: 0, exposure: 1, clouds: 0.25 }],
  Night_Clear: ['Ясная ночь', 'Clear night', 'time', { hours: 23, sunLux: 0, sunColor: c3(1, 0.9, 0.8), sky: 1.0, fogDensity: 0.006, fogFalloff: 0.1, fogColor: c3(0.3, 0.38, 0.55), volFog: 0.4, dust: 0.05, wind: 2.5, windYaw: 55, storm: 0, haze: 0, exposure: 1, clouds: 0.06 }],
  Sandstorm_Full: ['Песчаная буря', 'Full sandstorm', 'weather', { hours: -1, sunLux: 90000, sunColor: c3(1, 0.8, 0.55), sky: 0.85, fogDensity: 0.02, fogFalloff: 0.03, fogColor: c3(0.82, 0.58, 0.32), volFog: 0.9, dust: 0.95, wind: 17, windYaw: 40, storm: 1, haze: 0, exposure: 1.1, clouds: 0.8 }],
  Overcast_Dust: ['Пыльная мгла', 'Dusty overcast', 'weather', { hours: -1, sunLux: 70000, sunColor: c3(1, 0.88, 0.7), sky: 0.9, fogDensity: 0.016, fogFalloff: 0.04, fogColor: c3(0.78, 0.62, 0.44), volFog: 0.8, dust: 0.65, wind: 7, windYaw: 50, storm: 0.15, haze: 0.1, exposure: 1.1, clouds: 0.9 }],
  Calm_Still: ['Штиль', 'Dead calm', 'weather', { hours: -1, sunLux: 100000, sunColor: c3(1, 0.95, 0.88), sky: 1, fogDensity: 0.005, fogFalloff: 0.08, fogColor: c3(0.76, 0.66, 0.52), volFog: 0.5, dust: 0.04, wind: 0.8, windYaw: 55, storm: 0, haze: 0.3, exposure: 1.1, clouds: 0.1 }],
};
const CSV_META = {
  Dawn_Ridge: ['Рассвет на гребне', 'Ridge dawn', 'time'],
  Morning_Erg: ['Утро в эрге', 'Morning in the erg', 'time'],
  Noon_Approach: ['Жёсткий полдень', 'Harsh noon', 'time'],
  Storm_Horizon: ['Буря на горизонте', 'Storm on the horizon', 'weather'],
  Worm_Tension: ['Тишина перед червём', 'Worm tension', 'story'],
  Worm_Reveal: ['Явление червя', 'Worm reveal', 'story'],
  Crevice_Shade: ['Тень расщелины', 'Crevice shade', 'story'],
  Sietch_Interior: ['Сиетч (вечер)', 'Sietch interior', 'story'],
  Hall_Ritual: ['Зал ритуала', 'Ritual hall', 'story'],
};
/** Порядок в меню. */
const MENU_ORDER = ['Dawn_Ridge', 'Morning_Erg', 'Clear_Noon', 'Haze_Noon', 'Noon_Approach', 'Dusk_Gold', 'Twilight_Violet', 'Night_Clear', 'Storm_Horizon', 'Sandstorm_Full', 'Overcast_Dust', 'Calm_Still'];

const NUM_KEYS = ['sunLux', 'sky', 'fogDensity', 'fogFalloff', 'volFog', 'dust', 'wind', 'windYaw', 'storm', 'haze', 'exposure', 'clouds'];
const OV_KEYS = ['wind', 'storm', 'dust', 'haze', 'clouds', 'fog'];
const fin = (v, d) => (Number.isFinite(v) ? v : d);
const wrap24 = (h) => ((h % 24) + 24) % 24;

export function createWeather(game, sky, world) {
  const { bus } = game;
  const csv = game.data?.WeatherPresets || {};
  const table = {};
  for (const [id, p] of Object.entries(csv)) table[id] = { ...p };
  for (const [id, [RU, EN, kind, p]] of Object.entries(EXTRA)) table[id] = { id, ...p, RU, EN, kind };
  for (const [id, m] of Object.entries(CSV_META)) if (table[id]) { table[id].RU = m[0]; table[id].EN = m[1]; table[id].kind = m[2]; }
  for (const [id, p] of Object.entries(table)) { p.RU = p.RU || id; p.EN = p.EN || id; p.kind = p.kind || 'story'; }

  const st = {
    sunLux: 75000, sky: 1.2, fogDensity: 0.012, fogFalloff: 0.15, volFog: 0.6, dust: 0.1, wind: 3.5,
    windYaw: 55, storm: 0, haze: 0.1, exposure: 1, clouds: 0.08,
    sunColor: new THREE.Color(1, 0.86, 0.72), fogColor: new THREE.Color(0.55, 0.45, 0.42),
  };
  // «эффективные» значения: базовое состояние пресета + override + производные от бури
  const eff = { ...st, fog: 0, sunColor: new THREE.Color(), fogColor: new THREE.Color() };
  let from = null, to = null, t = 1, dur = 1;
  // часы
  const clock = { h: 6.667, goal: 6.667, dur: 3, day: 0, snap: true };
  // override: целевое значение и вес (0..1), вес плавно ведётся к 1 (задан) или 0 (снят)
  const ovVal = {}, ovW = {}, ovGoal = {}, ovRate = {};
  for (const k of OV_KEYS) { ovVal[k] = 0; ovW[k] = 0; ovGoal[k] = 0; ovRate[k] = 1; }

  const moons = MOON_DEF.map((d) => ({
    ...d, phaseManual: null, phase: d.phase0, lit: 0, elev: -90, dir: new THREE.Vector3(0, -1, 0), tan: new THREE.Vector3(1, 0, 0),
    sinPsi: 0, cosPsi: 1, color: new THREE.Color(),
  }));

  const sunDirTrue = new THREE.Vector3();
  const sunColor = new THREE.Color(1, 0.9, 0.8), fogC = new THREE.Color();

  let emitLock = 0;
  const weather = {
    current: 'Dawn_Ridge',
    hours: clock.h, day: 0, timeScale: 0,
    windDir: new THREE.Vector3(), windSpeed: 3.5, windBase: 3.5, gust: 0,
    storm: 0, dust: 0.1, haze: 0.1, clouds: 0.08, fog: 0, exposure: 1, sunElev: 13,
    isNight: false, phase: 'day', sandstorm: false,
    moons, rayColor: new THREE.Color(1, 0.8, 0.55),
    state: st, eff,
    alwaysUpdate: false,

    /** Список пресетов: [{id, RU, EN, kind: 'time'|'weather'|'story', hours}]. По умолчанию — только меню (без сюжетных). */
    presets(opts = {}) {
      const ids = opts.all ? Object.keys(table) : MENU_ORDER.filter((id) => table[id]);
      return ids.map((id) => ({ id, RU: table[id].RU, EN: table[id].EN, kind: table[id].kind, hours: table[id].hours >= 0 ? table[id].hours : null }));
    },
    /** Плавный переход к пресету за blendSec с. opts.keepTime — не менять время суток (по умолчанию пресет с часами ≥ 0 двигает время). */
    request(id, blendSec = 6, opts = {}) {
      const p = table[id];
      if (!p) { console.warn('[weather] нет пресета', id); return; }
      from = {}; for (const k of NUM_KEYS) from[k] = st[k];
      from.sunColor = st.sunColor.clone(); from.fogColor = st.fogColor.clone();
      to = {}; for (const k of NUM_KEYS) to[k] = fin(p[k], st[k]);
      const col = (c, d) => new THREE.Color(fin(c?.r ?? c?.[0], d.r), fin(c?.g ?? c?.[1], d.g), fin(c?.b ?? c?.[2], d.b));
      to.sunColor = col(p.sunColor, st.sunColor); to.fogColor = col(p.fogColor, st.fogColor);
      dur = Math.max(0.001, blendSec); t = 0;
      weather.current = id;
      emitLock++;
      if (p.hours >= 0 && !opts.keepTime) weather.setHours(p.hours, blendSec <= 0, blendSec);
      emitLock--;
      if (blendSec <= 0) step(dur, true);
      emit('preset');
    },
    /** Время суток 0..24. instant=true (по умолчанию) — сразу; false — плавно по кратчайшей дуге за durSec с (по умолчанию 3). */
    setHours(h, instant = true, durSec = 3) {
      h = fin(+h, clock.h);
      clock.goal = wrap24(h);
      if (instant) { clock.h = clock.goal; clock.snap = true; }
      else clock.dur = Math.max(0.2, durSec);
      weather.hours = clock.h;
      emit('hours');
    },
    getHours() { return clock.h; },
    /** Скорость хода суток: игровых СЕКУНД на реальную секунду (0 — стоп; 60 → сутки за 24 мин; 3600 → час в секунду). */
    setTimeScale(v) { weather.timeScale = Math.max(0, fin(+v, 0)); emit('timeScale'); },
    /** Частичные переопределения (0..1): {wind, storm, dust, haze, clouds, fog}. null/undefined-ключ → снять override ключа. */
    setOverride(o = {}, blendSec = 3) {
      for (const k of OV_KEYS) {
        if (!(k in o)) continue;
        if (o[k] === null || o[k] === undefined) { ovGoal[k] = 0; ovRate[k] = 1 / Math.max(0.001, blendSec); continue; }
        const v = clamp(fin(+o[k], 0), 0, k === 'wind' ? 40 : 1.5);
        if (ovW[k] < 0.001) ovVal[k] = v;                 // с нуля — сразу целевое значение, плавно растёт вес
        else ovVal[k] = v;
        ovGoal[k] = 1; ovRate[k] = 1 / Math.max(0.001, blendSec);
        if (blendSec <= 0) ovW[k] = 1;
      }
      emit('override');
    },
    /** Снять override: все или перечисленные ключи (массив). */
    clearOverride(keys, blendSec = 3) {
      for (const k of (keys || OV_KEYS)) { ovGoal[k] = 0; ovRate[k] = 1 / Math.max(0.001, blendSec); if (blendSec <= 0) ovW[k] = 0; }
      emit('override');
    },
    getOverride() { const o = {}; for (const k of OV_KEYS) if (ovGoal[k] > 0) o[k] = ovVal[k]; return o; },
    /** Зафиксировать фазы лун (0 новая … 0.5 полная … 1); null — вернуть автоматический ход. */
    setMoonPhase(a, b) {
      if (a !== undefined) moons[0].phaseManual = a === null ? null : wrap1(a);
      if (b !== undefined) moons[1].phaseManual = b === null ? null : wrap1(b);
      emit('moons');
    },
    /** Мгновенно применить всё (без сглаживания экспозиции/часов) — для скриншотов/телепортов. */
    snap() { clock.snap = true; step(0.0001, true); },
    /** Снимок состояния для UI. */
    snapshot() {
      return {
        id: weather.current, hours: clock.h, timeScale: weather.timeScale, phase: weather.phase, isNight: weather.isNight, sandstorm: weather.sandstorm,
        storm: eff.storm, dust: eff.dust, wind: weather.windSpeed, windBase: weather.windBase, clouds: eff.clouds, haze: eff.haze, fog: eff.fog,
        override: weather.getOverride(), sunElev: weather.sunElev,
        moons: moons.map((m) => ({ id: m.id, phase: m.phase, lit: m.lit, elev: m.elev })),
      };
    },
  };
  const wrap1 = (v) => ((v % 1) + 1) % 1;

  // --- события шины: 'weather' {type, id, hours, ...} ---
  let lastPhase = '', lastStorm = false;
  function emit(type) {
    if (emitLock) return;
    bus.emit('weather', { type, ...weather.snapshot() });
  }

  // «сырые» цвета пресетов в CSV — sRGB-значения (R,G,B 0..1); конвертируем в линейные при применении
  const srgbToLin = (c, out) => { out.r = Math.pow(c.r, 2.2); out.g = Math.pow(c.g, 2.2); out.b = Math.pow(c.b, 2.2); return out; };

  const zenithDust = new THREE.Color('#A58A5E'), zenithStorm = new THREE.Color('#8f6a38');
  const horStorm = new THREE.Color('#b8864a');
  const skyK = { z: new THREE.Color(), a: new THREE.Color(), s: new THREE.Color(), l: 1 };
  const tmpC = new THREE.Color(), tmpF = new THREE.Color(), tmpS = new THREE.Color(), tmpG = new THREE.Color(), tmpH = new THREE.Color();
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), keyDir = new THREE.Vector3(), moonCol = new THREE.Color(0.55, 0.7, 1.0);
  const starAxis = new THREE.Vector3(Math.cos(PHI) * Math.cos(240 * DEG), Math.sin(PHI), Math.cos(PHI) * Math.sin(240 * DEG)).normalize();
  const starM4 = new THREE.Matrix4();
  let exposureSnapNext = true;

  function advanceClock(dt) {
    if (weather.timeScale > 0) {
      const dh = (weather.timeScale / 3600) * dt;           // timeScale — игровых секунд за реальную; dh — игровых часов
      clock.goal = wrap24(clock.goal + dh);
      clock.h += dh;
    }
    if (clock.snap) { clock.h = clock.goal; clock.snap = false; }
    else {
      const d = ((clock.goal - clock.h + 36) % 24) - 12;
      if (Math.abs(d) > 1e-4) {
        clock.h += Math.abs(d) < 0.004 ? d : d * (1 - Math.exp(-dt * 3.2 / Math.max(0.2, clock.dur)));
      }
    }
    if (clock.h >= 24) { clock.h -= 24; clock.day++; }
    else if (clock.h < 0) { clock.h += 24; clock.day = Math.max(0, clock.day - 1); }
    weather.hours = clock.h; weather.day = clock.day;
  }

  function step(dt, force = false) {
    // --- часы ---
    advanceClock(dt);
    const hours = clock.h;
    // --- смесь пресетов ---
    if (to && t < 1) {
      t = Math.min(1, t + dt / dur);
      const k = t * t * (3 - 2 * t);
      for (const key of NUM_KEYS) st[key] = lerp(from[key], to[key], k);
      st.sunColor.lerpColors(from.sunColor, to.sunColor, k);
      st.fogColor.lerpColors(from.fogColor, to.fogColor, k);
    }
    // --- override ---
    for (const k of OV_KEYS) {
      const g = ovGoal[k];
      if (ovW[k] !== g) { const d = ovRate[k] * dt; ovW[k] = ovW[k] < g ? Math.min(g, ovW[k] + d) : Math.max(g, ovW[k] - d); }
    }
    const ov = (key, base, map = (v) => v) => (ovW[key] > 0 ? lerp(base, map(ovVal[key]), ovW[key] * ovW[key] * (3 - 2 * ovW[key])) : base);
    for (const k of NUM_KEYS) eff[k] = st[k];
    eff.sunColor.copy(st.sunColor); eff.fogColor.copy(st.fogColor);
    eff.storm = ov('storm', st.storm);
    eff.dust = ov('dust', st.dust);
    eff.haze = ov('haze', st.haze);
    eff.clouds = ov('clouds', st.clouds);
    eff.wind = ov('wind', st.wind);
    // туман: 0..1 → плотность в единицах CSV
    const fogFromCsv = clamp(Math.pow(Math.max(st.fogDensity - 0.002, 0) / 0.9, 1 / 1.8), 0, 1);
    eff.fog = ov('fog', fogFromCsv);
    eff.fogDensity = ovW.fog > 0 ? lerp(st.fogDensity, 0.002 + 0.9 * Math.pow(Math.min(ovVal.fog, 1.2), 1.8), ovW.fog * ovW.fog * (3 - 2 * ovW.fog)) : st.fogDensity;
    // производные от бури
    const S = clamp(eff.storm, 0, 1.2);
    const sFull = smoothstep(0.5, 1.0, S);                    // «настоящая» буря сверх CSV-Storm_Horizon
    eff.dust = Math.max(eff.dust, Math.pow(Math.min(S, 1), 0.8) * 0.92);
    if (ovW.wind < 0.5) eff.wind = Math.max(eff.wind, 3 + 13 * Math.pow(Math.min(S, 1), 1.2));
    eff.clouds = Math.max(eff.clouds, 0.18 + 0.75 * Math.min(S, 1));
    eff.sunLux *= 1 - 0.78 * sFull;
    eff.sky *= 1 - 0.3 * sFull;
    eff.haze *= 1 - 0.8 * smoothstep(0.2, 0.8, S);
    eff.fogDensity += 0.55 * Math.pow(sFull, 1.4) + 0.05 * S;
    eff.sunColor.lerp(tmpH.setRGB(1, 0.66, 0.34), sFull * 0.8);
    eff.fogColor.lerp(tmpH.setRGB(0.82, 0.55, 0.28), clamp(sFull * 0.9 + (eff.dust - st.dust) * 0.4, 0, 0.92));
    // дымка из пыли без бури
    eff.fogDensity += 0.004 * Math.max(0, eff.dust - st.dust);

    const time = game.time;
    // ветер с порывами
    const g1 = Math.sin(time * 0.37) * 0.5 + Math.sin(time * 0.91 + 1.7) * 0.3 + Math.sin(time * 0.17 + 4) * 0.4;
    weather.gust = 0.5 + 0.5 * g1 / 1.2;
    const gustAmp = 0.18 + 0.5 * S;
    weather.windBase = eff.wind;
    weather.windSpeed = eff.wind * (1 + gustAmp * (weather.gust * 2 - 1)) + S * 2 * weather.gust;
    const yaw = (eff.windYaw + 6 * Math.sin(time * 0.05)) * DEG;
    weather.windDir.set(Math.cos(yaw), 0, Math.sin(yaw));
    weather.storm = eff.storm; weather.dust = eff.dust; weather.clouds = eff.clouds; weather.fog = eff.fog;

    // --- солнце ---
    const el = elevationFor(hours, 12);
    const az = azimuthAt(hours);
    weather.sunElev = el;
    dirFromElAz(el, az, sunDirTrue);
    const sinE = Math.max(Math.sin(el * DEG), 0);
    const am = 1 / (sinE + 0.035);
    const dustK = 1 + 2.2 * eff.dust + 1.4 * S;
    const tr = (tau) => Math.exp(-tau * Math.min(am, 40) * dustK * 0.62);
    const sc = srgbToLin(eff.sunColor, tmpS);
    const sunI = eff.sunLux / 30000;
    const dayK = smoothstep(-1.5, 3, el);
    sunColor.setRGB(sc.r * tr(0.045) * sunI * dayK, sc.g * tr(0.08) * sunI * dayK, sc.b * tr(0.16) * sunI * dayK);
    ENV.uniforms.uSunDir.value.copy(sunDirTrue);
    ENV.uniforms.uSunColor.value.copy(sunColor);
    const sunLum = Math.max(sunColor.r, sunColor.g, sunColor.b, 1e-5);
    weather.rayColor.setRGB(sunColor.r / sunLum, sunColor.g / sunLum, sunColor.b / sunLum).multiplyScalar(0.25 + 0.12 * Math.min(sunLum, 3));

    // --- луны ---
    const totalDays = clock.day + hours / 24;
    let moonKey = 0, bestMoon = null, bestLum = 0, moonAmb = 0;
    for (const m of moons) {
      m.phase = m.phaseManual ?? wrap1(m.phase0 + totalDays / m.synodic);
      const hm = hours + 24 * m.phase;
      m.elev = elevationFor(hm, m.dec);
      dirFromElAz(m.elev, azimuthAt(hm) + (12 - m.dec) * 1.3, m.dir);
      // фаза по реальному углу к солнцу
      const cosPsi = clamp(m.dir.dot(sunDirTrue), -1, 1);
      m.cosPsi = cosPsi; m.sinPsi = Math.sqrt(Math.max(1 - cosPsi * cosPsi, 0));
      m.lit = 0.5 * (1 - cosPsi);
      tmpV.copy(sunDirTrue).addScaledVector(m.dir, -cosPsi);
      if (tmpV.lengthSq() < 1e-6) tmpV.set(0, 1, 0).addScaledVector(m.dir, -m.dir.y);
      m.tan.copy(tmpV).normalize();
      const up = smoothstep(-2, 9, m.elev);
      const lum = m.lit * up * m.bright * Math.pow(1 - smoothstep(-6, 8, el) , 1) ;
      m.light = lum;
      moonKey += m.lit * up * m.bright * (m === moons[0] ? 0.4 : 0.14);
      moonAmb += m.lit * up * m.bright * (m === moons[0] ? 1 : 0.35);
      const wl = m.lit * up * m.bright * (m === moons[0] ? 1 : 0.38);
      if (wl > bestLum) { bestLum = wl; bestMoon = m; }
    }
    // дневной свет гасит лунный ключ (глаз/экспозиция не различают), к закату луна ещё не светит
    const nightK = 1 - smoothstep(-8, 1, el);              // 0 днём … 1 ночью (по солнцу)
    moonKey *= nightK;
    weather.moonLight = moonKey;
    const night = 1 - smoothstep(-17, -4, el);              // звёзды/ночное небо
    weather.isNight = el < -6;
    ENV.uniforms.uNight.value = night;
    weather.phase = el < -10 ? 'night' : el < -0.8 ? (hourAngle(hours) < 0 ? 'dawn' : 'dusk') : el < 12 ? (hourAngle(hours) < 0 ? 'dawn' : 'dusk') : 'day';

    // --- ключевой свет: солнце днём, луна ночью ---
    const mc = tmpC.setRGB(moonCol.r, moonCol.g, moonCol.b);
    if (bestMoon) mc.setRGB(bestMoon.tint[0] * 0.3 + 0.02, bestMoon.tint[1] * 0.5 + 0.04, bestMoon.tint[2] * 1.0);
    const wMoon = moonKey / (moonKey + sunLum + 1e-6);
    keyDir.copy(sunDirTrue).multiplyScalar(1 - wMoon);
    if (bestMoon) keyDir.addScaledVector(bestMoon.dir, wMoon);
    if (keyDir.lengthSq() < 1e-4) keyDir.copy(sunDirTrue);
    keyDir.normalize();
    const keyCol = tmpV2.set(sunColor.r * (1 - wMoon) + mc.r * moonKey * 1.0, sunColor.g * (1 - wMoon) + mc.g * moonKey, sunColor.b * (1 - wMoon) + mc.b * moonKey);
    // нормируем цвет моно-светом: интенсивность = сумма, цвет — смесь
    const kMax = Math.max(keyCol.x, keyCol.y, keyCol.z, 1e-5);
    ENV.uniforms.uKeyDir.value.copy(keyDir);
    ENV.uniforms.uKeyColor.value.setRGB(keyCol.x, keyCol.y, keyCol.z);
    world.sunDir.copy(keyDir);
    if (!world.sunColor) world.sunColor = new THREE.Color();
    world.sunColor.setRGB(keyCol.x / kMax, keyCol.y / kMax, keyCol.z / kMax).multiplyScalar(clamp(kMax / 3.2, 0.05, 1));   // для модуля червя: цвет ключевого света
    if (world.sunDir.y < 0.02) { world.sunDir.y = 0.02; world.sunDir.normalize(); }

    // --- небо ---
    skyAt(el, skyK);
    const kd = smoothstep(-2, 42, el);
    const dustMix = clamp(eff.dust * 0.55, 0, 0.6) * smoothstep(-10, 6, el);
    tmpC.copy(skyK.z);
    tmpC.lerp(zenithDust, dustMix);
    tmpC.lerp(zenithStorm, clamp(S * 0.85, 0, 0.85) * smoothstep(-10, 6, el));
    const level = skyK.l * (0.85 + 0.15 * eff.sky);
    ENV.uniforms.uZenith.value.copy(tmpC).multiplyScalar(level);
    // горизонт: от солнца / к солнцу; пыль и буря мутят цвет к охре
    const hAway = ENV.uniforms.uHorizon.value.copy(skyK.a);
    const hSun = sky.skyU.uHorizonSun.value.copy(skyK.s);
    const dM = clamp(eff.dust * 0.6 + S * 0.6, 0, 0.85) * smoothstep(-10, 6, el);
    srgbToLin(eff.fogColor, tmpF);
    // цвет тумана = FogInscatterColor пресета (sRGB) × яркость неба, к сумеркам/ночи — цвет горизонта неба
    const fogLevel = (0.35 + 0.65 * kd) * 1.9 * (0.55 + 0.45 * clamp(sinE * 2.4, 0, 1));
    fogC.setRGB(tmpF.r * fogLevel, tmpF.g * fogLevel, tmpF.b * fogLevel);
    const twil = 1 - smoothstep(-1.5, 9, el);               // 1 в сумерках и ночью → туман берёт цвет горизонта неба
    tmpG.copy(hAway).lerp(hSun, 0.3).multiplyScalar(level * 1.1);
    ENV.uniforms.uFogColor.value.copy(fogC).lerp(tmpG, twil * (1 - 0.6 * smoothstep(0.4, 1, S)));
    hAway.multiplyScalar(level * 1.1).lerp(ENV.uniforms.uFogColor.value, dM);
    hSun.multiplyScalar(level * 1.35).lerp(ENV.uniforms.uFogColor.value, dM * 0.8);
    // плотность тумана: CSV (единицы UE) → экстинкция, 1/м
    ENV.uniforms.uFogDensity.value = eff.fogDensity * 0.026;
    ENV.uniforms.uFogFalloff.value = Math.max(0.0008, st.fogFalloff * 0.06);
    ENV.uniforms.uMist.value = (0.0045 * smoothstep(0.02, 0.15, st.fogFalloff) * (1 - kd * 0.7)) * (st.fogFalloff > 0.12 ? 1 : 0.35) + 0.0006
      + 0.0016 * Math.max(0, eff.dust - 0.1) + 0.0012 * twil;
    ENV.uniforms.uFogSun.value = 1.0 + 1.5 * st.volFog * eff.dust;
    ENV.uniforms.uWind.value.set(weather.windDir.x, weather.windDir.z);
    ENV.uniforms.uWindSpeed.value = weather.windSpeed;
    ENV.uniforms.uStorm.value = S;
    ENV.uniforms.uDust.value = eff.dust;
    const su = sky.skyU;
    su.uClouds.value = eff.clouds;
    su.uSkyNight.value = night * (1 - 0.85 * clamp(S * 1.2, 0, 1)) * (1 - 0.5 * clamp(eff.dust, 0, 1)) * (1 - 0.6 * clamp(eff.clouds - 0.5, 0, 1));
    su.uStarMat.value.setFromMatrix4(starM4.makeRotationAxis(starAxis, (hours / 24 + clock.day) * Math.PI * 2 * 1.0027));
    // свет облаков: солнце (с рассеянием) или луна
    su.uCloudKey.value.setRGB(keyCol.x, keyCol.y, keyCol.z);
    moons.forEach((m, i) => {
      su.uMoonDir.value[i].copy(m.dir);
      su.uMoonTan.value[i].copy(m.tan);
      su.uMoonP.value[i].set(Math.sin(m.radius * DEG), m.sinPsi, m.cosPsi, m.bright);
      su.uMoonCol.value[i].setRGB(m.tint[0], m.tint[1], m.tint[2]);
    });

    // --- свет сцены ---
    sky.sun.color.setRGB(keyCol.x / kMax, keyCol.y / kMax, keyCol.z / kMax);
    sky.sun.intensity = kMax;
    sky.sun.visible = world.visible !== false && kMax > 0.003 && keyDir.y > 0.01;
    // полусфера: цвет неба сверху, отражённый песок снизу; ночью — холодный лунный/звёздный рассеянный свет
    const zen = ENV.uniforms.uZenith.value, hor = ENV.uniforms.uHorizon.value;
    const skyE = (0.18 + 0.82 * kd) * eff.sky * 0.55 * (1 + eff.dust * 0.5);
    const dayHemi = tmpH.setRGB(lerp(zen.r, hor.r, 0.45), lerp(zen.g, hor.g, 0.45), lerp(zen.b, hor.b, 0.45));
    const cm = Math.max(dayHemi.r, dayHemi.g, dayHemi.b, 1e-4);
    const dayI = skyE * cm * 2.4;
    // ночной ambient: звёзды + лунное небо (синий), не ноль даже в новолуние
    const nightI = night * (0.15 + 0.09 * clamp(moonAmb, 0, 1.4) ) * (1 - 0.5 * S);
    const nr = 0.26, ng = 0.40, nb = 1.0;
    const totI = dayI + nightI;
    sky.hemi.color.setRGB((dayHemi.r / cm * dayI + nr * nightI) / Math.max(totI, 1e-5), (dayHemi.g / cm * dayI + ng * nightI) / Math.max(totI, 1e-5), (dayHemi.b / cm * dayI + nb * nightI) / Math.max(totI, 1e-5));
    sky.hemi.intensity = totI;
    sky.hemi.groundColor.setRGB(0.62, 0.42, 0.24).multiplyScalar(0.18 + 1.3 * sinE * Math.min(1, sunI / 3));
    sky.hemi.groundColor.r += 0.07 * nightI * 6; sky.hemi.groundColor.g += 0.085 * nightI * 6; sky.hemi.groundColor.b += 0.13 * nightI * 6;
    ENV.uniforms.uAmbient.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity);

    // --- экспозиция (имитация адаптации глаза + ExposureBias) ---
    const Ecur = sunI * Math.max(sinE, 0.1) * dayK + sky.hemi.intensity + moonKey * 1.2;
    const Eref = 4 * 0.97 + 0.8;
    const base = 0.74 * Math.pow(Eref / Math.max(Ecur, 0.5), 0.4);
    let target = base * Math.pow(2, (eff.exposure - 1) * 0.42);
    if (!Number.isFinite(target)) target = 1;
    target = clamp(target, 0.25, 4.5);
    if (force || exposureSnapNext || !Number.isFinite(weather.exposure)) { weather.exposure = target; exposureSnapNext = false; }
    else weather.exposure = damp(weather.exposure, target, 1.6, dt);
    const expo = weather.exposure * (world.exposureTrim ?? 1);
    if (world.visible !== false) game.renderer.toneMappingExposure = expo;
    else game.renderer.toneMappingExposure = 0.95 * Math.pow(2, (eff.exposure - 0.3) * 0.7); // интерьер: янтарные светошары
    ENV.uniforms.uInvExp.value = 1 / Math.max(expo, 0.05);
    // scene.fog для объектов других модулей (червь, фигуры): совпадает с приземным туманом
    if (game.scene.fog) {
      game.scene.fog.color.copy(ENV.uniforms.uFogColor.value);
      game.scene.fog.density = Math.sqrt(ENV.uniforms.uFogDensity.value * 700) / 700;
    }
    weather.haze = eff.haze * (0.2 + 0.8 * smoothstep(6, 46, el));   // марево — от жары: сильнее при высоком солнце

    // --- события ---
    const phaseNow = weather.phase;
    const sandNow = S > 0.7;
    if (phaseNow !== lastPhase) { const first = lastPhase === ''; lastPhase = phaseNow; if (!first) emit('phase'); }
    if (sandNow !== lastStorm) { lastStorm = sandNow; weather.sandstorm = sandNow; emit(sandNow ? 'sandstorm:start' : 'sandstorm:end'); }
  }

  weather.update = (dt) => { step(dt); if (game.paused && world.visible !== false) { ENV.uniforms.uTime.value = game.realTime; sky.update(game.camera.position); } };
  weather.alwaysUpdate = true; // часы/смена погоды идут и в меню на паузе (dt = реальный)
  // стартовый пресет
  emitLock++;
  weather.request('Dawn_Ridge', 0);
  emitLock--;
  return weather;
}
