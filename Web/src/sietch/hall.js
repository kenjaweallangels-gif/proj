// Религиозный зал B5: ярусы вокруг песчаной чаши, свод-«глотка» с рёбрами и кольцами, световая шахта.
import * as THREE from 'three';
import { HALL, hallHeightSmooth, cell, ceilAt } from './plan.js';
import { clamp, smoothstep, rng, fbm2 } from '../core/util.js';

export const SHAFT_R = 2.1, VAULT_TOP = 25, WALL_TOP = 9;
const TAU = Math.PI * 2;

export function rectR(th) {
  const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
  return Math.min(HALL.hx / Math.max(c, 1e-6), HALL.hz / Math.max(s, 1e-6));
}
export function vaultY(u) { return WALL_TOP + (VAULT_TOP - WALL_TOP) * Math.pow(1 - Math.pow(clamp(u, 0, 1), 1.5), 0.6); }
export function vaultPoint(th, u) {
  const R = rectR(th), rho = SHAFT_R + (R - SHAFT_R) * u;
  return [HALL.cx + Math.cos(th) * rho, vaultY(u), HALL.cz + Math.sin(th) * rho];
}
/** Высота свода над точкой плана (для цепей светошаров и т. п.). */
export function vaultYAt(x, z) {
  const dx = x - HALL.cx, dz = z - HALL.cz, th = Math.atan2(dz, dx), rho = Math.hypot(dx, dz), R = rectR(th);
  return vaultY(clamp((rho - SHAFT_R) / (R - SHAFT_R), 0, 1));
}
/** Точки рёбер: равномерно по периметру, начиная с центра западной стены (вход). */
export function ribPoints(n) {
  const hx = HALL.hx, hz = HALL.hz, per = 4 * hx + 4 * hz;
  const pts = [];
  for (let i = 0; i < n; i++) {
    let d = (i / n) * per + 0; // от (-hx,0) к северу (−z)
    // маршрут: (-hx,0)->(-hx,-hz)->(hx,-hz)->(hx,hz)->(-hx,hz)->(-hx,0)
    const segs = [[-hx, 0, -hx, -hz], [-hx, -hz, hx, -hz], [hx, -hz, hx, hz], [hx, hz, -hx, hz], [-hx, hz, -hx, 0]];
    for (const [x0, z0, x1, z1] of segs) {
      const L = Math.hypot(x1 - x0, z1 - z0);
      if (d <= L) { pts.push([x0 + ((x1 - x0) * d) / L, z0 + ((z1 - z0) * d) / L]); break; }
      d -= L;
    }
  }
  return pts.map(([x, z]) => ({ x: HALL.cx + x, z: HALL.cz + z, th: Math.atan2(z, x) }));
}

export function buildHall(B, ctx, decal) {
  B.region = 'B5';
  const R = rng(55);
  const cx = HALL.cx, cz = HALL.cz;

  // ---- Песчаная чаша: диск со рябью.
  B.grid('sand', (s, t) => {
    const r = s * (HALL.bowlR + 0.05), a = t * TAU;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const y = hallHeightSmooth(x, z) + (fbm2(x * 0.7, z * 0.7, 3) * 0.05) * Math.min(1, r);
    return [x, y, z];
  }, 12, 64, { want: [0, 1, 0], par: [0, 0.05, 2], color: [1, 0.95, 0.85] });

  // ---- Ярусы: кольцевые площадки и подступенки.
  const rings = [];
  for (let k = 0; k < HALL.tiers; k++) {
    const r0 = HALL.bowlR + k * HALL.tierW, r1 = r0 + HALL.tierW, y = HALL.bowlY + HALL.tierH * (k + 1);
    const yPrev = k === 0 ? HALL.bowlY : HALL.bowlY + HALL.tierH * k;
    const nA = 96;
    // площадка (кольцо)
    B.grid('stone', (s, t) => { const r = r0 + (r1 - r0) * s, a = t * TAU; return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]; }, 2, nA, { want: [0, 1, 0], par: [0.25 + 0.4 * (k % 2), 0.05, 0] });
    // подступенок (цилиндр, нормаль к центру: смотрит на чашу)
    B.grid('stone', (s, t) => { const a = t * TAU; return [cx + Math.cos(a) * r0, yPrev + (y - yPrev) * s, cz + Math.sin(a) * r0]; }, 1, nA, { want: [-1, 0, 0], par: [0.3, 0.05, 0] });
    // полированная кромка-навес
    B.grid('stone', (s, t) => { const a = t * TAU, r = r0 - 0.05 + s * 0.05; return [cx + Math.cos(a) * r, y - 0.01 + s * 0.0, cz + Math.sin(a) * r]; }, 1, nA, { want: [0, 1, 0], par: [1, 0, 0] });
  }
  // Венец чаши: полированный бортик (кольцо шире и выше).
  {
    const nA = 96, r0 = HALL.bowlR - 0.02, r1 = HALL.bowlR + 0.6, y = HALL.bowlY + 0.55;
    B.grid('stone', (s, t) => { const a = t * TAU; return [cx + Math.cos(a) * (r0 + (r1 - r0) * s), y, cz + Math.sin(a) * (r0 + (r1 - r0) * s)]; }, 2, nA, { want: [0, 1, 0], par: [1, 0, 0], color: [1.05, 0.98, 0.9] });
    B.grid('stone', (s, t) => { const a = t * TAU; return [cx + Math.cos(a) * r0, HALL.bowlY + 0.55 * (1 - s) * 1, cz + Math.sin(a) * r0]; }, 1, nA, { want: [-1, 0, 0], par: [0.9, 0, 0] });
    // 12 знаков-шагов разной длины по краю чаши (слой 1)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.12, len = 0.25 + R() * 0.5;
      B.box('stone', [cx + Math.cos(a) * (HALL.bowlR + 0.3), y + 0.01, cz + Math.sin(a) * (HALL.bowlR + 0.3)], [len, 0.02, 0.07], { rot: [0, -a + Math.PI / 2, 0], color: [0.35, 0.26, 0.18], par: [0, 0.8, 0] });
    }
  }
  // Внешний пол: прямоугольник с круглым вырезом r=17.4 (ShapeGeometry в координатах (x,-z)).
  {
    const rOut = HALL.bowlR + HALL.tiers * HALL.tierW - 0.01;
    const sh = new THREE.Shape([new THREE.Vector2(-HALL.hx, -HALL.hz), new THREE.Vector2(HALL.hx, -HALL.hz), new THREE.Vector2(HALL.hx, HALL.hz), new THREE.Vector2(-HALL.hx, HALL.hz)]);
    const hole = new THREE.Path(); for (let i = 0; i < 64; i++) { const a = (i / 64) * TAU; const p = [Math.cos(a) * rOut, Math.sin(a) * rOut]; i ? hole.lineTo(p[0], p[1]) : hole.moveTo(p[0], p[1]); }
    sh.holes.push(hole);
    const g = new THREE.ShapeGeometry(sh, 12);
    g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
    B.add('stone', g, [1, 1, 1], [0.25, 0.05, 0]);
  }

  // ---- Свод-«глотка».
  const ribs = ribPoints(40);
  ctx.hallRibs = ribs;
  const NT = 200, NU = 56;
  const Pu = [], Pd = [];
  const ribTh = ribs.map((r) => r.th);
  const U = (j) => Math.pow(j / NU, 1.25);
  const base = [];
  for (let j = 0; j <= NU; j++) { base.push([]); for (let i = 0; i <= NT; i++) base[j].push(vaultPoint((i / NT) * TAU - Math.PI, U(j))); }
  const rows = [];
  for (let j = 0; j <= NU; j++) {
    const row = [];
    for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * TAU - Math.PI, u = U(j);
      const p = base[j][i];
      // касательные для нормали
      const pj = base[Math.min(NU, j + 1)][i], pj0 = base[Math.max(0, j - 1)][i];
      const pi = base[j][Math.min(NT, i + 1)], pi0 = base[j][Math.max(0, i - 1)];
      const a = [pj[0] - pj0[0], pj[1] - pj0[1], pj[2] - pj0[2]], b = [pi[0] - pi0[0], pi[1] - pi0[1], pi[2] - pi0[2]];
      let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const nl = Math.hypot(...n) || 1; n = n.map((v) => v / nl);
      // внутрь: вниз/к центру
      const rad = [cx - p[0], 0, cz - p[2]];
      const tin = n[0] * rad[0] * 0.2 + n[1] * -1 + n[2] * rad[2] * 0.2;
      if (tin < 0) n = n.map((v) => -v);
      // расстояние до ближайшего ребра в метрах
      let dm = 1e9;
      for (const t of ribTh) { let dt = Math.abs(((th - t + Math.PI * 3) % TAU) - Math.PI); dm = Math.min(dm, dt); }
      const rho = SHAFT_R + (rectR(th) - SHAFT_R) * u;
      const lat = dm * rho;
      const ribB = Math.exp(-((lat / 0.55) ** 2)) * (0.55 + 0.9 * u * (1 - u) * 2) * smoothstep(0.0, 0.08, u);
      const ringB = Math.pow(0.5 + 0.5 * Math.cos(u * TAU * 11), 4) * 0.34 * smoothstep(0.03, 0.14, u);
      const noise = fbm2(p[0] * 0.5, p[2] * 0.5 + p[1] * 0.3, 3) * 0.12;
      const d = ribB + ringB + noise;
      row.push([p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d]);
    }
    rows.push(row);
  }
  B.rails('stone', rows, { want: [0, -1, 0], par: (x, y, z) => [0.05, 0.55 * (1 - smoothstep(14, 24, y) * 0.5), 1], color: [1, 0.95, 0.9], uvu: 1 });

  // ---- Шахта: труба вверх, кольцо-воротник, небо.
  B.grid('stone', (s, t) => { const a = t * TAU; return [cx + Math.cos(a) * SHAFT_R, VAULT_TOP + s * 7, cz + Math.sin(a) * SHAFT_R]; }, 1, 40, { want: [-Math.cos(0), 0, 0], par: [0.6, 0.15, 1] });
  B.geo('stone', new THREE.TorusGeometry(SHAFT_R + 0.5, 0.32, 10, 40), { pos: [cx, VAULT_TOP - 0.15, cz], rot: [Math.PI / 2, 0, 0], par: [0.7, 0.2, 0] });
  B.geo('stone', new THREE.TorusGeometry(SHAFT_R + 1.4, 0.2, 10, 40), { pos: [cx, VAULT_TOP - 0.8, cz], rot: [Math.PI / 2, 0, 0], par: [0.4, 0.3, 0] });

  // ---- Стены: пилястры от рёбер (вертикально до карниза), карниз, скамьи у стен.
  for (const r of ribs) {
    const onW = Math.abs(r.x - (cx - HALL.hx)) < 0.01, onE = Math.abs(r.x - (cx + HALL.hx)) < 0.01, onN = Math.abs(r.z - (cz - HALL.hz)) < 0.01, onS = Math.abs(r.z - (cz + HALL.hz)) < 0.01;
    if (onW && Math.abs(r.z - cz) < 3.4) continue;
    const nx = onW ? 1 : onE ? -1 : 0, nz = onN ? 1 : onS ? -1 : 0;
    const ox = r.x + nx * 0.22, oz = r.z + nz * 0.22;
    const sz = nz ? [0.9, WALL_TOP, 0.44] : [0.44, WALL_TOP, 0.9];
    B.box('stone', [ox, WALL_TOP / 2, oz], sz, { par: [0.45, 0.35, 0] });
    B.box('stone', [ox + nx * 0.06, 0.3, oz + nz * 0.06], nz ? [1.15, 0.6, 0.56] : [0.56, 0.6, 1.15], { par: [0.7, 0.1, 0] });
    B.box('stone', [ox + nx * 0.06, WALL_TOP - 0.3, oz + nz * 0.06], nz ? [1.15, 0.6, 0.56] : [0.56, 0.6, 1.15], { par: [0.5, 0.4, 0] });
  }
  // карниз по периметру
  const cn = 0.5, ch = 0.55;
  B.box('stone', [cx, WALL_TOP - 0.1, cz - HALL.hz + cn / 2], [2 * HALL.hx, ch, cn], { par: [0.3, 0.5, 0] });
  B.box('stone', [cx, WALL_TOP - 0.1, cz + HALL.hz - cn / 2], [2 * HALL.hx, ch, cn], { par: [0.3, 0.5, 0] });
  B.box('stone', [cx + HALL.hx - cn / 2, WALL_TOP - 0.1, cz], [cn, ch, 2 * HALL.hz], { par: [0.3, 0.5, 0] });
  B.box('stone', [cx - HALL.hx + cn / 2, WALL_TOP - 0.1, cz], [cn, ch, 2 * HALL.hz], { par: [0.3, 0.5, 0] });
  // скамьи вдоль длинных стен
  for (const s of [-1, 1]) for (let x = cx - 21; x <= cx + 21; x += 5) B.box('stone', [x, 0.25, cz + s * 16.7], [4.2, 0.5, 0.55], { par: [0.9, 0, 0] });
  // Резьба и росписи между пилястрами (3 слоя истории).
  const sides = [[-1, 'z+'], [1, 'z-']];
  for (const [s, face] of sides) {
    for (let i = 0; i < 8; i++) {
      const x = cx - 21 + i * 6 + 3;
      const z = cz + s * (HALL.hz - 0.01);
      decal(B, i % 3 === 1 ? 'carvingB' : 'carving', x, 3.1, z, 2.4, 2.4, face);
      if (i % 2 === 0) decal(B, 'sigil', x, 6.3, z, 2.2, 2.2, face, { color: [0.82, 0.82, 0.82] });
      else decal(B, 'mural', x, 6.5, z, 2.6, 1.3, face);
    }
  }
  decal(B, 'carving', cx + HALL.hx - 0.01, 3.2, cz - 6, 2.6, 2.6, 'x-');
  decal(B, 'sigil', cx + HALL.hx - 0.01, 6.0, cz, 3.4, 3.4, 'x-', { color: [0.78, 0.78, 0.78] });
  decal(B, 'carving', cx + HALL.hx - 0.01, 3.2, cz + 6, 2.6, 2.6, 'x-');
}
