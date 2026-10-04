// Процедурный человек для всех NPC и игрока: скин-тело + дистикомб + ткань с вторичной анимацией.
//
// makeFigure(opts) → { group, height, parts, animate(speed, dt, irregular, ctx), setTalking(b), lookAt(worldPos, w), gait, onStep, setWind, stats }
//   • Ось «вперёд» фигуры — +Z локальной группы. Пивот — у ступней.
//   • animate(speed м/с, dt, irregular 0..1, ctx?) — ходьба/бег/покой; irregular>0.45 → «походка по песку».
//     ctx (необязателен): { vel: Vector3 мировая скорость (иначе берётся из смещения группы), wind: {dir:Vector3, speed},
//       slope: рад (>0 — вверх по склону вдоль курса), sliding: 0..1 (скольжение по склону), desert: true (принудительно песок), allowPause: true }.
//     Ткань (плащ, подол, капюшон, шарф) реагирует на скорость/ускорение/поворот; ветер — глобальный (setFigureWind) или ctx.wind.
//   • figure.onStep = ({foot:'L'|'R', side:0|1, intensity, mode:'walk'|'run'|'desert', speed}) — событие касания стопой земли (для звука/следов).
//   • figure.gait: { env (множитель скорости для «рваного» ритма песка), desertness 0..1, stutter(), reset() }.
//   • Лицо (LOD0): скульптурная голова (char_face.js), глаза с веками/радужкой; figure.blink(), figure.setMouth(0..1|null), setTalking(b).
//     Автоматически: моргание, саккады (следуют за lookAt), слоговая анимация рта при setTalking.
//   • Рука: figure.reachTo(worldPoint|null, 'L'|'R', weight, {sweep, palm, speed}) — IK плечо–локоть–кисть поверх анимации; figure.handWorld(side, out?) → Vector3.
//   • Опции лица/кожи: age 0..1, gender 0..1, stubble, freckles, hair('short'|'crop'|'bun'|'long'|'none'), beard, beardLen, hairColor; всё детерминировано по seed.
//   • parts: root, pelvis, spine, chest, neck, headPivot, limbs.L/R.{sh,el,hand,hip,kn,foot,toe} — Object3D-кости (скин-скелет).
//   • Один скин-меш тела (+1 меш ткани), геометрия общая для фигур с одним «вариантом», 3 LOD (по расстоянию до setFigureView).
// Глобально: setFigureWind(dir, speed) — ветер для всех (вызывает модуль игрока), setFigureView(camPos) — для LOD.
import * as THREE from 'three';
import { rng } from './util.js';
import { BONE_NAMES, REST, REG, BUILDS, robeProfile, geometryFor, geometryStage, hasGeometry, triCount } from '../player/char_geometry.js';
import { faceParams, faceKey, faceUniformsSpec } from '../player/char_face.js';
import { makeUniforms, makeBodyMaterial, makeClothMaterial } from '../player/char_material.js';
import { createAnimator } from '../player/char_anim.js';
import { createArmIK } from '../player/char_ik.js';

// ------------------------------------------------------------------------------------------ глобальное состояние ----
const WIND = { x: 0, z: 0, speed: 0 };
const VIEW = new THREE.Vector3(1e6, 0, 1e6);
let VIEW_SET = false;
let LOD_SCALE = 1;
// Половина вертикального угла камеры (tan): берётся из камеры, которая реально рисует фигуру, — LOD зависит от экранного размера, а не только от метров.
let TAN_HALF = 0.62;
const REF_SCREEN = 1.75 / (6 * 2 * 0.5774); // экранная доля роста 1.75 м на 6 м при fov 60° — бывшая граница LOD0
// Пороги экранной доли роста (с гистерезисом ±12%): LOD0 выше A, LOD1 выше B, иначе LOD2.
const SCR_A = REF_SCREEN * 0.9, SCR_B = REF_SCREEN * 0.27;
const FADE_TIME = 0.4;
let CLOCK = 0;
let _tick = 0;
function FRAME_TICK() { const n = performance.now(); if (n - _tick > 4) { FRAME++; _tick = n; } }
export function setFigureWind(dir, speed = 0) { if (!dir) { WIND.x = WIND.z = WIND.speed = 0; return; } WIND.x = dir.x; WIND.z = dir.z; WIND.speed = speed; }
export function setFigureView(camPos) { VIEW.copy(camPos); VIEW_SET = true; }
/** Масштаб дистанций LOD (качество графики: low 0.6, med 1, high 1.4). */
export function setFigureQuality(q) { LOD_SCALE = q === 'low' ? 0.6 : q === 'high' ? 1.4 : 1; }
export const FIGURE_STATS = { figures: 0, lod: [0, 0, 0] };
// Фоновая очередь сборки геометрии LOD: один этап (тело или ткань) за кадр и не чаще бюджета — без подвисаний при приближении NPC.
const BUILDQ = [], QSET = new Set();
let QFRAME = -1, FRAME = 0;
function enqueueBuild(o, lod, key) { const k = key + '|' + lod; if (QSET.has(k)) return; QSET.add(k); BUILDQ.push({ o, lod, key, k }); }
/** Выполнить этапы очереди в пределах бюджета (мс). Вызывается автоматически из animate (раз в кадр); можно вызвать при загрузке с большим бюджетом. */
export function pumpFigureBuilds(budgetMs = 4) {
  const t0 = performance.now();
  while (BUILDQ.length && performance.now() - t0 < budgetMs) {
    const j = BUILDQ[0];
    if (geometryStage(j.o, j.lod, j.key)) { BUILDQ.shift(); QSET.delete(j.k); }
  }
}
export function figureBuildBacklog() { return BUILDQ.length; }
/** Поставить в фоновую очередь сборку геометрии варианта (для групповых LOD: figure_crowd.js). */
export function enqueueFigureBuild(o, lod, key) { if (!hasGeometry(key, lod)) enqueueBuild(o, lod, key); }

// ------------------------------------------------------------------------------------------ палитры архетипов толпы ----
export const PALETTES = {
  Trader: { cloth: '#7a5a3a', accent: '#a0522d', suit: '#4b4035' },
  Artisan: { cloth: '#6b5844', accent: '#8b6b3a', suit: '#463b31', pack: true },
  WaterCarrier: { cloth: '#5d6a73', accent: '#2c5f8a', suit: '#3f3e3a' },
  Child: { cloth: '#9a7b55', accent: '#b5462c', suit: '#5a4a3a', height: 1.2, mask: false },
  Guard: { cloth: '#3a332c', accent: '#6e2b20', suit: '#2e2a26', bulk: 1.15 },
  Pilgrim: { cloth: '#b9a07a', accent: '#6b5a3a', suit: '#5a4d3e' },
  Elder: { cloth: '#4e4438', accent: '#2c3e57', suit: '#3b342d', height: 1.66, age: 0.92 },
  Weaver: { cloth: '#7d4f3a', accent: '#2c3e57', suit: '#4a3d33' },
};

/**
 * Внешность жителей сиетча по архетипу: возраст, телосложение, поклажа, кушаки, головные повязки, кольца воды, бороды.
 * Детерминирована генератором R() (передаёт crowd.js) — один архетип даёт разные силуэты.
 * Фракции: возрожденцы-«фримены» (Pilgrim/Artisan/Weaver/Guard), жрецы Разделённого Бога (Elder с повязкой), торговцы (Trader), дети (Child).
 */
export function crowdLook(arch, R) {
  const pick = (a) => a[Math.floor(R() * a.length)];
  const o = {};
  switch (arch) {
    case 'Trader': // пёстрые многослойные одеяния, сумки, украшения: торговцы живут обменом
      o.age = 0.3 + R() * 0.45; o.sash = R() < 0.75; o.wrap = R() < 0.35; o.carry = R() < 0.6 ? pick(['satchel', 'satchel', 'bundle', 'skin']) : undefined; o.waterRings = R() < 0.55 ? 3 + Math.floor(R() * 4) : 0; o.wear = 0.15 + R() * 0.3; o.hemTrim = true; o.frontTrim = R() < 0.5; o.scarf = R() < 0.2; break;
    case 'Artisan':
      o.age = 0.3 + R() * 0.5; o.sash = R() < 0.5; o.carry = R() < 0.55 ? pick(['basket', 'bundle', 'satchel']) : undefined; o.wrap = R() < 0.3; o.wrapStyle = 'band'; o.waterRings = R() < 0.3 ? 3 : 0; o.wear = 0.4 + R() * 0.4; break;
    case 'WaterCarrier': // кувшины и бурдюки, кольца воды на шнуре
      o.age = 0.25 + R() * 0.5; o.carry = R() < 0.85 ? pick(['jug', 'jug', 'skin']) : 'skin'; o.wrap = R() < 0.5; o.sash = R() < 0.4; o.waterRings = R() < 0.7 ? 4 + Math.floor(R() * 4) : 0; o.wear = 0.3 + R() * 0.4; break;
    case 'Child':
      o.sash = R() < 0.5; o.wrap = R() < 0.25; o.wrapStyle = 'band'; o.carry = R() < 0.15 ? 'skin' : undefined; o.wear = 0.3 + R() * 0.4; break;
    case 'Guard': // возрожденцы-воины: сумки, кольца, крис
      o.age = 0.25 + R() * 0.4; if (R() < 0.6) o.build = 'a'; o.waterRings = R() < 0.5 ? 4 : 0; o.carry = R() < 0.25 ? 'satchel' : undefined; o.wrap = R() < 0.25; o.wrapStyle = 'band'; break;
    case 'Pilgrim': // странники: скатки, корзины, выцветшие тюрбаны
      o.age = 0.25 + R() * 0.6; o.carry = R() < 0.6 ? pick(['bundle', 'bundle', 'basket', 'skin']) : undefined; o.wrap = R() < 0.6; o.sash = R() < 0.35; o.waterRings = R() < 0.35 ? 3 : 0; o.wear = 0.5 + R() * 0.4; o.dust = 0.7; break;
    case 'Elder': // старики и жрецы Разделённого Бога: длинные одежды, тюрбаны, кольца, седая борода
      o.age = 0.8 + R() * 0.15; if (R() < 0.4) o.build = 'e'; o.style = { elder: 1, stride: 0.8, sway: 0.8, tempo: 0.85, armSwing: 0.6 }; o.wrap = R() < 0.55; o.wrapAccent = R() < 0.5; o.sash = R() < 0.6; o.waterRings = R() < 0.6 ? 4 + Math.floor(R() * 5) : 0; o.carry = R() < 0.15 ? 'satchel' : undefined; o.wear = 0.5 + R() * 0.4; break;
    case 'Weaver':
      o.age = 0.25 + R() * 0.55; o.sash = R() < 0.6; o.wrap = R() < 0.5; o.wrapAccent = R() < 0.4; o.carry = R() < 0.15 ? 'satchel' : undefined; o.waterRings = R() < 0.3 ? 3 : 0; o.wear = 0.2 + R() * 0.4; break;
  }
  return o;
}

// ------------------------------------------------------------------------------------------ пресеты персонажей ----
// Стили походки: см. char_anim DEFAULT_STYLE.
export const PRESETS = {
  Kair: {
    name: 'Kair', age: 0.35, height: 1.76, build: 'm', skin: '#7a563a', suit: '#4a4038', cloth: '#8a6a44', cloth2: '#c9a46a', accent: '#2c3e57', leather: '#5a3e28',
    robe: true, robeStyle: 'tunic', layers: [{ style: 'cape', asym: 1, tear: 1, fold: 0.045, hemTrim: false }], hood: true, mask: true, pouches: 3, kris: false, staff: true,
    hair: 'short', hairColor: '#201812', wear: 0.55, dust: 0.65, cuffTrim: false, style: { stride: 1, armSwing: 1, tempo: 1 }, seed: 11,
  },
  Ilva: {
    name: 'Ilva', age: 0.4, height: 1.68, build: 'f', skin: '#b08a68', suit: '#3e3630', cloth: '#7e7466', cloth2: '#b8ae9c', accent: '#6b5a7a', lining: '#d8c8a8', leather: '#5a4a3a',
    robe: true, robeStyle: 'jubba', robeTint: 2, layers: [{ style: 'shawl', hemTrim: true, fold: 0.06, folds: 7, lining: true }], hood: true, mask: 'down', pouches: 1, hemTrim: false, hair: 'bun', hairColor: '#2a1c14', wear: 0.2, dust: 0.45,
    style: { composed: 1, sway: 0.55, bounce: 0.8, armSwing: 0.55, stride: 0.95, shoulders: 0.0 }, seed: 23, staff: 'sling',
  },
  Rayn: {
    name: 'Rayn', age: 0.62, height: 1.6, build: 'm', bulk: 1.1, skin: '#a9805e', suit: '#3e3630', cloth: '#5a4a3a', cloth2: '#7a2e24', accent: '#c9a46a', leather: '#4a3524',
    robe: true, robeStyle: 'kaftan', layers: [{ style: 'cape', fold: 0.05, tear: 0.3 }], hood: true, mask: true, pouches: 5, frontTrim: true, hemTrim: true, pack: 'box', sash: true, waterRings: 5, hair: 'short', hairColor: '#4a3a2a', wear: 0.25, dust: 0.7,
    style: { nervous: 1, stride: 0.82, tempo: 1.15, hunch: 0.05, shoulders: 1, armSwing: 0.7 }, seed: 31,
  },
  Ossana: {
    name: 'Ossana', age: 0.45, gender: 0.1, height: 1.72, build: 'a', skin: '#5a3e28', suit: '#3b302a', cloth: '#4a3b2c', cloth2: '#6b4f36', accent: '#2c3e57', leather: '#4a3222',
    robe: true, robeStyle: 'tunic', layers: [{ style: 'cape', fold: 0.04, tear: 0.5, scale: 0.97 }], hood: true, mask: 'down', pouches: 3, kris: true, armPads: true, harness: true, hooks: 2, hair: 'short', hairColor: '#1a1410',
    eyesIbad: true, wear: 0.7, dust: 0.6, style: { stride: 1.08, armSwing: 1.1, stance: 1, sway: 1.1 }, seed: 41, scarf: false, waterRings: 7, wrap: true, wrapStyle: 'band',
  },
  Rider: {
    name: 'Rider', age: 0.3, height: 1.78, build: 'm', skin: '#6e4c34', suit: '#14120f', cloth: '#1d1a17', cloth2: '#2a2118', accent: '#5c2a1f', leather: '#3a2a1c',
    robe: true, robeStyle: 'tunic', layers: [{ style: 'cape', fold: 0.04, tear: 0.8 }], hood: true, mask: true, pouches: 2, armPads: true, kris: true, hooks: 1, eyesIbad: true, wear: 0.6, scarf: true, waterRings: 6, style: { stride: 1.05 }, seed: 51,
  },
  Rider2: {
    name: 'Rider2', age: 0.28, height: 1.66, build: 'f', skin: '#7a563a', suit: '#3b302a', cloth: '#5e4b3c', cloth2: '#9c7c52', accent: '#2c3e57', leather: '#4a3222',
    robe: true, robeStyle: 'tunic', layers: [{ style: 'cape', fold: 0.04, scale: 0.9 }], hood: true, mask: 'down', pouches: 2, armPads: true, hooks: 2, eyesIbad: true, wear: 0.5, scarf: true, hair: 'short', hairColor: '#241a14', waterRings: 5, style: { stride: 1.0, tempo: 1.05 }, seed: 52,
  },
  Harmat: {
    name: 'Harmat', age: 0.92, height: 1.72, build: 'e', bulk: 1.12, skin: '#7a563a', suit: '#2a221b', cloth: '#2b2420', cloth2: '#6b4f36', accent: '#2c62b8', leather: '#3a2a1a',
    robe: true, robeStyle: 'jubba', layers: [{ style: 'heavy', hemTrim: true, folds: 6, fold: 0.05 }], hood: false, mask: false, pouches: 2, kris: true, hair: 'short', hairColor: '#c9c6bd', beard: true, eyesIbad: true,
    wear: 0.8, dust: 0.5, staff: 'hook', sash: true, waterRings: 8, wrap: true, wrapAccent: true, style: { elder: 1, stride: 0.8, sway: 0.8, tempo: 0.85, armSwing: 0.6 }, seed: 61,
  },
  Priestess: {
    name: 'Priestess', age: 0.3, height: 1.86, build: 'f', skin: '#c2a083', suit: '#e0d6c2', cloth: '#e0d6c2', cloth2: '#e0d6c2', accent: '#3f5e7a', lining: '#f0e8d6', leather: '#8a6a3a', bare: true, barefoot: true, gloves: false,
    robe: true, robeStyle: 'jubba', layers: [{ style: 'shawl', scale: 0.9, hemTrim: true, folds: 8, fold: 0.07 }], hood: false, mask: false, sleeve: 'short', pouches: 0, hair: 'bun', hairColor: '#1a1410', cowl: false, noTubes: true,
    eyesIbad: true, wear: 0.05, dust: 0.1, style: { composed: 1, sway: 0.5, stride: 0.9, armSwing: 0.4 }, seed: 71,
  },
  // Дистикомб без одежды сверху (для проверки/референса и сцен без плаща)
  Stillsuit: { name: 'Stillsuit', height: 1.76, build: 'm', skin: '#7a563a', suit: '#4a4038', accent: '#2c3e57', leather: '#4a3524', robe: false, layers: [], hood: false, mask: true, pouches: 3, kris: true, hair: 'short', seed: 90, wear: 0.5 },
  Guard: { name: 'Guard', height: 1.82, build: 'm', bulk: 1.12, skin: '#6e4c34', suit: '#2e2a26', cloth: '#3a332c', cloth2: '#4a3d33', accent: '#6e2b20', robe: false, layers: [{ style: 'cape', fold: 0.04 }], hood: true, mask: true, armPads: true, kris: true, pouches: 4, eyesIbad: false, wear: 0.5, seed: 81 },
};

const DEFAULTS = { height: 1.75, build: 'm', cloth: '#8a6a48', suit: '#4a4038', accent: '#2c3e57', skin: '#9c7458', hood: true, mask: true, robe: true, bulk: 1 };
const SKINS = ['#7a563a', '#6a4a32', '#9c7458', '#8a6244', '#5a3e28', '#a98264'];
const HAIRS = ['#201812', '#2a1c14', '#3a2a1c', '#4a3a2a', '#b9b5ac'];
const clean = (o) => { const r = {}; for (const k in o) if (o[k] !== undefined) r[k] = o[k]; return r; };
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Разрешить опции: пресет → явные опции → выведенные «вариации» (по сиду). */
// Старые вызовы без preset (модуль червя: name 'Rider1'/'Ossana'/'Rider3') получают одноимённый пресет; явные цвета/размеры из опций главнее.
const NAME_PRESET = { Kair: 'Kair', Ilva: 'Ilva', Rayn: 'Rayn', Ossana: 'Ossana', Rider1: 'Rider', Rider3: 'Rider', Rider2: 'Rider2', Harmat: 'Harmat', Priestess: 'Priestess' };
function resolveOptions(opts) {
  const byName = !opts.preset && NAME_PRESET[opts.name];
  const presetKey = opts.preset || byName;
  const pre = presetKey ? (PRESETS[presetKey] || {}) : {};
  const o = { ...DEFAULTS, ...pre, ...clean(opts) };
  if (byName && opts.hooks === undefined) o.hooks = 0; // у наездников на черве свои шесты
  const seed = opts.seed ?? (opts.name && !presetKey ? hashStr(opts.name) : pre.seed ?? Math.floor(Math.random() * 1e9));
  const R = rng(seed + 7);
  o.seed = seed;
  const explicit = (k) => opts[k] !== undefined || pre[k] !== undefined;
  const child = o.height < 1.4;
  if (!explicit('build')) o.build = child ? 'c' : (R() < 0.42 ? 'f' : 'm');
  if (!presetKey) {
    if (o.robe !== false && !explicit('robeStyle')) { const r = R(); o.robeStyle = child ? 'kaftan' : r < 0.5 ? 'jubba' : r < 0.78 ? 'kaftan' : 'tunic'; if (o.robeStyle === 'tunic' && !o.layers) o.layers = [{ style: 'cape', fold: 0.045, tear: R() }]; }
    if (!explicit('hemTrim')) o.hemTrim = R() < 0.5;
    if (!explicit('frontTrim')) o.frontTrim = R() < 0.3;
    if (!explicit('pouches')) o.pouches = child ? 0 : 1 + Math.floor(R() * 4);
    if (!explicit('hair')) o.hair = o.build === 'f' ? (R() < 0.5 ? 'bun' : 'long') : 'short';
    if (!explicit('beard')) o.beard = o.build === 'm' && R() < 0.22 && !child;
    if (!explicit('hairColor')) o.hairColor = HAIRS[Math.floor(R() * HAIRS.length)];
    if (!explicit('skin')) o.skin = SKINS[Math.floor(R() * SKINS.length)];
    if (!explicit('fold')) o.fold = R() < 0.5 ? 0.04 : 0.065;
    if (!explicit('scarf')) o.scarf = R() < 0.12 && !child;
    if (!explicit('armPads')) o.armPads = R() < 0.2;
    if (!explicit('wear')) o.wear = 0.2 + R() * 0.6;
    if (!explicit('cloth2')) o.cloth2 = o.cloth;
    if (!explicit('lining')) o.lining = '#6a5a44';
  }
  if (o.pack === true) o.pack = 'bag';
  // «маска»: true/'up' — закрывает рот, 'down' — спущена на подбородок, false — без
  o.maskState = o.mask === 'down' ? 'down' : o.mask ? 'up' : 'none';
  o.maskOn = o.maskState !== 'none';
  // радиус пояса поверх одежды
  const layers = o.layers || [];
  let br = null;
  const consider = (style, sc = 1) => { const rows = robeProfile(style).rows; let rx = 0.19, rz = 0.14; for (let i = 1; i < rows.length; i++) if (rows[i][0] >= 1.0) { const a = rows[i - 1], b = rows[i], t = (1.0 - a[0]) / (b[0] - a[0]); rx = a[1] + (b[1] - a[1]) * t; rz = a[2] + (b[2] - a[2]) * t; break; } rx *= sc * 0.96; rz *= sc * 0.96; if (!br) br = [rx, rz]; else br = [Math.max(br[0], rx), Math.max(br[1], rz)]; };
  if (o.robe !== false) consider(o.robeStyle || 'jubba');
  o.beltR = br ? [br[0] + 0.012, br[1] + 0.012] : null;
  // лицо: возраст/пол/черты — детерминированно по сиду
  if (o.age === undefined && /NPC_Elder/.test(o.name || '')) o.age = 0.88;
  o.faceP = faceParams(o);
  o.hs = (BUILDS[o.build] || BUILDS.m).head;
  o.faceSpec = faceUniformsSpec(o.build, o.faceP, BUILDS[o.build] || BUILDS.m);
  if (o.stubble === undefined) o.stubble = o.faceP.g > 0.5 && !o.beard && o.faceP.age > 0.2 && R() < 0.6 ? 0.25 + R() * 0.5 : 0;
  if (o.freckles === undefined) o.freckles = 0.15 + R() * 0.45;
  return o;
}

function geoKey(o) {
  const k = {};
  for (const f of ['build', 'robe', 'robeStyle', 'layers', 'hood', 'maskState', 'scarf', 'hair', 'beard', 'pouches', 'kris', 'armPads', 'gloves', 'bare', 'barefoot', 'asym', 'tear', 'hemTrim', 'frontTrim', 'fold', 'noDrape', 'cuffTrim', 'sleeve', 'hoodTrim', 'cowl', 'noTubes', 'harness', 'hoodUp', 'beltR', 'sash', 'carry', 'waterRings', 'wrap', 'wrapStyle', 'wrapAccent']) k[f] = o[f];
  k.lin = !!o.lining; k.hr = o.height < 1.4; k.fk = faceKey(o.faceP); k.hv = (o.seed | 0) % 4;
  return JSON.stringify(k);
}

/**
 * Квантованный вариант фигуры для группового (инстансового) LOD: общий силуэт — построение, одежда, капюшон, причёска, борода —
 * без случайных мелочей (складки, лицо, подсумки), поэтому десятки NPC делят единицы геометрий. Цвета берутся из опций отдельно.
 * Возвращает { o, key } — опции и ключ кэша геометрии (geometryFor/hasGeometry).
 */
export function figureFarVariant(src) {
  const child = src.height < 1.4;
  const age = src.faceP?.age ?? 0.4, fem = (src.faceP?.g ?? 0.9) < 0.5;
  const L0 = (src.layers || [])[0];
  const hair = src.hair === 'bun' || src.hair === 'long' || src.hair === 'braid' ? src.hair : 'short';
  const fo = {
    ...src, seed: 4000 + (src.build || 'm').charCodeAt(0), age: age > 0.7 ? 0.9 : age > 0.4 ? 0.5 : 0.25, gender: fem ? 0.05 : 0.92, height: child ? 1.2 : 1.75,
    layers: L0 ? [{ style: L0.style, fold: 0.05 }] : [], fold: 0.05, folds: undefined, tear: 0, asym: 0, hemTrim: false, frontTrim: false, hoodTrim: false, cuffTrim: false,
    pouches: 0, kris: false, armPads: false, scarf: false, harness: !!src.harness, maskState: src.maskState === 'up' ? 'up' : 'none', maskOn: src.maskState === 'up', mask: src.maskState === 'up', hair, beard: !!src.beard,
    wear: 0.4, hooks: 0, props: undefined, lining: undefined, waterRings: 0, wrapAccent: false, wrapStyle: src.wrap ? (src.wrapStyle === 'band' ? 'band' : 'turban') : undefined, sleeve: undefined,
  };
  fo.faceP = faceParams(fo); fo.hs = (BUILDS[fo.build] || BUILDS.m).head; fo.faceSpec = faceUniformsSpec(fo.build, fo.faceP, BUILDS[fo.build] || BUILDS.m);
  fo.beltR = src.beltR;
  return { o: fo, key: geoKey(fo) };
}

// ------------------------------------------------------------------------------------------ реквизит ----
const propMats = new Map();
function pmat(color, rough = 0.8, metal = 0) { const k = color + rough + metal; if (!propMats.has(k)) propMats.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })); return propMats.get(k); }
const PG = {};
function pg() {
  if (PG.ready) return PG;
  PG.ready = true;
  PG.box = new THREE.BoxGeometry(0.28, 0.32, 0.13, 2, 2, 2);
  PG.shaft2 = new THREE.CylinderGeometry(0.017, 0.022, 2.4, 7);
  PG.shaft1 = new THREE.CylinderGeometry(0.02, 0.026, 1.9, 7);
  PG.hook = new THREE.TorusGeometry(0.11, 0.016, 6, 12, Math.PI * 1.15);
  PG.wrap = new THREE.CylinderGeometry(0.027, 0.027, 0.13, 7);
  PG.corner = new THREE.BoxGeometry(0.03, 0.03, 0.14);
  PG.pole = new THREE.CylinderGeometry(0.02, 0.024, 1.55, 6);
  return PG;
}
function addProps(parts, o) {
  const G = pg(), chest = parts.chest;
  const leather = pmat(o.leather || '#4a3828', 0.8), metal = pmat('#2a2724', 0.5, 0.7), brass = pmat('#b08d57', 0.4, 0.7), wood = pmat('#4a3826', 0.8), ribbon = pmat(o.accent || '#2c3e57', 0.9);
  const props = [];
  const add = (m, parent) => { m.castShadow = true; parent.add(m); props.push(m); return m; };
  if (o.pack) {
    const bx = add(new THREE.Mesh(G.box, leather), chest); bx.position.set(0, -0.03, -0.2); bx.scale.set(o.pack === 'box' ? 1.1 : 1, o.pack === 'box' ? 1.15 : 1, 1);
    if (o.pack === 'box') for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const c = add(new THREE.Mesh(G.corner, brass), chest); c.position.set(sx * 0.15, -0.03 + sy * 0.18, -0.2); c.rotation.set(0, 0, 0); }
  }
  const hooks = o.hooks | 0;
  for (let k = 0; k < hooks; k++) {
    const s = hooks === 1 ? 1 : k ? 1 : -1;
    const h = new THREE.Group();
    const sh = new THREE.Mesh(hooks === 2 && o.height < 1.7 ? G.shaft1 : G.shaft2, metal); h.add(sh);
    const hk = new THREE.Mesh(G.hook, metal); hk.position.set(0.1, hooks === 2 && o.height < 1.7 ? 0.95 : 1.2, 0); hk.rotation.z = Math.PI * 0.6; h.add(hk);
    const rb = new THREE.Mesh(G.wrap, ribbon); rb.position.y = 0.4; h.add(rb);
    h.position.set(0, -0.2, -0.24); h.rotation.set(0.08, 0, s * 0.62);
    chest.add(h); props.push(h);
  }
  if (o.staff) {
    const st = new THREE.Group();
    const hook = o.staff === 'hook';
    const sh = new THREE.Mesh(hook ? G.shaft2 : G.pole, hook ? wood : wood); st.add(sh);
    if (o.staff === true) { for (let i = 0; i < 6; i++) { const n = new THREE.Mesh(G.wrap, ribbon); n.scale.set(1.0, 0.1, 1.0); n.position.y = -0.5 + i * 0.16; st.add(n); } }
    if (hook) { const hk = new THREE.Mesh(G.hook, metal); hk.position.set(0.09, 1.2, 0); hk.rotation.z = 0.5; st.add(hk); }
    if (o.staff === 'hook') { st.position.set(0.28, -0.34, 0.14); st.rotation.set(0, 0, 0); st.scale.setScalar(0.9); st.position.y -= 0.0; parts.limbs.R.hand.add(st); st.position.set(0.0, -0.05, 0.03); st.rotation.x = 0; st.position.y = 0.95 - 0.1; props.push(st); }
    else if (o.staff === 'pilgrim') { parts.limbs.R.hand.add(st); st.position.set(0.0, 0.2, 0.04); st.rotation.set(0.0, 0, 0.0); props.push(st); }
    else { st.position.set(0.0, 0.05, -0.27); st.rotation.set(0.12, 0, 0.28); chest.add(st); props.push(st); }
  }
  return props;
}

// ------------------------------------------------------------------------------------------ makeFigure ----
/**
 * @param {object} o  см. DEFAULTS/PRESETS; ключевые: preset, height, build('m'|'f'|'c'|'a'|'e'), cloth, cloth2, suit, accent, skin,
 *   hood, mask(true|'down'|false), robe, robeStyle('jubba'|'kaftan'|'tunic'), layers[{style:'cape'|'shawl'|'heavy',...}], pack('bag'|'box'),
 *   hooks(0..2), staff, eyesIbad, bulk, scarf, hair, beard, lod(0..2|undefined=auto), seed, wear, dust
 */
export function makeFigure(opts = {}) {
  const o = resolveOptions(opts);
  const H = o.height, s = H / 1.75, bulk = o.bulk ?? 1;
  const g = new THREE.Group();
  g.name = o.name || 'Figure';
  const root = new THREE.Group();
  root.scale.set(s * bulk, s, s * (1 + (bulk - 1) * 0.8));
  g.add(root);

  // --- скелет ---
  const mkBone = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); return b; };
  const sw = 0.19 * (BUILDS[o.build] || BUILDS.m).sh;
  const pelvis = mkBone('pelvis', root, 0, 0.92, 0);
  const spine = mkBone('spine', pelvis, 0, 0, 0);
  const chest = mkBone('chest', spine, 0, 0.3, 0);
  const neck = mkBone('neck', chest, 0, 0.28, 0);
  const headPivot = mkBone('head', neck, 0, 0.13, 0);
  const limbs = {};
  const byName = { pelvis, spine, chest, neck, head: headPivot };
  for (const side of [-1, 1]) {
    const k = side < 0 ? 'L' : 'R';
    const sh = mkBone('sh' + k, chest, sw * side, 0.21, 0);
    const el = mkBone('el' + k, sh, 0, -0.3, 0);
    const hand = mkBone('hand' + k, el, 0, -0.26, 0);
    const hip = mkBone('hip' + k, pelvis, 0.09 * side, 0, 0);
    const kn = mkBone('kn' + k, hip, 0, -0.44, 0);
    const foot = mkBone('foot' + k, kn, 0, -0.4, 0);
    const toe = mkBone('toe' + k, foot, 0, -0.045, 0.13);
    limbs[k] = { sh, el, hand, hip, kn, foot, toe };
    Object.assign(byName, { ['sh' + k]: sh, ['el' + k]: el, ['hand' + k]: hand, ['hip' + k]: hip, ['kn' + k]: kn, ['foot' + k]: foot, ['toe' + k]: toe });
  }
  const bones = BONE_NAMES.map((n) => byName[n]);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  // --- меши (LOD по расстоянию) ---
  const key = geoKey(o);
  const geoAt = (l) => geometryFor(o, l, key); // строится лениво и кэшируется по варианту
  const U = makeUniforms({ ...o, cloth2: o.cloth2 || o.cloth, lining: o.lining });
  const bodyMat = makeBodyMaterial(U), clothMat = makeClothMaterial(U);
  let lod = o.lod ?? 1;
  const g0 = geoAt(lod);
  const body = new THREE.SkinnedMesh(g0.body, bodyMat);
  const cloth = new THREE.SkinnedMesh(g0.cloth, clothMat);
  for (const m of [body, cloth]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = true; root.add(m); }
  body.name = 'FigureBody'; cloth.name = 'FigureCloth';
  root.updateMatrixWorld(true);
  body.bind(skeleton, body.matrixWorld);
  cloth.bind(skeleton, cloth.matrixWorld);
  for (const m of [body, cloth]) m.onBeforeRender = (r, sc, cam) => { cl.seen = FRAME; if (cam.isPerspectiveCamera) TAN_HALF = 1 / cam.projectionMatrix.elements[5]; };
  const setLod = (l) => { const e = geoAt(l); if (l === lod && body.geometry === e.body) return; lod = l; body.geometry = e.body; cloth.geometry = e.cloth; };
  // Перекрёстное растворение LOD: «призрачная» пара мешей со старой геометрией и дизерингом (по экранному шуму) — переключение не заметно.
  let ghost = null;
  const fadeSt = { t: 1 };
  function ensureGhost() {
    if (ghost) return ghost;
    const U2 = { ...U, uFade: { value: 1 } };
    const gb = new THREE.SkinnedMesh(body.geometry, makeBodyMaterial(U2)), gc = new THREE.SkinnedMesh(cloth.geometry, makeClothMaterial(U2));
    for (const m of [gb, gc]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = true; m.visible = false; root.add(m); }
    gb.bind(skeleton, body.matrixWorld); gc.bind(skeleton, cloth.matrixWorld);
    gb.name = 'FigureBodyLodGhost'; gc.name = 'FigureClothLodGhost';
    ghost = { gb, gc, U2 };
    return ghost;
  }
  function startFade(l) {
    if (fadeSt.t < 1) endFade();
    const seenNow = FRAME - cl.seen < 30;
    if (!seenNow || !g.parent) { cl.fadeTo = -1; setLod(l); return; }
    const gh = ensureGhost(), e = geoAt(l);
    gh.gb.geometry = body.geometry; gh.gc.geometry = cloth.geometry;
    // внешние правки материалов/теней основного меша (например, подсветка наездников) — те же у призрака
    for (const [a, b] of [[gh.gb, body], [gh.gc, cloth]]) { if (a.material.emissive && b.material.emissive) { a.material.emissive.copy(b.material.emissive); a.material.emissiveIntensity = b.material.emissiveIntensity; } a.castShadow = b.castShadow; a.receiveShadow = b.receiveShadow; }
    gh.gb.visible = gh.gc.visible = true;
    lod = l; body.geometry = e.body; cloth.geometry = e.cloth;
    fadeSt.t = 0; cl.fadeTo = l; U.uFade.value = 0.001; gh.U2.uFade.value = -0.001;
  }
  function endFade() { fadeSt.t = 1; cl.fadeTo = -1; U.uFade.value = 1; if (ghost) { ghost.gb.visible = ghost.gc.visible = false; ghost.U2.uFade.value = 1; } }
  function fadeStep(dt) {
    if (fadeSt.t >= 1) return false;
    fadeSt.t += dt / FADE_TIME;
    if (fadeSt.t >= 1) { endFade(); return false; }
    const t = Math.min(0.999, Math.max(0.001, fadeSt.t * fadeSt.t * (3 - 2 * fadeSt.t)));
    U.uFade.value = t; ghost.U2.uFade.value = -t;
    return true;
  }
  const parts = { root, pelvis, spine, chest, neck, headPivot, limbs, body, cloth, skeleton };
  const props = addProps(parts, o);

  // --- анимация ---
  const anim = createAnimator(parts, { style: o.style, seed: o.seed });
  const ik = createArmIK(parts, g);
  const V = THREE.Vector3;
  const cl = { lag: new V(), lv: new V(), prev: new V(), have: false, vel: new V(), lastPos: new V(), lodT: 0, jit: 0.05 + (hashStr(o.name || 'x') % 100) / 1000, skip: 0, acc: 0, jph: 0.3 + (hashStr(o.name || 'x') % 70) / 100, fadeTo: -1, wasCtxWind: false, dist: 5, seen: 1e9 };
  const fig = {
    group: g, height: H, parts, options: o, props, gait: null, onStep: null, lod: () => lod, _anim: anim,
    get stats() { return { tris: [0, 1, 2].map((l) => { const e = geoAt(l); return triCount(e.body) + triCount(e.cloth); }), key }; },
    /** Скорость в м/с; irregular>0.45 — «походка по песку» (рваный шаг). 4-й параметр — ctx (см. шапку). Возвращает фазу цикла (рад). */
    animate(speed, dt, irregular = 0, ctx) {
      if (dt <= 0) return anim.state.ph * Math.PI * 2;
      CLOCK += 0; // clock — по собственному таймеру анимации
      // LOD по расстоянию до камеры (гистерезис, редкая проверка со смещением по фигурам)
      FRAME_TICK();
      cl.lodT -= dt;
      if (cl.lodT <= 0 && o.lod === undefined) {
        cl.lodT = 0.18 + cl.jit;
        if (VIEW_SET) {
          g.updateWorldMatrix(true, false);
          const e = g.matrixWorld.elements, dx = e[12] - VIEW.x, dy = e[13] + 1 - VIEW.y, dz = e[14] - VIEW.z;
          cl.dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / LOD_SCALE;
          const d = cl.dist, hy = 1.12;
          // экранная доля роста (с учётом fov камеры и масштаба качества)
          const scr = (H / Math.max(0.3, d)) / (2 * TAN_HALF);
          const want = scr > SCR_A / (lod === 0 ? hy : 1 / hy) ? 0 : scr > SCR_B / (lod === 1 ? hy : lod === 2 ? 1 / hy : 1) ? 1 : 2;
          // геометрию строим заранее: LOD0 — при scr > 0.6·A, остальные — по запросу; переключаем (с перекрёстным растворением), когда готово
          if (want !== lod && want !== cl.fadeTo) {
            if (hasGeometry(key, want)) startFade(want); else enqueueBuild(o, want, key);
          } else if (lod > 0 && scr > SCR_A * 0.6 && !hasGeometry(key, 0)) enqueueBuild(o, 0, key);
          else if (lod === 0 && !hasGeometry(key, 1)) enqueueBuild(o, 1, key);
        }
      }
      if (QFRAME !== FRAME && BUILDQ.length) { QFRAME = FRAME; pumpFigureBuilds(3.5); }
      // частота анимации по экранному размеру: LOD0 — каждый кадр, LOD1 ≈ 30 Гц, LOD2 ≈ 20 Гц (dt копится, поза не «залипает»);
      // скрытые от камеры дальние — 10 Гц. Фаза сдвинута по фигурам, чтобы нагрузка не приходилась на один кадр.
      cl.acc += dt;
      const seen = FRAME - cl.seen < 30;
      const period = !seen && cl.dist > 9 ? 0.1 : lod === 0 ? 0 : lod === 1 ? 0.03 : 0.048;
      if (fadeStep(dt)) { /* перекрёстное растворение идёт каждый кадр */ }
      if (period > 0 && cl.acc < period * cl.jph) return anim.state.ph * Math.PI * 2;
      cl.jph = 1;
      const adt = Math.min(cl.acc, 0.1); cl.acc = 0;
      const out = anim.update(adt, speed, irregular, ctx);
      clothStep(adt, speed, ctx, out);
      if (lod === 0) faceStep(adt);
      if (ik.active()) ik.apply(adt);
      return anim.state.ph * Math.PI * 2;
    },
    /** Рука тянется к мировой точке (null — отпустить). side 'L'|'R', weight 0..1, opts {sweep: смещение вбок м, palm: ладонью вперёд, speed}. */
    reachTo(point, side = 'R', weight = 1, opts) { ik.reachTo(point, side, weight, opts); },
    /** Мировая позиция ладони (для деформации ткани/занавеса). */
    handWorld(side = 'R', out) { return ik.handWorld(side, out); },
    /** Состояние перекрёстного растворения LOD (для тестов): t 0..1, ghost — виден ли меш старой геометрии. */
    fadeState() { return { t: fadeSt.t, ghost: !!ghost && ghost.gb.visible, lod }; },
    /** Групповое растворение (figure_crowd.js): 1 — виден; 0<v<1 — доля пикселей; -m (m 0..1) — дополнение к группе: скрыто m пикселей. */
    setGroupFade(v) { U.uGrp.value = v; },
    setTalking(b) { anim.setTalking(!!b); fa.talk = !!b; },
    /** Открытие рта 0..1 (например, амплитуда голоса). null — вернуть управление автоанимации речи. */
    setMouth(v) { fa.ext = v === null || v === undefined ? null : clamp01(v); },
    /** Принудительное моргание / состояние глаз (для сцен): blink(0..1 постоянно закрыть) или blink() — разовое. */
    blink(v) { if (v === undefined) fa.blinkPh = 0; else fa.hold = clamp01(v); },
    /** Повернуть голову к мировой точке (ограничение ±70°), w — вес 0..1. */
    lookAt(worldPos, weight = 1) {
      const local = g.worldToLocal(worldPos.clone());
      const yaw = Math.atan2(local.x, local.z);
      anim.setLook(THREE.MathUtils.clamp(yaw, -1.2, 1.2), weight);
    },
    setWind(dir, speed) { cl.ownWind = dir ? { x: dir.x, z: dir.z, s: speed } : null; },
    dispose() { /* геометрии общие; материалы — по фигуре */ bodyMat.dispose(); clothMat.dispose(); if (ghost) { ghost.gb.material.dispose(); ghost.gc.material.dispose(); } },
  };
  fig.gait = {
    get env() { return anim.env; }, get desertness() { return anim.desertness; },
    stutter: () => anim.stutter(), reset: () => anim.reset(),
  };
  anim.hooks.onStep = (e) => fig.onStep?.(e);

  // --- лицо: моргание, саккады, речь ---
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const FR = rng((o.seed | 0) + 991);
  const fa = { talk: false, ext: null, hold: 0, blinkT: 1 + FR() * 3, blinkPh: -1, dbl: false, blink: 0, yaw: 0, pitch: 0, tyaw: 0, tpitch: 0, sacT: 0.3 + FR(), mouth: 0, t: FR() * 50 };
  function faceStep(dt) {
    fa.t += dt;
    // моргание: смыкание 0.07 c, раскрытие 0.13 c; 15% — двойное
    fa.blinkT -= dt;
    if (fa.blinkPh < 0 && fa.blinkT <= 0) { fa.blinkPh = 0; fa.dbl = FR() < 0.15; }
    let bl = 0;
    if (fa.blinkPh >= 0) {
      fa.blinkPh += dt; const p = fa.blinkPh;
      bl = p < 0.07 ? p / 0.07 : Math.max(0, 1 - (p - 0.07) / 0.13);
      if (p > 0.2) { fa.blinkPh = -1; fa.blinkT = fa.dbl ? 0.12 : 2.2 + FR() * 3.6; fa.dbl = false; }
    }
    fa.blink = Math.max(bl, fa.hold);
    // саккады: короткие прыжки взгляда; взгляд ведёт голову (lookAt)
    fa.sacT -= dt;
    if (fa.sacT <= 0) { fa.sacT = 0.35 + FR() * 1.8; fa.tyaw = (FR() - 0.5) * 0.22; fa.tpitch = (FR() - 0.5) * 0.12; }
    const st = anim.state, lead = THREE.MathUtils.clamp((st.lookYaw - st.headYaw) * 0.9, -0.45, 0.45);
    const k = 1 - Math.exp(-dt * 38);
    fa.yaw += (THREE.MathUtils.clamp(lead + fa.tyaw, -0.5, 0.5) - fa.yaw) * k; fa.pitch += (fa.tpitch - fa.pitch) * k;
    // рот: внешняя амплитуда или слоговая огибающая
    let tm = 0;
    if (fa.ext !== null) tm = fa.ext;
    else if (fa.talk) tm = Math.abs(Math.sin(fa.t * 6.3)) * (0.55 + 0.45 * Math.sin(fa.t * 2.1 + 1.0)) * (0.6 + 0.4 * Math.sin(fa.t * 11.7)) * 0.9;
    fa.mouth += (tm - fa.mouth) * (1 - Math.exp(-dt * (tm > fa.mouth ? 30 : 18)));
    U.uBlink.value = fa.blink; U.uEyeRot.value.set(fa.yaw, fa.pitch); U.uMouth.value = fa.mouth * (o.maskState === "up" ? 0.55 : 1);
  }

  // --- вторичная анимация ткани (CPU: пружина «отставания»; GPU: вершинный шейдер) ---
  function clothStep(dt, speed, ctx, out) {
    const px = g.position.x, pz = g.position.z;
    let vx, vz;
    if (ctx?.vel) { vx = ctx.vel.x; vz = ctx.vel.z; }
    else if (cl.have) { vx = (px - cl.lastPos.x) / dt; vz = (pz - cl.lastPos.z) / dt; }
    else { vx = vz = 0; }
    cl.lastPos.set(px, 0, pz); cl.have = true;
    const vm = Math.hypot(vx, vz);
    if (vm > 14) { vx *= 14 / vm; vz *= 14 / vm; }
    const yaw = g.rotation.y, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const sc = 1 / (root.scale.y || 1);
    const lx = (vx * cy - vz * sy) * sc, lz = (vx * sy + vz * cy) * sc;
    const yr = anim.state.yawRate;
    const tx = -lx * 0.045 + yr * 0.035, tz = -lz * 0.06;
    const ty = -Math.min(0.06, Math.abs(anim.state.accel) * 0.01) * 0.0 + Math.min(0.05, vm * 0.008);
    // пружина отставания: точное решение недодемпфированного осциллятора (ω=9.2, ζ=0.65) — устойчиво при любом dt, без аллокаций
    {
      const W = 9.2, Z = 0.65, wd = W * Math.sqrt(1 - Z * Z), dd = Math.min(dt, 0.1), ex = Math.exp(-Z * W * dd), cs = Math.cos(wd * dd), sn = Math.sin(wd * dd);
      const k1 = W * W / wd, k2 = Z * W / wd, k3 = Z * W;
      let d = cl.lag.x - tx, v = cl.lv.x, c2 = (v + k3 * d) / wd;
      cl.lag.x = tx + ex * (d * cs + c2 * sn); cl.lv.x = ex * (v * cs - k1 * d * sn - k2 * v * sn);
      d = cl.lag.y - ty; v = cl.lv.y; c2 = (v + k3 * d) / wd;
      cl.lag.y = ty + ex * (d * cs + c2 * sn); cl.lv.y = ex * (v * cs - k1 * d * sn - k2 * v * sn);
      d = cl.lag.z - tz; v = cl.lv.z; c2 = (v + k3 * d) / wd;
      cl.lag.z = tz + ex * (d * cs + c2 * sn); cl.lv.z = ex * (v * cs - k1 * d * sn - k2 * v * sn);
    }
    const m = Math.hypot(cl.lag.x, cl.lag.z); if (m > 0.3) { cl.lag.x *= 0.3 / m; cl.lag.z *= 0.3 / m; }
    U.uLag.value.copy(cl.lag);
    // ветер → локальная система фигуры
    const wd = ctx?.wind ? { x: ctx.wind.dir.x, z: ctx.wind.dir.z, s: ctx.wind.speed } : cl.ownWind || { x: WIND.x, z: WIND.z, s: WIND.speed };
    const ws = Math.min(0.26, wd.s * 0.02);
    U.uWind.value.set((wd.x * cy - wd.z * sy) * ws, 0.0, (wd.x * sy + wd.z * cy) * ws);
    U.uTime.value = anim.state.t;
    U.uHipY.value = out.hipY;
    U.uLegL.value.set(out.kz[0], out.ky[0], out.az[0], out.ay[0]);
    U.uLegR.value.set(out.kz[1], out.ky[1], out.az[1], out.ay[1]);
  }

  FIGURE_STATS.figures++;
  return fig;
}

/** Статистика треугольников по LOD для данного набора опций (для отчётов/тестов). */
export function figureTriangles(opts = {}) {
  const f = makeFigure({ ...opts, lod: 0 });
  const r = f.stats.tris.slice();
  f.dispose();
  return r;
}
