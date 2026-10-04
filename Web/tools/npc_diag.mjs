// Диагностика поведения NPC сиетча и спутников БЕЗ рендера (game.simulate), 3–5 минут игрового времени.
// Считает: дрожание (>3 смен направления/с), хождение сквозь стены и друг через друга, застревание, телепорты/скачки,
// скольжение (скорость ≠ анимация), хождение сквозь игрока/занавеси, петли «туда-сюда», замершие позы, одновременные развороты группы.
// Сценарий: 0–60 с игрок стоит на рынке (B2), 60–T-40 с идёт маршрутом B2 → B3 → комнаты → назад, последние 40 с стоит в B3.
//   node tools/npc_diag.mjs [--file=rakis_demo.html] [--sec=240] [--q=low] [--json=path]
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const file = arg('file', 'rakis_demo.html'), q = arg('q', 'low'), SEC = +arg('sec', 240), jsonOut = arg('json', '');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext/.test(m.text())) errors.push(m.text()); });
await page.goto(`file://${root}/dist/${file}?autotest=1&q=${q}&lang=RU&drs=0&warm=0`, { timeout: 300000 });
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
// детерминизм: сид для Math.random, остановка rAF-цикла (симуляцию шагаем только вручную)
await page.evaluate(async () => {
  let a = 12345; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = window.__rakis; await g.sietch.enter('B2');
  window.requestAnimationFrame = () => 0;
});
await page.waitForTimeout(300);

const res = await page.evaluate((SEC) => {
  const g = window.__rakis, S = g.sietch, crowd = S.crowd, plan = S.plan, pl = g.player;
  const DT = 1 / 30;
  const npcs = crowd.npcs.filter((n) => !n.special);
  const comps = g.companions.list;
  const st = { fwd: 0 };
  g.input.axis = () => ({ x: 0, y: st.fwd });
  const toL = (v) => S.toLocal(v);
  // --- бот-игрок: стоит 60 с, потом идёт маршрутом, последние 40 с стоит
  const route = [[60, 0.5], [76, 0], [96, 0], [104, 0.4], [126, 0.5], [138, 0.3], [126, 0.5], [104, 0.4], [96, 0], [76, 0], [60, 0.5], [46, 0]].map(([x, z]) => { const w = S.toWorld(x, 0, z); return [w.x, w.z]; });
  // стартовая точка на рынке
  { const w = S.toWorld(60, plan.heightAtLocal(60, 0.5, 0), 0.5); pl.teleport?.(w.x, w.y, w.z, pl.yaw); g.companions.teleportBehind(); }
  let ri = 0, rBest = 1e9, rT = 0;
  const botStep = (t) => {
    if (t < 60 || t > SEC - 40 || ri >= route.length) { st.fwd = 0; return; }
    const [x, z] = route[ri], dx = x - pl.position.x, dz = z - pl.position.z, d = Math.hypot(dx, dz);
    if (pl.cam) pl.cam.yaw = Math.atan2(dz, dx);
    pl.yaw = Math.atan2(dz, dx);
    st.fwd = 1;
    if (d < 1.5) { ri++; rBest = 1e9; rT = t; } else if (d < rBest - 0.3) { rBest = d; rT = t; } else if (t - rT > 10) { ri++; rBest = 1e9; rT = t; }
  };

  // --- метрики
  const M = {
    npc: { jitter: 0, jitterNpcs: new Set(), yawJitter: 0, wallWalk: 0, wallAct: 0, wallNpcs: new Set(), overlapEp: 0, overlapPairs: new Set(), stuck: 0, stuckNpcs: new Set(), teleports: 0, teleNpcs: new Set(), yawJumps: 0,
      slideWin: 0, movingWin: 0, nudgeWin: 0, throughPlayer: 0, ppNpcs: new Set(), curtainCross: 0, curtainHand: 0, loops: 0, loopNpcs: new Set(), frozenSec: 0, totalActSec: 0, frozenNpcs: new Set(), groupTurns: 0, walkSec: 0 },
    comp: { jitter: 0, teleports: 0, teleOnScreen: 0, wall: 0, overlapPlayer: 0, blockFront: 0, blockNarrow: 0, lagSec: 0, simTurn: 0, speedFlip: 0, frames: 0, idleSec: 0, headTurns: 0, maxLag: 0, nearFrontSec: 0 },
  };
  const EX = (M.ex = {});
  const ex = (k, o) => { const a = (EX[k] = EX[k] || []); if (a.length < 4) a.push(o); };
  const r1 = (v) => +v.toFixed(1);
  const poseSec = {}, taskSec = {};
  const per = new Map();
  for (const n of npcs) per.set(n, { lx: n.x, lz: n.z, lt: 0, dirs: [], flips: [], yflips: [], ly: n.yaw, ldy: 0, wallT: -9, ovT: new Map(), win: { t: 0, d0x: n.x, d0z: n.z, an: 0, k: 0 }, pathLen: 0, pathT: 0, p0x: n.x, p0z: n.z, wasWalk: false, still: 0, stillYaw: n.yaw, frozenCounted: false, ppT: -9, side: new Map(), lastPath: null, walkT0: -1, prog: { t: 0, x: n.x, z: n.z }, turnT: -9, lastLoop: -99 });
  const cp = new Map();
  for (const c of comps) cp.set(c, { x: c.position.x, z: c.position.z, flips: [], lastDir: null, mv: [], lyaw: c.yaw, turns: [], lagT: 0, mvFlag: c.moving });
  const turnLog = []; // [t, npc] начала разворотов
  // замер стоимости crowd.update (JS, без рендера), мс на тик
  const cu = crowd.update; const tm = []; crowd.update = function (dt2, t2) { const a = performance.now(); cu.call(crowd, dt2, t2); tm.push(performance.now() - a); };
  let t = 0;
  const cam = g.camera, fwd = { x: 0, z: 0 };
  const flipsIn = (arr, now, w = 1) => { while (arr.length && arr[0] < now - w) arr.shift(); return arr.length; };

  g.simulate(SEC, DT, () => {
    t += DT;
    botStep(t);
    const pw = pl.position, plL = toL(pw);
    const cdir = cam.getWorldDirection(new (cam.position.constructor)()); fwd.x = cdir.x; fwd.z = cdir.z; const fl = Math.hypot(fwd.x, fwd.z) || 1; fwd.x /= fl; fwd.z /= fl;
    // -------- NPC
    for (const n of npcs) {
      const s = per.get(n);
      const dxm = n.x - s.lx, dzm = n.z - s.lz, dd = Math.hypot(dxm, dzm);
      const moved = dd > 1e-4;
      const dtS = t - s.lt;
      if (moved) {
        // скачок
        const vmax = Math.max(4, (n.speed || 1.2) * 3.5);
        if (dd > Math.max(0.9, vmax * dtS * 1.3) && n.mode !== 'wait') { M.npc.teleports++; M.npc.teleNpcs.add(n.id); ex('npcTele', [n.id, n.kind, r1(t), r1(dd), n.mode]); }
        // смены направления
        if (dd > 0.004 && s.dirs.length) { const [px, pz] = s.dirs[s.dirs.length - 1]; if (px * dxm + pz * dzm < -0.2 * Math.hypot(px, pz) * dd) { s.flips.push(t); if (flipsIn(s.flips, t) >= 4) { M.npc.jitter++; M.npc.jitterNpcs.add(n.id); ex('jitter', [n.id, n.kind, n.mode, r1(t), n.speedNow && +n.speedNow.toFixed(2), n.lod]); s.flips.length = 0; } } }
        if (dd > 0.004) { s.dirs.push([dxm, dzm]); if (s.dirs.length > 3) s.dirs.shift(); }
        s.lx = n.x; s.lz = n.z; s.lt = t;
      }
      // курс: скачок и дрожание
      let dy = n.yaw - s.ly; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      if (Math.abs(dy) > 1.2 && n.mode !== 'wait') { M.npc.yawJumps++; ex('yawJump', [n.id, n.kind, n.mode, r1(t), r1(dy)]); }
      if (Math.abs(dy) > 0.03 && Math.abs(s.ldy) > 0.03 && dy * s.ldy < 0) { s.yflips.push(t); if (flipsIn(s.yflips, t) >= 4) { M.npc.yawJitter++; s.yflips.length = 0; } }
      if (Math.abs(dy) > 1e-4) s.ldy = dy; s.ly = n.yaw;
      // начало резкого разворота (> 0.9 рад за 0.4 с) → групповой разворот
      if (!s.yh) s.yh = [];
      s.yh.push([t, n.yaw]); while (s.yh.length && s.yh[0][0] < t - 0.4) s.yh.shift();
      { let d2 = n.yaw - s.yh[0][1]; d2 = Math.atan2(Math.sin(d2), Math.cos(d2)); if (Math.abs(d2) > 0.9 && t - s.turnT > 2 && n.mode !== 'walk') { s.turnT = t; turnLog.push([t, n.id]); } }
      const sleeping = n.kind === 'sleep' || n.pose === 'sleep';
      if (!sleeping && n.mode !== 'walk') poseSec[n.pose] = (poseSec[n.pose] || 0) + DT;
      if (n.task) taskSec[n.task.type] = (taskSec[n.task.type] || 0) + DT;
      const sitting = n.pose === 'sitFloor' || n.pose === 'sitBench' || n.mode === 'seat';
      // стены
      if (!sleeping && n.arch !== undefined) {
        const wd = plan.wallDistLocal(n.x, n.z, n.layer || 0);
        if (wd < 0.1) { if (t - s.wallT > 2.5) { if (n.mode === 'walk') M.npc.wallWalk++; else M.npc.wallAct++; M.npc.wallNpcs.add(n.id); ex('npcWall', [n.id, n.kind, n.mode, r1(n.x), r1(n.z), +wd.toFixed(2)]); } s.wallT = t; }
      }
      // через игрока
      { const dp = Math.hypot(n.x - plL.x, n.z - plL.z); if (dp < 0.4 && !sleeping && Math.abs((n.layer ? 6.5 : 0) - 0) < 99) { if (t - s.ppT > 2.5) { M.npc.throughPlayer++; M.npc.ppNpcs.add(n.id); ex('npcPlayer', [n.id, n.kind, n.mode, r1(t)]); } s.ppT = t; } }
      // занавеси
      if (moved) for (const c of S.ctx.curtains) {
        if (c.axis !== 'x') continue;
        if (Math.abs(n.x - c.x) < c.w / 2) { const a = (s.lz - c.z) * c.side, b = (n.z - c.z) * c.side; if (a * b < 0 && Math.abs(n.z - s.lz) < 1) { M.npc.curtainCross++; if (n.fig.handReach?.() || n.reaching) M.npc.curtainHand++; } }
      }
      // скольжение: окно 0.5 с
      const w = s.win; w.an += (n.mode === 'walk' ? n.speedNow : 0) * DT; w.k++; w.t += DT;
      if (w.t >= 0.5) {
        const act = Math.hypot(n.x - w.d0x, n.z - w.d0z) / w.t, an = w.an / w.t;
        if (!sleeping && n.kind !== 'dancer') {
          if (an > 0.2 || act > 0.2) { M.npc.movingWin++; if (Math.abs(act - an) > Math.max(0.35, 0.3 * an)) M.npc.slideWin++; }
          if (n.mode !== 'walk' && an < 0.05 && act > 0.12) M.npc.nudgeWin++;
        }
        w.t = 0; w.an = 0; w.k = 0; w.d0x = n.x; w.d0z = n.z;
      }
      // петли и застревание (пока идёт путь)
      if (n.mode === 'walk') {
        M.npc.walkSec += DT;
        if (!s.wasWalk) { s.pathLen = 0; s.pathT = t; s.p0x = n.x; s.p0z = n.z; s.walkT0 = t; s.prog = { t, x: n.x, z: n.z }; }
        s.pathLen += dd;
        if (t - s.pathT >= 10) {
          const net = Math.hypot(n.x - s.p0x, n.z - s.p0z);
          if (s.pathLen > 5 && net < 0.3 * s.pathLen && t - s.lastLoop > 10 && n.kind !== 'play') { M.npc.loops++; M.npc.loopNpcs.add(n.id); s.lastLoop = t; }
          s.pathT = t; s.pathLen = 0; s.p0x = n.x; s.p0z = n.z;
        }
        if (t - s.prog.t >= 6) { if (Math.hypot(n.x - s.prog.x, n.z - s.prog.z) < 0.4) { M.npc.stuck++; M.npc.stuckNpcs.add(n.id); ex('stuck6s', [n.id, n.kind, r1(t), r1(n.x), r1(n.z), n.path && n.path.length]); } s.prog = { t, x: n.x, z: n.z }; }
        if (t - s.walkT0 > 60 && n.kind !== 'play') { M.npc.stuck++; M.npc.stuckNpcs.add(n.id); s.walkT0 = t; ex('walk60s', [n.id, n.kind, r1(t), r1(n.x), r1(n.z)]); }
      }
      s.wasWalk = n.mode === 'walk';
      // замершая стоячая поза (без активности) > 20 с
      if (n.mode === 'act' && n.pose === 'stand' && !sleeping && n.kind !== 'guardPost' && n.kind !== 'guardGrate') {
        M.npc.totalActSec += DT;
        const dyaw = Math.abs(Math.atan2(Math.sin(n.yaw - s.stillYaw), Math.cos(n.yaw - s.stillYaw)));
        if (dyaw > 0.05 || moved) { s.still = 0; s.stillYaw = n.yaw; s.frozenCounted = false; } else { s.still += DT; if (s.still > 20) { M.npc.frozenSec += DT; M.npc.frozenNpcs.add(n.id); } }
      } else if (n.mode === 'act') M.npc.totalActSec += DT; else s.still = 0;
    }
    // перекрытия между людьми (раз в 3 тика: O(N²))
    if (((t / DT) | 0) % 3 === 0) {
      for (let i = 0; i < npcs.length; i++) {
        const a = npcs[i]; if (a.kind === 'sleep' || a.pose === 'sleep') continue;
        for (let j = i + 1; j < npcs.length; j++) {
          const b = npcs[j]; if (b.kind === 'sleep' || b.pose === 'sleep' || (a.layer || 0) !== (b.layer || 0)) continue;
          if (a.mode !== 'walk' && b.mode !== 'walk') continue;
          const d = Math.hypot(a.x - b.x, a.z - b.z); if (d > 0.36) continue;
          const key = a.id * 1000 + b.id, sa = per.get(a), last = sa.ovT.get(key) ?? -9;
          if (t - last > 2.5) { M.npc.overlapEp++; M.npc.overlapPairs.add(key); ex('overlap', [a.id, a.kind, a.mode, b.id, b.kind, b.mode, r1(t), r1(a.x), r1(a.z)]); }
          sa.ovT.set(key, t);
        }
      }
    }
    // -------- спутники
    for (const c of comps) {
      const s = cp.get(c), p = c.position;
      const cl = toL(p);
      const dx = p.x - s.x, dz = p.z - s.z, dd = Math.hypot(dx, dz);
      M.comp.frames++;
      if (dd > 0.6) { M.comp.teleports++; const vx = p.x - cam.position.x, vz = p.z - cam.position.z, vl = Math.hypot(vx, vz) || 1; if ((vx * fwd.x + vz * fwd.z) / vl > 0.35 && vl < 60) M.comp.teleOnScreen++; }
      if (dd > 0.003) { if (s.lastDir && s.lastDir[0] * dx + s.lastDir[1] * dz < -0.2 * Math.hypot(...s.lastDir) * dd) { s.flips.push(t); if (flipsIn(s.flips, t) >= 4) { M.comp.jitter++; s.flips.length = 0; } } s.lastDir = [dx, dz]; }
      s.x = p.x; s.z = p.z;
      if (c.moving !== s.mvFlag) { s.mv.push(t); s.mvFlag = c.moving; if (flipsIn(s.mv, t) >= 4) { M.comp.speedFlip++; s.mv.length = 0; } }
      { const wdc = plan.wallDistLocal(cl.x, cl.z, cl.y > 3.4 ? 6.5 : 0); if (wdc < 0.12) { M.comp.wall++; ex('compWall', [c.id, r1(t), r1(cl.x), r1(cl.y), r1(cl.z), +wdc.toFixed(2)]); } }
      const dp = Math.hypot(p.x - pw.x, p.z - pw.z);
      if (dp < 0.45) M.comp.overlapPlayer++;
      const vx = p.x - cam.position.x, vz = p.z - cam.position.z, vl = Math.hypot(vx, vz) || 1, cosA = (vx * fwd.x + vz * fwd.z) / vl;
      if (vl < 3.2 && cosA > 0.8) { M.comp.blockFront++; }
      if (vl < 4 && cosA > 0.7) M.comp.nearFrontSec += DT;
      const pwd = plan.wallDistLocal(plL.x, plL.z, 0);
      if (pwd < 1.5 && vl < 3.5 && cosA > 0.75) M.comp.blockNarrow++;
      if (dp > 9) { M.comp.lagSec += DT; M.comp.maxLag = Math.max(M.comp.maxLag, dp); }
      if (!c.moving) M.comp.idleSec += DT;
      let dyc = c.yaw - s.lyaw; dyc = Math.atan2(Math.sin(dyc), Math.cos(dyc)); s.lyaw = c.yaw;
      s.turns.push([t, dyc]); while (s.turns.length && s.turns[0][0] < t - 0.5) s.turns.shift();
    }
    if (comps.length > 1) { const rate = (c) => Math.abs(cp.get(c).turns.reduce((a, b) => a + b[1], 0)); if (rate(comps[0]) > 0.5 && rate(comps[1]) > 0.5 && ((t / DT) | 0) % 15 === 0) M.comp.simTurn++; }
  });
  // групповые развороты: >=3 NPC начали разворот в окне 0.6 с
  turnLog.sort((a, b) => a[0] - b[0]);
  let last = -9;
  for (let i = 0; i < turnLog.length; i++) { let k = 0; for (let j = i; j < turnLog.length && turnLog[j][0] - turnLog[i][0] < 0.6; j++) k++; if (k >= 3 && turnLog[i][0] - last > 3) { M.npc.groupTurns++; last = turnLog[i][0]; } }
  const o = JSON.parse(JSON.stringify(M, (k, v) => (v instanceof Set ? v.size : v)));
  o.nNpc = npcs.length; o.sec = SEC; o.nComp = comps.length;
  o.npc.slidePct = +(100 * M.npc.slideWin / Math.max(1, M.npc.movingWin)).toFixed(1);
  o.npc.frozenPct = +(100 * M.npc.frozenSec / Math.max(1, M.npc.totalActSec)).toFixed(1);
  o.comp.blockFrontPct = +(100 * M.comp.blockFront / Math.max(1, M.comp.frames)).toFixed(1);
  o.comp.blockNarrowPct = +(100 * M.comp.blockNarrow / Math.max(1, M.comp.frames)).toFixed(1);
  o.poses = Object.fromEntries(Object.entries(poseSec).map(([k, v]) => [k, Math.round(v)])); o.tasks = Object.fromEntries(Object.entries(taskSec).map(([k, v]) => [k, Math.round(v)]));
  o.social = crowd.social ? { ...crowd.social.stats, phase: crowd.social.phase } : null; o.curtainHands = crowd.curtainHands ?? null; o.nav = crowd.nav ? { ...crowd.nav.stats, cells: crowd.nav.cellsOk } : null; o.compStats = g.companions.stats || null;
  tm.sort((a, b) => a - b); o.crowdMs = { median: +tm[tm.length >> 1].toFixed(3), p95: +tm[Math.floor(tm.length * 0.95)].toFixed(3), max: +tm[tm.length - 1].toFixed(3), mean: +(tm.reduce((a, b) => a + b, 0) / tm.length).toFixed(3) };
  o.perf = { crowd: S.prof.crowd, total: S.prof.total, crowdProf: crowd.prof };
  return o;
}, SEC);

console.log(JSON.stringify(res, null, 1));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(res, null, 1));
if (errors.length) console.log('ERRORS', errors.slice(0, 5));
await browser.close();
