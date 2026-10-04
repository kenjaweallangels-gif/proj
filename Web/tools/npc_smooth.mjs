// Плавность NPC сиетча: записываем позицию/курс фигур (полный LOD) за 6 с при рваном dt и считаем «дрожание» — долю тиков без сдвига
// у идущих NPC, скачки скорости и разворотов. Без рендера (ручное шагание модулей), работает на старой и новой сборке.
//   node tools/npc_smooth.mjs --file=cur2.html [--at=market|hall]
import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const file = arg('file', 'cur2.html'), at = arg('at', 'market');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('ERR', e));
await page.goto(`file://${root}/dist/${file}?autotest=1&q=low&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
const r = await page.evaluate(async (at) => {
  const g = window.__rakis;
  await g.debug.goto(at);
  g.paused = true;
  const step = (dt) => {
    g.realTime += dt; g.dt = dt; g.time += dt; g.colliders.tick?.();
    for (const { mod } of g.modules) { try { mod.update?.(dt, g.time); } catch (e) { /* */ } }
    for (const { mod } of g.modules) { try { mod.lateUpdate?.(dt, g.time); } catch (e) { /* */ } }
    g.input.endFrame?.();
  };
  for (let i = 0; i < 120; i++) step(1 / 60);
  const npcs = g.sietch.crowd.npcs.filter((n) => n.lod === 'full' && !n.special);
  const tracks = new Map(npcs.map((n) => [n, { x: [], z: [], yaw: [], mode: [], y: [] }]));
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const dts = [];
  for (let i = 0; i < 360; i++) {
    const dt = 0.008 + rnd() * 0.012; dts.push(dt);
    step(dt);
    for (const n of npcs) { const t = tracks.get(n), p = n.fig.group.position; t.x.push(p.x); t.z.push(p.z); t.y.push(p.y); t.yaw.push(n.fig.group.rotation.y); t.mode.push(n.mode); }
  }
  const out = [];
  for (const [n, t] of tracks) {
    const sp = [], dyaw = [], dy = [];
    let walkTicks = 0, stopTicks = 0;
    for (let i = 1; i < t.x.length; i++) {
      const s = Math.hypot(t.x[i] - t.x[i - 1], t.z[i] - t.z[i - 1]) / dts[i];
      if (t.mode[i] === 'walk') { walkTicks++; if (s < 0.05) stopTicks++; sp.push(s); }
      let a = t.yaw[i] - t.yaw[i - 1]; a = Math.atan2(Math.sin(a), Math.cos(a)); dyaw.push(Math.abs(a) / dts[i]);
      dy.push(Math.abs(t.y[i] - t.y[i - 1]) / dts[i]);
    }
    if (walkTicks < 60) continue;
    const m = sp.reduce((a, b) => a + b, 0) / sp.length;
    const cv = Math.sqrt(sp.reduce((a, b) => a + (b - m) ** 2, 0) / sp.length) / (m || 1);
    out.push({ id: n.id ?? n.arch, arch: n.arch, walkTicks, stopPct: +(100 * stopTicks / walkTicks).toFixed(1), speedMean: +m.toFixed(2), speedCV: +cv.toFixed(2), maxYawRate: +Math.max(...dyaw).toFixed(1), maxVy: +Math.max(...dy).toFixed(2) });
  }
  return { n: npcs.length, walkers: out };
}, at);
console.log(file, at, 'full-LOD npcs:', r.n, '| walkers:', r.walkers.length);
for (const w of r.walkers) console.log(JSON.stringify(w));
await browser.close();
