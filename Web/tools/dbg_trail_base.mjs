// Сравнение: проходит ли бот участок тропы (i=30..60) в старой сборке (ручное шагание модулей) и в новой (game.simulate).
import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const file = arg('file', 'perf_baseline.html');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('ERR', e));
await page.goto(`file://${root}/dist/${file}?autotest=1&q=low&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
const r = await page.evaluate(() => {
  const g = window.__rakis, pl = g.player;
  let fwd = 1; g.input.axis = () => ({ x: 0, y: fwd });
  g.debug.goto('trail');
  const step = (dt) => {
    if (g.simulate) { g.simulate(dt, dt); return; }
    g.dt = dt; g.time += dt; g.realTime += dt;
    for (const { mod } of g.modules) { try { mod.update?.(dt, g.time); } catch (e) { /* */ } }
    for (const { mod } of g.modules) { try { mod.lateUpdate?.(dt, g.time); } catch (e) { /* */ } }
    g.input.endFrame?.();
  };
  for (let k = 0; k < 30; k++) step(1 / 30);
  const tr = g.approach.trail;
  let i = 0, t = 0, best = 1e9, lastBest = 0; const log = [];
  let rs = 5; const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647; let side = 1, sideT = 0;
  while (t < 120 && i < 60) {
    t += 1 / 30; step(1 / 30);
    const w = tr[i]; const dx = w.x - pl.position.x, dz = w.z - pl.position.z, d = Math.hypot(dx, dz);
    let off = 0;
    if (t - lastBest > 1.2) { sideT += 1 / 30; if (sideT < 1.3) off = side; else { sideT = 0; side = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 1.3); lastBest = t - 0.6; } }
    pl.cam.yaw = Math.atan2(dz, dx) + off;
    if (d < 1.2) { i += 6; best = 1e9; lastBest = t; }
    else if (d < best - 0.25) { best = d; lastBest = t; }
    if (Math.round(t * 30) % 60 === 0) log.push([+t.toFixed(0), i, +pl.position.x.toFixed(1), +pl.position.y.toFixed(1), +pl.position.z.toFixed(1)]);
  }
  return { i, t: +t.toFixed(1), pos: pl.position.toArray().map((v) => +v.toFixed(1)), log };
});
console.log(file, JSON.stringify({ i: r.i, t: r.t, pos: r.pos }));
for (const x of r.log.slice(0, 40)) console.log(x.join('\t'));
await browser.close();
