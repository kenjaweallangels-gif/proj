// Процедурная геометрия человека: тело, дистикомб, одежда — одним слитым скин-мешем на фигуру (2 меша: тело и ткань).
// Все координаты — «абсолютные» в позе привязки (рост 1.75 м, +Z вперёд, +X — левая сторона фигуры = 'R' в именах API).
// Атрибуты: region (материал), aux = (ребро-координата, сила рёбер, пыль/складка, угол для швов), skinIndex/skinWeight.
import * as THREE from 'three';
import { faceParams, buildHeadHi, buildHair, buildBeard } from './char_face.js';
import { rng } from '../core/util.js';

// ---------------------------------------------------------------------------------------------- кости ----
export const BONE_NAMES = ['pelvis', 'spine', 'chest', 'neck', 'head'];
for (const s of ['L', 'R']) for (const n of ['sh', 'el', 'hand', 'hip', 'kn', 'foot', 'toe']) BONE_NAMES.push(n + s);
const SB = { L: 5, R: 12 };
export const BI = { pelvis: 0, spine: 1, chest: 2, neck: 3, head: 4 };
for (const s of ['L', 'R']) ['sh', 'el', 'hand', 'hip', 'kn', 'foot', 'toe'].forEach((n, i) => { BI[n + s] = SB[s] + i; });
/** Позиции суставов в позе привязки (абсолют). side: L=-1 (x<0), R=+1. */
export const REST = {
  pelvis: [0, 0.92, 0], spine: [0, 0.92, 0], chest: [0, 1.22, 0], neck: [0, 1.5, 0], head: [0, 1.63, 0],
  sh: [0.185, 1.43, 0], el: [0.185, 1.13, 0], hand: [0.185, 0.87, 0], hip: [0.09, 0.92, 0], kn: [0.09, 0.48, 0], foot: [0.09, 0.08, 0], toe: [0.09, 0.035, 0.13],
};
export const L1 = 0.44, L2 = 0.4; // бедро, голень
export const REG = { SUIT: 0, SKIN: 1, CLOTH: 2, ACCENT: 3, LEATHER: 4, METAL: 5, HAIR: 6, SCLERA: 7, IRIS: 8, LIP: 9, SOLE: 10, LINING: 11, CLOTH2: 12, TOOTH: 13, MOUTH: 14, FRINGE: 15, HOSE: 16 };

// ---------------------------------------------------------------------------------------------- билдер ----
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/** Веса кожи по высоте: stops [[y, bone],...] по убыванию y; между соседними костями линейно. */
export function skY(y, stops) {
  if (y >= stops[0][0]) return [stops[0][1], 1, 0, 0];
  for (let i = 1; i < stops.length; i++) {
    if (y >= stops[i][0]) {
      const [ya, ba] = stops[i - 1], [yb, bb] = stops[i];
      const t = (ya - y) / (ya - yb || 1);
      return ba === bb ? [ba, 1, 0, 0] : [ba, 1 - t, bb, t];
    }
  }
  const l = stops[stops.length - 1];
  return [l[1], 1, 0, 0];
}

export class GB {
  constructor() { this.p = []; this.reg = []; this.aux = []; this.sk = []; this.idx = []; this.fc = []; this.nm = []; }
  get n() { return this.reg.length; }
  vert(x, y, z, reg, aux, sk, fc, nrm) {
    this.nm.push(nrm || null);
    this.p.push(x, y, z); this.reg.push(reg); this.aux.push(aux[0], aux[1], aux[2], aux[3]);
    if (fc) this.fc.push(fc[0], fc[1], fc[2], fc[3]); else this.fc.push(0, 0, 0, 0);
    this.sk.push(sk[0], sk[1], sk[2] || 0, sk[3] || 0);
    return this.reg.length - 1;
  }
  /**
   * Лофт по кольцам. rings: массив массивов точек [x,y,z] одинаковой длины (по возрастанию «вверх»).
   * meta(j, i, p) → {reg, aux:[4], sk:[4]}. closed — замыкать по окружности.
   */
  loft(rings, meta, o = {}) {
    const R = rings.length, M = rings[0].length, closed = o.closed !== false;
    const base = this.n;
    for (let j = 0; j < R; j++) for (let i = 0; i < M; i++) {
      const p = rings[j][i], m = meta(j, i, p);
      this.vert(p[0], p[1], p[2], m.reg, m.aux, m.sk, m.face, m.nrm);
    }
    const cols = closed ? M : M - 1;
    const at = (j, i) => base + j * M + (i % M);
    // Ориентация граней определяется геометрически: нормаль первого квада должна смотреть от оси лофта наружу.
    const ctr = (ring) => { let x = 0, y = 0, z = 0; for (const p of ring) { x += p[0]; y += p[1]; z += p[2]; } return [x / ring.length, y / ring.length, z / ring.length]; };
    const jm = Math.max(0, Math.min(R - 2, (R - 1) >> 1)), cm = ctr(rings[jm]);
    const pa = rings[jm][0], pb = rings[jm][1 % M], pc = rings[jm + 1][0];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const out = [pa[0] - cm[0], pa[1] - cm[1], pa[2] - cm[2]];
    const flip = (nn[0] * out[0] + nn[1] * out[1] + nn[2] * out[2] < 0) !== !!o.flip;
    for (let j = 0; j < R - 1; j++) for (let i = 0; i < cols; i++) {
      const a = at(j, i), b = at(j, i + 1), c = at(j + 1, i), d = at(j + 1, i + 1);
      if (flip) this.idx.push(a, c, b, b, c, d); else this.idx.push(a, b, c, b, d, c);
    }
    const c0 = ctr(rings[0]), c1 = ctr(rings[R - 1]);
    const dir = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
    const cap = (j, sign) => {
      const ring = rings[j], c = ctr(ring);
      const m = meta(j, 0, ring[0]);
      const cv = this.vert(c[0], c[1], c[2], m.reg, m.aux, m.sk, m.face);
      const vs = [];
      for (let i = 0; i < M; i++) vs.push(this.vert(ring[i][0], ring[i][1], ring[i][2], m.reg, m.aux, m.sk, m.face));
      const A = ring[0], Bp = ring[1 % M];
      const u1 = [A[0] - c[0], A[1] - c[1], A[2] - c[2]], u2 = [Bp[0] - c[0], Bp[1] - c[1], Bp[2] - c[2]];
      const n = [u1[1] * u2[2] - u1[2] * u2[1], u1[2] * u2[0] - u1[0] * u2[2], u1[0] * u2[1] - u1[1] * u2[0]];
      const ok = (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]) * sign > 0;
      for (let i = 0; i < cols; i++) {
        const a = vs[i], b = vs[(i + 1) % M];
        if (ok) this.idx.push(cv, a, b); else this.idx.push(cv, b, a);
      }
    };
    if (o.capStart) cap(0, -1);
    if (o.capEnd) cap(R - 1, 1);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('region', new THREE.Float32BufferAttribute(this.reg, 1));
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.aux, 4));
    g.setAttribute('face', new THREE.Float32BufferAttribute(this.fc, 4));
    const si = [], sw = [];
    for (let i = 0; i < this.sk.length; i += 4) { si.push(this.sk[i], this.sk[i + 2], 0, 0); sw.push(this.sk[i + 1], this.sk[i + 3], 0, 0); }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(this.n > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals();
    // Сварка нормалей в совпадающих вершинах одного материала (шов окружности, стыки лофтов) — без «ступенек» освещения.
    {
      const nrm = g.attributes.normal.array, pos = this.p, map = new Map(), n = this.n;
      const keyOf = (i) => `${Math.round(pos[i * 3] * 5000)},${Math.round(pos[i * 3 + 1] * 5000)},${Math.round(pos[i * 3 + 2] * 5000)},${this.reg[i]}`;
      const keys = new Array(n);
      for (let i = 0; i < n; i++) {
        const k = keys[i] = keyOf(i);
        let a = map.get(k); if (!a) { a = [0, 0, 0]; map.set(k, a); }
        a[0] += nrm[i * 3]; a[1] += nrm[i * 3 + 1]; a[2] += nrm[i * 3 + 2];
      }
      for (let i = 0; i < n; i++) {
        const a = map.get(keys[i]), l = Math.hypot(a[0], a[1], a[2]) || 1;
        nrm[i * 3] = a[0] / l; nrm[i * 3 + 1] = a[1] / l; nrm[i * 3 + 2] = a[2] / l;
      }
    }
    { const nrm = g.attributes.normal.array; for (let i = 0; i < this.n; i++) { const v = this.nm[i]; if (v) { nrm[i * 3] = v[0]; nrm[i * 3 + 1] = v[1]; nrm[i * 3 + 2] = v[2]; } } }
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.45);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-1.2, -0.1, -1.2), new THREE.Vector3(1.2, 2.3, 1.2));
    return g;
  }
}
// В skinIndex пары (idx, w) хранятся как sk=[i0,w0,i1,w1] → разворачиваем: четыре индекса/веса. Упрощение: используем 2 влияния.
// (build() фильтрует чётные/нечётные элементы: [i0,i1,0,0] и [w0,w1,0,0] — см. vert(): sk хранится как 4 числа.)

// Кольцо в плоскости XZ (ось Y). a=0 — вперёд (+Z), a растёт к +X.
export function ringY(y, cx, cz, rx, rz, N, fn, a0 = 0, a1 = Math.PI * 2, open = false) {
  const pts = [], M = open ? N + 1 : N;
  for (let i = 0; i < M; i++) {
    const a = a0 + (a1 - a0) * (i / (open ? N : N));
    const m = fn ? fn(a, y) : 1;
    pts.push([cx + Math.sin(a) * rx * m, y, cz + Math.cos(a) * rz * m]);
  }
  return pts;
}
// Кольцо в плоскости XY (ось Z) для стопы. a=0 — вверх (+Y).
function ringZ(z, cx, cy, rx, ry, N) {
  const pts = [];
  for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; pts.push([cx + Math.sin(a) * rx, cy + Math.cos(a) * ry, z]); }
  return pts;
}
function interp(table, y, k) {
  // table: [[y, v1, v2, ...]] по возрастанию y → линейно.
  if (y <= table[0][0]) return table[0][k];
  for (let i = 1; i < table.length; i++) if (y <= table[i][0]) { const t = (y - table[i - 1][0]) / (table[i][0] - table[i - 1][0]); return lerp(table[i - 1][k], table[i][k], t); }
  return table[table.length - 1][k];
}

const rotQ = new THREE.Quaternion(), rotE = new THREE.Euler(), tv = new THREE.Vector3();

// ----------------------------------------------------------------------------------------- примитивы ----
/** Эллипсоид. rot — Euler [x,y,z]. */
export function ellipsoid(b, c, r, reg, sk, o = {}) {
  const U = o.u ?? 8, V = o.v ?? 6, rot = o.rot, aux = o.aux || [c[1], 0, 0, 0];
  if (rot) { rotE.set(rot[0], rot[1], rot[2]); rotQ.setFromEuler(rotE); }
  const rings = [];
  for (let k = 0; k <= V; k++) {
    const ph = -Math.PI / 2 + (Math.PI * k) / V, cy = Math.cos(ph), sy = Math.sin(ph), pts = [];
    for (let i = 0; i < U; i++) {
      const a = (i / U) * Math.PI * 2;
      tv.set(Math.sin(a) * cy * r[0], sy * r[1], Math.cos(a) * cy * r[2]);
      if (rot) tv.applyQuaternion(rotQ);
      pts.push([c[0] + tv.x, c[1] + tv.y, c[2] + tv.z]);
    }
    rings.push(pts);
  }
  b.loft(rings, (j) => ({ reg, aux, sk: typeof sk === 'function' ? sk(rings[j][0][1]) : sk }));
}

/** Трубка по ломаной с радиусом r(t). Параллельный перенос кадра. */
export function tube(b, pts, rad, reg, skFn, o = {}) {
  const N = o.seg ?? 6, P0 = pts.map((p) => new THREE.Vector3(...p)), P = P0.filter((p, i) => i === 0 || p.distanceTo(P0[i - 1]) > 2e-3), n = P.length;
  if (n < 2) return;
  const rings = [], tan = [];
  for (let i = 0; i < n; i++) tan.push(P[Math.min(n - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize());
  let up = Math.abs(tan[0].y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  let nrm = new THREE.Vector3().crossVectors(tan[0], up).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) { nrm.sub(tan[i].clone().multiplyScalar(nrm.dot(tan[i]))).normalize(); }
    const bin = new THREE.Vector3().crossVectors(tan[i], nrm).normalize();
    const r = typeof rad === 'function' ? rad(i / (n - 1)) : rad, ring = [];
    for (let k = 0; k < N; k++) { const a = (k / N) * Math.PI * 2; ring.push([P[i].x + (nrm.x * Math.cos(a) + bin.x * Math.sin(a)) * r, P[i].y + (nrm.y * Math.cos(a) + bin.y * Math.sin(a)) * r, P[i].z + (nrm.z * Math.cos(a) + bin.z * Math.sin(a)) * r]); }
    rings.push(ring);
  }
  const aux = o.aux || [0, 0, 0.2, 0];
  b.loft(rings, (j, i, p) => ({ reg, aux: o.auxFn ? o.auxFn(p) : [aux[0], aux[1], aux[2], aux[3]], sk: skFn(p[1], p) }), { capStart: !o.noCaps, capEnd: !o.noCaps });
}

// ---------------------------------------------------------------------------------------------- тело ----
// Параметры телосложения: ширины в плечах/талии/бёдрах, глубина груди.
export const BUILDS = {
  m: { sh: 1, chest: 1, waist: 1, hip: 1, depth: 1, bust: 0, limb: 1, head: 1 },
  f: { sh: 0.9, chest: 0.93, waist: 0.88, hip: 1.1, depth: 0.95, bust: 1, limb: 0.9, head: 0.96 },
  c: { sh: 0.85, chest: 0.9, waist: 1, hip: 0.95, depth: 0.95, bust: 0, limb: 0.9, head: 1.28 },
  a: { sh: 1.08, chest: 1.0, waist: 0.92, hip: 0.98, depth: 1, bust: 0.2, limb: 1, head: 0.98 },
  e: { sh: 1.06, chest: 1.1, waist: 1.15, hip: 1.06, depth: 1.06, bust: 0, limb: 1.02, head: 1 },
};
const TORSO_BASE = [ // y, rx, rz, cz
  [0.78, 0.148, 0.095, 0], [0.92, 0.158, 0.1, 0], [1.02, 0.138, 0.092, 0], [1.12, 0.146, 0.097, 0.004],
  [1.22, 0.162, 0.112, 0.008], [1.32, 0.17, 0.108, 0.005], [1.4, 0.165, 0.092, -0.002], [1.45, 0.122, 0.076, -0.005],
  [1.485, 0.064, 0.062, -0.006], [1.52, 0.052, 0.052, -0.002], [1.6, 0.047, 0.05, 0.004],
];
export function torsoTable(build) {
  const B = BUILDS[build] || BUILDS.m;
  return TORSO_BASE.map(([y, rx, rz, cz]) => {
    const w = y < 0.85 ? B.hip : y < 0.97 ? B.hip : y < 1.07 ? B.waist : y < 1.3 ? B.chest : y < 1.43 ? B.sh : 1;
    return [y, rx * w * (y > 1.47 ? 1 : 1), rz * B.depth * (y > 1.15 && y < 1.32 ? 1 + B.bust * 0.18 : 1), cz + (y > 1.15 && y < 1.32 ? B.bust * 0.012 : 0)];
  });
}
const TORSO_SK = [[1.52, BI.neck], [1.43, BI.chest], [1.15, BI.chest], [1.0, BI.spine], [0.9, BI.pelvis]];

/** Рёбра: aux.x — координата вдоль оси (м), aux.y — сила. */
const ribs = (y, s = 1) => [y, s, 0, 0];
const bump = (y, c, w) => Math.exp(-(((y - c) / w) ** 2));
// зоны гофры: на суставах — складчатая «гармошка», на сегментах — гладкие панели (видно конструкцию)
const zLeg = (y) => 0.16 + 0.84 * Math.max(bump(y, 0.49, 0.075), bump(y, 0.16, 0.05), bump(y, 0.93, 0.06));
const zArm = (y) => 0.16 + 0.84 * Math.max(bump(y, 1.13, 0.07), bump(y, 0.9, 0.045), bump(y, 1.42, 0.05));
const zTor = (y) => 0.2 + 0.8 * Math.max(bump(y, 1.02, 0.07), bump(y, 1.46, 0.04), bump(y, 0.8, 0.05));
/** Ремешок вокруг конечности с пряжкой. */
function band(b, cx, cz, y, rx, rz, h, reg, stops, N, ang) {
  const R = (yy, d) => ringY(yy, cx, cz, rx + d, rz + d, N);
  b.loft([R(y - h / 2, 0.0008), R(y - h / 2, 0.0046), R(y + h / 2, 0.0046), R(y + h / 2, 0.0008)], (j, i, p) => ({ reg, aux: [0, 0, 0.45, 0], sk: skY(p[1], stops) }));
  const x = cx + Math.sin(ang) * (rx + 0.0065), z = cz + Math.cos(ang) * (rz + 0.0065);
  ellipsoid(b, [x, y, z], [0.0085, h * 0.62, 0.0035], REG.METAL, skY(y, stops), { u: 6, v: 4, rot: [0, ang, 0], aux: [0, 0, 0.1, 0] });
}
/** Гофрированный шланг по сглаженной траектории; зажимы на концах. */
export function hose(b, ctrl, r0, skFn, o = {}) {
  const curve = new THREE.CatmullRomCurve3(ctrl.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const L = curve.getLength(), n = Math.max(6, Math.round(L / (o.step ?? 0.0055)));
  const pts = curve.getSpacedPoints(n).map((v) => [v.x, v.y, v.z]);
  const period = o.period ?? 0.011;
  tube(b, pts, (t) => r0 * (0.86 + 0.2 * Math.abs(Math.sin((t * L / period) * Math.PI))) * (t < 0.03 || t > 0.97 ? 0.92 : 1), o.reg ?? REG.HOSE, skFn, { seg: o.seg ?? 6, aux: [0, 0, 0.1, 0] });
  if (o.clamps !== false) for (const t of [0.015, 0.985]) { const p = curve.getPoint(t), q = curve.getPoint(t < 0.5 ? t + 0.02 : t - 0.02); tube(b, [[p.x, p.y, p.z], [(p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2]], r0 * 1.32, REG.METAL, skFn, { seg: 6, aux: [0, 0, 0.1, 0] }); }
}

export function buildBody(o, lod) {
  const b = new GB();
  const B = BUILDS[o.build] || BUILDS.m;
  const N = [16, 10, 6][lod], hiRibs = lod === 0;
  const suitReg = REG.SUIT;
  const torso = torsoTable(o.build);
  const bare = !!o.bare; // без дистикомба (жрица): кожа
  const bodyReg = bare ? REG.SKIN : suitReg;
  const ribAmt = bare ? 0 : 1;

  // ---- торс (дистикомб) с рёбрами ---
  {
    const ys = []; const steps = [10, 6, 4][lod];
    for (let k = 0; k < torso.length - 1; k++) for (let s = 0; s < (k < torso.length - 2 ? Math.max(1, Math.round(steps / 5)) : 2); s++) { const t = s / Math.max(1, Math.round(steps / 5)); ys.push(lerp(torso[k][0], torso[k + 1][0], t)); }
    ys.push(torso[torso.length - 1][0]);
    const rings = ys.map((y) => {
      const rx = interp(torso, y, 1), rz = interp(torso, y, 2), cz = interp(torso, y, 3);
      const rib = hiRibs && !bare ? (a) => 1 + 0.006 * zTor(y) * Math.sin(y * 150) : null;
      return ringY(y, 0, cz, rx, rz, N, rib);
    });
    b.loft(rings, (j, i, p) => ({ reg: p[1] > 1.5 ? REG.SKIN : bodyReg, aux: [ribs(p[1])[0], p[1] > 1.5 ? 0 : ribAmt * zTor(p[1]), 0.15 * (1 - Math.abs(Math.cos((i / N) * 6.2832))), (i / N)], sk: skY(p[1], TORSO_SK) }), { capStart: true });
  }
  // воротник-«шейный затвор»
  if (!bare) {
    const rings = [1.44, 1.47, 1.5, 1.53].map((y, k) => ringY(y, 0, 0.0, [0.075, 0.07, 0.062, 0.06][k], [0.07, 0.066, 0.06, 0.058][k], N));
    b.loft(rings, (j, i, p) => ({ reg: REG.SUIT, aux: [p[1], 1, 0.3, i / N], sk: skY(p[1], TORSO_SK) }), { capEnd: false });
    // верхняя кромка валиком
    const rim = ringY(1.535, 0, 0.0, 0.058, 0.057, N);
    b.loft([ringY(1.53, 0, 0, 0.06, 0.058, N), rim], (j, i, p) => ({ reg: REG.ACCENT, aux: [p[1], 0, 0.2, 0], sk: skY(p[1], TORSO_SK) }));
  }
  // шея (кожа) — внутри затвора/головы
  b.loft([1.5, 1.56, 1.62].map((y, k) => ringY(y, 0, 0.004 * k, 0.046, 0.048, N)), (j, i, p) => ({ reg: REG.SKIN, aux: [0, 0, 0, 0], sk: [BI.neck, 1] }));

  // ---- плечи (дельты) ----
  for (const s of [-1, 1]) {
    const sd = s < 0 ? 'L' : 'R';
    ellipsoid(b, [0.19 * s * B.sh, 1.405, 0], [0.052, 0.058, 0.05], bodyReg, [BI['sh' + sd], 1], { u: [10, 7, 5][lod], v: [6, 5, 3][lod], aux: [1.4, ribAmt, 0.1, 0] });
  }

  // ---- таз/бёдра/ноги ---
  const legRows = [ // y, rx, rz, cz  (центр x = ±0.09)
    [0.09, 0.034, 0.038, 0], [0.16, 0.039, 0.043, 0], [0.26, 0.048, 0.056, -0.008], [0.34, 0.05, 0.057, -0.006], [0.42, 0.05, 0.056, 0], [0.47, 0.054, 0.06, 0.004],
    [0.52, 0.057, 0.062, 0.006], [0.6, 0.066, 0.07, 0.004], [0.7, 0.078, 0.082, 0.004], [0.8, 0.086, 0.09, 0.002], [0.9, 0.09, 0.095, 0], [0.97, 0.088, 0.095, 0],
  ];
  const legSK = (side) => [[1.0, BI['hip' + side]], [0.55, BI['hip' + side]], [0.44, BI['kn' + side]], [0.16, BI['kn' + side]], [0.1, BI['foot' + side]]];
  const wear = o.wear ?? 0.4;
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R', cx = 0.09 * s, stops = legSK(side);
    const step = [0.6, 0.12, 0][lod]; // доля дополнительных подразбиений
    const ys = []; for (let k = 0; k < legRows.length - 1; k++) { ys.push(legRows[k][0]); if (lod === 0) ys.push((legRows[k][0] + legRows[k + 1][0]) / 2); }
    ys.push(legRows[legRows.length - 1][0]);
    const useRows = lod === 2 ? [0, 3, 6, 9, 11].map((i) => legRows[i][0]) : lod === 1 ? legRows.filter((_, i) => i % 2 === 0 || i === legRows.length - 1).map((r) => r[0]) : ys;
    const rings = useRows.map((y) => {
      const rx = interp(legRows, y, 1) * B.limb, rz = interp(legRows, y, 2) * B.limb, cz = interp(legRows, y, 3);
      const knee = Math.exp(-(((y - 0.49) / 0.03) ** 2)) * 0.006;
      return ringY(y, cx, cz + knee * 0.5, rx, rz, N, hiRibs && !bare ? () => 1 + 0.006 * zLeg(y) * Math.sin(y * 160) : null);
    });
    b.loft(rings, (j, i, p) => ({ reg: bodyReg, aux: [p[1], ribAmt * zLeg(p[1]), 0.15 + 0.5 * Math.exp(-(((p[1] - 0.49) / 0.05) ** 2)), i / N], sk: skY(p[1], stops) }), { capEnd: false });
    // ремни: бедро, голень над сапогом
    if (lod < 2 && !bare) {
      band(b, cx, 0.0, 0.69, 0.083 * B.limb, 0.088 * B.limb, 0.03, REG.LEATHER, stops, 14, s * 0.9);
      band(b, cx, 0.0, 0.39, 0.052 * B.limb, 0.057 * B.limb, 0.022, REG.LEATHER, stops, 12, s * 0.9);
    }
    // наколенник-заплата
    if (lod < 2) ellipsoid(b, [cx, 0.5, 0.064 * B.limb], [0.044, 0.05, 0.016], REG.LEATHER, [BI['kn' + side], 1], { u: 8, v: 5, aux: [0.5, 0, 0.5, 0] });
    // карман-«ловушка» на бедре + трубка
    if (lod < 2 && !bare) {
      ellipsoid(b, [cx + s * 0.065, 0.74, 0.045], [0.026, 0.085, 0.05], REG.LEATHER, [BI['hip' + side], 1], { u: 8, v: 6, rot: [0, 0, s * 0.06], aux: [0.74, 0, 0.6, 0] });
      ellipsoid(b, [cx + s * 0.068, 0.79, 0.07], [0.02, 0.012, 0.03], REG.METAL, [BI['hip' + side], 1], { u: 6, v: 4, aux: [0.79, 0, 0.1, 0] });
    }
  }
  // таз-мост между ногами
  b.loft([0.78, 0.86, 0.94].map((y, k) => ringY(y, 0, 0, [0.12, 0.155, 0.16][k] * B.hip, [0.085, 0.098, 0.1][k], N)), (j, i, p) => ({ reg: bodyReg, aux: [p[1], ribAmt, 0.2, i / N], sk: skY(p[1], [[0.95, BI.pelvis], [0.7, BI.pelvis]]) }));

  // ---- сапоги ----
  if (!o.barefoot) for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R', cx = 0.09 * s;
    const shaftStops = [[0.34, BI['kn' + side]], [0.16, BI['kn' + side]], [0.1, BI['foot' + side]]];
    const sh = [0.33, 0.30, 0.22, 0.14, 0.08].map((y, k) => ringY(y, cx, 0.0, [0.062, 0.058, 0.054, 0.052, 0.05][k] * B.limb, [0.066, 0.062, 0.058, 0.058, 0.058][k] * B.limb, N));
    b.loft(sh, (j, i, p) => ({ reg: REG.LEATHER, aux: [p[1] * 2.2, 0, 0.45, i / N], sk: skY(p[1], shaftStops) }), { capStart: false });
    // манжета
    b.loft([ringY(0.345, cx, 0, 0.056, 0.06, N), ringY(0.33, cx, 0, 0.066, 0.07, N), ringY(0.31, cx, 0, 0.064, 0.068, N)], (j, i, p) => ({ reg: REG.ACCENT, aux: [0, 0, 0.3, 0], sk: [BI['kn' + side], 1] }));
    // стопа (лофт вдоль Z)
    const fz = [[-0.092, 0.058, 0.03, 0.045], [-0.07, 0.066, 0.042, 0.064], [-0.01, 0.052, 0.047, 0.062], [0.06, 0.04, 0.05, 0.046], [0.13, 0.034, 0.047, 0.036], [0.19, 0.03, 0.037, 0.03], [0.232, 0.026, 0.02, 0.018]];
    const useFz = lod === 2 ? [fz[0], fz[2], fz[4], fz[6]] : fz;
    const rings = useFz.map(([z, cy, rx, ry]) => ringZ(z, cx, cy, rx * B.limb, ry, [10, 8, 5][lod]));
    const footSk = (z) => (z > 0.1 ? [BI['foot' + side], 1 - sstep(0.1, 0.17, z), BI['toe' + side], sstep(0.1, 0.17, z)] : [BI['foot' + side], 1]);
    b.loft(rings, (j, i, p) => ({ reg: REG.LEATHER, aux: [p[2] * 2, 0, 0.5, 0], sk: footSk(p[2]) }), { capStart: true, capEnd: true });
    // подошва
    const sole = [[-0.098, 0.016, 0.032], [-0.04, 0.012, 0.047], [0.08, 0.012, 0.05], [0.2, 0.012, 0.034], [0.238, 0.014, 0.022]];
    b.loft((lod === 2 ? [sole[0], sole[2], sole[4]] : sole).map(([z, cy, rx]) => ringZ(z, cx, cy, rx * B.limb, 0.014, [10, 6, 4][lod])), (j, i, p) => ({ reg: REG.SOLE, aux: [0, 0, 0.7, 0], sk: footSk(p[2]) }), { capStart: true, capEnd: true });
    if (lod < 2) {
      // ремни голенища, мысок, каблук-ступень
      band(b, cx, 0.0, 0.25, 0.057 * B.limb, 0.062 * B.limb, 0.02, REG.LEATHER, shaftStops, 12, s * 0.8);
      band(b, cx, 0.0, 0.19, 0.053 * B.limb, 0.059 * B.limb, 0.018, REG.LEATHER, shaftStops, 12, s * 0.8);
      ellipsoid(b, [cx, 0.052, 0.185], [0.034 * B.limb, 0.026, 0.05], REG.LEATHER, [BI['foot' + side], 0.3, BI['toe' + side], 0.7], { u: 10, v: 6, aux: [0, 0, 0.6, 0] });
      ellipsoid(b, [cx, 0.014, -0.058], [0.04 * B.limb, 0.016, 0.04], REG.SOLE, [BI['foot' + side], 1], { u: 8, v: 5, aux: [0, 0, 0.7, 0] });
    }
    // каблучный насос
    if (lod < 2) ellipsoid(b, [cx, 0.1, -0.094], [0.024, 0.034, 0.018], REG.METAL, [BI['foot' + side], 1], { u: 8, v: 5, aux: [0, 0, 0.2, 0] });
  } else for (const s of [-1, 1]) {
    // босые ступни
    const side = s < 0 ? 'L' : 'R', cx = 0.09 * s;
    const fz = [[-0.07, 0.05, 0.026, 0.04], [-0.02, 0.05, 0.036, 0.05], [0.06, 0.035, 0.042, 0.034], [0.15, 0.022, 0.044, 0.02], [0.2, 0.014, 0.034, 0.012]];
    b.loft(fz.map(([z, cy, rx, ry]) => ringZ(z, cx, cy, rx, ry, [10, 7, 5][lod])), (j, i, p) => ({ reg: REG.SKIN, aux: [0, 0, 0, 0], sk: p[2] > 0.1 ? [BI['foot' + side], 0.4, BI['toe' + side], 0.6] : [BI['foot' + side], 1] }), { capStart: true, capEnd: true });
  }

  // ---- руки ----
  const armRows = [ // y, rx, rz, cz
    [0.87, 0.027, 0.03, 0], [0.93, 0.031, 0.034, 0], [1.0, 0.037, 0.04, 0.002], [1.07, 0.039, 0.041, 0], [1.13, 0.036, 0.038, 0],
    [1.2, 0.038, 0.04, 0.003], [1.29, 0.043, 0.046, 0.005], [1.37, 0.047, 0.05, 0.002], [1.44, 0.05, 0.05, 0],
  ];
  const gloves = o.gloves !== false && !bare;
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R', cx = 0.19 * s * B.sh;
    const stops = [[1.46, BI['sh' + side]], [1.2, BI['sh' + side]], [1.1, BI['el' + side]], [0.92, BI['el' + side]], [0.86, BI['hand' + side]]];
    const useRows = lod === 2 ? [0, 3, 5, 8].map((i) => armRows[i]) : lod === 1 ? armRows.filter((_, i) => i % 2 === 0) : armRows;
    const rings = useRows.map(([y]) => { const rx = interp(armRows, y, 1) * B.limb, rz = interp(armRows, y, 2) * B.limb, cz = interp(armRows, y, 3); return ringY(y, cx, cz, rx, rz, [12, 8, 5][lod], hiRibs && !bare ? () => 1 + 0.006 * zArm(y) * Math.sin(y * 150) : null); });
    b.loft(rings, (j, i, p) => ({ reg: bodyReg, aux: [p[1], ribAmt * zArm(p[1]), 0.12 + 0.5 * Math.exp(-(((p[1] - 1.13) / 0.05) ** 2)), i / N], sk: skY(p[1], stops) }), { capEnd: false });
    if (lod < 2 && !bare) {
      band(b, cx, 0.0, 1.02, 0.037 * B.limb, 0.04 * B.limb, 0.02, REG.LEATHER, stops, 10, -s * 0.9);
      ellipsoid(b, [cx, 1.13, -0.036 * B.limb], [0.03, 0.036, 0.012], REG.LEATHER, [BI['el' + side], 1], { u: 8, v: 5, aux: [0, 0, 0.5, 0] });
    }
    // налокотник / накладка на предплечье (ездовая кожа)
    if (o.armPads && lod < 2) b.loft([1.12, 1.06, 0.98, 0.92].map((y, k) => ringY(y, cx, 0.0, [0.046, 0.047, 0.042, 0.036][k], [0.048, 0.049, 0.044, 0.038][k], N)), (j, i, p) => ({ reg: REG.LEATHER, aux: [0, 0, 0.5, 0], sk: skY(p[1], stops) }));
    // кисть
    const hreg = gloves ? REG.SUIT : REG.SKIN, hsk = [BI['hand' + side], 1], inw = -s;
    // манжета перчатки
    if (gloves) b.loft([0.915, 0.9, 0.88, 0.86].map((y, k) => ringY(y, cx, 0, [0.036, 0.034, 0.03, 0.028][k], [0.037, 0.036, 0.034, 0.03][k], 10)), (j, i, p) => ({ reg: REG.ACCENT, aux: [0, 0, 0.3, 0], sk: skY(p[1], stops) }));
    b.loft([0.87, 0.82, 0.77, 0.745].map((y, k) => ringY(y, cx, 0.0, [0.019, 0.02, 0.019, 0.015][k], [0.032, 0.039, 0.04, 0.036][k], [10, 7, 5][lod])), (j, i, p) => ({ reg: hreg, aux: [p[1], gloves ? 0.6 : 0, 0.2, 0], sk: hsk }), { capEnd: true });
    if (lod === 0) {
      // 4 пальца: три фаланги, разный изгиб и веерное расхождение, утолщения суставов
      const lens = [0.086, 0.1, 0.093, 0.074], zs = [-0.0265, -0.0088, 0.0092, 0.0268], curl = [0.78, 0.92, 1.05, 1.2], fan = [-0.1, -0.03, 0.04, 0.12];
      zs.forEach((z, k) => {
        const L = lens[k], ph = [0.46, 0.3, 0.24];
        let x = cx, y = 0.754, zz = z, ang = 0.0;
        const pts = [[x, y, zz]];
        for (let q = 0; q < 3; q++) {
          ang += [0.16, 0.42, 0.62][q] * curl[k];
          const len = L * ph[q];
          x += inw * Math.sin(ang) * len; y -= Math.cos(ang) * len; zz += fan[k] * len;
          pts.push([x, y, zz]);
        }
        const dense = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))).getPoints(9).map((v) => [v.x, v.y, v.z]);
        tube(b, dense, (t) => (0.0086 - t * 0.0028) * (1 + 0.1 * Math.abs(Math.sin(t * Math.PI * 2.9))), hreg, () => hsk, { seg: 6, aux: [0.6, gloves ? 0.4 : 0, 0.25, 0] });
        const e = dense[dense.length - 1];
        if (!gloves) ellipsoid(b, [e[0] - inw * 0.002, e[1] + 0.006, e[2]], [0.0042, 0.0075, 0.0035], REG.SKIN, hsk, { u: 6, v: 4, rot: [0, 0, inw * 0.9], aux: [0, 0, 0, 0] });
      });
      // большой палец: два сустава
      tube(b, new THREE.CatmullRomCurve3([[cx + inw * 0.009, 0.8, 0.028], [cx + inw * 0.022, 0.775, 0.045], [cx + inw * 0.034, 0.752, 0.056], [cx + inw * 0.046, 0.733, 0.057]].map((p) => new THREE.Vector3(...p))).getPoints(8).map((v) => [v.x, v.y, v.z]), (t) => (0.0108 - t * 0.0036) * (1 + 0.08 * Math.sin(t * Math.PI * 2)), hreg, () => hsk, { seg: 6, aux: [0.6, gloves ? 0.4 : 0, 0.25, 0] });
    } else {
      ellipsoid(b, [cx + inw * 0.018, 0.7, 0.002], [0.016, 0.052, 0.034], hreg, hsk, { u: 8, v: 4, aux: [0, 0, 0.2, 0] });
    }
  }

  // ---- голова ----
  buildHead(b, o, lod, B);

  // ---- пояс, подсумки, трубки ----
  buildBelt(b, o, lod, torso, B);
  if (!bare && lod < 2 && !o.noTubes) buildSuitTubes(b, o, lod, torso);
  return b;
}

// Параметры головы (локально: центр 0, подбородок -0.118, макушка 0.138), затем переносится в y=1.63.
export const HEAD_Y = 1.63;
const HEAD_ROWS = [ // y, rx, rz, cz
  [-0.12, 0.026, 0.03, 0.058], [-0.108, 0.05, 0.058, 0.04], [-0.085, 0.07, 0.076, 0.024], [-0.05, 0.08, 0.09, 0.008], [-0.01, 0.083, 0.097, 0.004],
  [0.03, 0.083, 0.1, 0.003], [0.07, 0.08, 0.099, -0.001], [0.105, 0.07, 0.088, -0.006], [0.128, 0.05, 0.068, -0.012], [0.141, 0.025, 0.04, -0.012],
];
export function headRow(y) { return [interp(HEAD_ROWS, y, 1), interp(HEAD_ROWS, y, 2), interp(HEAD_ROWS, y, 3)]; }
const headFace = (a, y) => {
  // надбровье, скулы, подбородок — мультипликатор радиуса по углу
  const f = Math.exp(-(((a > Math.PI ? a - Math.PI * 2 : a) / 0.55) ** 2));
  const brow = Math.exp(-(((y - 0.05) / 0.022) ** 2)) * 0.07 * f;
  const cheek = Math.exp(-(((y + 0.03) / 0.03) ** 2)) * 0.05 * Math.exp(-(((Math.abs(a > Math.PI ? a - Math.PI * 2 : a) - 0.9) / 0.35) ** 2));
  const chin = Math.exp(-(((y + 0.1) / 0.02) ** 2)) * 0.1 * f;
  return 1 + brow + cheek + chin;
};
const HSK = [BI.head, 1];
function headRings(N, yRows, off = 0, a0 = 0, a1 = Math.PI * 2, open = false, hs = 1) {
  return yRows.map((y) => { const [rx, rz, cz] = headRow(y); return ringY(HEAD_Y + y * hs, 0, cz * hs + 0.005, (rx + off) * hs, (rz + off) * hs, N, null, a0, a1, open); });
}
function buildHead(b, o, lod, B) {
  const hs = B.head, N = [18, 12, 8][lod];
  if (lod === 2) {
    const rows = [-0.12, -0.05, 0.03, 0.105, 0.141];
    const rings = rows.map((y) => { const [rx, rz, cz] = headRow(y); return ringY(HEAD_Y + y * hs, 0, cz * hs + 0.005, rx * hs, rz * hs, N, null); });
    b.loft(rings, (j, i, p) => ({ reg: REG.SKIN, aux: [0, 0, 0, 0], sk: HSK }), { capStart: true, capEnd: true });
    return;
  }
  const P = o.faceP || faceParams(o);
  const cowled = o.cowl !== false && ((o.maskOn ?? (o.mask !== false)) || o.hood !== false) && !o.bare;
  const hh = buildHeadHi(b, o, lod, B, cowled, P);
  buildHair(b, o, lod, B, P, hh.S);
  if (o.beard) buildBeard(b, o, lod, B, P, hh.S);
}

/** Головной чехол дистикомба: капюшон-«затвор» вокруг лица + маска с трубками. Возвращает ничего (в тело). */
export function buildCowl(b, o, lod, B) {
  const hs = B.head, N = [20, 12, 8][lod], maskUp = o.maskState ? o.maskState === 'up' : o.mask !== false;
  const rowsY = lod === 0 ? [-0.2, -0.165, -0.13, -0.11, -0.09, -0.06, -0.035, -0.01, 0.02, 0.05, 0.08, 0.105, 0.128, 0.145] : [-0.2, -0.13, -0.09, -0.035, 0.02, 0.08, 0.128, 0.145];
  // угол раскрытия лица θ(y): 0 — закрыто.
  const theta = (y) => {
    if (y < -0.125) return 0;
    if (y < -0.035) return maskUp ? 0 : (y < -0.1 ? 0 : 1.15);
    if (y < 0.0) return 0.95 + (0.0 - y) * 4;
    if (y < 0.05) return 0.95 - y * 2.0;
    return Math.max(0, 0.85 - (y - 0.05) * 19);
  };
  const rings = rowsY.map((y) => {
    const yy = Math.max(y, -0.12), [rx, rz, cz] = headRow(yy);
    const neck = y < -0.12 ? (-0.12 - y) : 0; // ниже подбородка — шея
    const off = 0.007 + (maskUp && y < -0.03 ? 0.003 : 0) + neck * 0.18;
    const th = theta(y);
    return ringY(HEAD_Y + y * hs, 0, cz * hs + 0.005 + neck * 0.0, (rx + off) * hs + neck * 0.15, (rz + off) * hs + neck * 0.1, N, (a, yy2) => headFace(a, yy) * (y < -0.035 && maskUp && y > -0.12 ? 1.01 : 1), th, Math.PI * 2 - th, th > 0.01);
  });
  // для ровной топологии: все кольца с N+1 точек, замкнутые — дубль точки (th=0 даёт a0=0,a1=2π → совпадает)
  const fixed = rings.map((r, j) => { if (r.length === N) r.push(r[0].slice()); return r; });
  b.loft(fixed, (j, i, p) => {
    const y = p[1] - HEAD_Y;
    const inMask = y < -0.03 && y > -0.125 && maskUp;
    const jw = sstep(-0.05, -0.078, y / hs) * (1 - sstep(0.04, 0.08, Math.abs(p[0] / hs))) * (1 - sstep(-0.13, -0.2, y / hs));
    return { reg: REG.SUIT, aux: [p[1] * 1.0, inMask ? 1.1 : 0.7, 0.3 + (inMask ? 0.2 : 0), 0], face: [0, 0, 0, lod === 0 ? jw : 0], sk: y < -0.14 ? [BI.neck, 1 - sstep(-0.2, -0.14, y) * 0 , BI.head, 0] : HSK };
  }, { closed: false, capStart: true });
  // шов-обод вокруг лица (герметизация)
  const rimPts = [];
  const faceRows = [-0.03, 0, 0.03, 0.06, 0.09, 0.11];
  const side = (s) => faceRows.map((y) => { const [rx, rz, cz] = headRow(y); const th = theta(y); const m = headFace(th, y); const a = th; return [s * Math.sin(a) * (rx + 0.009) * m * hs, HEAD_Y + y * hs, (Math.cos(a) * (rz + 0.009) * m + cz) * hs + 0.005]; });
  const L = side(-1), R = side(1);
  const topFront = [0, 0.128, 0.056];
  const rim = [...L, [0, HEAD_Y + 0.128 * hs, headRow(0.128)[1] * hs * 0.6 + 0.008], ...R.slice().reverse()];
  if (lod < 2) tube(b, rim, 0.0085, REG.ACCENT, () => HSK, { seg: 6, aux: [0, 0, 0.2, 0] });
  if (maskUp && lod < 2) {
    // трубки носовых заглушек: от ноздрей по щекам вниз к затвору на шее
    for (const s of [-1, 1]) {
      const pts = [[0.012 * s, HEAD_Y - 0.034 * hs, 0.104 * hs], [0.026 * s, HEAD_Y - 0.04 * hs, 0.1 * hs], [0.056 * s, HEAD_Y - 0.052 * hs, 0.085 * hs], [0.082 * s, HEAD_Y - 0.085 * hs, 0.05 * hs], [0.078 * s, HEAD_Y - 0.14 * hs, 0.036 * hs], [0.07 * s, HEAD_Y - 0.19 * hs, 0.03 * hs], [0.09 * s, 1.43, 0.045]];
      hose(b, pts, 0.0066, (y) => (y > HEAD_Y - 0.15 ? HSK : [BI.neck, 1]), { seg: 5, step: 0.0045, period: 0.008, clamps: false });
    }
    // питьевая трубка: от клапана у рта вниз к груди
    const pts = [[0.032, HEAD_Y - 0.066 * hs, 0.096 * hs], [0.045, HEAD_Y - 0.085 * hs, 0.1 * hs], [0.05, HEAD_Y - 0.13 * hs, 0.098 * hs], [0.04, 1.44, 0.11], [0.03, 1.36, 0.125], [0.05, 1.28, 0.145], [0.075, 1.2, 0.152]];
    hose(b, pts, 0.0092, (y) => (y > 1.49 ? HSK : y > 1.4 ? [BI.neck, 1] : [BI.chest, 1]), { seg: 6, period: 0.0095, clamps: true });
    ellipsoid(b, [0.03, HEAD_Y - 0.068 * hs, 0.103 * hs], [0.015, 0.011, 0.012], REG.METAL, HSK, { u: 8, v: 5, aux: [0, 0, 0.1, 0] });
    // клапан (набор) на груди
    ellipsoid(b, [0.075, 1.19, 0.153], [0.014, 0.01, 0.012], REG.METAL, [BI.chest, 1], { u: 6, v: 4, aux: [0, 0, 0, 0] });
  }
}

function buildSuitTubes(b, o, lod, torso) {
  // рекуперационные шланги: от воротника по груди к карманам на бёдрах + зажимы
  for (const s of [-1, 1]) {
    const pts = [];
    const ys = [1.49, 1.43, 1.35, 1.25, 1.15, 1.05, 0.95, 0.86];
    ys.forEach((y, k) => {
      const rx = interp(torso, y, 1), rz = interp(torso, y, 2), cz = interp(torso, y, 3);
      const a = (0.5 + Math.sin(k * 0.9) * 0.08 + k * 0.1) * s;
      pts.push([Math.sin(a) * (rx + 0.014), y, Math.cos(a) * (rz + 0.014) + cz]);
    });
    hose(b, pts, 0.0105, (y) => skY(y, TORSO_SK), { seg: lod === 0 ? 6 : 5 });
  }
  // нагрудная панель-кокетка и спинной блок (видны на дистикомбе без одежды)
  if (o.robe === false && lod < 2) {
    const rowsY = [1.44, 1.38, 1.3, 1.22, 1.15];
    const arc = 1.0;
    const rings = rowsY.map((y) => { const rx = interp(torso, y, 1) + 0.0085, rz = interp(torso, y, 2) + 0.0085, cz = interp(torso, y, 3); return ringY(y, 0, cz, rx, rz, 14, null, -arc, arc, true); });
    b.loft(rings, (j, i, p) => ({ reg: REG.SUIT, aux: [0, 0, 0.2, i / 14], sk: skY(p[1], TORSO_SK) }), { closed: false });
    const edgeL = rings.map((r) => r[0]), edgeR = rings.map((r) => r[r.length - 1]), bot = rings[rings.length - 1];
    tube(b, [...edgeL, ...bot.slice(1, -1), ...edgeR.slice().reverse()], 0.0042, REG.LEATHER, (y) => skY(y, TORSO_SK), { seg: 5, aux: [0, 0, 0.4, 0] });
    // спинной блок рекуперации
    ellipsoid(b, [0, 1.17, interp(torso, 1.17, 3) - interp(torso, 1.17, 2) - 0.02], [0.115, 0.15, 0.03], REG.SUIT, [BI.chest, 1], { u: 12, v: 8, aux: [0, 0, 0.3, 0] });
    for (const s of [-1, 1]) hose(b, [[s * 0.05, 1.3, -0.1], [s * 0.1, 1.38, -0.09], [s * 0.14, 1.43, -0.04], [s * 0.1, 1.48, 0.02]], 0.0085, () => [BI.chest, 1], { clamps: true });
  }
}

function buildBelt(b, o, lod, torso, B) {
  const robeR = o.beltR; // радиусы пояса поверх одежды (rx, rz) на y=1.02 — если задан robe
  const y0 = 1.0;
  const rx0 = (robeR ? robeR[0] : interp(torso, y0, 1) + 0.006), rz0 = (robeR ? robeR[1] : interp(torso, y0, 2) + 0.006);
  const N = [22, 14, 8][lod];
  const belt = [[y0 - 0.025, 0.004], [y0 - 0.02, 0.012], [y0 + 0.024, 0.012], [y0 + 0.03, 0.004]];
  const rings = belt.map(([y, d]) => ringY(y, 0, 0, rx0 + d, rz0 + d, N));
  const bsk = [[1.05, BI.spine], [0.95, BI.spine]];
  b.loft(rings, (j, i, p) => ({ reg: REG.LEATHER, aux: [0, 0, 0.35, i / N], sk: [BI.spine, 1] }), { capStart: false });
  if (lod === 2) return;
  // пряжка
  ellipsoid(b, [0, y0, rz0 + 0.018], [0.026, 0.02, 0.008], REG.METAL, [BI.spine, 1], { u: 8, v: 4, aux: [0, 0, 0.1, 0] });
  const np = o.pouches ?? 3;
  const angles = [0.75, -0.75, 2.35, -2.35, 1.5, -1.5].slice(0, np);
  angles.forEach((a, k) => {
    const x = Math.sin(a) * (rx0 + 0.03), z = Math.cos(a) * (rz0 + 0.03);
    ellipsoid(b, [x, y0 - 0.03, z], [0.04, 0.045, 0.026], REG.LEATHER, [BI.spine, 1], { u: 8, v: 5, rot: [0, a, 0], aux: [0, 0, 0.5, 0] });
    if (lod === 0) ellipsoid(b, [Math.sin(a) * (rx0 + 0.052), y0 - 0.01, Math.cos(a) * (rz0 + 0.052)], [0.034, 0.012, 0.012], REG.ACCENT, [BI.spine, 1], { u: 8, v: 4, rot: [0, a, 0], aux: [0, 0, 0.2, 0] });
  });
  // обвязка наездника: ремни крест-накрест через грудь
  if (o.harness && !robeR) {
    for (const s of [-1, 1]) {
      const pts = [], n = 7;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1), y = lerp(1.43, 1.02, t), a = lerp(0.55, -0.9, t) * s;
        const rx = interp(torso, y, 1) + 0.008, rz = interp(torso, y, 2) + 0.008, cz = interp(torso, y, 3);
        pts.push([Math.sin(a) * rx, y, Math.cos(a) * rz + cz]);
      }
      tube(b, pts, 0.014, REG.LEATHER, (y) => skY(y, TORSO_SK), { seg: 6, aux: [0, 0, 0.4, 0] });
    }
    ellipsoid(b, [0, 1.23, interp(torso, 1.23, 2) + 0.016], [0.022, 0.022, 0.01], REG.METAL, [BI.chest, 1], { u: 8, v: 5, aux: [0, 0, 0, 0] });
  }
  // фляга-трубка/рукоятка ножа (крис) на бедре
  if (o.kris && lod < 2) {
    ellipsoid(b, [0.17, y0 - 0.12, 0.02], [0.016, 0.07, 0.016], REG.METAL, [BI.pelvis, 1], { u: 6, v: 5, rot: [0.1, 0, -0.25], aux: [0, 0, 0.1, 0] });
    ellipsoid(b, [0.2, y0 - 0.03, 0.02], [0.02, 0.03, 0.02], REG.ACCENT, [BI.pelvis, 1], { u: 6, v: 4, aux: [0, 0, 0.1, 0] });
  }
}

// ---------------------------------------------------------------------------------------------- ткань ----
/** Профиль робы: y → (rx, rz, cz) для выбранного стиля. */
const ROBE_ROWS = {
  jubba: [[0.16, 0.34, 0.31, 0.0], [0.4, 0.3, 0.27, 0.0], [0.7, 0.265, 0.235, 0.0], [0.92, 0.225, 0.19, 0], [1.05, 0.2, 0.15, 0.004], [1.2, 0.205, 0.15, 0.008], [1.32, 0.225, 0.147, 0.004], [1.41, 0.215, 0.12, -0.003], [1.45, 0.14, 0.09, -0.004], [1.485, 0.085, 0.07, -0.004]],
  kaftan: [[0.42, 0.285, 0.255, 0.0], [0.7, 0.262, 0.232, 0.0], [0.92, 0.225, 0.19, 0], [1.05, 0.2, 0.15, 0.004], [1.2, 0.205, 0.15, 0.008], [1.32, 0.225, 0.147, 0.004], [1.41, 0.215, 0.12, -0.003], [1.45, 0.14, 0.09, -0.004], [1.485, 0.085, 0.07, -0.004]],
  tunic: [[0.74, 0.232, 0.2, 0.0], [0.92, 0.218, 0.178, 0], [1.05, 0.195, 0.15, 0.004], [1.2, 0.2, 0.15, 0.008], [1.32, 0.222, 0.147, 0.004], [1.41, 0.212, 0.12, -0.003], [1.45, 0.14, 0.09, -0.004], [1.485, 0.085, 0.07, -0.004]],
  cape: [[0.7, 0.32, 0.27, -0.02], [0.92, 0.29, 0.24, -0.015], [1.05, 0.265, 0.21, -0.01], [1.2, 0.265, 0.19, -0.005], [1.32, 0.265, 0.175, -0.005], [1.4, 0.245, 0.175, -0.01], [1.44, 0.195, 0.14, -0.008], [1.47, 0.125, 0.105, -0.006], [1.495, 0.085, 0.085, -0.004]],
  shawl: [[0.62, 0.34, 0.3, -0.03], [0.92, 0.31, 0.26, -0.02], [1.1, 0.29, 0.23, -0.01], [1.25, 0.28, 0.2, -0.005], [1.36, 0.27, 0.17, -0.005], [1.43, 0.25, 0.14, -0.004], [1.46, 0.17, 0.11, -0.004], [1.49, 0.092, 0.08, -0.004]],
  heavy: [[0.1, 0.46, 0.4, 0], [0.5, 0.39, 0.34, 0], [0.92, 0.31, 0.26, -0.01], [1.15, 0.285, 0.22, -0.005], [1.3, 0.29, 0.2, 0], [1.4, 0.29, 0.16, -0.004], [1.45, 0.2, 0.12, -0.004], [1.49, 0.1, 0.09, -0.004]],
};
export function robeProfile(style) { const r = ROBE_ROWS[style] || ROBE_ROWS.jubba; return { rows: r, hemY: r[0][0] }; }

/** Складка: сумма гармоник по углу (целые частоты — шов замкнутого кольца непрерывен); возвращает [-1..1]. */
function makePleat(R, nf) {
  const H = [{ k: nf, ph: R() * 6.283, w: 1, tw: (R() - 0.5) * 2.2 }, { k: Math.round(nf * 2.1), ph: R() * 6.283, w: 0.42, tw: (R() - 0.5) * 3 }, { k: Math.round(nf * 0.5) + 1, ph: R() * 6.283, w: 0.55, tw: (R() - 0.5) * 1.5 }, { k: Math.round(nf * 3.7), ph: R() * 6.283, w: 0.16, tw: 0 }];
  const norm = H.reduce((a, h) => a + h.w, 0);
  return (a, y) => { let f = 0; for (const h of H) f += h.w * Math.cos(h.k * a + h.ph + h.tw * y); f /= norm; return f > 0 ? f : f * 0.8; };
}

/** Робочая юбка/накидка: настоящие складки по гравитации (гребни острые, впадины мягкие), стянутость поясом, закатанный подол, бахрома. */
function clothLayer(b, layer, lod, B, N, seed = 1) {
  const { style } = layer, rows = ROBE_ROWS[style] || ROBE_ROWS.jubba;
  const hemY = rows[0][0], topY = 1.49;
  const R = rng(seed);
  const fold = layer.fold ?? (style === 'heavy' ? 0.045 : 0.05), nf = layer.folds ?? 9;
  const pleat = makePleat(R, nf), sc = layer.scale ?? 1;
  const nRings = [30, 14, 7][lod];
  const ys = []; for (let k = 0; k < nRings; k++) ys.push(lerp(hemY, topY, k / (nRings - 1)));
  const sk = (y) => skY(y, [[1.52, BI.neck], [1.43, BI.chest], [1.18, BI.chest], [1.05, BI.spine], [0.93, BI.pelvis]]);
  const hemSkew = layer.asym ?? 0, tear = layer.tear ?? 0;
  const th0 = layer.open ?? (style === 'cape' ? 0.55 : style === 'shawl' ? 0.5 : style === 'heavy' ? 0.42 : 0);
  const beltable = !layer.noBelt && (style === 'jubba' || style === 'kaftan' || style === 'tunic');
  const aOf = (i) => th0 + ((Math.PI * 2 - 2 * th0) * i) / N;
  const closedRing = th0 === 0;
  const cols = closedRing ? N : N + 1;
  const hemPts = [];
  const rings = ys.map((y, j) => {
    const rx = interp(rows, y, 1) * sc, rz = interp(rows, y, 2) * sc, cz = interp(rows, y, 3);
    const below = clamp((1.12 - y) / 0.9, 0, 1), amp = fold * 2.9 * (0.12 + 0.88 * below * below) + 0.003;
    // пояс: стяжка на y=1.0 и напуск выше
    const cinch = beltable ? 1 - 0.04 * Math.exp(-(((y - 1.0) / 0.045) ** 2)) + 0.028 * Math.exp(-(((y - 1.1) / 0.06) ** 2)) : 1;
    const gather = beltable ? Math.exp(-(((y - 1.1) / 0.07) ** 2)) * 0.012 : 0;
    const pts = [];
    for (let i = 0; i < cols; i++) {
      const a = closedRing ? (i / N) * Math.PI * 2 : aOf(i);
      const f = pleat(a, y), m = cinch * (1 + amp * f) + gather * Math.cos(a * (nf * 3 + 2) + 0.5);
      const hemLift = j === 0 ? 0.03 * Math.sin(a * 3 + 0.5) + 0.018 * Math.sin(a * 7) + hemSkew * 0.1 * Math.max(0, Math.sin(a)) + tear * 0.06 * Math.max(0, Math.sin(a * 5 + 2)) + 0.022 * Math.max(0, f) : 0;
      // подол слегка выбрасывает вперёд/в стороны: радиус растёт у самого края
      const flare = j < 2 ? (1 - j) * 0.012 + 0.006 * (j === 1 ? 1 : 0) : 0;
      pts.push([Math.sin(a) * (rx * (y < 1.45 ? B.sh * 0.5 + 0.5 : 1)) * (m + flare), y + hemLift, cz + Math.cos(a) * rz * (m + flare)]);
      if (j === 0) hemPts.push(pts[pts.length - 1]);
    }
    return pts;
  });
  b.loft(rings, (j, i, p) => {
    const y = p[1], hemBand = y < hemY + 0.05;
    const flex = clamp((1.08 - y) / (1.08 - hemY), 0, 1);
    const a = closedRing ? (i / N) * Math.PI * 2 : aOf(i);
    const f = pleat(a, y);
    const edge = th0 > 0 ? (i <= 1 || i >= N - 1) : (a < 0.08 || a > Math.PI * 2 - 0.08);
    const trim = (hemBand && layer.hemTrim) || (layer.frontTrim && edge && y > 1.0);
    return { reg: trim ? REG.ACCENT : (layer.reg ?? REG.CLOTH), aux: [flex * flex, layer.lining ? 1 : 0, 0.5 + 0.5 * f, a], sk: sk(y) };
  }, { capStart: false, closed: closedRing });
  if (lod < 2) {
    // закатанный подол (толщина ткани) и кромки раскрытых слоёв
    const hemReg = layer.hemTrim ? REG.ACCENT : (layer.reg ?? REG.CLOTH);
    const rr = 0.0075;
    tube(b, closedRing ? [...hemPts, hemPts[0]] : hemPts, rr, hemReg, (y, p) => sk(y), { seg: 5, auxFn: (p) => [clamp((1.08 - p[1]) / (1.08 - hemY), 0, 1) ** 2, 0, 0.7, 0], noCaps: closedRing });
    if (!closedRing) for (const side of [0, cols - 1]) tube(b, rings.map((r) => r[side]), 0.0065, layer.frontTrim ? REG.ACCENT : (layer.reg ?? REG.CLOTH), (y) => sk(y), { seg: 5, auxFn: (p) => [clamp((1.08 - p[1]) / (1.08 - hemY), 0, 1) ** 2, 0, 0.8, 0] });
    // бахрома: потёртый подол
    const fr = layer.fringe ?? (tear > 0.2 || (layer.wear ?? 0) > 0.45);
    if (fr && lod === 0) {
      const depth = 0.04, base = b.n, K = hemPts.length;
      for (let i = 0; i < K; i++) for (let r = 0; r < 2; r++) {
        const p = hemPts[i], v = r, y = p[1] - 0.004 - depth * r, a = closedRing ? (i / N) * Math.PI * 2 : aOf(i);
        b.vert(p[0] * (1.004 + 0.006 * r), y, p[2] * (1.004 + 0.006 * r) - 0.0, REG.FRINGE, [clamp((1.08 - p[1]) / (1.08 - hemY), 0, 1) ** 2, v, 0.5, a / (Math.PI * 2)], sk(y), [Math.random() * 0 + (i % 7) / 7, 0, 0, 0]);
      }
      for (let i = 0; i < K - 1; i++) { const a0 = base + i * 2; b.idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2); b.idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3); }
    }
  }
  // воротник-шаль у горла
  if (layer.collar && lod < 2) {
    b.loft([1.5, 1.47, 1.43].map((y, k) => ringY(y, 0, 0, [0.095, 0.115, 0.15][k], [0.085, 0.1, 0.12][k], N, (a) => 1 + 0.07 * Math.sin(a * 7))), (j, i, p) => ({ reg: REG.CLOTH, aux: [0, 0, 0.7, (i / N) * 6.28], sk: skY(p[1], [[1.52, BI.neck], [1.43, BI.chest]]) }), {});
  }
}

function sleeves(b, o, lod, B, N) {
  const jub = o.sleeve ?? 'wide';
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'L' : 'R', cx = 0.19 * s * B.sh;
    const stops = [[1.46, BI['sh' + side]], [1.2, BI['sh' + side]], [1.1, BI['el' + side]], [0.92, BI['el' + side]], [0.86, BI['hand' + side]]];
    const to = jub === 'short' ? 1.05 : 0.9;
    const ys = []; const n = [12, 7, 4][lod]; for (let k = 0; k < n; k++) ys.push(lerp(1.465, to, k / (n - 1)));
    const prof = (y) => (y > 1.2 ? 0.066 + (1.465 - y) * 0.12 * 0 + 0.012 * sstep(1.46, 1.3, y) * 0 : lerp(0.07, 0.1, sstep(1.2, to, y)));
    const rings = ys.map((y) => { const r = (y > 1.2 ? 0.07 : lerp(0.07, jub === 'wide' ? 0.098 : 0.08, sstep(1.2, to, y))) * B.limb; const nn = Math.max(6, [12, 8, 5][lod]); return ringY(y, cx + s * 0.006, 0.0, r, r * 1.04, nn, (a) => 1 + 0.06 * Math.sin(a * 3 + y * 11) * sstep(1.3, to, y)); });
    b.loft(rings, (j, i, p) => ({ reg: p[1] < to + 0.04 && o.cuffTrim ? REG.ACCENT : REG.CLOTH2, aux: [0.25 * sstep(1.25, to, p[1]) ** 2, 0, 0.55 + 0.4 * Math.sin(i * 1.7 + p[1] * 9), i * 0.7], sk: skY(p[1], stops) }), { capStart: false });
  }
}

/** Капюшон (ткань): над и вокруг головы, спереди открыт; хвост назад. */
function clothHood(b, o, lod, B) {
  const hs = B.head, N = [22, 12, 7][lod];
  const ys = lod === 0 ? [-0.2, -0.16, -0.11, -0.06, -0.01, 0.04, 0.09, 0.13, 0.165, 0.195, 0.21, 0.216] : [-0.2, -0.1, 0.0, 0.09, 0.165, 0.205, 0.216];
  const th = (y) => (y < -0.14 ? 0 : y < -0.05 ? 1.2 * sstep(-0.14, -0.05, y) + 0.2 : y < 0.12 ? 1.18 - (y + 0.05) * 1.5 : Math.max(0, 0.9 - (y - 0.12) * 8));
  const rings = ys.map((y) => {
    const t = Math.max(0, th(y)), yy = clamp(y, -0.12, 0.141), [rx, rz, cz] = headRow(yy);
    const u = y > 0.141 ? (y - 0.141) / 0.077 : 0;
    const sz = y > 0.141 ? Math.sqrt(Math.max(0, 1 - u * u)) * 0.96 + 0.04 : 1;
    const off = 0.03 + (y < -0.03 ? 0.06 * sstep(-0.03, -0.18, y) : 0) + (y > 0.08 ? 0.012 : 0);
    return ringY(HEAD_Y + y * hs, 0, cz * hs - 0.015 - Math.max(0, y) * 0.25, (rx + off) * hs * sz, (rz + off + 0.02) * hs * sz, N, (a) => 1 + 0.03 * Math.sin(a * 6 + y * 20), t, Math.PI * 2 - t, true);
  });
  b.loft(rings, (j, i, p) => {
    const y = p[1] - HEAD_Y, back = clamp(Math.abs(i / N - 0.5) * 2, 0, 1);
    return { reg: REG.CLOTH, aux: [0.18 * (y < -0.1 ? 1 : 0.4) * back + (y > 0.1 ? 0.12 * back : 0), 0, 0.5 + 0.4 * Math.sin(i * 1.3 + y * 20), i * 0.3], sk: y < -0.15 ? skY(p[1], [[1.5, BI.head], [1.43, BI.chest]]) : HSK };
  }, { closed: false, capEnd: true });
  // обод капюшона (скатанная кромка)
  if (lod < 2) {
    const k0 = 3, e0 = rings.slice(k0).map((r) => r[0]), e1 = rings.slice(k0).map((r) => r[r.length - 1]);
    tube(b, [...e0, ...e1.reverse()], 0.012, o.hoodTrim ? REG.ACCENT : REG.CLOTH, (y) => (y > 1.5 ? HSK : [BI.chest, 1]), { seg: 6, aux: [0, 0, 0.4, 0] });
  }
}

/** Накидка-спадающий хвост капюшона / плащ-шаль на плечах (отдельный полог). */
function hoodDrape(b, o, lod, B, N) {
  const ys = lod === 0 ? [1.5, 1.46, 1.4, 1.33, 1.26, 1.18, 1.1] : [1.5, 1.4, 1.26, 1.1];
  const rings = ys.map((y) => { const t = (1.5 - y) / 0.4; return ringY(y, 0, -0.04 - t * 0.04, 0.12 + t * 0.07, 0.1 + t * 0.03, N, (a) => 1 + 0.04 * Math.sin(a * 5 + y * 8), Math.PI * 0.55, Math.PI * 1.45, true); });
  b.loft(rings, (j, i, p) => ({ reg: REG.CLOTH, aux: [clamp((1.5 - p[1]) / 0.4, 0, 1) ** 1.5, 0, 0.5 + 0.45 * Math.sin(i * 1.9 + p[1] * 6), i * 0.4], sk: skY(p[1], [[1.52, BI.neck], [1.43, BI.chest], [1.15, BI.chest]]) }), { closed: false });
}

/** Шарф: длинный хвост на спине (flex сильный). */
function scarf(b, o, lod, B) {
  const ys = lod === 0 ? 14 : 7, pts = [], N = 4;
  const rings = [];
  for (let k = 0; k < ys; k++) {
    const t = k / (ys - 1), y = lerp(1.5, 0.86, t), z = -0.1 - t * 0.04 - Math.sin(t * 6) * 0.01, w = 0.045 + t * 0.02;
    rings.push([[-w, y, z], [w, y, z - 0.004], [w, y, z + 0.004], [-w, y, z + 0.0]].map((p) => p));
  }
  b.loft(rings, (j, i, p) => ({ reg: REG.ACCENT, aux: [(j / (ys - 1)) ** 1.3, 0, p[1] * 3, i], sk: skY(p[1], [[1.52, BI.neck], [1.43, BI.chest], [1.15, BI.chest], [1.0, BI.spine]]) }), { capEnd: true });
}

export function buildCloth(o, lod) {
  const b = new GB();
  const B = BUILDS[o.build] || BUILDS.m;
  const N = [64, 30, 14][lod];
  const hasRobe = o.robe !== false;
  const layers = o.layers || [];
  if (hasRobe) clothLayer(b, { reg: REG.CLOTH2, style: o.robeStyle || 'jubba', hemTrim: o.hemTrim, frontTrim: o.frontTrim, asym: o.asym, tear: o.tear, lining: o.lining, collar: true, fold: o.fold, wear: o.wear }, lod, B, N, (o.seed | 0) + 3);
  layers.forEach((l, li) => clothLayer(b, { wear: o.wear, ...l }, lod, B, N, (o.seed | 0) + 17 + li * 5));
  if (hasRobe) sleeves(b, o, lod, B, Math.max(8, N / 3 | 0));
  if (o.cowl !== false && o.hoodUp !== false && o.hood !== false) { clothHood(b, o, lod, B); if (lod < 2 && !o.noDrape) hoodDrape(b, o, lod, B, Math.max(10, N / 2 | 0)); }
  if (o.scarf) scarf(b, o, lod, B);
  if (!b.n) { b.vert(0, 0, 0, 2, [0, 0, 0, 0], [0, 1]); b.vert(0.001, 0, 0, 2, [0, 0, 0, 0], [0, 1]); b.vert(0, 0.001, 0, 2, [0, 0, 0, 0], [0, 1]); b.idx.push(0, 1, 2); }
  return b;
}

/** Тело + чехол головы (капюшон дистикомба/маска). */
export function buildBodyFull(o, lod) {
  const b = buildBody(o, lod);
  const B = BUILDS[o.build] || BUILDS.m;
  if (o.cowl !== false && ((o.maskOn ?? (o.mask !== false)) || o.hood !== false) && !o.bare && lod < 3) buildCowl(b, o, lod, B);
  if (o.bare && o.maskless !== true) { /* без чехла */ }
  return b;
}

// Кэш геометрий по ключу варианта.
const cache = new Map();
export function geometryFor(o, lod, key) {
  const k = key + '|' + lod;
  let e = cache.get(k);
  if (!e) {
    e = { body: buildBodyFull(o, lod).build(), cloth: buildCloth(o, lod).build() };
    cache.set(k, e);
  }
  return e;
}
export function triCount(g) { return g.index.count / 3; }
