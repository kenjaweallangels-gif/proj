// Навигационная сетка сиетча для горожан (и спутников): строится ОДИН раз из запечённых сеток пола/стен (plan.js), т.е. покрывает ВСЕ помещения
// (галерея B2, жилые комнаты B3, большие залы, водяной погреб B6, зал B5) без ручного графа. Нижний слой (пол < 4.4 м).
//  • проходимая клетка: есть пол, расстояние до стены/реквизита ≥ CFG.minClear; двери-уплотнители закрыты для толпы (она живёт по своим зонам);
//  • A* по 8 соседям, стоимость растёт у стен (идут по середине проходов), поиск порционный (бюджет раскрытий на кадр → нет всплесков);
//  • путь сглаживается (жадный line-of-sight) и сдвигается на «правую полосу» (правостороннее движение в проходах, пока позволяет ширина).
import { SEALS } from './cave/layout.js';

export const NAV_CFG = {
  cell: 0.5,              // м, шаг сетки
  ox: -8, oz: -64, nx: 460, nz: 232,
  minClear: 0.36,         // клетка проходима, если до стены ≥ (м)
  losClear: 0.46,         // line-of-sight при сглаживании: зазор ≥ (м)
  maxStep: 0.56,          // макс. перепад пола между соседними клетками (ступени 0.25 / 0.35 м проходимы)
  wallCostBelow: 1.4,     // штраф стоимости там, где зазор меньше (м)
  wallCostK: 1.1,
  laneOffset: 0.42,       // смещение «правой полосы» (м)
  laneMinClear: 0.95,     // полоса включается, если справа остаётся зазор ≥ (м)
  budget: 700,            // раскрытий A* за кадр
};

const SQ2 = Math.SQRT2;
const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DZ8 = [0, 0, 1, -1, 1, -1, 1, -1];

export function createNav(plan, cfg = NAV_CFG) {
  const { cell, ox, oz, nx, nz } = cfg, N = nx * nz;
  const ok = new Uint8Array(N), clr = new Float32Array(N), fy = new Float32Array(N), comp = new Int32Array(N).fill(-1);
  const cx = (i) => ox + (i + 0.5) * cell, cz = (j) => oz + (j + 0.5) * cell;
  const ci = (x) => Math.floor((x - ox) / cell), cj = (z) => Math.floor((z - oz) / cell);
  const sealBlocks = SEALS.filter((d) => !d.fixedOpen);

  // ------------------------------------------------------------------ построение ----
  let cellsOk = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = cx(i), z = cz(j), k = j * nx + i;
    if (!plan.hasFloor(x, z, 0)) continue;
    const wd = plan.wallDistLocal(x, z, 0);
    clr[k] = wd; fy[k] = plan.heightAtLocal(x, z, 0);
    if (wd < cfg.minClear) continue;
    let sealed = false;
    for (const d of sealBlocks) {
      const al = d.axis === 'x' ? x - d.x : z - d.z, ac = d.axis === 'x' ? z - d.z : x - d.x;
      if (Math.abs(al) < 0.7 && Math.abs(ac) < d.hw + 0.7) { sealed = true; break; }
    }
    if (sealed) continue;
    ok[k] = 1; cellsOk++;
  }
  // компоненты связности (с учётом перепада пола)
  let nComp = 0; const compSize = [];
  {
    const st = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (!ok[s] || comp[s] >= 0) continue;
      let sp = 0, size = 0; st[sp++] = s; comp[s] = nComp;
      while (sp) {
        const k = st[--sp]; size++;
        const i = k % nx, j = (k / nx) | 0;
        for (let d = 0; d < 4; d++) {
          const ii = i + DX8[d], jj = j + DZ8[d]; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const m = jj * nx + ii; if (!ok[m] || comp[m] >= 0 || Math.abs(fy[m] - fy[k]) > cfg.maxStep) continue;
          comp[m] = nComp; st[sp++] = m;
        }
      }
      compSize.push(size); nComp++;
    }
  }

  const cellAt = (x, z) => { const i = ci(x), j = cj(z); return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i; };
  /** Клетка в точке проходима. */
  const walkable = (x, z) => { const k = cellAt(x, z); return k >= 0 && ok[k] === 1; };
  /** Зазор до стены (м) по сетке (грубо, для быстрых проверок). */
  const clearanceAt = (x, z) => { const k = cellAt(x, z); return k < 0 ? 0 : clr[k]; };
  /** Ближайшая проходимая клетка (спираль по кольцам до maxR м); возвращает индекс или −1. prefComp — предпочесть эту компоненту. */
  function nearestCell(x, z, maxR = 3, prefComp = -1) {
    const i0 = ci(x), j0 = cj(z), R = Math.ceil(maxR / cell);
    let best = -1, bd = 1e9;
    for (let r = 0; r <= R; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const k = j * nx + i; if (!ok[k] || (prefComp >= 0 && comp[k] !== prefComp)) continue;
        const d = (cx(i) - x) ** 2 + (cz(j) - z) ** 2; if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0 && r * cell > Math.sqrt(bd) + cell) break;
    }
    return best;
  }
  /** Ближайшая проходимая точка {x,z} (или null). */
  function snap(x, z, maxR = 3, out = { x: 0, z: 0 }) {
    const k = nearestCell(x, z, maxR); if (k < 0) return null;
    out.x = cx(k % nx); out.z = cz((k / nx) | 0); return out;
  }
  /** Случайная проходимая точка в прямоугольнике с зазором ≥ minC (rnd — функция 0..1). */
  function randomPoint(x0, x1, z0, z1, minC, rnd, out = { x: 0, z: 0 }) {
    for (let t = 0; t < 24; t++) {
      const x = x0 + (x1 - x0) * rnd(), z = z0 + (z1 - z0) * rnd(), k = cellAt(x, z);
      if (k >= 0 && ok[k] && clr[k] >= minC && comp[k] === mainComp) { out.x = x; out.z = z; return out; }
    }
    return null;
  }
  let mainComp = 0; { let bs = -1; compSize.forEach((s, c) => { if (s > bs) { bs = s; mainComp = c; } }); }

  // ------------------------------------------------------------------ A* (порционный) ----
  const g = new Float32Array(N), parent = new Int32Array(N), stamp = new Uint32Array(N), hpos = new Int32Array(N), heap = new Int32Array(N), f = new Float32Array(N);
  let hn = 0, gen = 0;
  const hLess = (a, b) => f[a] < f[b];
  function hPush(k) { let i = hn++; heap[i] = k; hpos[k] = i; hUp(i); }
  function hUp(i) { const k = heap[i]; while (i > 0) { const p = (i - 1) >> 1, pk = heap[p]; if (!hLess(k, pk)) break; heap[i] = pk; hpos[pk] = i; i = p; } heap[i] = k; hpos[k] = i; }
  function hDown(i) { const k = heap[i]; for (;;) { let c = 2 * i + 1; if (c >= hn) break; if (c + 1 < hn && hLess(heap[c + 1], heap[c])) c++; if (!hLess(heap[c], k)) break; heap[i] = heap[c]; hpos[heap[i]] = i; i = c; } heap[i] = k; hpos[k] = i; }
  function hPop() { const k = heap[0]; hn--; if (hn > 0) { heap[0] = heap[hn]; hpos[heap[0]] = 0; hDown(0); } hpos[k] = -1; return k; }

  const queue = []; let job = null;
  const stats = { requests: 0, expansions: 0, fails: 0, maxExp: 0 };

  /** Поставить запрос пути: cb(path | null), path = [[x,z], ...] (мировые локальные координаты сиетча), первая точка — не стартовая. */
  function request(from, to, cb, opts = {}) {
    stats.requests++;
    queue.push({ from, to, cb, opts, state: 0 });
    return queue[queue.length - 1];
  }
  function cancel(req) { const i = queue.indexOf(req); if (i >= 0) queue.splice(i, 1); if (job === req) job = null; req.cancelled = true; }

  function begin(req) {
    const s = nearestCell(req.from.x, req.from.z, 4), tg = nearestCell(req.to.x, req.to.z, 4, s >= 0 ? comp[s] : -1);
    if (s < 0 || tg < 0 || comp[s] !== comp[tg]) { stats.fails++; req.cb(null); return false; }
    gen++; hn = 0; req.s = s; req.t = tg; req.exp = 0;
    stamp[s] = gen; g[s] = 0; parent[s] = -1; f[s] = 0; hPush(s);
    req.tx = tg % nx; req.tz = (tg / nx) | 0;
    return true;
  }
  function stepJob(req, maxExp) {
    const { t, tx, tz } = req;
    let n = 0;
    while (hn > 0 && n < maxExp) {
      const k = hPop(); n++; req.exp++;
      if (k === t) { stats.expansions += n; stats.maxExp = Math.max(stats.maxExp, req.exp); finish(req); return true; }
      const i = k % nx, j = (k / nx) | 0, gk = g[k];
      for (let d = 0; d < 8; d++) {
        const ii = i + DX8[d], jj = j + DZ8[d]; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const m = jj * nx + ii; if (!ok[m] || Math.abs(fy[m] - fy[k]) > cfg.maxStep) continue;
        if (d >= 4 && (!ok[j * nx + ii] || !ok[jj * nx + i])) continue;       // без срезания углов
        const c = (d >= 4 ? SQ2 : 1) * (1 + Math.max(0, cfg.wallCostBelow - clr[m]) * cfg.wallCostK);
        const ng = gk + c;
        if (stamp[m] !== gen) { stamp[m] = gen; g[m] = ng; parent[m] = k; const ddx = Math.abs(ii - tx), ddz = Math.abs(jj - tz); f[m] = ng + (ddx + ddz) + (SQ2 - 2) * Math.min(ddx, ddz); hPush(m); }
        else if (ng < g[m] && hpos[m] >= 0) { g[m] = ng; parent[m] = k; const ddx = Math.abs(ii - tx), ddz = Math.abs(jj - tz); f[m] = ng + (ddx + ddz) + (SQ2 - 2) * Math.min(ddx, ddz); hUp(hpos[m]); }
      }
    }
    stats.expansions += n; stats.maxExp = Math.max(stats.maxExp, req.exp);
    if (hn === 0) { stats.fails++; req.cb(null); return true; }
    return false;
  }
  function finish(req) {
    const pts = [];
    for (let k = req.t; k >= 0; k = parent[k]) pts.push([cx(k % nx), cz((k / nx) | 0)]);
    pts.reverse();
    // реальные концы: старт — откуда вышли, финиш — точная цель
    pts[0] = [req.from.x, req.from.z];
    const last = pts[pts.length - 1];
    if (Math.hypot(last[0] - req.to.x, last[1] - req.to.z) < 4) pts.push([req.to.x, req.to.z]);
    const path = smooth(pts, req.opts);
    path.shift();
    req.cb(path);
  }
  /** Вызывать раз в кадр: тратит budget раскрытий. */
  function pump(budget = cfg.budget) {
    let left = budget;
    while (left > 0) {
      if (!job) { job = queue.shift(); if (!job) return; if (job.cancelled || !begin(job)) { job = null; continue; } }
      const before = job.exp, done = stepJob(job, left);
      left -= job.exp - before || 1;
      if (done) job = null;
    }
  }

  // ------------------------------------------------------------------ сглаживание + правая полоса ----
  function los(ax, az, bx, bz, minC) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 0.25));
    let pf = fy[cellAt(ax, az)] ?? 0;
    for (let s = 1; s < n; s++) {
      const x = ax + ((bx - ax) * s) / n, z = az + ((bz - az) * s) / n, k = cellAt(x, z);
      if (k < 0 || !ok[k] || clr[k] < minC) return false;
      if (Math.abs(fy[k] - pf) > 0.3) return false;
      pf = fy[k];
    }
    return true;
  }
  function smooth(pts, opts = {}) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !los(pts[a][0], pts[a][1], pts[b][0], pts[b][1], cfg.losClear)) b--;
      out.push(pts[b]); a = b;
    }
    // дополнительные точки на длинных прямых (чтобы правая полоса и избегание могли «дышать»), шаг ≤ 6 м
    const dense = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const p = out[i - 1], q = out[i], d = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.ceil(d / 6);
      for (let s = 1; s < n; s++) dense.push([p[0] + ((q[0] - p[0]) * s) / n, p[1] + ((q[1] - p[1]) * s) / n]);
      dense.push(q);
    }
    return opts.lane === false ? dense : lane(dense);
  }
  /** Правая полоса: вершины (кроме концов) сдвигаются вправо от направления движения, если зазор позволяет. «Вправо» — при взгляде вдоль +X локально это +Z. */
  function lane(p) {
    if (p.length < 3) return p;
    const out = [p[0]];
    for (let i = 1; i < p.length - 1; i++) {
      const a = p[i - 1], b = p[i], c = p[i + 1];
      let dx = c[0] - a[0], dz = c[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      // направление +X (вглубь): правая рука — сторона +Z (проектная система: +Z вправо, см. README), т.е. right = (−dz, dx) в плоскости (x,z) при взгляде вдоль (dx,dz)
      const rx = -dz, rz = dx;
      const wl = clearanceAt(b[0] + rx * 1.6, b[1] + rz * 1.6), tx = b[0] + rx * cfg.laneOffset, tz = b[1] + rz * cfg.laneOffset;
      const kk = cellAt(tx, tz);
      if (kk >= 0 && ok[kk] && clr[kk] >= cfg.laneMinClear && wl > 0 && los(out[out.length - 1][0], out[out.length - 1][1], tx, tz, cfg.minClear)) out.push([tx, tz]); else out.push(b);
    }
    out.push(p[p.length - 1]);
    return out;
  }

  return { cfg, ok, clr, fy, comp, nx, nz, cell, ox, oz, cellsOk, nComp, mainComp, walkable, clearanceAt, nearestCell, snap, randomPoint, request, cancel, pump, stats, lineClear: (ax, az, bx, bz) => los(ax, az, bx, bz, cfg.minClear + 0.04), cellAt, queue: () => queue.length };
}
