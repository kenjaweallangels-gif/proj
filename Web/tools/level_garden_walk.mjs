// Браузерный прогон сада и тропы: бот идёт по тем же heightAt/collide, что и игра (через input.axis), считает застревания.
//   1) штольня → устье → площадь → тропы/грядки/пруд → овраг → пустыня и обратно;
//   2) тропа к нише вверх и вниз;
//   3) расхождение видимой земли и физики в 200 случайных точках (raycast по мешу пола против heightAt) < 0.05 м.
// node tools/build.mjs --out=garden.html && node tools/level_garden_walk.mjs [--only=garden,trail,mismatch] [--q=low]
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const only = arg('only', 'garden,trail,mismatch').split(',');
function findChromium() { const b = '/opt/pw-browsers'; if (!existsSync(b)) return undefined; const d = readdirSync(b).find((n) => /^chromium-\d+$/.test(n)); return d ? join(b, d, 'chrome-linux', 'chrome') : undefined; }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext|GPU stall|ReadPixels/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'garden.html'))}?autotest=1&q=${arg('q', 'low')}&lang=RU&skip=1`);
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
  const loop = [[803, 395.8], [812, 396.5], [822, 395.5], [832, 397.5], [842, 402.8], [852, 404], [864, 403.5], [878, 406.5], [890, 410], [902, 412.5], [914, 416.5], [926, 419.5]];
  const y0 = await page.evaluate(() => window.__rakis.world.heightAt(796, 395.8));
  await walk('mouth -> ravine -> desert', loop, { start: [796, 395.8], yStart: y0 });
  await walk('ravine -> mouth', loop.slice().reverse().concat([[797, 395.8]]), { start: [926, 419.5] });
  await walk('garden loop', [[812, 396], [818, 386], [826, 368], [828, 396], [836, 420], [846, 436], [830, 412], [850, 404], [852, 380], [870, 372], [878, 390], [868, 420], [840, 440], [820, 410], [808, 396]], { start: [808, 396] });
  await walk('beds crossing', [[836, 395], [843, 382], [843, 397], [861, 397], [861, 412], [850, 420], [850, 404]], { start: [836, 395] });
  const c = await page.evaluate(() => { const g = window.__rakis; return { zone: g.zone, space: g.space, surf: g.world.surfaceAt(822, 396), surfBed: g.world.surfaceAt(843, 388) }; });
  console.log('state', JSON.stringify(c));
}
if (only.includes('diag')) {
  // диагностика стыка штольня ↔ туннель сиетча: высота/коллизия/пространство по шагам вдоль оси z = 395.8
  const rows = await page.evaluate(() => {
    const g = window.__rakis, T = g.THREE, out = [];
    const sp0 = g.space; g.space = 'sietch';      // как у игрока в туннеле (contains решает по точке)
    for (let x = 800; x >= 789.9; x -= 0.5) {
      const y0 = g.world.heightAt(x, 395.8, 6);
      const p = new T.Vector3(x, y0, 395.8); const o = p.clone();
      const inS = !!g.sietch?.contains?.(p);
      const gh = g.groundAt ? g.groundAt(x, 395.8, y0)?.heightAt?.(x, 395.8, y0) : null;
      const hit = g.collide(p, 0.35);
      const cols = []; for (const e of g.colliders.near(new T.Vector3(x, y0 + 1, 395.8), 1.2)) cols.push(`${e.owner}:${[...(e.tags || [])].join('/')}`);
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
    const toHall = [[803, 395.8], [796, 395.8]].concat(path.slice().reverse());
    const r1 = await walk('garden -> tunnel -> hall', toHall, { start: [812, 396], maxStuck: 25 });
    // из зала: входим в сиетч штатным способом (debug enter 'exit' — пространство и свет переключает сам сиетч) и идём по туннелю к саду
    const e0 = await page.evaluate(async () => { const g = window.__rakis; await g.sietch.enter('exit'); const p = g.player.position; return [p.x, p.z]; });
    let k0 = 0, best = 1e9; path.forEach((q, i) => { const d = Math.hypot(q[0] - e0[0], q[1] - e0[1]); if (d < best) { best = d; k0 = i; } });
    const toGarden = path.slice(k0).concat([[796, 395.8], [803, 395.8], [812, 396]]);
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
    let n = 0, worst = 0, bad = [], sum = 0, miss = 0, terrainAbove = -9, rock = 0;
    const field = G.field;
    while (n < 200) {
      const x = 805 + rnd() * 110, z = 340 + rnd() * 110;
      if (G.grid.coverAt(x, z) < 0.99) continue;
      // только пол внутри котловины: у стен видимая «земля» — скала, там heightAt (колонки SDF) и должен быть выше сетки
      const inRav = x > 856 && G.field.ravineW(x, z).d < 2.2;
      if (!inRav && (Math.hypot(x - G.center.x, z - G.center.z) > 46 || x < G.faceAt(z) + 4)) continue;
      // вне стенок/структур: bump = 0
      if (field.bump(x, z) > 0.001) continue;
      const hp = g.world.heightAt(x, z, 1e3);          // «верх» колонки — только для точек в котловине без скал над головой
      const gy = G.groundAt(x, z);
      rc.set(new T.Vector3(x, gy + 3, z), dir); rc.far = 10;
      // видимая поверхность = самая высокая из (меш пола, меш скал/валунов) не выше ступней + 1.1 м (как выбирает heightAt)
      const hp0 = g.world.heightAt(x, z, gy + 0.3);
      if (hp0 > gy + 0.05) { rock++; continue; }          // под ногами камень (валун/склон): там точность — сетка скал 0.8 м, не пол
      const hit = rc.intersectObject(G.groundMesh, false)[0];
      n++;
      terrainAbove = Math.max(terrainAbove, G.terrainAt(x, z) - gy);
      if (!hit) { miss++; continue; }
      const dy = Math.abs(hit.point.y - g.world.heightAt(x, z, gy + 0.3));
      sum += dy; if (dy > worst) worst = dy; if (dy > 0.05) bad.push([+x.toFixed(1), +z.toFixed(1), +dy.toFixed(3)]);
    }
    return { n, miss, worst: +worst.toFixed(4), mean: +(sum / Math.max(1, n - miss)).toFixed(5), terrainMinusGroundMax: +terrainAbove.toFixed(3), skippedRock: rock, bad: bad.slice(0, 8) };
  });
  console.log(`${r.worst < 0.05 && !r.miss && r.terrainMinusGroundMax < -0.05 ? 'OK  ' : 'FAIL'} mismatch visual/physics @200:`, JSON.stringify(r));
  if (r.worst >= 0.05 || r.miss || r.terrainMinusGroundMax >= -0.05) process.exitCode = 1;
}
console.log('errors:', errors.length ? '\n' + errors.slice(0, 10).join('\n') : 'none');
await browser.close();
