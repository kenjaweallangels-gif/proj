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
//   • parts: root, pelvis, spine, chest, neck, headPivot, limbs.L/R.{sh,el,hand,hip,kn,foot,toe} — Object3D-кости (скин-скелет).
//   • Один скин-меш тела (+1 меш ткани), геометрия общая для фигур с одним «вариантом», 3 LOD (по расстоянию до setFigureView).
// Глобально: setFigureWind(dir, speed) — ветер для всех (вызывает модуль игрока), setFigureView(camPos) — для LOD.
import * as THREE from 'three';
import { rng } from './util.js';
import { BONE_NAMES, REST, REG, robeProfile, geometryFor, triCount } from '../player/char_geometry.js';
import { makeUniforms, makeBodyMaterial, makeClothMaterial } from '../player/char_material.js';
import { createAnimator } from '../player/char_anim.js';

// ------------------------------------------------------------------------------------------ глобальное состояние ----
const WIND = { x: 0, z: 0, speed: 0 };
const VIEW = new THREE.Vector3(1e6, 0, 1e6);
let VIEW_SET = false;
let LOD_SCALE = 1;
let CLOCK = 0;
export function setFigureWind(dir, speed = 0) { if (!dir) { WIND.x = WIND.z = WIND.speed = 0; return; } WIND.x = dir.x; WIND.z = dir.z; WIND.speed = speed; }
export function setFigureView(camPos) { VIEW.copy(camPos); VIEW_SET = true; }
/** Масштаб дистанций LOD (качество графики: low 0.6, med 1, high 1.4). */
export function setFigureQuality(q) { LOD_SCALE = q === 'low' ? 0.6 : q === 'high' ? 1.4 : 1; }
export const FIGURE_STATS = { figures: 0, lod: [0, 0, 0] };

// ------------------------------------------------------------------------------------------ палитры архетипов толпы ----
export const PALETTES = {
  Trader: { cloth: '#7a5a3a', accent: '#a0522d', suit: '#4b4035' },
  Artisan: { cloth: '#6b5844', accent: '#8b6b3a', suit: '#463b31', pack: true },
  WaterCarrier: { cloth: '#5d6a73', accent: '#2c5f8a', suit: '#3f3e3a' },
  Child: { cloth: '#9a7b55', accent: '#b5462c', suit: '#5a4a3a', height: 1.2, mask: false },
  Guard: { cloth: '#3a332c', accent: '#6e2b20', suit: '#2e2a26', bulk: 1.15 },
  Pilgrim: { cloth: '#b9a07a', accent: '#6b5a3a', suit: '#5a4d3e' },
  Elder: { cloth: '#4e4438', accent: '#2c3e57', suit: '#3b342d', height: 1.66 },
  Weaver: { cloth: '#7d4f3a', accent: '#2c3e57', suit: '#4a3d33' },
};

// ------------------------------------------------------------------------------------------ пресеты персонажей ----
// Стили походки: см. char_anim DEFAULT_STYLE.
export const PRESETS = {
  Kair: {
    name: 'Kair', height: 1.76, build: 'm', skin: '#7a563a', suit: '#4a4038', cloth: '#8a6a44', cloth2: '#c9a46a', accent: '#2c3e57', leather: '#5a3e28',
    robe: true, robeStyle: 'tunic', layers: [{ style: 'cape', asym: 1, tear: 1, fold: 0.045, hemTrim: false }], hood: true, mask: true, pouches: 3, kris: false, staff: true,
    hair: 'short', hairColor: '#201812', wear: 0.55, dust: 0.65, cuffTrim: false, style: { stride: 1, armSwing: 1, tempo: 1 }, seed: 11,
  },
  Ilva: {
    name: 'Ilva', height: 1.68, build: 'f', skin: '#b08a68', suit: '#3e3630', cloth: '#7e7466', cloth2: '#b8ae9c', accent: '#6b5a7a', lining: '#d8c8a8', leather: '#5a4a3a',
    robe: true, robeStyle: 'jubba', robeTint: 2, layers: [{ style: 'shawl', hemTrim: true, fold: 0.06, folds: 7, lining: true }], hood: true, mask: 'down', pouches: 1, hemTrim: false, hair: 'bun', hairColor: '#2a1c14', wear: 0.2, dust: 0.45,
    style: { composed: 1, sway: 0.55, bounce: 0.8, armSwing: 0.55, stride: 0.95, shoulders: 0.0 }, seed: 23, staff: 'sling',
  },
  Rayn: {
    name: 'Rayn', height: 1.6, build: 'm', bulk: 1.1, skin: '#a9805e', suit: '#3e3630', cloth: '#5a4a3a', cloth2: '#7a2e24', accent: '#c9a46a', leather: '#4a3524',
    robe: true, robeStyle: 'kaftan', layers: [{ style: 'cape', fold: 0.05, tear: 0.3 }], hood: true, mask: true, pouches: 5, frontTrim: true, hemTrim: true, pack: 'box', hair: 'short', hairColor: '#4a3a2a', wear: 0.25, dust: 0.7,
    style: { nervous: 1, stride: 0.82, tempo: 1.15, hunch: 0.05, shoulders: 1, armSwing: 0.7 }, seed: 31,
  },
  Ossana: {
    name: 'Ossana', height: 1.72, build: 'a', skin: '#5a3e28', suit: '#3b302a', cloth: '#4a3b2c', cloth2: '#6b4f36', accent: '#2c3e57', leather: '#4a3222',
    robe: true, robeStyle: 'tunic', layers: [{ style: 'cape', fold: 0.04, tear: 0.5, scale: 0.97 }], hood: true, mask: 'down', pouches: 3, kris: true, armPads: true, harness: true, hooks: 2, hair: 'short', hairColor: '#1a1410',
    eyesIbad: true, wear: 0.7, dust: 0.6, style: { stride: 1.08, armSwing: 1.1, stance: 1, sway: 1.1 }, seed: 41, scarf: false,
  },
  Rider: {
    name: 'Rider', height: 1.78, build: 'm', skin: '#6e4c34', suit: '#14120f', cloth: '#1d1a17', cloth2: '#2a2118', accent: '#5c2a1f', leather: '#3a2a1c',
    robe: true, robeStyle: 'tunic', layers: [{ style: 'cape', fold: 0.04, tear: 0.8 }], hood: true, mask: true, pouches: 2, armPads: true, kris: true, hooks: 1, eyesIbad: true, wear: 0.6, scarf: true, style: { stride: 1.05 }, seed: 51,
  },
  Rider2: {
    name: 'Rider2', height: 1.66, build: 'f', skin: '#7a563a', suit: '#3b302a', cloth: '#5e4b3c', cloth2: '#9c7c52', accent: '#2c3e57', leather: '#4a3222',
    robe: true, robeStyle: 'tunic', layers: [{ style: 'cape', fold: 0.04, scale: 0.9 }], hood: true, mask: 'down', pouches: 2, armPads: true, hooks: 2, eyesIbad: true, wear: 0.5, scarf: true, hair: 'short', hairColor: '#241a14', style: { stride: 1.0, tempo: 1.05 }, seed: 52,
  },
  Harmat: {
    name: 'Harmat', height: 1.72, build: 'e', bulk: 1.12, skin: '#7a563a', suit: '#2a221b', cloth: '#2b2420', cloth2: '#6b4f36', accent: '#2c62b8', leather: '#3a2a1a',
    robe: true, robeStyle: 'jubba', layers: [{ style: 'heavy', hemTrim: true, folds: 6, fold: 0.05 }], hood: false, mask: false, pouches: 2, kris: true, hair: 'short', hairColor: '#c9c6bd', beard: true, eyesIbad: true,
    wear: 0.8, dust: 0.5, staff: 'hook', style: { elder: 1, stride: 0.8, sway: 0.8, tempo: 0.85, armSwing: 0.6 }, seed: 61,
  },
  Priestess: {
    name: 'Priestess', height: 1.86, build: 'f', skin: '#c2a083', suit: '#e0d6c2', cloth: '#e0d6c2', cloth2: '#e0d6c2', accent: '#3f5e7a', lining: '#f0e8d6', leather: '#8a6a3a', bare: true, barefoot: true, gloves: false,
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
  const consider = (style, sc = 1) => { const rows = robeProfile(style).rows; let rx = 0.19, rz = 0.14; for (let i = 1; i < rows.length; i++) if (rows[i][0] >= 1.0) { const a = rows[i - 1], b = rows[i], t = (1.0 - a[0]) / (b[0] - a[0]); rx = a[1] + (b[1] - a[1]) * t; rz = a[2] + (b[2] - a[2]) * t; break; } rx *= sc; rz *= sc; if (!br) br = [rx, rz]; else br = [Math.max(br[0], rx), Math.max(br[1], rz)]; };
  if (o.robe !== false) consider(o.robeStyle || 'jubba');
  o.beltR = br ? [br[0] + 0.012, br[1] + 0.012] : null;
  return o;
}

function geoKey(o) {
  const k = {};
  for (const f of ['build', 'robe', 'robeStyle', 'layers', 'hood', 'maskState', 'scarf', 'hair', 'beard', 'pouches', 'kris', 'armPads', 'gloves', 'bare', 'barefoot', 'asym', 'tear', 'hemTrim', 'frontTrim', 'fold', 'noDrape', 'cuffTrim', 'sleeve', 'hoodTrim', 'cowl', 'noTubes', 'harness', 'hoodUp', 'beltR']) k[f] = o[f];
  k.lin = !!o.lining; k.hr = o.height < 1.4;
  return JSON.stringify(k);
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
  const sw = 0.19 * ({ m: 1, f: 0.9, c: 0.85, a: 1.08, e: 1.06 }[o.build] || 1);
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
  const setLod = (l) => { const e = geoAt(l); if (l === lod && body.geometry === e.body) return; lod = l; body.geometry = e.body; cloth.geometry = e.cloth; };
  const parts = { root, pelvis, spine, chest, neck, headPivot, limbs, body, cloth, skeleton };
  const props = addProps(parts, o);

  // --- анимация ---
  const anim = createAnimator(parts, { style: o.style, seed: o.seed });
  const V = THREE.Vector3;
  const cl = { lag: new V(), lv: new V(), prev: new V(), have: false, vel: new V(), lastPos: new V(), lodT: Math.random() * 0.3, skip: 0, acc: 0, wasCtxWind: false };
  const fig = {
    group: g, height: H, parts, options: o, props, gait: null, onStep: null, lod: () => lod,
    get stats() { return { tris: [0, 1, 2].map((l) => { const e = geoAt(l); return triCount(e.body) + triCount(e.cloth); }), key }; },
    /** Скорость в м/с; irregular>0.45 — «походка по песку» (рваный шаг). 4-й параметр — ctx (см. шапку). Возвращает фазу цикла (рад). */
    animate(speed, dt, irregular = 0, ctx) {
      if (dt <= 0) return anim.state.ph * Math.PI * 2;
      CLOCK += 0; // clock — по собственному таймеру анимации
      // LOD по расстоянию до камеры
      cl.lodT -= dt;
      if (cl.lodT <= 0 && o.lod === undefined) {
        cl.lodT = 0.2 + Math.random() * 0.15;
        if (VIEW_SET) {
          g.updateWorldMatrix(true, false);
          const e = g.matrixWorld.elements, dx = e[12] - VIEW.x, dy = e[13] + 1 - VIEW.y, dz = e[14] - VIEW.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / LOD_SCALE;
          const hy = lod === 0 ? 1.5 : lod === 1 ? -1.5 : 0;
          const nl = d < 9 + (lod > 0 ? -1.5 : 1.5) ? 0 : d < 26 + (lod > 1 ? -3 : 3) ? 1 : 2;
          if (nl !== lod) setLod(nl);
        }
      }
      // дальние — анимируем реже
      cl.acc += dt;
      if (lod === 2 && ++cl.skip % 3 !== 0) return anim.state.ph * Math.PI * 2;
      const adt = cl.acc; cl.acc = 0;
      const out = anim.update(adt, speed, irregular, ctx);
      clothStep(adt, speed, ctx, out);
      return anim.state.ph * Math.PI * 2;
    },
    setTalking(b) { anim.setTalking(!!b); },
    /** Повернуть голову к мировой точке (ограничение ±70°), w — вес 0..1. */
    lookAt(worldPos, weight = 1) {
      const local = g.worldToLocal(worldPos.clone());
      const yaw = Math.atan2(local.x, local.z);
      anim.setLook(THREE.MathUtils.clamp(yaw, -1.2, 1.2), weight);
    },
    setWind(dir, speed) { cl.ownWind = dir ? { x: dir.x, z: dir.z, s: speed } : null; },
    dispose() { /* геометрии общие; материалы — по фигуре */ bodyMat.dispose(); clothMat.dispose(); },
  };
  fig.gait = {
    get env() { return anim.env; }, get desertness() { return anim.desertness; },
    stutter: () => anim.stutter(), reset: () => anim.reset(),
  };
  anim.hooks.onStep = (e) => fig.onStep?.(e);

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
    // пружина (2 подшага)
    const sub = dt > 0.02 ? 2 : 1, h = dt / sub;
    for (let k = 0; k < sub; k++) {
      cl.lv.x += ((tx - cl.lag.x) * 85 - cl.lv.x * 12) * h; cl.lv.y += ((ty - cl.lag.y) * 85 - cl.lv.y * 12) * h; cl.lv.z += ((tz - cl.lag.z) * 85 - cl.lv.z * 12) * h;
      cl.lag.x += cl.lv.x * h; cl.lag.y += cl.lv.y * h; cl.lag.z += cl.lv.z * h;
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
