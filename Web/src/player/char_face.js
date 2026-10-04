// Скульптурная голова: череп с надбровьем, глазницами, скулами, носом, губами, челюстью; глазные яблоки; уши; волосы-карточки; борода.
// Поверхность — «карта высот» над базовым эллипсом headRow (цилиндрическая сетка с учащением на лице), поэтому капюшон/чехол,
// построенные по headRow, садятся на голову без прорезей. Все параметры лица детерминированы по сиду (faceParams).
// Атрибуты вершин кожи головы: aux = (вес века ±, кромка века 0..1, тёмная полость 0..1, вес челюсти 0..1).
// Для волос: aux = (u поперёк, v вдоль, id пряди | -1 = сплошная «шапка», вес челюсти).
import * as THREE from 'three';
import { GB, BI, REG, headRow, HEAD_Y, ellipsoid, tube } from './char_geometry.js';
import { rng } from '../core/util.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const G = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / sy) ** 2));
const tab = (T, y) => { if (y >= T[0][0]) return T[0][1]; for (let i = 1; i < T.length; i++) if (y >= T[i][0]) { const t = (y - T[i - 1][0]) / (T[i][0] - T[i - 1][0]); return lerp(T[i - 1][1], T[i][1], t); } return T[T.length - 1][1]; };
const HSK = [4, 1]; // BI.head (циклический импорт: константу нельзя читать при инициализации модуля)
const tri = (v) => (v < 0.95 ? 0.86 : v > 1.07 ? 1.14 : 1);
const YM = -0.0632; // линия рта

/** Параметры лица из опций (квантованы — геометрия кэшируется по ключу). */
export function faceParams(o) {
  const R = rng(((o.seed | 0) * 7919 + 13) >>> 0);
  const child = o.height < 1.4;
  const g = o.gender ?? (child ? 0.3 : o.build === 'f' ? 0.05 : 0.92);
  const age = o.age ?? (child ? 0.03 : 0.22 + R() * 0.45);
  const J = (k = 0.14) => 1 + (R() * 2 - 1) * k;
  const fem = 1 - g;
  const P = {
    g: Math.round(g * 4) / 4, age: Math.round(age * 4) / 4, child,
    nlen: tri(J()), nwid: tri(J(0.16)) * (child ? 0.8 : 1), nprot: tri(J()) * (child ? 0.62 : 1) * (1 - fem * 0.1),
    brow: (0.55 + g * 0.55) * tri(J()) * (child ? 0.35 : 1), cheek: (0.9 + fem * 0.25) * tri(J()), jaw: (0.7 + g * 0.55) * tri(J()) * (child ? 0.4 : 1),
    chin: (0.75 + g * 0.35) * tri(J()) * (child ? 0.55 : 1), lips: (0.8 + fem * 0.45) * tri(J(0.18)), mouthW: tri(J()),
    eyeSize: (child ? 1.22 : 1 + fem * 0.06) * tri(J(0.1)), eyeSp: tri(J(0.1)) * (child ? 1.05 : 1), fat: clamp((child ? 0.9 : 0.3 + R() * 0.4) - age * 0.2, 0, 1),
    ears: (child ? 1.1 : 1) * tri(J(0.2)),
    asXi: Math.round((R() - 0.5) * 6), asTi: Math.round((R() - 0.5) * 6),
  };
  P.fat = Math.round(P.fat * 3) / 3;
  return P;
}
export const faceKey = (P) => JSON.stringify(P, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v));

// ------------------------------------------------------------------------------------------ поверхность ----
const cache = new Map();
export function faceSurface(P) {
  const key = faceKey(P);
  if (cache.has(key)) return cache.get(key);
  const S = makeSurface(P);
  cache.set(key, S);
  return S;
}

function makeSurface(P) {
  const ex = 0.0335 * P.eyeSp, ey = 0.014, Re = 0.0123 * P.eyeSize, ow = 0.0132 * P.eyeSize, ohU = 0.0058 * P.eyeSize, ohL = 0.0043 * P.eyeSize;
  const age = P.age;
  const PR = [[0.04, 0], [0.032, 0.0015], [0.024, 0.0045], [0.013, 0.0085], [0.002, 0.0135], [-0.008, 0.019], [-0.017, 0.0245], [-0.024, 0.0268], [-0.029, 0.0265], [-0.033, 0.0215], [-0.037, 0.011], [-0.042, 0.002], [-0.048, 0]];
  const WN = [[0.045, 0.0032], [0.02, 0.0052], [0.0, 0.0068], [-0.015, 0.0086], [-0.027, 0.0098], [-0.035, 0.0108], [-0.045, 0.009]];
  const nl = P.nlen;
  function disp(x, y, ca) {
    const ax = Math.abs(x), fw = sstep(-0.05, 0.4, ca), axm = Math.abs(x - P.asXi * 0.0005), ym = y + P.asTi * 0.02 * x;
    let v = 0, dark = 0;
    v += 0.004 * G(ax, y, 0, 0.092, 0.065, 0.035);                                             // лоб
    const yb = 0.04 + 0.009 * Math.min(1, ax / 0.055);
    v += P.brow * 0.0095 * G(ax, y, 0.034, yb, 0.03, 0.0085) + P.brow * 0.004 * G(ax, y, 0, 0.036, 0.013, 0.012); // надбровье
    v -= 0.003 * G(ax, y, 0.074, 0.04, 0.02, 0.035);                                          // висок
    v -= 0.0035 * G(ax, y, ex, ey, 0.019, 0.013);                                             // глазница
    v -= (0.0016 + 0.0045 * age) * G(ax, y, ex, ey - 0.0155, 0.012, 0.0055);                // мешки
    v -= 0.0016 * G(ax, y, ex, ey + 0.0105, 0.016, 0.0022); v += 0.0022 * G(ax, y, ex, ey + 0.0175, 0.018, 0.005); // складка верхнего века
    v += P.cheek * 0.0075 * G(ax, y, 0.054, -0.012, 0.019, 0.014);                            // скула
    v -= (0.0025 + 0.006 * age * (1.1 - P.fat)) * (1.15 - P.fat * 0.6) * G(ax, y, 0.052, -0.05, 0.02, 0.02); // впадина щеки
    // нос
    const pr = tab(PR, ym * (1 / nl) + (nl !== 1 ? 0.0 : 0)) * P.nprot * (0.78 + 0.22 * P.g), wn = tab(WN, ym) * P.nwid;
    v += pr * Math.exp(-((axm / wn) ** 2.3));
    v += 0.0042 * P.nwid * G(axm, ym, 0.0105 * P.nwid, -0.0305, 0.0048, 0.0065);                // крылья
    const nost = G(axm, ym, 0.0068 * P.nwid, -0.0385, 0.0033, 0.0036);
    v -= 0.0085 * nost; dark = Math.max(dark, nost);
    v -= 0.0022 * (0.5 + age) * (G(axm, ym, 0.0150, -0.032, 0.0045, 0.006) + G(axm, ym, 0.0215, -0.046, 0.0045, 0.008) + G(axm, ym, 0.028, -0.062, 0.0045, 0.007)); // носогубная
    // рот
    const mw = 0.0235 * P.mouthW, wf = 1 - sstep(mw * 0.72, mw * 1.12, axm);
    v += 0.0035 * G(axm, ym, 0, -0.066, 0.034, 0.03);                                             // «морда»
    v += 0.0062 * P.lips * G(axm, ym, 0, -0.0572, 0.0185, 0.0046) * (1 - 0.35 * age);           // верхняя губа
    v += 0.0078 * P.lips * G(axm, ym, 0, -0.0708, 0.0172, 0.0055) * (1 - 0.3 * age);            // нижняя губа
    v -= 0.0012 * G(axm, ym, 0.0045, -0.0485, 0.0022, 0.006);                                    // фильтр
    const gy = Math.exp(-(((ym - YM) / 0.0016) ** 2)) * wf;
    v -= 0.0045 * gy; dark = Math.max(dark, gy * 0.95);
    v -= 0.0022 * G(axm, ym, mw * 1.08, YM, 0.0045, 0.0045);
    v -= 0.0035 * G(axm, ym, 0, -0.084, 0.014, 0.0028);                                          // подбородочная борозда
    v += P.chin * 0.016 * G(axm, ym, 0, -0.108, 0.022, 0.014);
    v += P.jaw * 0.004 * G(axm, ym, 0.064, -0.082, 0.02, 0.022) + age * 0.003 * G(axm, ym, 0.045, -0.092, 0.02, 0.014);
    return { v: v * fw, dark: dark * fw };
  }
  const zEdge = (y, x) => { const [rx, rz, cz] = headRow(clamp(y, -0.12, 0.141)); return cz + Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) * rz; };

  /** Точка на поверхности головы (единичный масштаб): угол a (0 — вперёд), высота y. */
  function ptBase(a, y) {
    const [rx, rz, cz] = headRow(clamp(y, -0.12, 0.141)), sa = Math.sin(a), ca = Math.cos(a), rho = Math.hypot(sa * rx, ca * rz) || 1e-4;
    const d = disp(sa * rx, y, ca), m = 1 + d.v / rho;
    return { x: sa * rx * m, y, z: cz + ca * rz * m, dark: d.dark, ca, sa };
  }
  // центр глазного яблока: ищем угол, дающий x=ex на высоте ey
  let lo = 0, hi = 1.2;
  for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (ptBase(mid, ey).x < ex) lo = mid; else hi = mid; }
  const zc = ptBase(lo, ey).z + 0.0035 - Re;
  const eye = { x: ex, y: ey, z: zc, R: Re };
  const lidT = 0.0011;

  function pt(a, y) {
    const p = ptBase(a, y);
    let lid = 0, margin = 0;
    const sg = p.x >= 0 ? 1 : -1, dx = p.x - sg * ex, dy = y - ey, d2 = dx * dx + dy * dy;
    if (d2 < 0.034 * 0.034 && p.ca > 0.2) {
      const R2 = Re + lidT, hug = d2 < R2 * R2 ? zc + Math.sqrt(R2 * R2 - d2) : -1;
      let zz = Math.max(p.z, hug);
      const out = sg * dx, dy2 = dy - 0.0004 - 0.05 * out;
      const q = (dx / ow) ** 2 + (dy2 >= 0 ? (dy2 / ohU) ** 2 : (dy2 / ohL) ** 2);
      const tm = 1 - sstep(0.5, 1.0, q);
      const tuck = zc + Math.sqrt(Math.max(Re * Re - d2, 0)) - 0.0045;
      zz = lerp(zz, tuck, tm);
      p.z = zz;
      margin = sstep(0.6, 1.0, q) * (1 - sstep(1.05, 1.6, q));
      const hx = 1 - sstep(ow * 0.9, ow * 1.8, Math.abs(dx));
      lid = dy2 >= 0 ? hx * (1 - sstep(0.0045, 0.0105, dy2)) : -hx * (1 - sstep(0.0035, 0.0075, -dy2)) * 0.3;
    }
    p.lid = lid; p.margin = margin;
    p.jaw = sstep(YM + 0.0006, YM - 0.0006, y) * (1 - sstep(0.04, 0.078, Math.abs(p.x)));
    return p;
  }
  return { pt, eye, ow, zEdge, P };
}

// ------------------------------------------------------------------------------------------ сетка ----
function rowList(lod) {
  const Y = new Set(), add = (a, b, st) => { for (let y = a; y < b - 1e-9; y += st) Y.add(+y.toFixed(5)); };
  if (lod === 0) {
    add(-0.1205, -0.096, 0.0082); add(-0.096, -0.0755, 0.0052); add(-0.0755, -0.001, 0.0041); add(-0.001, 0.0335, 0.0031); add(0.0335, 0.074, 0.0055); add(0.074, 0.141, 0.0105);
    const keys = [YM + 0.0009, YM - 0.0009, -0.0575, -0.0705, 0.014, 0.141];
    const out = [...Y].filter((y) => !keys.some((k) => Math.abs(k - y) < 0.0011));
    return [...new Set([...out, ...keys].map((v) => +v.toFixed(5)))].sort((a, b) => a - b);
  }
  add(-0.1205, 0.141, 0.022);
  return [...Y, 0.141].sort((a, b) => a - b);
}
function colList(lod) {
  const PI = Math.PI, fine = lod === 0 ? 0.04 : 0.15, coarse = lod === 0 ? 0.2 : 0.4, lim = lod === 0 ? 1.2 : 0.9;
  const pos = [];
  for (let a = 0; a < lim - 1e-6; a += fine) pos.push(a);
  const nC = Math.max(2, Math.round((PI - lim) / coarse)), st = (PI - lim) / (nC + 0.5);
  for (let k = 0; k <= nC; k++) pos.push(lim + st * k);
  return [...pos.slice(1).reverse().map((v) => -v), ...pos];
}

/** Голова целиком. cowled — на голове чехол/капюшон (уши не нужны). Возвращает {eye, hs}. */
export function* buildHeadHi(b, o, lod, B, cowled, P) {
  const S = faceSurface(P), hs = B.head;
  const rows = rowList(lod), cols = colList(lod);
  const X = (x) => x * hs, Y = (y) => HEAD_Y + y * hs, Z = (z) => z * hs + 0.005;
  const N = cols.length;
  let rings = [], meta = [];
  const gk = lod + '|' + hs;
  if (S.grid && S.grid.k === gk) { rings = S.grid.rings; meta = S.grid.meta; }
  else for (let j = 0; j < rows.length; j++) {
    const r = [], mrow = [];
    for (let i = 0; i < N; i++) {
      const p = S.pt(cols[i], rows[j]);
      r.push([X(p.x), Y(p.y), Z(p.z)]);
      mrow.push(p);
    }
    rings.push(r); meta.push(mrow);
  }
  S.grid = { k: gk, rings, meta };
  yield;
  const jawOn = lod === 0;
  b.loft(rings, (j, i) => { const m = meta[j][i]; return { reg: REG.SKIN, aux: [0, 0, 0, 0], face: [m.lid, m.margin, m.dark, jawOn ? m.jaw : 0], sk: HSK }; }, { capStart: true, capEnd: true });
  const e = S.eye;
  const eyeAbs = { x: X(e.x), y: Y(e.y), z: Z(e.z), R: e.R * hs };
  if (lod === 0) {
    for (const s of [-1, 1]) buildEyeball(b, [s * eyeAbs.x, eyeAbs.y, eyeAbs.z], eyeAbs.R);
    buildMouthInterior(b, S, hs, X, Y, Z);
    if (!cowled) for (const s of [-1, 1]) buildEar(b, s, hs, P);
  }
  return { eye: eyeAbs, S };
}

function buildEyeball(b, c, R) {
  // сфера с выпуклой роговицей; регион SCLERA, радужка/зрачок — в шейдере по направлению от центра
  const U = 14, V = 10, rings = [];
  for (let k = 0; k <= V; k++) {
    const ph = -Math.PI / 2 + (Math.PI * k) / V, cy = Math.cos(ph), sy = Math.sin(ph), pts = [];
    for (let i = 0; i < U; i++) {
      const a = (i / U) * Math.PI * 2;
      const dx = Math.sin(a) * cy, dy = sy, dz = Math.cos(a) * cy;
      const ang = Math.acos(clamp(dz, -1, 1)), bulge = 1 + 0.16 * (1 - sstep(0.18, 0.5, ang));
      pts.push([c[0] + dx * R * bulge, c[1] + dy * R * bulge, c[2] + dz * R * bulge]);
    }
    rings.push(pts);
  }
  b.loft(rings, () => ({ reg: REG.SCLERA, aux: [0, 0, 0, 0], sk: HSK }));
}

function buildMouthInterior(b, S, hs, X, Y, Z) {
  const yz = S.zEdge(YM, 0);
  // полость рта (тёмная) и зубы: верхний ряд статичен, нижний едет с челюстью
  ellipsoid(b, [0, Y(YM - 0.002), Z(yz - 0.026)], [0.019 * hs, 0.011 * hs, 0.02 * hs], REG.MOUTH, HSK, { u: 10, v: 6, aux: [0, 0, 0, 0], face: [0, 0, 0, 0] });
  const arc = (y, w, zOff, jaw) => {
    const rings = [];
    for (let k = 0; k < 2; k++) rings.push([...Array(9)].map((_, i) => { const t = (i / 8 - 0.5) * 2, x = t * 0.0175 * hs, z = yz - 0.0095 - 0.0045 * t * t - zOff; return [X(x), Y(y + (k ? -w : 0)), Z(z)]; }));
    b.loft(rings, () => ({ reg: REG.TOOTH, aux: [0, 0, 0, 0], face: [0, 0, 0, jaw], sk: HSK }), { closed: false });
    b.loft(rings.map((r) => r.map((p) => [p[0], p[1], p[2] - 0.003 * hs])), () => ({ reg: REG.TOOTH, aux: [0, 0, 0, 0], face: [0, 0, 0, jaw], sk: HSK }), { closed: false, flip: true });
  };
  arc(YM - 0.0006, 0.0078, 0, 0);
  arc(YM - 0.0016, 0.0072, 0.0012, 1);
}

function buildEar(b, s, hs, P) {
  // Ухо — «чаша» на поверхности головы: приподнятый завиток по краю, углубление раковины, мочка; задний край отстаёт от черепа.
  const k = P.ears * hs, cy = -0.008, cz0 = -0.013, RY = 0.031 * k / hs, RZ = 0.019 * k / hs, NU = 16, NV = 6;
  const sheet = (inset) => {
    const rings = [];
    for (let v = 0; v <= NV; v++) {
      const rho = v / NV, ring = [];
      for (let u = 0; u < NU; u++) {
        const th = (u / NU) * Math.PI * 2, ey = Math.cos(th) * rho * RY, ez = Math.sin(th) * rho * RZ * (1 + 0.12 * Math.cos(th));
        const y = cy + ey, rx = headRow(clamp(y, -0.12, 0.141))[0] * 0.989;
        const back = clamp(0.5 - ez / RZ * 0.5, 0, 1), lobe = sstep(-0.25, -1.0, Math.cos(th) * rho) * 0.55;
        const rimK = sstep(0.55, 0.85, rho) * (1 - sstep(0.93, 1.0, rho));
        const xo = 0.0012 + 0.0052 * rimK * (1 - 0.7 * lobe) + 0.0032 * (1 - rho * rho) * (1 - 0.4 * back) + 0.014 * Math.pow(back, 1.5) * rho * (1 - lobe) - inset;
        ring.push([s * (rx + xo) * hs, HEAD_Y + y * hs, (cz0 + ez) * hs + 0.005]);
      }
      rings.push(ring);
    }
    return rings;
  };
  b.loft(sheet(0), () => ({ reg: REG.SKIN, aux: [0, 0, 0, 0], sk: HSK }), { capStart: false, capEnd: false });
  b.loft(sheet(0.0028), () => ({ reg: REG.SKIN, aux: [0, 0, 0, 0], sk: HSK }), { capStart: false, capEnd: false, flip: true });
}

// ------------------------------------------------------------------------------------------ волосы ----
/** Линия роста волос по углу s=|a|: высота y (в локальных координатах головы). */
function hairline(s, bald) {
  const T = [[0, 0.094], [0.5, 0.088], [0.9, 0.062], [1.25, 0.012], [1.5, 0.026], [1.9, 0.01], [2.3, -0.04], [3.2, -0.074]];
  let y = T[T.length - 1][1];
  for (let i = 1; i < T.length; i++) if (s <= T[i][0]) { y = lerp(T[i - 1][1], T[i][1], (s - T[i - 1][0]) / (T[i][0] - T[i - 1][0])); break; }
  return y + bald * (0.03 * (1 - sstep(0.9, 2.2, s)) + 0.02);
}

function strip(b, left, right, hint, meta, nrm) {
  // полоса из пар точек (left[k], right[k]); ориентация — по подсказке нормали hint[k]
  const base = b.n, K = left.length;
  for (let k = 0; k < K; k++) {
    const m = meta(k / (K - 1));
    b.vert(left[k][0], left[k][1], left[k][2], REG.HAIR, [0, m.v, m.id, 0], HSK, [0, 0, 0, m.jaw], nrm ? nrm[k] : null);
    b.vert(right[k][0], right[k][1], right[k][2], REG.HAIR, [1, m.v, m.id, 0], HSK, [0, 0, 0, m.jaw], nrm ? nrm[k] : null);
  }
  // проверка ориентации по первому квадрату
  const P = b.p, a = base, c = base + 1, d = base + 2;
  const e1 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]], e2 = [P[d * 3] - P[a * 3], P[d * 3 + 1] - P[a * 3 + 1], P[d * 3 + 2] - P[a * 3 + 2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const flip = n[0] * hint[0][0] + n[1] * hint[0][1] + n[2] * hint[0][2] < 0;
  for (let k = 0; k < K - 1; k++) {
    const i0 = base + k * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i0 + 3;
    if (flip) b.idx.push(i0, i2, i1, i1, i2, i3); else b.idx.push(i0, i1, i2, i1, i3, i2);
  }
}

/**
 * Волосы: непрозрачная «шапка» + слои карточек с прядями (alpha-test в шейдере). style: short | crop | bun | long | braid.
 * Бровей геометрией нет — они в шейдере. Возвращает ничего.
 */
export function* buildHair(b, o, lod, B, P, S) {
  const style = o.hair;
  if (!style || style === 'none') return;
  const hs = B.head, R = rng(((o.seed | 0) * 31 + 7) >>> 0);
  const bald = P.age > 0.8 ? 0.7 : P.age > 0.55 && P.g > 0.5 ? 0.25 : 0;
  const X = (x) => x * hs, Y = (y) => HEAD_Y + y * hs, Z = (z) => z * hs + 0.005;
  const surf = (a, y, off) => {
    const p = S.pt(a, y), [rx, rz, cz] = headRow(clamp(y, -0.12, 0.141));
    let nx = p.x / (rx * rx + 1e-6), nz = (p.z - cz) / (rz * rz + 1e-6), nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    // у макушки нормаль наклоняется вверх
    const up = sstep(0.1, 0.145, y) * 0.9, ny = up, nn = Math.hypot(nx, ny, nz);
    const n = [nx / nn, ny / nn, nz / nn];
    return { p: [X(p.x + n[0] * off), Y(y + n[1] * off), Z(p.z + n[2] * off)], n };
  };
  const shortN = style === 'crop' ? 0.7 : 1;
  // --- шапка ---
  const NC = lod === 0 ? 40 : 16, NR = lod === 0 ? 10 : 5;
  const capRings = [], capN = [];
  for (let j = 0; j < NR; j++) {
    const t = j / (NR - 1), r = [], rn = [];
    for (let i = 0; i < NC; i++) {
      const a = -Math.PI + (i / NC) * Math.PI * 2, hl = hairline(Math.abs(a), bald) + (j === 0 ? 0 : 0);
      const y = lerp(hl, 0.1405, t ** 0.85), off = 0.0042 + 0.0025 * Math.sin(t * Math.PI) * (style === 'long' ? 1 : 0.5);
      const sf = surf(a, y, off); r.push(sf.p); rn.push(sf.n);
    }
    capRings.push(r); capN.push(rn);
  }
  const hcap = style === 'bald';
  if (!hcap) b.loft(capRings, (j, i) => ({ reg: REG.HAIR, aux: [0, 0, lod > 0 ? -2 : -1, 0], sk: HSK, nrm: capN[j][i] }), { capEnd: true });
  if (lod > 0) {
    // дальний/средний LOD: силуэт причёски без карточек
    if (style === 'bun') { const bz = headRow(0.07)[2] - headRow(0.07)[1]; ellipsoid(b, [0, Y(0.072), Z(bz - 0.028)], [0.042 * hs, 0.034 * hs, 0.032 * hs], REG.HAIR, HSK, { u: 8, v: 5, aux: [0, 0, -2, 0] }); }
    else if (style === 'long' || style === 'braid') ellipsoid(b, [0, Y(-0.05), Z(headRow(-0.04)[2] - headRow(-0.04)[1] * 0.8)], [0.07 * hs, 0.085 * hs, 0.03 * hs], REG.HAIR, HSK, { u: 8, v: 5, aux: [0, 0, -2, 0] });
    return;
  }
  // --- карточки ---
  const cards = style === 'long' || style === 'braid' ? 340 : style === 'bun' ? 250 : 250;
  const jawBeard = 0;
  for (let c = 0; c < cards; c++) {
    if (c % 110 === 109) yield;
    const layer = c % 3, a0 = (R() * 2 - 1) * Math.PI, s0 = Math.abs(a0), hl0 = hairline(s0, bald);
    const y0 = lerp(hl0 + 0.004, 0.135, Math.pow(R(), 0.75));
    if (style === 'bun' && R() < 0.0) continue;
    const K = 4, left = [], right = [], hint = [];
    const w0 = (0.01 + R() * 0.009) * (layer === 0 ? 1.2 : 1) * hs;
    let len = style === 'long' ? 0.12 + R() * 0.07 : style === 'braid' ? 0.1 + R() * 0.05 : style === 'bun' ? 0.2 + R() * 0.1 : (0.03 + R() * 0.03) * shortN;
    const swirl = (R() - 0.5) * 0.5;
    const pts = [], norms = [];
    for (let k = 0; k < K; k++) {
      const t = k / (K - 1);
      let a, y;
      if (style === 'bun') {
        // зачёс назад к пучку
        const s = Math.sign(a0) || 1, tt = t * Math.min(1, len / 0.2), tgt = s * Math.PI * (0.92 + 0.05 * R());
        a = a0 + (tgt - a0) * tt * (s0 < 1.0 ? 0.55 : 0.7) + swirl * 0.1 * tt;
        y = lerp(y0, 0.075, tt * (s0 < 1.0 ? 0.55 : 0.8)) + 0.035 * Math.sin(Math.PI * tt) * (1 - s0 / Math.PI);
      } else {
        a = a0 + swirl * t * 0.25; y = y0 - t * len;
        // не опускаться ниже линии роста для коротких стрижек
        if (style === 'short' || style === 'crop') { const hl = hairline(Math.abs(a), bald); y = Math.max(y, hl - 0.002 - 0.004 * layer); }
      }
      const lift = 0.0042 + layer * 0.0018 + t * 0.0022 * (style === 'long' ? 2.2 : 1);
      if (y < -0.108) {
        // ниже подбородка — свободно вниз
        const base = surf(a, -0.108, lift + 0.004 + (-0.108 - y) * 0.2);
        pts.push([base.p[0], Y(y), base.p[2]]); norms.push(base.n);
      } else { const q = surf(a, y, lift); pts.push(q.p); norms.push(q.n); }
    }
    for (let k = 0; k < K; k++) {
      const p = pts[k], n = norms[k], pn = pts[Math.min(K - 1, k + 1)], pp = pts[Math.max(0, k - 1)];
      let tx = pn[0] - pp[0], ty = pn[1] - pp[1], tz = pn[2] - pp[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let sx = ty * n[2] - tz * n[1], sy = tz * n[0] - tx * n[2], sz = tx * n[1] - ty * n[0]; const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      const w = w0 * (1 - 0.35 * (k / (K - 1))) * 0.5;
      left.push([p[0] - sx * w, p[1] - sy * w, p[2] - sz * w]); right.push([p[0] + sx * w, p[1] + sy * w, p[2] + sz * w]); hint.push(n);
    }
    const id = R();
    strip(b, left, right, hint, (t) => ({ v: t, id: 0.05 + id * 0.9, jaw: jawBeard }), norms);
  }
  if (style === 'bun') {
    // пучок: сплюснутый эллипсоид + пара обводящих прядей
    const bz = S.zEdge(0.06, 0) * 0 + headRow(0.07)[2] - headRow(0.07)[1] * 1.0;
    ellipsoid(b, [0, Y(0.072), Z(bz - 0.028)], [0.042 * hs, 0.034 * hs, 0.032 * hs], REG.HAIR, HSK, { u: 12, v: 8, aux: [0, 0, -1, 0] });
    for (let k = 0; k < 3; k++) tube(b, [...Array(11)].map((_, i) => { const t = (i / 10) * Math.PI * 1.8 + k * 1.0; return [Math.cos(t) * 0.04 * hs, Y(0.072 + Math.sin(t) * 0.032), Z(bz - 0.028) - Math.abs(Math.sin(t * 0.5)) * 0.01 - 0.026 * hs]; }), 0.0042, REG.HAIR, () => HSK, { seg: 5, aux: [0, 0, -1, 0] });
  }
}

/** Борода/усы-карточки: корни на нижней части лица, пряди вниз и вперёд; двигаются с челюстью. */
export function* buildBeard(b, o, lod, B, P, S) {
  const hs = B.head, R = rng(((o.seed | 0) * 17 + 3) >>> 0);
  const X = (x) => x * hs, Y = (y) => HEAD_Y + y * hs, Z = (z) => z * hs + 0.005;
  const len0 = o.beardLen ?? 0.1;
  const top = (s) => (s < 0.4 ? -0.076 : s < 1.0 ? lerp(-0.076, -0.02, sstep(0.4, 1.0, s)) : lerp(-0.02, 0.0, sstep(1.0, 1.6, s)));
  const outN = (p, y) => { const [rx, rz, cz] = headRow(clamp(y, -0.12, 0.14)); const nx = p.x / (rx * rx), nz = (p.z - cz) / (rz * rz), l = Math.hypot(nx, nz) || 1; return [nx / l, nz / l]; };
  const jawW = (y, x) => sstep(-0.05, -0.085, y) * (1 - sstep(0.04, 0.078, Math.abs(x)));
  // подложка: непрозрачная шапка бороды (тёмные корни)
  const NR = lod > 1 ? 4 : lod > 0 ? 5 : 7, NC = lod > 1 ? 9 : lod > 0 ? 13 : 19, rings = [];
  for (let j = 0; j < NR; j++) {
    const t = j / (NR - 1), r = [];
    for (let i = 0; i < NC; i++) {
      const a = lerp(-1.5, 1.5, i / (NC - 1)), y = lerp(top(Math.abs(a)), -0.118, t), p = S.pt(a, y), n = outN(p, y), off = 0.0035 + 0.003 * Math.sin(t * 3);
      r.push([X(p.x + n[0] * off), Y(y), Z(p.z + n[1] * off)]);
    }
    rings.push(r);
  }
  b.loft(rings, (j, i, p) => ({ reg: REG.HAIR, aux: [0, 0, lod > 0 ? -2 : -1, 0], face: [0, 0, 0, lod > 0 ? 0 : jawW((p[1] - HEAD_Y) / hs, p[0] / hs)], sk: HSK }), { closed: false });
  if (lod > 0) return;
  const strand = (a0, yTop, L, w0, layer, jawFlag) => {
    const K = 4, pts = [], norms = [];
    for (let k = 0; k < K; k++) {
      const t = k / (K - 1), y = yTop - t * L, yy = Math.max(y, -0.118), p = S.pt(a0, yy), n = outN(p, yy), drop = Math.max(0, -0.118 - y);
      const off = 0.005 + 0.005 * layer + t * 0.008;
      pts.push([X(p.x + n[0] * (off + drop * 0.2)), Y(y), Z(p.z + n[1] * (off + drop * 0.5))]); norms.push([n[0], 0.15, n[1]]);
    }
    const left = [], right = [];
    for (let k = 0; k < K; k++) {
      const p = pts[k], pn = pts[Math.min(K - 1, k + 1)], pp = pts[Math.max(0, k - 1)], nrm = norms[k];
      let tx = pn[0] - pp[0], ty = pn[1] - pp[1], tz = pn[2] - pp[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let sx = ty * nrm[2] - tz * nrm[1], sy = tz * nrm[0] - tx * nrm[2], sz = tx * nrm[1] - ty * nrm[0]; const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      const w = w0 * 0.5 * (1 - 0.3 * k / (K - 1));
      left.push([p[0] - sx * w, p[1] - sy * w, p[2] - sz * w]); right.push([p[0] + sx * w, p[1] + sy * w, p[2] + sz * w]);
    }
    const id = R(), jw = jawFlag ? jawW(yTop, S.pt(a0, yTop).x) : 0;
    strip(b, left, right, norms, (t) => ({ v: t, id: 0.05 + id * 0.9, jaw: jw }), norms);
  };
  for (let c = 0; c < 170; c++) {
    if (c % 60 === 59) yield;
    const a0 = (R() * 2 - 1) * 1.45, s0 = Math.abs(a0), L = len0 * (0.55 + R() * 0.7) * (s0 < 0.5 ? 1.3 : 0.7) * (0.45 + 0.55 * Math.cos(s0 * 0.9));
    strand(a0, top(s0) + R() * 0.02, L, (0.012 + R() * 0.01) * hs, c % 3, true);
  }
  // усы
  for (const s of [-1, 1]) for (let c = 0; c < 9; c++) {
    const y0 = -0.045 - R() * 0.008, x0 = (0.002 + R() * 0.014) * s, p0 = S.pt(Math.asin(clamp(x0 / 0.075, -1, 1)), y0);
    const pts = [0, 1, 2].map((k) => [X(p0.x + s * k * 0.008), Y(y0 - k * 0.005), Z(p0.z + 0.005 - k * 0.002)]);
    strip(b, pts.map((p) => [p[0], p[1] + 0.0028, p[2]]), pts.map((p) => [p[0], p[1] - 0.0028, p[2]]), [[0, 0, 1], [0, 0, 1], [0, 0, 1]], (t) => ({ v: t, id: 0.05 + R() * 0.9, jaw: 0 }));
  }
}

/** Параметры для униформ шейдера (глаз и т.д.). */
export function faceUniformsSpec(build, P, B) {
  const S = faceSurface(P), hs = B.head, e = S.eye;
  return { eye: [e.x * hs, HEAD_Y + e.y * hs, e.z * hs + 0.005, e.R * hs], ow: S.ow * hs };
}
