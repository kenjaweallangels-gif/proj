// Архитектура сиетча: стены с проёмами (полосы по кривым потолков), полы, своды с рёбрами, порталы,
// колонны, балконы, лестницы, двери-уплотнители, ниши, цистерна. Всё в локальных координатах.
import * as THREE from 'three';
import { Builder } from './builder.js';
import { CELLS, NICHES, ceilAt, inCell, GALLERY, BRIDGE, FUNERAL, cell, addBlock, STAIRS, stairH } from './plan.js';
import { clamp, smoothstep, rng } from '../core/util.js';
import { buildHall } from './hall.js';

export const regionOf = (c) => (c.id === 'B1' ? 'B1' : c.id === 'B2' ? 'B2' : c.id === 'B4' || c.id === 'B4a' ? 'B4' : c.id === 'B5' ? 'B5' : 'B3');
export const DOORS = [{ x: 8, id: 'outer' }, { x: 24, id: 'inner' }];

const SIDE = {
  w: (c) => ({ a: c.z0, b: c.z1, pt: (u, y) => [c.x0, y, u], inn: (u) => [c.x0, u], out: (u) => [c.x0 - 0.02, u], n: [1, 0, 0], horiz: false }),
  e: (c) => ({ a: c.z0, b: c.z1, pt: (u, y) => [c.x1, y, u], inn: (u) => [c.x1, u], out: (u) => [c.x1 + 0.02, u], n: [-1, 0, 0], horiz: false }),
  n: (c) => ({ a: c.x0, b: c.x1, pt: (u, y) => [u, y, c.z0], inn: (u) => [u, c.z0], out: (u) => [u, c.z0 - 0.02], n: [0, 0, 1], horiz: true }),
  s: (c) => ({ a: c.x0, b: c.x1, pt: (u, y) => [u, y, c.z1], inn: (u) => [u, c.z1], out: (u) => [u, c.z1 + 0.02], n: [0, 0, -1], horiz: true }),
};

/** Высота проёма в стене стороны key ячейки c в точке u (0 — стена до пола). */
function holeH(c, S, covering, u) {
  let h = 0;
  for (const n of covering) { const o = S.out(u); h = Math.max(h, ceilAt(n, o[0], o[1])); }
  return h;
}

const sootPar = (top) => (x, y) => [0, clamp(smoothstep(top - 3.0, top + 0.3, y) * 0.85 + 0.06, 0, 1), 0];

function wallSide(B, c, key, o = {}) {
  const S = SIDE[key](c);
  const nbs = CELLS.filter((n) => n !== c);
  const bps = new Set([S.a, S.b]);
  for (const n of nbs) {
    const [n0, n1] = S.horiz ? [n.x0, n.x1] : [n.z0, n.z1];
    if (n0 > S.a + 1e-6 && n0 < S.b - 1e-6) bps.add(n0);
    if (n1 > S.a + 1e-6 && n1 < S.b - 1e-6) bps.add(n1);
  }
  const arr = [...bps].sort((p, q) => p - q);
  const solidRuns = [];
  const top = c.crown + 0.4;
  const openings = [];
  for (let k = 0; k < arr.length - 1; k++) {
    const p = arr[k], q = arr[k + 1];
    if (q - p < 1e-4) continue;
    const m = (p + q) / 2, mo = S.out(m);
    const covering = nbs.filter((n) => inCell(n, mo[0], mo[1]));
    const nu = Math.max(1, Math.ceil((q - p) / 0.2));
    const us = [], Hs = [], Ts = [];
    for (let i = 0; i <= nu; i++) {
      const u = p + ((q - p) * i) / nu;
      const ip = S.inn(u);
      us.push(u);
      Hs.push(covering.length ? holeH(c, S, covering, u) : 0);
      Ts.push(ceilAt(c, ip[0], ip[1]));
    }
    if (covering.length) openings.push({ p, q, covering, Hs, us });
    else solidRuns.push([p, q]);
    let maxd = 0;
    for (let i = 0; i <= nu; i++) maxd = Math.max(maxd, Ts[i] - Math.min(Hs[i], Ts[i]));
    if (maxd < 0.02) continue;
    const nv = Math.max(1, Math.ceil(maxd / 1.4));
    const rails = [];
    for (let j = 0; j <= nv; j++) {
      const row = [];
      for (let i = 0; i <= nu; i++) { const H = Math.min(Hs[i], Ts[i]); row.push(S.pt(us[i], H + ((Ts[i] - H) * j) / nv)); }
      rails.push(row);
    }
    B.rails('stone', rails, { want: S.n, par: o.par || sootPar(top), color: o.color || [1, 1, 1] });
  }
  // цоколь по сплошным участкам
  if (!o.noPlinth) {
    let cur = null; const runs = [];
    for (const [p, q] of solidRuns) { if (cur && Math.abs(cur[1] - p) < 1e-4) cur[1] = q; else { cur = [p, q]; runs.push(cur); } }
    for (const [p, q] of runs) {
      if (q - p < 0.4) continue;
      const mid = (p + q) / 2, len = q - p;
      const ip = S.inn(mid);
      const off = 0.07;
      const px = ip[0] + S.n[0] * off, pz = ip[1] + S.n[2] * off;
      const size = S.horiz ? [len, 0.34, 0.14] : [0.14, 0.34, len];
      B.box('stone', S.horiz ? [mid, 0.17, ip[1] + S.n[2] * off] : [ip[0] + S.n[0] * off, 0.17, mid], size, { par: [0.7, 0, 0] });
    }
  }
  return { S, openings };
}

function frameBand(B, S, pts, w, d, o = {}) {
  // Рамка проёма: полоса вдоль контура (u,v) с откосом и фаской. pts: [[u,v],...] слева-снизу → справа-снизу.
  let cu = 0, vmax = 0; for (const p of pts) { cu += p[0]; vmax = Math.max(vmax, p[1]); } cu /= pts.length;
  const cv = vmax * 0.35;
  const n = pts.length;
  const O = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tu = b[0] - a[0], tv = b[1] - a[1]; const l = Math.hypot(tu, tv) || 1; tu /= l; tv /= l;
    let nu = -tv, nv = tu;
    if (nu * (p[0] - cu) + nv * (p[1] - cv) < 0) { nu = -nu; nv = -nv; }
    return [nu, nv];
  });
  const A = [], A2 = [], Bb = [], B2 = [];
  const nx = S.n[0], nz = S.n[2];
  pts.forEach((p, i) => {
    const a = S.pt(p[0], p[1]);
    const bpt = S.pt(p[0] + O[i][0] * w, Math.max(0, p[1] + O[i][1] * w));
    A.push(a); Bb.push(bpt);
    A2.push([a[0] + nx * d, a[1], a[2] + nz * d]);
    B2.push([bpt[0] + nx * d * 0.35, bpt[1], bpt[2] + nz * d * 0.35]);
  });
  const col = o.color || [1, 1, 1], par = o.par || [0.55, 0.1, 0];
  const o3 = [Bb[0][0] - A[0][0], Bb[0][1] - A[0][1], Bb[0][2] - A[0][2]];
  B.rails('stone', [A, A2], { want: [-o3[0], -o3[1], -o3[2]], par, color: col });                       // откос
  B.rails('stone', [A2, B2], { want: S.n, par, color: col });                                              // лицо
  B.rails('stone', [B2, Bb], { want: [S.n[0] + o3[0] * 0.5, S.n[1] + o3[1] * 0.5, S.n[2] + o3[2] * 0.5], par, color: col }); // фаска
}

function portal(B, c, key, n, o = {}) {
  // Рамка вокруг проёма из ячейки c в соседнюю n (по стороне key).
  const S = SIDE[key](c);
  const [n0, n1] = S.horiz ? [n.x0, n.x1] : [n.z0, n.z1];
  const u0 = Math.max(S.a, n0), u1 = Math.min(S.b, n1);
  if (u1 - u0 < 0.5) return;
  const pts = [[u0, 0]];
  const N = 22;
  for (let i = 0; i <= N; i++) { const u = u0 + ((u1 - u0) * i) / N; const oo = S.out(u); pts.push([u, ceilAt(n, oo[0], oo[1])]); }
  pts.push([u1, 0]);
  frameBand(B, S, pts, o.w || 0.36, o.d || 0.3, o);
}

function decal(B, name, x, y, z, w, h, face, o = {}) {
  const off = 0.012;
  const n = { 'x+': [1, 0, 0], 'x-': [-1, 0, 0], 'z+': [0, 0, 1], 'z-': [0, 0, -1] }[face];
  const hw = w / 2, hh = h / 2;
  let a, b, c, d;
  if (face[0] === 'z') { const s = n[2]; a = [x - hw * s, y - hh, z + off * s]; b = [x + hw * s, y - hh, z + off * s]; c = [x + hw * s, y + hh, z + off * s]; d = [x - hw * s, y + hh, z + off * s]; }
  else { const s = n[0]; a = [x + off * s, y - hh, z + hw * s]; b = [x + off * s, y - hh, z - hw * s]; c = [x + off * s, y + hh, z - hw * s]; d = [x + off * s, y + hh, z + hw * s]; }
  B.quad(`decal:${name}`, a, b, c, d, { want: n, color: o.color || [1, 1, 1], par: [0, 0, 0] });
}

function archPath(c, x, n = 20) { // дуга поперёк ячейки в плоскости x (ось X) → точки [x,y,z]
  const pts = [];
  for (let i = 0; i <= n; i++) { const z = c.z0 + ((c.z1 - c.z0) * i) / n; pts.push([x, ceilAt(c, x, z), z]); }
  return pts;
}
function archPathZ(c, z, n = 20) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const x = c.x0 + ((c.x1 - c.x0) * i) / n; pts.push([x, ceilAt(c, x, z), z]); }
  return pts;
}
/** Ребро свода: сечение w×d, ведётся по дуге, выступает вниз. */
function rib(B, c, pos, w, d, o = {}) {
  const alongX = c.axis === 'x';
  const base = alongX ? archPath(c, pos, 24) : archPathZ(c, pos, 24);
  const sec = (p, i) => {
    const a = base[Math.max(0, i - 1)], b = base[Math.min(base.length - 1, i + 1)];
    const tx = alongX ? 0 : b[0] - a[0], tz = alongX ? b[2] - a[2] : 0, ty = b[1] - a[1];
    const l = Math.hypot(tx, ty, tz) || 1;
    // внутрь (вниз): перпендикуляр к касательной в плоскости сечения
    const dx = alongX ? 0 : ty / l, dz = alongX ? ty / l : 0, dy = -(alongX ? tz : tx) / l;
    return [dx, dy, dz];
  };
  const inw = base.map(sec);
  const lo = [], hi = [], loD = [], hiD = [];
  base.forEach((p, i) => {
    const n = inw[i]; const k = d;
    const sx = alongX ? w / 2 : 0, sz = alongX ? 0 : w / 2;
    lo.push([p[0] - sx, p[1], p[2] - sz]); hi.push([p[0] + sx, p[1], p[2] + sz]);
    loD.push([p[0] - sx + n[0] * k, p[1] + n[1] * k, p[2] - sz + n[2] * k]); hiD.push([p[0] + sx + n[0] * k, p[1] + n[1] * k, p[2] + sz + n[2] * k]);
  });
  const par = o.par || [0.25, 0.35, 1], col = o.color || [1, 1, 1];
  B.rails('stone', [loD, hiD], { want: inw[0], par, color: col });
  B.rails('stone', [lo, loD], { want: alongX ? [-1, 0, 0] : [0, 0, -1], par, color: col });
  B.rails('stone', [hiD, hi], { want: alongX ? [1, 0, 0] : [0, 0, 1], par, color: col });
}

function floorCell(B, c) {
  const nx = Math.max(1, Math.ceil((c.x1 - c.x0) / 2)), nz = Math.max(1, Math.ceil((c.z1 - c.z0) / 2));
  const wear = (x, y, z) => {
    const cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
    const d = c.axis === 'x' ? Math.abs(z - cz) : c.axis === 'z' ? Math.abs(x - cx) : Math.min(Math.abs(x - cx), Math.abs(z - cz));
    const w = (c.axis === 'x' ? c.z1 - c.z0 : c.x1 - c.x0) * 0.22 + 0.4;
    return [0.1 + 0.5 * Math.exp(-((d / w) ** 2)), 0.05, 0];
  };
  B.grid('stone', (s, t) => [c.x0 + (c.x1 - c.x0) * s, 0, c.z0 + (c.z1 - c.z0) * t], nx, nz, { want: [0, 1, 0], par: wear });
}
function ceilingCell(B, c) {
  const len = c.axis === 'z' ? c.z1 - c.z0 : c.x1 - c.x0;
  const wid = c.axis === 'z' ? c.x1 - c.x0 : c.z1 - c.z0;
  const nl = Math.max(1, Math.ceil(len / 1.5)), nw = c.crown > c.spring ? Math.max(8, Math.ceil(wid / 0.6)) : Math.max(1, Math.ceil(wid / 2));
  const un = c.axis === 'z' ? nw : nl, vn = c.axis === 'z' ? nl : nw;
  B.grid('stone', (s, t) => { const x = c.x0 + (c.x1 - c.x0) * s, z = c.z0 + (c.z1 - c.z0) * t; return [x, ceilAt(c, x, z), z]; }, un, vn, { want: [0, -1, 0], par: [0.0, 0.62, 1] });
}

function column(B, x, z, h, o = {}) {
  const r = o.r || 0.45;
  const pts = [[r * 1.55, 0], [r * 1.55, 0.2], [r * 1.25, 0.34], [r * 1.05, 0.42], [r, 0.55], [r * 0.92, h * 0.35], [r * 0.88, h * 0.7], [r * 0.95, h - 0.75], [r * 1.12, h - 0.55], [r * 1.35, h - 0.38], [r * 1.5, h - 0.28], [r * 1.5, h - 0.1], [r * 1.5, h], [0, h]];
  B.lathe('stone', pts, [x, o.y0 || 0, z], 16, { par: [0.45, 0.05, 0], color: o.color });
  // резные кольца
  for (const hh of [h * 0.35, h * 0.7]) B.cyl('stone', [x, (o.y0 || 0) + hh, z], r * 1.0, r * 1.0, 0.1, 16, { par: [0.7, 0, 0] });
}

function archSpandrel(B, x0, x1, y0, yTop, zPlane, nrm) {
  // Арка между колоннами: заполнение выше дуги, лицевая грань + нижняя (интрадос).
  const w = x1 - x0, N = 20, front = [], edge = [], back = [];
  const top = [], bot = [];
  const rise = Math.min(1.1, w * 0.2);
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = x0 + w * t;
    const yb = y0 + rise * Math.sqrt(Math.max(0, 1 - ((t - 0.5) / 0.5) ** 2));
    bot.push([x, yb, zPlane]); top.push([x, yTop, zPlane]);
  }
  B.rails('stone', [bot, top], { want: [0, 0, nrm], par: [0.35, 0.1, 0] });
  const bot2 = bot.map((p) => [p[0], p[1], p[2] - nrm * 0.45]);
  B.rails('stone', [bot, bot2], { want: [0, -1, 0], par: [0.5, 0.1, 0] });
  const top2 = top.map((p) => [p[0], p[1], p[2] - nrm * 0.45]);
  B.rails('stone', [bot2, top2], { want: [0, 0, -nrm], par: [0.2, 0.1, 0] });
}

function balustrade(B, x0, x1, z, y, dirZ) {
  // Балюстрада: перила + балясины + резная панель; полировка рук.
  const len = x1 - x0;
  B.box('stone', [(x0 + x1) / 2, y + 1.05, z], [len, 0.1, 0.34], { par: [1, 0, 0] });
  B.box('stone', [(x0 + x1) / 2, y + 0.1, z], [len, 0.2, 0.3], { par: [0.5, 0, 0] });
  const n = Math.floor(len / 0.34);
  for (let i = 0; i <= n; i++) {
    const x = x0 + (len * i) / n;
    B.lathe('stone', [[0.04, 0], [0.09, 0.1], [0.06, 0.3], [0.08, 0.5], [0.06, 0.7], [0.1, 0.85], [0.04, 0.9]], [x, y + 0.2, z], 8, { par: [0.7, 0, 0] });
  }
  for (let x = x0; x <= x1 + 0.01; x += 3) B.box('stone', [x, y + 0.55, z], [0.28, 1.1, 0.4], { par: [0.8, 0, 0] });
}

// ----------------------------------------------------------------- построение ----
export function buildStatic(B, M, ctx) {
  const rg = rng(2024);
  ctx.decals = [];
  const GL = ctx.globes;

  // 1. Каркас: полы, потолки, стены.
  for (const c of CELLS) {
    B.region = regionOf(c);
    if (!c.custom) { if (c.id !== 'B4') floorCell(B, c); ceilingCell(B, c); }
    for (const k of ['w', 'e', 'n', 's']) wallSide(B, c, k);
  }

  // 2. Рёбра сводов.
  B.region = 'B1';
  for (let x = 2; x < 40; x += 4) rib(B, cell('B1'), x, 0.5, 0.28);
  B.region = 'B2';
  for (let x = 47; x <= 95; x += 6) rib(B, cell('B2'), x, 0.7, 0.55);
  B.region = 'B3';
  for (const id of ['B3c', 'B3n1', 'B3s1']) { const c = cell(id); for (let x = c.x0 + 3; x < c.x1 - 1; x += 3.5) rib(B, c, x, 0.36, 0.2); }
  { const c = cell('B3n2'); for (let z = c.z0 + 2.5; z < c.z1 - 2; z += 3.5) rib(B, c, z, 0.36, 0.2); }
  { const c = cell('B3n3'); for (let x = c.x0 + 5; x < c.x1 - 1; x += 3.5) rib(B, c, x, 0.36, 0.2); }
  B.region = 'B4';
  { const c = cell('B4'); for (let x = 112; x < 140; x += 7) rib(B, c, x, 0.6, 0.45); }

  // 3. Порталы (рамки проёмов).
  B.region = 'B2';
  portal(B, cell('B2'), 'w', cell('B1'), { w: 0.5, d: 0.45 });
  for (const id of ['B3n1', 'B3c', 'B3s1']) portal(B, cell('B2'), 'e', cell(id), { w: 0.42, d: 0.35 });
  B.region = 'B3';
  portal(B, cell('B3v'), 'e', cell('B5'), { w: 0.3, d: 0.3 });
  B.region = 'B5';
  portal(B, cell('B5'), 'w', cell('B3v'), { w: 0.7, d: 0.6 });
  for (const n of NICHES) { if (n.open) { B.region = 'B3'; portal(B, cell(n.side < 0 ? 'B3c' : 'B3c'), n.side < 0 ? 'n' : 's', cell(n.id), { w: 0.28, d: 0.22 }); } }

  // 4. B1: крыша двери-камня, шлюзы.
  b1(B, ctx, decal);
  // 5. B2: балконы, лестницы, колонны, мост, световые колодцы.
  b2(B, ctx, decal, rg);
  // 6. B3: ниши и тупик.
  b3(B, ctx, decal, rg);
  // 7. B4: цистерна.
  b4(B, ctx, decal, rg);
  buildHall(B, ctx, decal);

  // 8. Кронштейны и цепи светошаров.
  for (const g of GL) {
    B.region = g.region;
    if (g.wall && (g.wall[0] || g.wall[2])) {
      const [wx, , wz] = g.wall;
      // кронштейн: пластина на стене, консоль, кольцо
      B.box('metal', [g.x - wx * 0.22, g.y - 0.08, g.z - wz * 0.22], [Math.abs(wx) > 0 ? 0.36 : 0.1, 0.08, Math.abs(wz) > 0 ? 0.36 : 0.1], { color: [0.55, 0.45, 0.35] });
      B.box('metal', [g.x - wx * 0.38, g.y + 0.02, g.z - wz * 0.38], [Math.abs(wx) > 0 ? 0.04 : 0.2, 0.42, Math.abs(wz) > 0 ? 0.04 : 0.2], { color: [0.5, 0.4, 0.3] });
      B.cyl('metal', [g.x, g.y - 0.17, g.z], 0.14, 0.06, 0.09, 12, { color: [0.5, 0.4, 0.3] });
    } else if (g.chain) {
      let top;
      if (g.region === 'B2') top = ceilAt(cell('B2'), g.x, g.z);
      else if (g.region === 'B4') top = ceilAt(cell('B4'), g.x, g.z);
      else top = g.y + g.chain;
      const L = top - g.y - 0.15;
      B.cyl('metal', [g.x, g.y + 0.15 + L / 2, g.z], 0.012, 0.012, L, 5, { color: [0.4, 0.33, 0.25] });
      B.cyl('metal', [g.x, g.y + 0.22, g.z], 0.06, 0.09, 0.08, 8, { color: [0.5, 0.4, 0.3] });
      B.cyl('metal', [g.x, g.y - 0.17, g.z], 0.14, 0.06, 0.09, 12, { color: [0.5, 0.4, 0.3] });
    } else if (g.region === 'B5' && g.y < 3) {
      // каменная стойка на ярусе
      B.cyl('stone', [g.x, g.y / 2 - 0.5, g.z], 0.14, 0.2, g.y + 1.0, 8, { par: [0.7, 0, 0] });
      B.cyl('metal', [g.x, g.y - 0.17, g.z], 0.14, 0.06, 0.09, 12, { color: [0.5, 0.4, 0.3] });
    }
  }
}

// ----------------------------------------------------------------------- B1 ----
function b1(B, ctx, decal) {
  B.region = 'B1';
  const c1 = cell('B1');
  // Торец: валун-дверь (фальшивый камень), приоткрытый — холодный свет снаружи.
  B.cyl('stone', [0.42, 1.62, 0.95], 1.62, 1.62, 0.6, 28, { rot: [0, 0, Math.PI / 2], par: [0.5, 0.1, 1], color: [0.9, 0.85, 0.78] });
  B.box('stone', [0.12, 1.6, -0.35], [0.24, 3.2, 0.5], { par: [0.5, 0.1, 1] });
  B.box('stone', [0.12, 3.15, -1.2], [0.24, 0.3, 1.7], { par: [0.5, 0.1, 1] });
  // откос двери + порог с песком
  B.box('stone', [0.12, 0.08, 0], [0.5, 0.14, 4], { par: [0.3, 0, 0] });
  // Дверные рамы-уплотнители (экструзия): рама + бронзовое кольцо.
  for (const d of DOORS) doorFrame(B, d.x);
  // Эркер у колонн: стойка тамперов и крючьев (опорные доски)
  B.box('wood', [34, 0.9, -1.78], [3, 1.8, 0.12], { color: [0.5, 0.38, 0.26] });
  B.box('wood', [34, 0.12, -1.55], [3, 0.14, 0.5], { color: [0.5, 0.38, 0.26] });
  B.box('wood', [34, 1.7, -1.62], [3.1, 0.1, 0.3], { color: [0.45, 0.34, 0.24] });
  // Декали: резьба (слой 1), печати (2), росписи (3).
  decal(B, 'carving', 3.0, 1.9, -1.99, 1.9, 1.9, 'z+');
  decal(B, 'carving', 11.5, 1.9, -1.99, 1.9, 1.9, 'z+');
  decal(B, 'carvingB', 17, 1.7, 1.99, 1.9, 1.9, 'z-');
  decal(B, 'carving', 30.5, 2.0, 1.99, 1.9, 1.9, 'z-');
  decal(B, 'sigil', 26.6, 2.1, -1.99, 1.7, 1.7, 'z+');
  decal(B, 'sigil', 14.5, 2.3, 1.99, 1.2, 1.2, 'z-', { color: [0.9, 0.9, 0.9] });
  decal(B, 'chalk', 20, 1.0, 1.99, 1.8, 0.9, 'z-');
  decal(B, 'mural', 7, 1.3, 1.99, 1.8, 0.9, 'z-');
  ctx.decals.push('B1');
}

function doorFrame(B, x) {
  const c1 = cell('B1');
  const outer = [];
  for (let i = 0; i <= 24; i++) { const z = 2.02 - (4.04 * i) / 24; outer.push(new THREE.Vector2(z, ceilAt(c1, 1, clamp(z, -2, 2)) + (Math.abs(z) > 1.99 ? 0 : 0.0))); }
  const shape = new THREE.Shape([new THREE.Vector2(-2.02, 0), new THREE.Vector2(2.02, 0), ...outer.map((p) => new THREE.Vector2(p.x, p.y))]);
  const hole = ovalPath(1.25, 1.8, 1.2, -0.0);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 20 });
  g.rotateY(-Math.PI / 2); g.translate(x + 0.55, 0, 0);
  B.add('stone', g, [0.95, 0.9, 0.85], [0.3, 0.15, 0]);
  // кольцо
  const ring = new THREE.Shape(); ovalOutline(ring, 1.37, 1.8, 1.32);
  ring.holes.push(ovalPath(1.25, 1.8, 1.2));
  const rg = new THREE.ExtrudeGeometry(ring, { depth: 1.16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 1, curveSegments: 20 });
  rg.rotateY(-Math.PI / 2); rg.translate(x + 0.58, 0, 0);
  B.add('metal', rg, [0.7, 0.55, 0.36], [0, 0, 0]);
  // заклёпки по кольцу
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI; const zz = Math.cos(a) * 1.33, yy = 1.8 + Math.sin(a) * 1.27;
    for (const sx of [-1, 1]) B.sphere('brass', [x + sx * 0.6, yy, zz], 0.035, { ws: 6, hs: 4 });
  }
  // «Затяни — и войди»: тёмные скобы на косяке (метки руками)
  B.box('stone', [x + 0.0, 0.0, 0], [1.4, 0.08, 4.0], { par: [0.5, 0, 0] });
}
function ovalPath(hw, cy, ry) {
  const p = new THREE.Path();
  p.moveTo(-hw, 0); p.lineTo(-hw, cy);
  p.absellipse(0, cy, hw, ry, Math.PI, 0, true);
  p.lineTo(hw, 0); p.lineTo(-hw, 0);
  return p;
}
function ovalOutline(shape, hw, cy, ry) {
  shape.moveTo(-hw, 0); shape.lineTo(hw, 0); shape.lineTo(hw, cy);
  shape.absellipse(0, cy, hw, ry, 0, Math.PI, false);
  shape.lineTo(-hw, 0);
}

/** Створка двери (экструзия), по z смещается при открытии. side: -1 (север) / +1 (юг). Геометрия в абсолютных координатах. */
export function doorLeafParts(x, side) {
  const T = new Builder(); T.region = 'B1';
  const hw = 1.27, sg = side < 0 ? -1 : 1;
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(sg * hw, 0), new THREE.Vector2(sg * hw, 1.8)];
  for (let i = 1; i <= 12; i++) { const a = (i / 12) * (Math.PI / 2); pts.push(new THREE.Vector2(sg * 1.25 * Math.cos(a), 1.8 + 1.2 * Math.sin(a))); }
  const sh = new THREE.Shape(pts);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1, curveSegments: 16 });
  g.translate(0, 0, -0.1);
  g.rotateY(-Math.PI / 2); g.translate(x, 0, 0);
  T.add('metal', g, [0.46, 0.4, 0.34], [0.2, 0.1, 0]);
  for (let i = 0; i < 4; i++) { const y = 0.5 + i * 0.7; T.box('metal', [x + 0.14, y, side * 0.62], [0.06, 0.1, 1.15], { color: [0.55, 0.45, 0.34] }); T.box('metal', [x - 0.14, y, side * 0.62], [0.06, 0.1, 1.15], { color: [0.55, 0.45, 0.34] }); }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { for (const sx of [-1, 1]) T.sphere('brass', [x + sx * 0.18, 0.5 + i * 0.7, side * (0.2 + j * 0.3)], 0.032, { ws: 6, hs: 4 }); }
  T.cyl('brass', [x - 0.16, 1.6, side * 0.2], 0.13, 0.13, 0.05, 14, { rot: [0, 0, Math.PI / 2], color: [1, 0.9, 0.7] });
  return T.merged();
}

// ----------------------------------------------------------------------- B2 ----
function b2(B, ctx, decal, rg) {
  B.region = 'B2';
  const c = cell('B2');
  const colXs = []; for (let i = 0; i < 8; i++) colXs.push(53 + i * 6);
  const zsides = [-1, 1];
  for (const s of zsides) {
    // колонны, спандрели, плита, консоли
    for (const x of colXs) { column(B, x, s * 4.75, 5.5, { r: 0.42 }); addBlock({ cx: x, cz: s * 4.75, r: 0.5 }, 0); }
    // колонны на краях (под лестницами нет)
    for (let i = 0; i < colXs.length - 1; i++) archSpandrel(B, colXs[i] + 0.55, colXs[i + 1] - 0.55, 4.2, 5.5, s * 4.62, -s);
    archSpandrel(B, colXs[colXs.length - 1] + 0.55, 98.8, 4.2, 5.5, s * 4.62, -s);
    // плита
    const zc = s * 6.0;
    B.box('stone', [74.5, 5.75, zc], [49, 0.5, 3.0], { par: [0.3, 0.2, 0] });
    // консоли под плитой у стены
    for (let x = 52; x <= 98; x += 3) B.box('stone', [x, 5.25, s * 7.2], [0.5, 0.5, 0.6], { par: [0.5, 0.1, 0] });
    // перила по фасаду + торец
    balustrade(B, 50.2, 98.6, s * 4.62, 6.0, s);
    // пилястры по стене на уровне балкона
    for (const x of colXs.concat([47])) B.box('stone', [x, 7.6, s * 7.32], [0.8, 3.1, 0.3], { par: [0.5, 0.35, 0] });
    // нижние пилястры под балконом у стены
    for (const x of colXs) B.box('stone', [x, 2.7, s * 7.32], [0.7, 5.4, 0.3], { par: [0.5, 0.1, 0] });
  }
  // Лестницы (по стене, подъём вдоль +X). Ступени — сплошные блоки.
  for (const s of zsides) {
    const nSteps = Math.round((GALLERY.balconyY) / GALLERY.riser);
    const zc = s * 6.5, wd = 1.9;
    for (let i = 0; i < nSteps; i++) {
      const x = GALLERY.stair0 + (i + 0.5) * GALLERY.tread, h = (i + 1) * GALLERY.riser;
      B.box('stone', [x, h / 2, zc], [GALLERY.tread, h, wd], { par: [i % 2 ? 0.8 : 0.35, 0.03, 0] });
    }
    // тетива-балюстрада по открытой стороне, наклонная
    const zr = s * 5.62;
    const rails = [], rails2 = [];
    for (let i = 0; i <= 16; i++) { const x = GALLERY.stair0 + (9 * i) / 16; const y = stairH(x) + 0.95; rails.push([x, y, zr - 0.06]); rails2.push([x, y, zr + 0.06]); }
    for (let i = 0; i <= 18; i++) { const x = GALLERY.stair0 + (9 * i) / 18; B.box('wood', [x, stairH(x) + 0.5, zr], [0.07, 1.0, 0.07], { color: [0.45, 0.34, 0.24] }); }
    B.rails('wood', [rails, rails2], { want: [0, 1, 0], color: [0.6, 0.45, 0.3] });
  }
  // Мост через зал на высоте 6 м (3 м ширина), арочное днище и перила.
  {
    const bx = (BRIDGE.x0 + BRIDGE.x1) / 2;
    B.box('stone', [bx, 5.8, 0], [3.0, 0.4, 9.2], { par: [0.5, 0.2, 0] });
    for (let i = -3; i <= 3; i++) B.box('stone', [bx, 5.4 - Math.abs(i) * 0.04, i * 1.3], [2.6, 0.3, 0.5], { par: [0.3, 0.2, 0] });
  }
  // Перила моста: две стороны вдоль Z.
  for (const sx of [-1, 1]) {
    const x = (BRIDGE.x0 + BRIDGE.x1) / 2 + sx * 1.38;
    B.box('stone', [x, 7.05, 0], [0.34, 0.1, 9.0], { par: [1, 0, 0] });
    for (let z = -4.4; z <= 4.4; z += 0.34) B.lathe('stone', [[0.04, 0], [0.09, 0.1], [0.06, 0.3], [0.08, 0.5], [0.06, 0.7], [0.1, 0.85], [0.04, 0.9]], [x, 6.2, z], 8, { par: [0.7, 0, 0] });
    B.box('stone', [x, 6.1, 0], [0.3, 0.2, 9.0], { par: [0.5, 0, 0] });
  }
  // Световые колодцы: кольцо, шахта, светящийся «небесный» диск.
  for (const w of ctx.wells) {
    if (w.region !== 'B2') continue;
    B.region = 'B2';
    const rr = w.r + 0.1;
    B.geo('stone', new THREE.CylinderGeometry(rr + 0.35, rr + 0.5, 0.6, 20, 1, true), { pos: [w.x, 12.0, w.z], par: [0.4, 0.5, 1] });
    B.geo('stone', new THREE.TorusGeometry(rr + 0.2, 0.18, 8, 24), { pos: [w.x, 11.7, w.z], rot: [Math.PI / 2, 0, 0], par: [0.7, 0.5, 0] });
  }
  // Декали: резьба, печати, росписи нижнего и верхнего ярусов.
  const decs = [];
  for (let i = 0; i < 5; i++) {
    const x = 49 + i * 11.5;
    decal(B, 'carving', x, 2.3, -7.49, 2.0, 2.0, 'z+');
    decal(B, 'sigil', x + 5.2, 3.9, -7.49, 1.3, 1.3, 'z+');
    decal(B, 'carvingB', x + 2, 2.3, 7.49, 2.0, 2.0, 'z-');
    decal(B, 'sigil', x + 7.2, 3.9, 7.49, 1.3, 1.3, 'z-');
  }
  decal(B, 'mural', 70, 7.65, -7.49, 5.8, 2.9, 'z+', { color: [0.66, 0.62, 0.58] });
  decal(B, 'mural', 84, 7.65, 7.49, 4.8, 2.4, 'z-', { color: [0.66, 0.62, 0.58] });
  decal(B, 'chalk', 46, 1.1, -7.49, 3.4, 1.7, 'z+');
  decal(B, 'chalk', 46, 1.1, 7.49, 3.4, 1.7, 'z-');
  decal(B, 'carving', 56, 7.7, -7.49, 2.0, 2.0, 'z+');
  decal(B, 'carving', 62, 7.7, 7.49, 2.0, 2.0, 'z-');
  // Знак у входа в галерею
  decal(B, 'sigil', 40.02, 5.6, 0, 2.2, 2.2, 'x+');
  // Потолок: тёмные тяги/орнамент уже в рёбрах.
}

// ----------------------------------------------------------------------- B3 ----
function b3(B, ctx, decal, rg) {
  B.region = 'B3';
  // Занавеси ниш, ложе, лампа; ниша-святилище Шианы.
  for (const n of NICHES) {
    const c = cell(n.id); if (!c) continue;
    const wallZ = n.wallZ, d = n.side;
    const cx = (n.x0 + n.x1) / 2, w = n.x1 - n.x0;
    ctx.niches.push({ ...n, cx });
    // выступ-наличник вокруг проёма
    const top = 2.6;
    B.box('stone', [n.x0 - 0.12, top / 2, wallZ - d * 0.05], [0.24, top, 0.3], { par: [0.6, 0.1, 0] });
    B.box('stone', [n.x1 + 0.12, top / 2, wallZ - d * 0.05], [0.24, top, 0.3], { par: [0.6, 0.1, 0] });
    B.box('stone', [cx, top + 0.13, wallZ - d * 0.05], [w + 0.5, 0.26, 0.3], { par: [0.5, 0.2, 0] });
    // ложе/полка
    B.box('stone', [cx, 0.28, wallZ + d * 0.9], [w - 0.2, 0.5, 1.0], { par: [0.8, 0.0, 0], color: [0.95, 0.9, 0.85] });
    if (!n.open) {
      // ковёр-постель
      B.box('clothStatic', [cx, 0.56, wallZ + d * 0.9], [w - 0.4, 0.08, 0.86], { color: [0.28 + (n.curtain % 3) * 0.1, 0.34, 0.5 - (n.curtain % 2) * 0.15] });
    }
  }
  // Святилище Шианы: лента, чаша с песком, цветок, низкий светошар (в lightplan).
  const sh = ctx.niches.find((n) => n.id === 'Shrine');
  if (sh) {
    const z = sh.wallZ + 1.2;
    B.lathe('clay', [[0.0, 0], [0.18, 0.02], [0.22, 0.1], [0.2, 0.18], [0.17, 0.18], [0.0, 0.1]], [sh.cx - 0.5, 0.58, z], 14, { color: [0.8, 0.65, 0.5] });
    B.cyl('sand', [sh.cx - 0.5, 0.66, z], 0.17, 0.17, 0.02, 12, { par: [0, 0, 2], color: [1, 0.9, 0.7] });
    // сухой цветок (кинская оранжерея)
    B.cyl('wood', [sh.cx + 0.4, 0.78, z], 0.008, 0.008, 0.5, 4, { color: [0.4, 0.3, 0.2] });
    B.sphere('cloth', [sh.cx + 0.4, 1.04, z], 0.06, { color: [0.7, 0.62, 0.5], par: [0, 0, 0.1] });
    // синяя лента
    B.box('cloth', [sh.cx, 1.6, sh.wallZ + 1.55], [0.1, 1.0, 0.012], { color: [0.12, 0.25, 0.6], par: [0, 0, 1] });
    B.box('cloth', [sh.cx + 0.25, 1.4, sh.wallZ + 1.55], [0.08, 0.7, 0.012], { color: [0.2, 0.34, 0.7], par: [0, 0, 1] });
    decal(B, 'carving', sh.cx - 0.75, 1.5, sh.wallZ + 1.59, 0.8, 0.8, 'z-', { color: [0.9, 0.9, 0.9] });
    // два коврика-мата перед нишей уже в props
  }
  // Занавеси (качающиеся) — ткань, один меш на нишу; вышитая капля на похоронной.
  for (const n of ctx.niches) {
    if (n.open) continue;
    curtain(B, n.cx, n.wallZ - n.side * 0.12, n.x1 - n.x0 + 0.1, 2.5, 'x', n.side, [0.85, 0.85, 0.85], n.curtain, false, ['cloth:blueCloth', 'cloth:stripeRed', 'cloth:plain'][n.curtain % 3]);
  }
  // Похоронная ниша: занавесь в торце x=136
  {
    const z = FUNERAL.z;
    curtain(B, FUNERAL.x - 0.12, z, 2.2, 2.6, 'z', -1, [0.55, 0.6, 0.8], 7, true, 'cloth:blueCloth');
    B.box('stone', [FUNERAL.x + 0.06, 1.3, z - 1.2], [0.25, 2.6, 0.3], { par: [0.6, 0.1, 0] });
    B.box('stone', [FUNERAL.x + 0.06, 1.3, z + 1.2], [0.25, 2.6, 0.3], { par: [0.6, 0.1, 0] });
    B.box('stone', [FUNERAL.x + 0.06, 2.73, z], [0.25, 0.26, 2.9], { par: [0.5, 0.2, 0] });
    decal(B, 'embroidery', FUNERAL.x - 0.16, 1.4, z, 1.0, 1.0, 'x-');
  }
  // Резьба и росписи в проходах (реже, чем в зале).
  decal(B, 'carving', 120, 1.8, -1.49, 1.6, 1.6, 'z+');
  decal(B, 'carvingB', 140, 1.8, -1.49, 1.6, 1.6, 'z+');
  decal(B, 'mural', 109, 1.7, -6.49, 1.7, 0.9, 'z+');
  decal(B, 'sigil', 130, 2.0, 6.49, 1.2, 1.2, 'z-');
}

function curtain(B, x, z, w, h, axis, side, color, seed, emb, matKey = 'cloth') {
  // Занавесь: сетка со складками (синус по ширине), раскачка — вершинный шейдер (par.z по высоте).
  const nx = 18, ny = 10;
  const rails = [];
  for (let j = 0; j <= ny; j++) {
    const row = [];
    const t = j / ny; // 0 — вверху, 1 — внизу
    for (let i = 0; i <= nx; i++) {
      const s = i / nx - 0.5;
      const fold = Math.sin(i * 1.55 + seed) * 0.05 * (0.4 + t * 0.6);
      const y = 0.08 + (h - 0.08) * (1 - t);
      if (axis === 'x') row.push([x + s * w, y, z + side * (0.05 + fold)]);
      else row.push([x + (0.05 + fold) * -1, y, z + s * w]);
    }
    rails.push(row);
  }
  const want = axis === 'x' ? [0, 0, -side] : [-1, 0, 0];
  const [r, g, b] = color;
  // раскачка: par.z = t (внизу сильнее) — через parFn по y
  B.rails(matKey, rails, { want, color: [r, g, b], par: (px, py) => [0, 0, clamp(1 - py / h, 0, 1) * 1.3], uvu: 2, uvv: 2 });
  // штанга
  if (axis === 'x') B.cyl('metal', [x, h + 0.04, z + side * 0.04], 0.02, 0.02, w + 0.3, 6, { rot: [0, 0, Math.PI / 2], color: [0.5, 0.4, 0.3] });
  else B.cyl('metal', [x - 0.04, h + 0.04, z], 0.02, 0.02, w + 0.3, 6, { rot: [Math.PI / 2, 0, 0], color: [0.5, 0.4, 0.3] });
}

// ----------------------------------------------------------------------- B4 ----
function b4(B, ctx, decal, rg) {
  B.region = 'B4';
  const c = cell('B4');
  // Уступ-кромка по периметру, чаша бассейна, колонны, ниши.
  const ledge = 2.4;
  B.box('stone', [(c.x0 + c.x1) / 2, -0.25, c.z0 + ledge / 2], [30, 0.5, ledge], { par: [0.5, 0.1, 0] });
  B.box('stone', [(c.x0 + c.x1) / 2, -0.25, c.z1 - ledge / 2], [30, 0.5, ledge], { par: [0.5, 0.1, 0] });
  B.box('stone', [c.x0 + ledge / 2, -0.25, (c.z0 + c.z1) / 2], [ledge, 0.5, 20 - 2 * ledge], { par: [0.5, 0.1, 0] });
  B.box('stone', [c.x1 - ledge / 2, -0.25, (c.z0 + c.z1) / 2], [ledge, 0.5, 20 - 2 * ledge], { par: [0.5, 0.1, 0] });
  // вертикальные стенки бассейна (внутрь) и дно
  const x0 = c.x0 + ledge, x1 = c.x1 - ledge, z0 = c.z0 + ledge, z1 = c.z1 - ledge;
  B.rails('stone', [[[x0, -0.5, z0], [x1, -0.5, z0]], [[x0, -3, z0], [x1, -3, z0]]], { want: [0, 0, 1], par: [0.2, 0.2, 0] });
  B.rails('stone', [[[x0, -0.5, z1], [x1, -0.5, z1]], [[x0, -3, z1], [x1, -3, z1]]], { want: [0, 0, -1], par: [0.2, 0.2, 0] });
  B.rails('stone', [[[x0, -0.5, z0], [x0, -0.5, z1]], [[x0, -3, z0], [x0, -3, z1]]], { want: [1, 0, 0], par: [0.2, 0.2, 0] });
  B.rails('stone', [[[x1, -0.5, z0], [x1, -0.5, z1]], [[x1, -3, z0], [x1, -3, z1]]], { want: [-1, 0, 0], par: [0.2, 0.2, 0] });
  B.plane('stone', [(x0 + x1) / 2, -3, (z0 + z1) / 2], x1 - x0, z1 - z0, 'up', { par: [0.1, 0.1, 0] });
  // колонны 3×2 из воды
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) column(B, 118 + i * 7, 13 + j * 8, 6.4 + (i + j) % 2 * 0.0, { r: 0.55, y0: -3 });
  // решётка: рама и прутья с кольцами воды (мотив), зарубки
  const gx = 122, gz = 7.82;
  B.box('stone', [gx, 2.7, gz], [3.4, 0.2, 0.3], { par: [0.4, 0.1, 0] });
  B.box('stone', [gx, 0.1, gz], [3.4, 0.2, 0.3], { par: [0.4, 0.1, 0] });
  for (const sx of [-1.6, 1.6]) B.box('stone', [gx + sx, 1.4, gz], [0.2, 2.8, 0.3], { par: [0.5, 0.1, 0] });
  for (let i = 0; i <= 14; i++) {
    const x = gx - 1.4 + i * 0.2;
    B.cyl('metal', [x, 1.45, gz], 0.025, 0.025, 2.6, 6, { color: [0.38, 0.3, 0.24] });
  }
  for (const y of [0.55, 1.45, 2.35]) B.box('metal', [gx, y, gz], [3.0, 0.05, 0.05], { color: [0.4, 0.32, 0.25] });
  for (let i = 0; i < 4; i++) { B.geo('metal', new THREE.TorusGeometry(0.25 - i * 0.05, 0.012, 6, 20), { pos: [gx, 1.5, gz + 0.03], color: [0.42, 0.34, 0.26] }); }
  // зарубки: тёмные насечки на нескольких прутьях
  for (let i = 0; i < 26; i++) { const x = gx - 1.4 + (i % 14) * 0.2; B.box('metal', [x, 0.5 + Math.floor(i / 14) * 0.9 + (i % 3) * 0.1, gz - 0.027], [0.06, 0.012, 0.01], { color: [0.9, 0.8, 0.6] }); }
  // Дренажные «слёзы»: трубка-носик у стены
  B.cyl('metal', [133, 3.5, c.z1 - 0.3], 0.07, 0.07, 0.6, 8, { rot: [Math.PI / 2, 0, 0], color: [0.4, 0.34, 0.28] });
  // Своды цистерны: карнизная тяга
  decal(B, 'carving', 125, 3.6, c.z1 - 0.01, 3, 3, 'z-');
  decal(B, 'carving', 135, 3.6, c.z1 - 0.01, 3, 3, 'z-');
  decal(B, 'carvingB', c.x0 + 0.01, 3.6, 18, 3, 3, 'x+');
  decal(B, 'sigil', c.x1 - 0.01, 4.0, 18, 2, 2, 'x-');
}
