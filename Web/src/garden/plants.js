// Геометрия растений (карточки с альфой + стволы), материал с ветром в вершинном шейдере и инстанс-группы с чанковым LOD.
import * as THREE from 'three';
import { patchMaterial } from '../desert/env.js';
import { rng } from '../core/util.js';

/** Общие uniform-ы ветра: vec4(dirX, dirZ, амплитуда, время). Амплитуду выставляет модуль по погоде (в котловине слабее). */
export const GWIND = { value: new THREE.Vector4(0.5, 0.87, 0.06, 0) };

export function makePlantMaterial({ map = null, alphaTest = 0.42, roughness = 0.88, key = 'gd-plant', side = THREE.DoubleSide, vertexColors = true, color = 0xffffff, emissive = 0x000000 } = {}) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: map ? alphaTest : 0, side, roughness, metalness: 0, vertexColors, color, emissive });
  m.alphaToCoverage = !!map;
  patchMaterial(m, key, {
    uniforms: { uGWind: GWIND },
    vertexPars: 'varying vec3 vWP;\nattribute float aSway;\nuniform vec4 uGWind;\n',
    vertexMain: /* glsl */`
vec3 transformed = vec3(position);
{
  vec4 w0 = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  w0 = instanceMatrix * w0;
  #endif
  vec3 wp0 = (modelMatrix * w0).xyz;
  float ph = uGWind.w * 1.65 + wp0.x * 0.33 + wp0.z * 0.27;
  float s = sin(ph) + 0.42 * sin(ph * 2.37 + 1.7);
  transformed.x += uGWind.x * uGWind.z * aSway * s;
  transformed.z += uGWind.y * uGWind.z * aSway * s;
  transformed.y -= abs(s) * aSway * uGWind.z * 0.12;
  vec4 w2 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  w2 = instanceMatrix * w2;
  #endif
  vWP = (modelMatrix * w2).xyz;
}`,
    fragPars: 'varying vec3 vWP;\n',
  });
  return m;
}

/** Подключить туман/освещение пустыни к обычному материалу (без ветра). */
export function fogPatch(mat, key) {
  patchMaterial(mat, key, {
    vertexPars: 'varying vec3 vWP;\n',
    vertexMain: /* glsl */`
vec3 transformed = vec3(position);
{
  vec4 w0 = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  w0 = instanceMatrix * w0;
  #endif
  vWP = (modelMatrix * w0).xyz;
}`,
    fragPars: 'varying vec3 vWP;\n',
  });
  return mat;
}

// ---------------------------------------------------------------- построитель геометрии
class GB {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.s = []; this.i = []; }
  v(x, y, z, nx, ny, nz, u, v, col, sw) { const k = this.p.length / 3; this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(col[0], col[1], col[2]); this.s.push(sw); return k; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.s, 1));
    g.setIndex(this.i);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
const WHITE = [1, 1, 1];

/** Карточка (прямоугольник) с центром в (cx,cy,cz), осью «вверх» u и «вправо» r, нормалью n; sway задаётся (низ, верх). */
function card(b, c, rx, ry, rz, ux, uy, uz, hw, hh, n, col, swBot, swTop, bend = 0) {
  // rx.. — направление «вправо» (единичное), ux.. — «вверх» (единичное)
  const segs = 2;
  const idx = [];
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const off = bend * t * t;                            // изгиб карточки вдоль нормали
    for (const sg of [-1, 1]) {
      const x = c[0] + rx * hw * sg + ux * (hh * (2 * t - 1)) + n[0] * off;
      const y = c[1] + ry * hw * sg + uy * (hh * (2 * t - 1)) + n[1] * off;
      const z = c[2] + rz * hw * sg + uz * (hh * (2 * t - 1)) + n[2] * off;
      idx.push(b.v(x, y, z, n[0], n[1], n[2], sg < 0 ? 0 : 1, t, col, swBot + (swTop - swBot) * t));
    }
  }
  for (let s = 0; s < segs; s++) { const a = idx[s * 2], bb = idx[s * 2 + 1], cc = idx[s * 2 + 3], d = idx[s * 2 + 2]; b.quad(a, bb, cc, d); }
}

/** Тонкая коническая трубка вдоль ломаной (радиусы убывают), цвет коры. */
function tube(b, pts, r0, r1, radial, col, swK = 0, ringBands = false, baseSway = 0) {
  const rings = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = pts[i], q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    let tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // два перпендикуляра
    let ax = 0, ay = 1, az = 0; if (Math.abs(ty) > 0.95) { ax = 1; ay = 0; }
    let px = ty * az - tz * ay, py = tz * ax - tx * az, pz = tx * ay - ty * ax; const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
    const qx = ty * pz - tz * py, qy = tz * px - tx * pz, qz = tx * py - ty * px;
    const r = r0 + (r1 - r0) * t;
    const ring = [];
    const band = ringBands ? (0.82 + 0.18 * ((i % 2) ? 1 : 0)) : 1;
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const nx = px * ca + qx * sa, ny = py * ca + qy * sa, nz = pz * ca + qz * sa;
      ring.push(b.v(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz, k / radial, t, [col[0] * band, col[1] * band, col[2] * band], baseSway + swK * t * t));
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < radial; k++) b.quad(rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]);
}

// ---------------------------------------------------------------- растения
/** Пучок травы: 3 перекрёстные карточки. kind: 'poverty' (низкая, 0.35 м) | 'dune' (высокая, 1.1 м). */
export function buildGrass(kind, variant = 0) {
  const R = rng(500 + variant * 17 + (kind === 'dune' ? 99 : 0));
  const b = new GB();
  const H = kind === 'dune' ? 0.9 + R() * 0.45 : 0.28 + R() * 0.2, W = kind === 'dune' ? 0.75 : 0.5;
  const n = kind === 'dune' ? 4 : 3;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI + R() * 0.4;
    const rx = Math.cos(a), rz = Math.sin(a);
    card(b, [0, H / 2 - 0.02, 0], rx, 0, rz, 0, 1, 0, W / 2, H / 2, [-rz, 0.35, rx], WHITE, 0, 1, (R() - 0.5) * H * 0.25);
  }
  return b.build();
}

/** Куст из карточек-кластеров на полусфере + тонкие ветви. kind: creosote | saltbush. Возвращает {leaf, wood}. */
export function buildShrub(kind, variant = 0) {
  const R = rng(900 + variant * 31 + (kind === 'saltbush' ? 7 : 0));
  const leaf = new GB(), wood = new GB();
  const H = kind === 'creosote' ? 1.0 + R() * 0.5 : 0.7 + R() * 0.35, RAD = kind === 'creosote' ? 0.85 + R() * 0.3 : 0.7 + R() * 0.25;
  const nCards = kind === 'creosote' ? 22 : 18;
  for (let i = 0; i < nCards; i++) {
    const u = R(), v = R();
    const th = u * Math.PI * 2, ph = Math.acos(1 - v * 0.95);          // верхняя полусфера
    const px = Math.sin(ph) * Math.cos(th) * RAD * (0.35 + 0.65 * R()), pz = Math.sin(ph) * Math.sin(th) * RAD * (0.35 + 0.65 * R());
    const py = 0.18 * H + Math.cos(ph) * H * 0.82;
    const nrm = [px / RAD, (py - H * 0.35) / H, pz / RAD]; const nl = Math.hypot(...nrm) || 1; nrm.forEach((_, q) => { nrm[q] /= nl; });
    const yaw = R() * Math.PI * 2, tilt = 0.25 + R() * 0.9;
    const rx = Math.cos(yaw), rz = Math.sin(yaw);
    const ux = -Math.sin(yaw) * Math.sin(tilt) * 0.0, uy = Math.cos(tilt), uzv = 0;
    const size = (kind === 'creosote' ? 0.62 : 0.55) * (0.75 + R() * 0.6);
    const col = [0.85 + R() * 0.3, 0.85 + R() * 0.3, 0.85 + R() * 0.3];
    // «вверх» карточки — вдоль наклона к нормали купола
    const upx = nrm[0] * 0.6 + 0, upy = 0.5 + nrm[1] * 0.5, upz = nrm[2] * 0.6; const ul = Math.hypot(upx, upy, upz);
    card(leaf, [px, py, pz], rx, 0, rz, upx / ul, upy / ul, upz / ul, size / 2, size / 2, [nrm[0] * 0.6 + 0.0, 0.55 + nrm[1] * 0.4, nrm[2] * 0.6], col, 0.35 + 0.5 * (py / (H * 1.1)), 0.5 + 0.5 * (py / (H * 1.1)));
  }
  const brown = kind === 'creosote' ? [0.30, 0.22, 0.14] : [0.38, 0.32, 0.24];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + R();
    const pts = []; for (let s = 0; s <= 3; s++) { const t = s / 3; pts.push([Math.cos(a) * t * RAD * 0.55, t * H * 0.7, Math.sin(a) * t * RAD * 0.55]); }
    tube(wood, pts, 0.028, 0.012, 4, brown, 0.3, false, 0);
  }
  return { leaf: leaf.build(), wood: wood.build() };
}

/** Деревце: kind 'tamarisk' (метёлки, свисающие плети) | 'acacia' (зонтичная крона). Возвращает {leaf, wood}. */
export function buildTree(kind, variant = 0) {
  const R = rng(1300 + variant * 53 + (kind === 'acacia' ? 11 : 0));
  const leaf = new GB(), wood = new GB();
  const bark = kind === 'acacia' ? [0.26, 0.2, 0.15] : [0.34, 0.2, 0.15];
  const H = kind === 'acacia' ? 3.0 + R() * 0.9 : 3.4 + R() * 1.2;
  const stems = kind === 'acacia' ? 2 : 3;
  const crownPts = [];
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * Math.PI * 2 + R();
    const lean = (kind === 'acacia' ? 0.12 : 0.22) + R() * 0.14;
    const pts = []; const L = H * (0.8 + R() * 0.25);
    for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([Math.cos(a) * lean * L * t * t * 1.4 + Math.sin(t * 5 + s) * 0.05, t * L, Math.sin(a) * lean * L * t * t * 1.4]); }
    tube(wood, pts, 0.11 - s * 0.01, 0.035, 6, bark, 0.6, false, 0.0);
    crownPts.push(pts[pts.length - 1], pts[4], pts[5]);
    // боковые ветви
    for (let k = 0; k < 3; k++) {
      const bi = 3 + k, base = pts[Math.min(bi, 6)];
      const ba = a + (R() - 0.5) * 2.4, bl = 0.7 + R() * 0.8;
      const bp = []; for (let i = 0; i <= 3; i++) { const t = i / 3; bp.push([base[0] + Math.cos(ba) * bl * t, base[1] + t * bl * 0.45 - t * t * (kind === 'tamarisk' ? 0.5 : 0.1), base[2] + Math.sin(ba) * bl * t]); }
      tube(wood, bp, 0.04, 0.012, 4, bark, 0.8, false, 0.05);
      crownPts.push(bp[3], bp[2]);
    }
  }
  if (kind === 'tamarisk') {
    for (const p of crownPts) for (let k = 0; k < 3; k++) {
      const yaw = R() * Math.PI * 2, rx = Math.cos(yaw), rz = Math.sin(yaw);
      const hh = 0.55 + R() * 0.35, hw = 0.5 + R() * 0.25;
      const nrm = [Math.sin(yaw) * 0.3, 0.7, Math.cos(yaw) * 0.3];
      const col = [0.85 + R() * 0.3, 0.9 + R() * 0.25, 0.85 + R() * 0.3];
      card(leaf, [p[0] + rx * 0.2, p[1] - hh * 0.55, p[2] + rz * 0.2], rx, 0, rz, 0, 1, 0, hw, hh, nrm, col, 0.5, 1.0, 0.1);
    }
  } else {
    // зонтичная крона: кольца почти горизонтальных карточек
    const top = H * 0.9;
    for (let ring = 0; ring < 3; ring++) {
      const rr = 0.8 + ring * 0.95, cnt = 6 + ring * 4;
      for (let k = 0; k < cnt; k++) {
        const a = (k / cnt) * Math.PI * 2 + R() * 0.5;
        const cx = Math.cos(a) * rr * (0.8 + R() * 0.3), cz = Math.sin(a) * rr * (0.8 + R() * 0.3);
        const cy = top + 0.35 - ring * 0.18 + (R() - 0.5) * 0.25;
        const yaw = a + (R() - 0.5), rx = Math.cos(yaw), rz = Math.sin(yaw);
        // карточка лежит почти горизонтально: «вверх» — наружу вдоль радиуса
        const ox = Math.cos(a), oz = Math.sin(a);
        const col = [0.8 + R() * 0.3, 0.85 + R() * 0.3, 0.8 + R() * 0.3];
        card(leaf, [cx, cy, cz], -oz, 0, ox, ox * 0.97, 0.22, oz * 0.97, 0.75, 0.75, [0, 1, 0], col, 0.5, 1.0, 0);
      }
    }
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + R(); const pts = []; for (let i = 0; i <= 3; i++) { const t = i / 3; pts.push([Math.cos(a) * t * 1.6, top - 0.2 + t * 0.35 - t * t * 0.3, Math.sin(a) * t * 1.6]); } tube(wood, pts, 0.045, 0.015, 4, bark, 0.6, false, 0.02); }
  }
  return { leaf: leaf.build(), wood: wood.build() };
}

/** Финиковая пальма: изогнутый ствол с кольцами, крона из 18 дугообразных листьев, 4 грозди фиников. {trunk, fronds}. */
export function buildPalm(variant = 0) {
  const R = rng(2100 + variant * 71);
  const trunk = new GB(), fr = new GB();
  const H = 5.6 + R() * 2.4, lean = (R() - 0.5) * 0.9, la = R() * Math.PI * 2;
  const pts = [];
  const N = 12;
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push([Math.cos(la) * lean * t * t * H * 0.18, t * H, Math.sin(la) * lean * t * t * H * 0.18]); }
  tube(trunk, pts, 0.36, 0.22, 9, [0.46, 0.36, 0.26], 0.35, true, 0);
  // основание-«юбка»
  const top = pts[N];
  const nF = 18;
  for (let f = 0; f < nF; f++) {
    const a = (f / nF) * Math.PI * 2 + R() * 0.2;
    const ring = f % 3;                                  // 0 — прямые вверх, 2 — свисающие
    const L = 3.0 + R() * 0.8 - (ring === 0 ? 0.6 : 0), elev = [0.95, 0.55, 0.05][ring] + R() * 0.15, droop = [0.35, 0.9, 1.7][ring];
    const dx = Math.cos(a), dz = Math.sin(a);
    const segs = 7;
    const idx = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const px = top[0] + dx * L * t * Math.cos(elev * 0.9), pz = top[2] + dz * L * t * Math.cos(elev * 0.9);
      const py = top[1] + 0.1 + L * Math.sin(elev) * t - droop * t * t * 1.4;
      const hw = 0.62 * Math.sin(Math.PI * (0.12 + 0.88 * t) * 0.97) + 0.05;
      const sdx = -dz, sdz = dx;
      const sw = 0.2 + 0.8 * t;
      for (const sg of [-1, 1]) {
        const col = [0.82 + R() * 0.0, 0.9, 0.8];
        idx.push(fr.v(px + sdx * hw * sg, py - Math.abs(sg) * 0.0, pz + sdz * hw * sg, 0.15 * dx, 0.95, 0.15 * dz, sg < 0 ? 0 : 1, t, col, sw));
      }
    }
    for (let s = 0; s < segs; s++) fr.quad(idx[s * 2], idx[s * 2 + 1], idx[s * 2 + 3], idx[s * 2 + 2]);
  }
  // финики: гроздья под кроной
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + R();
    const cx = top[0] + Math.cos(a) * 0.55, cz = top[2] + Math.sin(a) * 0.55, cy = top[1] - 0.15;
    const stalk = [[cx, cy + 0.1, cz], [cx + Math.cos(a) * 0.2, cy - 0.15, cz + Math.sin(a) * 0.2], [cx + Math.cos(a) * 0.3, cy - 0.5, cz + Math.sin(a) * 0.3]];
    tube(trunk, stalk, 0.02, 0.012, 4, [0.55, 0.38, 0.18], 0.4, false, 0.1);
    for (let d = 0; d < 14; d++) {
      const px = stalk[1][0] + (R() - 0.5) * 0.28, py = stalk[1][1] - R() * 0.5, pz = stalk[1][2] + (R() - 0.5) * 0.28;
      const r = 0.035 + R() * 0.012, col = [0.62 + R() * 0.15, 0.3 + R() * 0.08, 0.1];
      const base = trunk.p.length / 3;
      const seg = 5;
      for (let ia = 0; ia <= seg; ia++) for (let ib = 0; ib <= seg; ib++) {
        const th = (ia / seg) * Math.PI, ph = (ib / seg) * Math.PI * 2;
        const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
        trunk.v(px + nx * r, py + ny * r * 1.5, pz + nz * r, nx, ny, nz, 0, 0, col, 0.4);
      }
      for (let ia = 0; ia < seg; ia++) for (let ib = 0; ib < seg; ib++) { const a0 = base + ia * (seg + 1) + ib; trunk.quad(a0, a0 + 1, a0 + seg + 2, a0 + seg + 1); }
    }
  }
  return { trunk: trunk.build(), fronds: fr.build(), top };
}

/** Цветочек: 2 перекрёстные карточки; атлас 4 цвета по uv.x (задаётся атрибутом цвета/смещением). */
export function buildFlower(colorIdx = 0) {
  const b = new GB();
  const H = 0.22, W = 0.2;
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI / 2;
    const rx = Math.cos(a), rz = Math.sin(a);
    const u0 = colorIdx * 0.25, u1 = u0 + 0.25;
    const i0 = b.v(-rx * W / 2, 0, -rz * W / 2, -rz, 0, rx, u0, 0, WHITE, 0), i1 = b.v(rx * W / 2, 0, rz * W / 2, -rz, 0, rx, u1, 0, WHITE, 0);
    const i2 = b.v(rx * W / 2, H, rz * W / 2, -rz, 0, rx, u1, 1, WHITE, 1), i3 = b.v(-rx * W / 2, H, -rz * W / 2, -rz, 0, rx, u0, 1, WHITE, 1);
    b.quad(i0, i1, i2, i3);
  }
  return b.build();
}

// ---------------------------------------------------------------- инстансы с чанковым LOD
export class InstGroup {
  /** parts: [{geo, mat}] — меши делят инстансные матрицы. opts: {range, shadow, cell} */
  constructor(parent, parts, { range = 80, shadow = false, cell = 16, name = 'inst' } = {}) {
    this.parent = parent; this.parts = parts; this.range = range; this.cell = cell; this.name = name;
    this.items = []; this.meshes = []; this.shadow = shadow;
    this.last = new THREE.Vector3(1e9, 0, 1e9); this.lastT = 0;
  }
  add(x, y, z, yaw, sx, sy = sx, color = null, tiltX = 0, tiltZ = 0) { this.items.push({ x, y, z, yaw, sx, sy, color, tiltX, tiltZ }); }
  finalize() {
    const N = Math.max(1, this.items.length);
    this.N = this.items.length;
    this.mat = new Float32Array(N * 16); this.col = new Float32Array(N * 3);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    this.chunks = new Map();
    this.items.forEach((it, i) => {
      e.set(it.tiltX, it.yaw, it.tiltZ, 'YXZ'); q.setFromEuler(e);
      m4.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sx)); m4.toArray(this.mat, i * 16);
      const c = it.color || [1, 1, 1]; this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
      const key = `${Math.floor(it.x / this.cell)},${Math.floor(it.z / this.cell)}`;
      let ch = this.chunks.get(key); if (!ch) { ch = { cx: (Math.floor(it.x / this.cell) + 0.5) * this.cell, cz: (Math.floor(it.z / this.cell) + 0.5) * this.cell, ids: [] }; this.chunks.set(key, ch); }
      ch.ids.push(i);
    });
    this.chunkList = [...this.chunks.values()];
    for (const { geo, mat } of this.parts) {
      const mesh = new THREE.InstancedMesh(geo, mat, N);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = this.shadow; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0; mesh.name = this.name;
      this.parent.add(mesh); this.meshes.push(mesh);
    }
    return this;
  }
  /** Перекомпоновать видимые инстансы вокруг камеры (вызывать не чаще раза в ~0.4 с и при сдвиге > 3 м). */
  refresh(cam, force = false) {
    if (!this.meshes.length) return;
    const dx = cam.x - this.last.x, dz = cam.z - this.last.z;
    if (!force && dx * dx + dz * dz < 9) return;
    this.last.copy(cam);
    const r2 = (this.range) ** 2, reach = this.range + this.cell * 0.75;
    let n = 0;
    const A = this.meshes[0].instanceMatrix.array, C = this.meshes[0].instanceColor.array;
    for (const ch of this.chunkList) {
      const cx = ch.cx - cam.x, cz = ch.cz - cam.z;
      if (cx * cx + cz * cz > reach * reach) continue;
      for (const id of ch.ids) {
        const it = this.items[id];
        const ex = it.x - cam.x, ez = it.z - cam.z;
        if (ex * ex + ez * ez > r2) continue;
        A.set(this.mat.subarray(id * 16, id * 16 + 16), n * 16);
        C[n * 3] = this.col[id * 3]; C[n * 3 + 1] = this.col[id * 3 + 1]; C[n * 3 + 2] = this.col[id * 3 + 2];
        n++;
      }
    }
    for (let k = 0; k < this.meshes.length; k++) {
      const m = this.meshes[k];
      if (k > 0) { m.instanceMatrix.array.set(A.subarray(0, n * 16)); m.instanceColor.array.set(C.subarray(0, n * 3)); }
      m.count = n; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    }
    this.visibleCount = n;
  }
  setVisible(b) { for (const m of this.meshes) m.visible = b; }
}
