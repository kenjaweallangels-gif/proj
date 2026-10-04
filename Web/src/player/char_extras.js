// Силуэтные детали одежды и поклажи: шарф-кушак с хвостами, головная повязка (тюрбан), кольца воды, кувшин/свёрток/корзина/бурдюк/сумка.
// Всё — геометрия тела (скин к спине/груди/голове), поэтому попадает во все LOD и в групповой LOD толпы (figure_crowd.js).
// LOD: детали видны с силуэта — сохраняем на LOD1/2 в упрощённом виде (меньше сегментов, без мелочи).
import * as THREE from 'three';
import { BI, REG, ringY, ellipsoid, tube, headRow, HEAD_Y, skY } from './char_geometry.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// Циклический импорт с char_geometry.js: индексы костей читаем лениво, при первом вызове билдера.
let CHEST, SPINE, PELVIS, HEAD, TORSO_SK;
function init() { if (CHEST) return; CHEST = [BI.chest, 1]; SPINE = [BI.spine, 1]; PELVIS = [BI.pelvis, 1]; HEAD = [BI.head, 1]; TORSO_SK = [[1.52, BI.neck], [1.43, BI.chest], [1.15, BI.chest], [1.0, BI.spine], [0.9, BI.pelvis]]; }

/** Кольцо-«бублик» (кольцо воды): центр c, нормаль n (единичная), радиус R, сечение r. */
function ringTorus(b, c, n, R, r, reg, sk, seg = 8, min = 4) {
  const N = new THREE.Vector3(...n).normalize();
  const U = new THREE.Vector3(0, 1, 0); if (Math.abs(N.y) > 0.9) U.set(1, 0, 0);
  U.sub(N.clone().multiplyScalar(U.dot(N))).normalize();
  const V = new THREE.Vector3().crossVectors(N, U);
  const rings = [];
  for (let i = 0; i <= seg; i++) {
    const th = (i / seg) * Math.PI * 2, d = U.clone().multiplyScalar(Math.cos(th)).add(V.clone().multiplyScalar(Math.sin(th))), pts = [];
    for (let k = 0; k < min; k++) { const ph = (k / min) * Math.PI * 2, q = d.clone().multiplyScalar(R + Math.cos(ph) * r).add(N.clone().multiplyScalar(Math.sin(ph) * r)); pts.push([c[0] + q.x, c[1] + q.y, c[2] + q.z]); }
    rings.push(pts);
  }
  b.loft(rings, () => ({ reg, aux: [0, 0, 0.1, 0], sk }), { closed: true });
}

/** Кушак из ткани поверх одежды с узлом и двумя свисающими хвостами (акцентный цвет). */
export function buildSash(b, o, lod, rx0, rz0, y0) {
  init();
  const N = [22, 14, 9][lod], bulgeRows = lod === 0 ? 5 : lod === 1 ? 4 : 3;
  const rows = [];
  for (let k = 0; k < bulgeRows; k++) {
    const t = k / (bulgeRows - 1), y = lerp(y0 - 0.058, y0 + 0.066, t), bl = Math.sin(t * Math.PI), d = 0.006 + 0.016 * bl;
    rows.push(ringY(y, 0, 0, rx0 + d, rz0 + d, N, (a) => 1 + 0.012 * Math.sin(a * 5 + t * 6) * bl + 0.01 * Math.cos(a * 11 + t * 3)));
  }
  b.loft(rows, (j, i, p) => ({ reg: REG.ACCENT, aux: [0, 0, 0.5 + 0.4 * Math.sin(i * 1.3 + j * 2), i / N], sk: skY(p[1], TORSO_SK) }), { capStart: false });
  // узел на бедре и хвосты
  const s = (o.seed | 0) % 2 ? 1 : -1, a0 = s * 0.95;
  const kx = Math.sin(a0) * (rx0 + 0.03), kz = Math.cos(a0) * (rz0 + 0.03);
  ellipsoid(b, [kx, y0 - 0.005, kz], [0.034, 0.04, 0.03], REG.ACCENT, PELVIS, { u: 8, v: 5, aux: [0, 0, 0.3, 0] });
  for (const [dx, len, tw] of [[-0.015, 0.46, 0.4], [0.03, 0.34, -0.5]]) {
    const K = lod === 0 ? 6 : 3, rowsT = [];
    for (let q = 0; q < K; q++) {
      const t = q / (K - 1), y = y0 - 0.03 - t * len, w = 0.04 * (1 - 0.15 * t), sway = Math.sin(t * 3 + tw) * 0.012;
      const cx = kx + s * dx + s * t * 0.02 + sway, cz = kz + 0.02 + t * 0.03;
      rowsT.push([[cx - w, y, cz - 0.004], [cx, y, cz + 0.006 + 0.01 * t], [cx + w, y, cz - 0.004]]);
    }
    b.loft(rowsT, (j, i, p) => ({ reg: REG.ACCENT, aux: [t01(j, K) ** 1.4, 0, 0.7, 0.2 * i], sk: PELVIS }), { closed: false });
  }
}
const t01 = (j, K) => j / Math.max(1, K - 1);

/** Кольца воды: связка колец на шнуре у пояса (канон: счёт сбережённой воды) + нитка колец на шее у части героев. */
export function buildWaterRings(b, o, lod, rx0, rz0, y0) {
  init();
  if (lod > 1) return;
  const s = (o.seed | 0) % 4 >= 2 ? 1 : -1, a = s * 2.0 + (s > 0 ? 0.2 : -0.2);
  const x = Math.sin(a) * (rx0 + 0.03), z = Math.cos(a) * (rz0 + 0.03);
  const n = o.waterRings === true ? 5 : Math.min(8, o.waterRings | 0);
  // шнур от пояса и кольца, нанизанные вдоль него
  tube(b, [[x, y0 - 0.01, z], [x + s * 0.01, y0 - 0.1, z + 0.006], [x + s * 0.015, y0 - 0.2, z + 0.004]], 0.0032, REG.LEATHER, () => PELVIS, { seg: 4, aux: [0, 0, 0.4, 0] });
  for (let k = 0; k < n; k++) {
    const t = k / Math.max(1, n - 1), yy = y0 - 0.04 - t * 0.17;
    ringTorus(b, [x + s * (0.004 + 0.012 * t), yy, z + 0.004 + (k % 2) * 0.004], k % 2 ? [1, 0, 0.3] : [0, 0.1, 1], 0.0125, 0.0034, REG.METAL, PELVIS, lod === 0 ? 8 : 6, lod === 0 ? 4 : 3);
  }
}

/** Головная повязка (тюрбан): витки ткани над бровями с лицевым вырезом + свободный хвост на плечо. style: 'turban' | 'band'. */
export function buildWrap(b, o, lod, B) {
  init();
  const hs = B.head, N = [22, 14, 8][lod], style = o.wrapStyle || 'turban';
  const ys = style === 'band' ? [0.04, 0.056, 0.074, 0.09] : lod === 0 ? [-0.05, -0.025, 0.0, 0.025, 0.045, 0.062, 0.08, 0.1, 0.118, 0.134, 0.148, 0.16, 0.17, 0.176] : [-0.05, 0.0, 0.045, 0.1, 0.134, 0.158, 0.176];
  const th = (y) => (y < 0.0 ? 1.7 : y < 0.045 ? lerp(1.7, 0.95, (y - 0.0) / 0.045) : y < 0.07 ? lerp(0.95, 0.55, (y - 0.045) / 0.025) : y < 0.09 ? lerp(0.55, 0.0, (y - 0.07) / 0.02) : 0);
  const rings = ys.map((y, j) => {
    const [rx, rz, cz] = headRow(clamp(y, -0.12, 0.141)), t = Math.max(0, th(y)), u = y > 0.141 ? (y - 0.141) / 0.037 : 0;
    const k = y > 0.141 ? Math.sqrt(Math.max(0, 1 - u * u)) * 0.92 + 0.08 : 1;
    const bulge = style === 'band' ? 0.012 : 0.014 + 0.024 * sstep(0.0, 0.12, y) + 0.008 * Math.sin(j * 2.1);
    return ringY(HEAD_Y + y * hs, 0, cz * hs + 0.002, (rx + bulge) * hs * k, (rz + bulge + 0.006) * hs * k, N, (a) => 1 + 0.05 * Math.sin(a * 3 + y * 55) + 0.025 * Math.sin(a * 7 - y * 30), t, Math.PI * 2 - t, true);
  });
  b.loft(rings, (j, i, p) => ({ reg: (o.wrapAccent && j % 4 === 2) ? REG.ACCENT : REG.CLOTH2, aux: [0.12, 0, 0.35 + 0.5 * Math.abs(Math.sin(j * 2.3 + i * 0.5)), i * 0.4], face: [1, 0, 0, 0], sk: HEAD }), { closed: false, capEnd: style !== 'band' });
  // хвост на левое плечо
  if (style === 'turban' && lod < 2) {
    const s = (o.seed | 0) % 2 ? 1 : -1, rowsT = [], K = lod === 0 ? 7 : 4;
    for (let q = 0; q < K; q++) {
      const t = q / (K - 1), y = lerp(1.6, 1.22, t), x = s * (0.1 + t * 0.07), z = -0.02 - 0.06 * t - 0.02 * Math.sin(t * 5), w = 0.04 + 0.012 * t;
      rowsT.push([[x - w, y, z], [x, y, z + 0.012], [x + w, y, z]]);
    }
    b.loft(rowsT, (j, i, p) => ({ reg: REG.CLOTH2, aux: [t01(j, K) ** 1.5 * 0.5, 0, 0.55, i * 0.3], face: [1, 0, 0, 0], sk: skY(p[1], [[1.62, BI.head], [1.5, BI.neck], [1.43, BI.chest]]) }), { closed: false });
  }
}

/** Поклажа за спиной/на бедре. kind: 'jug' | 'bundle' | 'basket' | 'skin' | 'satchel'. */
export function buildCarry(b, o, lod, torso) {
  init();
  const kind = o.carry; if (!kind) return;
  const s = (o.seed | 0) % 2 ? 1 : -1, N = [14, 9, 6][lod];
  const zBack = -0.215;
  const strap = (pts, w = 0.014) => tube(b, pts, w, REG.LEATHER, (y) => skY(y, TORSO_SK), { seg: lod === 0 ? 5 : 4, aux: [0, 0, 0.45, 0] });
  if (kind === 'jug') {
    // кувшин на спине в перевязи: профиль «пузатый, с узким горлом и ручками»
    const prof = [[0.0, 0.0], [0.07, 0.0], [0.115, 0.045], [0.135, 0.11], [0.12, 0.19], [0.085, 0.25], [0.052, 0.285], [0.05, 0.31], [0.062, 0.33], [0.0, 0.332]];
    const rings = prof.map(([r, h]) => ringY(0.74 + h, 0.02 * s, zBack - 0.03, r, r * 0.96, N, null));
    b.loft(rings.slice(1), (j, i, p) => ({ reg: REG.LEATHER, aux: [0, 0, 0.55, i / N], sk: SPINE }), { capStart: false, capEnd: false });
    if (lod < 2) for (const q of [-1, 1]) tube(b, [[q * 0.05, 1.0, zBack - 0.03], [q * 0.115, 0.975, zBack - 0.03], [q * 0.125, 0.925, zBack - 0.03], [q * 0.085, 0.89, zBack - 0.03]], 0.008, REG.LEATHER, () => SPINE, { seg: 4, aux: [0, 0, 0.4, 0] });
    strap([[0.1 * s, 1.43, -0.06], [0.055 * s, 1.3, 0.14], [-0.04 * s, 1.14, 0.16], [-0.14 * s, 1.0, 0.1], [-0.1 * s, 0.97, zBack + 0.03], [0.02 * s, 1.0, zBack]], 0.013);
  } else if (kind === 'bundle') {
    // скатка + узел на спине, лямки через плечи
    const rowsB = [-0.26, -0.2, -0.1, 0.1, 0.2, 0.26].map((x, k) => { const r = k === 0 || k === 5 ? 0.035 : 0.068; const pts = []; const NN = 8; for (let i = 0; i < NN; i++) { const a = (i / NN) * Math.PI * 2; pts.push([x, 1.35 + Math.cos(a) * r, zBack - 0.01 + Math.sin(a) * r]); } return pts; });
    b.loft(rowsB, (j, i, p) => ({ reg: REG.CLOTH2, aux: [0, 0, 0.5 + 0.4 * Math.sin(i), i * 0.3], face: [0, 0, 0, 0], sk: CHEST }), { capStart: true, capEnd: true });
    for (const x of [-0.13, 0.13]) tube(b, [[x, 1.35 + 0.07, zBack - 0.01], [x, 1.35, zBack - 0.01 + 0.07], [x, 1.35 - 0.07, zBack - 0.01], [x, 1.35, zBack - 0.01 - 0.07], [x, 1.35 + 0.07, zBack - 0.01]], 0.007, REG.ACCENT, () => CHEST, { seg: 4, aux: [0, 0, 0.3, 0] });
    if (lod < 2) ellipsoid(b, [0, 1.06, zBack - 0.03], [0.15, 0.2, 0.1], REG.LEATHER, SPINE, { u: N, v: 6, aux: [0, 0, 0.5, 0] });
    for (const q of [-1, 1]) strap([[q * 0.1, 1.44, -0.07], [q * 0.12, 1.3, 0.12], [q * 0.1, 1.15, 0.16], [q * 0.09, 1.1, zBack + 0.02]], 0.012);
  } else if (kind === 'basket') {
    // плетёная корзина за спиной (конус), крышка-ткань, лямки
    const rowsK = [[0.0, 0.13], [0.07, 0.15], [0.17, 0.175], [0.27, 0.195], [0.34, 0.2]].map(([h, r]) => ringY(0.92 + h, 0, zBack - 0.04, r * 1.1, r * 0.8, N + 4, (a) => 1 + 0.03 * Math.sin(a * 14 + h * 40)));
    b.loft(rowsK, (j, i, p) => ({ reg: REG.LEATHER, aux: [0, 0, 0.45 + 0.4 * ((i + j) % 2), i / N], sk: SPINE }), { capStart: true });
    tube(b, ringY(1.26, 0, zBack - 0.04, 0.22, 0.165, N + 4).concat([ringY(1.26, 0, zBack - 0.04, 0.22, 0.165, N + 4)[0]]), 0.011, REG.LEATHER, () => SPINE, { seg: 4, aux: [0, 0, 0.3, 0] });
    if (lod < 2) ellipsoid(b, [0, 1.29, zBack - 0.04], [0.19, 0.06, 0.13], REG.CLOTH2, SPINE, { u: N, v: 4, aux: [0, 0, 0.55, 0] });
    for (const q of [-1, 1]) strap([[q * 0.1, 1.44, -0.07], [q * 0.13, 1.3, 0.12], [q * 0.12, 1.12, 0.14], [q * 0.17, 1.0, zBack + 0.01]], 0.013);
  } else if (kind === 'skin') {
    // бурдюк на бедре
    const cx = 0.27 * s;
    ellipsoid(b, [cx, 0.8, 0.02], [0.065, 0.15, 0.075], REG.LEATHER, PELVIS, { u: N, v: 7, rot: [0, 0, -0.12 * s], aux: [0, 0, 0.55, 0] });
    if (lod < 2) { ellipsoid(b, [cx - 0.015 * s, 0.97, 0.02], [0.016, 0.03, 0.016], REG.METAL, PELVIS, { u: 6, v: 4, aux: [0, 0, 0.1, 0] }); strap([[0.09 * s, 1.0, 0.1], [0.2 * s, 1.0, 0.1], [cx, 0.95, 0.05]], 0.01); }
  } else if (kind === 'satchel') {
    // сумка через плечо
    strap([[0.12 * s, 1.44, -0.05], [0.04 * s, 1.3, 0.15], [-0.1 * s, 1.1, 0.17], [-0.24 * s, 0.9, 0.08]], 0.014);
    ellipsoid(b, [-0.255 * s, 0.84, 0.06], [0.05, 0.1, 0.12], REG.LEATHER, PELVIS, { u: N, v: 6, aux: [0, 0, 0.5, 0] });
    if (lod < 2) ellipsoid(b, [-0.265 * s, 0.9, 0.06], [0.055, 0.045, 0.125], REG.LEATHER, PELVIS, { u: N, v: 4, aux: [0, 0, 0.4, 0] });
  }
}
