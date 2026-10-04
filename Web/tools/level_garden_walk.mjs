// Браузерный прогон сада и тропы: бот идёт по тем же heightAt/collide, что и игра (через input.axis), считает застревания.
//   1) лаз → дно высокой котловины → обход по кругу и обратно к лазу (туда и обратно);
//   2) тропа к нише вверх и вниз;  3) расхождение видимой земли и физики в 200 случайных точках (raycast по мешу пола против heightAt) < 0.05 м;
//   4) escape: из сада НЕ выйти ни пешком, ни прыжками (8 направлений: радиус не выходит за кольцо, ноги не падают ниже дна).
// node tools/build.mjs --out=garden.html && node tools/level_garden_walk.mjs [--only=garden,trail,mismatch] [--q=low]
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const only = arg('only', 'garden,escape,tunnel,trail,mismatch').split(',');
function findChromium() { const b = '/opt/pw-browsers'; if (!existsSync(b)) return undefined; const d = readdirSync(b).find((n) => /^chromium-\d+$/.test(n)); return d ? join(b, d, 'chrome-linux', 'chrome') : undefined; }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext|GPU stall|ReadPixels/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'garden.html'))}?autotest=1&q=${arg('q', 'low')}&lang=RU&skip=1`, { timeout: 0 });
await page.waitForFunction(() => window.__rakis?.garden && window.__rakis.player && window.__rakis.realTime > 1.5, null, { timeout: 1200000 });
await page.evaluate(() => { const g = window.__rakis; g.timeScale = 3; g.weather?.setHours?.(10.5, true); });

/** Бот: waypoints [[x,z],...], стартовая позиция/высота; возвращает итог. Шаги — по игровому времени. */
async function walk(name, way, { start, yStart, maxStuck = 20, maxT = 600, tol = 1.6 } = {}) {
  const res = await page.evaluate(([way, start, yStart, maxStuck, maxT, tol]) => new Promise((resolve) => {
    const g = window.__rakis, p = g.player;
    p.teleport(start[0], yStart, start[1], 0, false);
    let wi = 0, stuckT = 0, lastD = 1e9, t = 0, maxSlope = 0, falls = 0, lastY = p.position.y, minY = 1e9, maxY = -1e9;
    const jumps = []; let lp = p.position.clone(); const hist = [];
    const ax = g.input.axis;
    const V = new g.THREE.Vector3();
    g.input.axis = () => {
      const tg = way[wi], dx = tg[0] - p.position.x, dz = tg[1] - p.position.z, d = Math.hypot(dx, dz) || 1;
      g.camera.getWorldDirection(V);
      const cy = Math.atan2(V.z, V.x);
      const wx = dx / d, wz = dz / d;
      return { x: wx * -Math.sin(cy) + wz * Math.cos(cy), y: wx * Math.cos(cy) + wz * Math.sin(cy) };
    };
    let gt = g.time;
    const id = setInterval(() => {
      const dtg = g.time - gt; if (dtg < 0.1) return; gt = g.time;
      t += dtg;
      { const dj = Math.hypot(p.position.x - lp.x, p.position.z - lp.z); hist.push([+p.position.x.toFixed(1), +p.position.y.toFixed(1), +p.position.z.toFixed(1), g.space]); if (hist.length > 6) hist.shift(); if (dj > 2.2 && jumps.length < 3) jumps.push({ t: +t.toFixed(1), from: [+lp.x.toFixed(1), +lp.y.toFixed(1), +lp.z.toFixed(1)], to: [+p.position.x.toFixed(1), +p.position.y.toFixed(1), +p.position.z.toFixed(1)], space: g.space, hist: hist.slice() }); lp.copy(p.position); }
      const tg = way[wi], d = Math.hypot(tg[0] - p.position.x, tg[1] - p.position.z);
      if (d < tol) { wi++; stuckT = 0; lastD = 1e9; if (wi >= way.length) { clearInterval(id); g.input.axis = ax; resolve({ done: true, t: +t.toFixed(0), maxSlope: +(p.slope || 0).toFixed(0), minY, maxY, pos: [+p.position.x.toFixed(1), +p.position.y.toFixed(1), +p.position.z.toFixed(1)] }); return; } }
      if (d > lastD - 0.05) stuckT += dtg; else { stuckT = 0; lastD = d; }
      if (p.slope > maxSlope) maxSlope = p.slope;
      minY = Math.min(minY, p.position.y); maxY = Math.max(maxY, p.position.y);
      if (stuckT > maxStuck || t > maxT) { clearInterval(id); g.input.axis = ax; resolve({ done: false, wi, of: way.length, pos: [+p.position.x.toFixed(1), +p.position.y.toFixed(1), +p.position.z.toFixed(1)], t: +t.toFixed(0), maxSlope: +maxSlope.toFixed(0), jumps }); }
    }, 100);
  }), [way, start, yStart, maxStuck, maxT, tol]);
  console.log(`${res.done ? 'OK  ' : 'FAIL'} ${name}:`, JSON.stringify(res));
  if (!res.done) process.exitCode = 1;
  return res;
}

if (only.includes('garden')) {
  const M = await page.evaluate(() => { const m = window.__rakis.garden.mouth.info; return { x: m.xOut, z: m.z }; });
  const y0 = await page.evaluate(() => window.__rakis.heightAt(802, 395, 40));
  await walk('mouth -> garden loop', [[M.x + 2, M.z], [812, 396.5], [822, 395.5], [832, 398], [846, 404], [852, 392], [842, 378], [826, 372], [816, 385], [818, 410], [832, 424], [850, 418], [832, 398], [814, 397], [M.x + 2, M.z]], { start: [802, 395], yStart: y0 });
  await walk('garden -> mouth', [[M.x + 1, M.z]], { start: [840, 398] });
  const c = await page.evaluate(() => { const g = window.__rakis; return { zone: g.zone, space: g.space, surf: g.world.surfaceAt(822, 396), y: +g.player.position.y.toFixed(2) }; });
  console.log('state', JSON.stringify(c));
}
if (only.includes('escape')) {
  // побег: игрок в 6 м от стены идёт к цели далеко за стеной; вариант 2 — то же с постоянными прыжками (Jump каждые ~0.7 с)
  const res = await page.evaluate(() => new Promise((resolve) => {
    const g = window.__rakis, p = g.player, G = g.garden, V = new g.THREE.Vector3();
    const ang = (x, z) => Math.atan2(z - G.center.z, x - G.center.x), rad = (x, z) => Math.hypot(x - G.center.x, z - G.center.z);
    const ax = g.input.axis, pr = g.input.pressed;
    const runs = []; for (const jump of [false, true]) for (let k = 0; k < 8; k++) runs.push({ jump, th: (k / 8) * Math.PI * 2 - Math.PI + 0.3 });
    let ri = -1, goal = null, t = 0, gt = g.time, worst = -1e9, minY = 1e9, bad = [], jt = 0, jumpNow = false;
    g.input.axis = () => {
      if (!goal) return { x: 0, y: 0 };
      const dx = goal[0] - p.position.x, dz = goal[1] - p.position.z, d = Math.hypot(dx, dz) || 1;
      g.camera.getWorldDirection(V); const cy = Math.atan2(V.z, V.x), wx = dx / d, wz = dz / d;
      return { x: wx * -Math.sin(cy) + wz * Math.cos(cy), y: wx * Math.cos(cy) + wz * Math.sin(cy) };
    };
    g.input.pressed = (a) => (a === 'Jump' && jumpNow ? (jumpNow = false, true) : pr(a));
    const next = () => {
      if (ri >= 0) runs[ri].res = { over: +worst.toFixed(2), minY: +minY.toFixed(1) };
      ri++;
      if (ri >= runs.length) { g.input.axis = ax; g.input.pressed = pr; resolve(runs); return; }
      const r = runs[ri];
      // старт: в 6 м внутри кольца (радиус кольца берём из api: inBasin по лучу)
      let rr = 45; while (rr > 5 && !G.inBasin(G.center.x + Math.cos(r.th) * rr, G.center.z + Math.sin(r.th) * rr, 6)) rr -= 1;
      const sx = G.center.x + Math.cos(r.th) * rr, sz = G.center.z + Math.sin(r.th) * rr;
      p.teleport(sx, G.groundAt(sx, sz), sz, 0, false);
      goal = [G.center.x + Math.cos(r.th) * 160, G.center.z + Math.sin(r.th) * 160];
      t = 0; worst = -1e9; minY = 1e9; jt = 0;
    };
    next();
    const id = setInterval(() => {
      const dtg = g.time - gt; if (dtg < 0.1) return; gt = g.time; t += dtg; jt += dtg;
      if (runs[ri].jump && jt > 0.7) { jt = 0; jumpNow = true; }
      const x = p.position.x, z = p.position.z;
      if (x > G.faceAt(z) + 3) worst = Math.max(worst, rad(x, z) - G.ringRadius(x, z));       // > 0 — вышел за подножие стены
      minY = Math.min(minY, p.position.y);
      if (t > 14) next();
    }, 100);
  }));
  // over — max(радиус − радиус подножия стены): должно быть < 0 (держит стена), ноги не ниже дна (не падал)
  const bad = res.filter((r) => r.res.minY < 33 || r.res.over > -0.3);
  console.log(`${bad.length ? 'FAIL' : 'OK  '} escape: ${res.length} runs (8 dirs x walk/jump)`, JSON.stringify(res.map((r) => [r.jump ? 'J' : 'W', +(r.th * 57.3).toFixed(0), r.res.over, r.res.minY])));
  const inside = await page.evaluate(() => { const g = window.__rakis, G = g.garden, p = g.player.position; return { inBasin: G.inBasin(p.x, p.z, 0.2) || p.x < G.faceAt(p.z) + 3, y: +p.y.toFixed(1) }; });
  console.log('after escape runs', JSON.stringify(inside));
  if (bad.length || !inside.inBasin) process.exitCode = 1;
}
if (only.includes('diag')) {
  // диагностика стыка штольня ↔ туннель сиетча: высота/коллизия/пространство по шагам вдоль оси z = 395
  const rows = await page.evaluate(() => {
    const g = window.__rakis, T = g.THREE, out = [];
    const sp0 = g.space; g.space = 'sietch';      // как у игрока в туннеле (contains решает по точке)
    for (let x = 800; x >= 789.9; x -= 0.5) {
      const y0 = g.world.heightAt(x, 395, 6);
      const p = new T.Vector3(x, y0, 395); const o = p.clone();
      const inS = !!g.sietch?.contains?.(p);
      const gh = g.groundAt ? g.groundAt(x, 395, y0)?.heightAt?.(x, 395, y0) : null;
      const hit = g.collide(p, 0.35);
      const cols = []; for (const e of g.colliders.near(new T.Vector3(x, y0 + 1, 395), 1.2)) cols.push(`${e.owner}:${[...(e.tags || [])].join('/')}`);
      out.push({ x, wh: +y0.toFixed(2), sietchContains: inS, groundH: gh === null ? null : +gh.toFixed(2), push: hit ? [+(p.x - o.x).toFixed(2), +(p.z - o.z).toFixed(2)] : 0, cols });
    }
    g.space = sp0;
    return out;
  });
  for (const r of rows) console.log(JSON.stringify(r));
}
if (only.includes('tunnel')) {
  // сиетч ↔ сад: из сада по выходному туннелю к залу и обратно (смена пространства desert ↔ sietch на ходу)
  const path = await page.evaluate(() => (window.__rakis.sietch?.exitPath || []).map((p) => [p.x, p.z]));
  if (path.length) {
    const toHall = [[803, 395], [797, 395]].concat(path.slice().reverse());
    const r1 = await walk('garden -> tunnel -> hall', toHall, { start: [812, 396], maxStuck: 25 });
    // из зала: входим в сиетч штатным способом (debug enter 'exit' — пространство и свет переключает сам сиетч) и идём по туннелю к саду
    const e0 = await page.evaluate(async () => { const g = window.__rakis; await g.sietch.enter('exit'); const p = g.player.position; return [p.x, p.z]; });
    let k0 = 0, best = 1e9; path.forEach((q, i) => { const d = Math.hypot(q[0] - e0[0], q[1] - e0[1]); if (d < best) { best = d; k0 = i; } });
    const toGarden = path.slice(k0).concat([[797, 395], [803, 395], [812, 396]]);
    await walk('hall(exit) -> tunnel -> garden', toGarden, { start: e0, yStart: await page.evaluate(() => window.__rakis.player.position.y), maxStuck: 25 });
    console.log('space/zone', JSON.stringify(await page.evaluate(() => ({ space: window.__rakis.space, zone: window.__rakis.zone }))));
  } else console.log('no sietch.exitPath — skip');
}
if (only.includes('perf')) {
  const r = await page.evaluate(() => { const p = window.__rakis.garden.perf; return { avgMs: +p.avg.toFixed(3), maxMs: +p.max.toFixed(2), firstMs: +p.first.toFixed(2), frames: p.n, firstFrameParts: Object.fromEntries(Object.entries(p.parts).map(([k, v]) => [k, +v.toFixed(1)])) }; });
  console.log('garden update() CPU:', JSON.stringify(r), 'render:', JSON.stringify(await page.evaluate(() => window.__rakis.garden.renderStats())));
}
if (only.includes('trail')) {
  // проходимость тропы «как в игре»: на каждой точке тропы game.collide не должен смещать позицию ступней (ни препятствия пустыни, ни коллайдеры)
  const clear = await page.evaluate(() => {
    const g = window.__rakis, A = g.approach, T = g.THREE; const bad = [];
    for (let i = 0; i < A.trail.length; i += 2) {
      const p = A.trail[i]; const pos = new T.Vector3(p.x, g.world.heightAt(p.x, p.z, p.y), p.z); const o = pos.clone();
      g.collide(pos, 0.35); if (Math.hypot(pos.x - o.x, pos.z - o.z) > 0.02) bad.push([+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1), +Math.hypot(pos.x - o.x, pos.z - o.z).toFixed(2)]);
    }
    const desertCols = []; for (const e of g.colliders.all()) if (e.owner === 'desert' && e.c && e.c.x > 575 && e.c.x < 670 && e.c.z > 225 && e.c.z < 325) desertCols.push([+e.c.x.toFixed(1), +e.c.z.toFixed(1), +e.r.toFixed(1)]);
    return { n: A.trail.length / 2 | 0, blocked: bad.length, bad: bad.slice(0, 10), desertCollidersInZone: desertCols.length };
  });
  console.log(`${clear.blocked ? 'FAIL' : 'OK  '} trail clearance:`, JSON.stringify(clear));
  if (clear.blocked) process.exitCode = 1;
  const way = await page.evaluate(() => { const A = window.__rakis.approach; const out = []; for (let i = 0; i < A.trail.length; i += 2) out.push([A.trail[i].x, A.trail[i].z]); out.push([A.trail[A.trail.length - 1].x, A.trail[A.trail.length - 1].z]); return out; });
  const st = await page.evaluate(() => { const A = window.__rakis.approach; return { x: A.trail[0].x, z: A.trail[0].z }; });
  await walk('trail up', way, { start: [st.x, st.z], maxStuck: 25, maxT: 1200, tol: 0.9 });
  await walk('trail down', way.slice().reverse(), { start: way[way.length - 1], yStart: undefined, maxStuck: 25, maxT: 1200, tol: 0.9 });
}
if (only.includes('mismatch')) {
  const r = await page.evaluate(() => {
    const g = window.__rakis, T = g.THREE, G = g.garden;
    const rc = new T.Raycaster(); const dir = new T.Vector3(0, -1, 0);
    G.root.updateMatrixWorld(true);
    let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let n = 0, worst = 0, bad = [], sum = 0, miss = 0;
    while (n < 200) {
      const x = G.center.x - 36 + rnd() * 72, z = G.center.z - 36 + rnd() * 72;
      if (!G.inBasin(x, z, 2)) continue;
      const gy = G.groundAt(x, z);
      rc.set(new T.Vector3(x, gy + 3, z), dir); rc.far = 10;
      const hit = rc.intersectObject(G.groundMesh, false)[0];
      n++;
      if (!hit) { miss++; continue; }
      const dy = Math.abs(hit.point.y - g.world.heightAt(x, z, gy + 0.3));
      sum += dy; if (dy > worst) worst = dy; if (dy > 0.05) bad.push([+x.toFixed(1), +z.toFixed(1), +dy.toFixed(3)]);
    }
    return { n, miss, worst: +worst.toFixed(4), mean: +(sum / Math.max(1, n - miss)).toFixed(5), bad: bad.slice(0, 8) };
  });
  console.log(`${r.worst < 0.05 && !r.miss ? 'OK  ' : 'FAIL'} mismatch visual/physics @200:`, JSON.stringify(r));
  if (r.worst >= 0.05 || r.miss) process.exitCode = 1;
}
console.log('errors:', errors.length ? '\n' + errors.slice(0, 10).join('\n') : 'none');
await browser.close();
