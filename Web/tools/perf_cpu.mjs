// CPU-проба БЕЗ рендера: чистое время JS-логики по модулям на тик (update+lateUpdate) в ключевых точках — не зависит от GPU/SwiftShader,
// одинаково работает на старой и новой сборке (модули оборачиваются в странице, шаг симуляции — вручную: dt=1/60).
// Шумоподавление: берём медиану по тикам и минимум из R повторов (на общей машине другие процессы раздувают время).
//   node tools/perf_cpu.mjs --file=perf_baseline.html|cur.html [--q=low] [--points=...] [--ticks=240] [--reps=3] [--out=dist/perf/cpu_<label>.json]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const file = arg('file', 'cur.html'), q = arg('q', 'low');
const TICKS = +arg('ticks', 240), REPS = +arg('reps', 3);
const points = arg('points', 'start,erg,worm,harvester,trail,cleft,market,hall,garden').split(',');
const PROF = arg('prof', '0') === '1'; // CDP-профиль: топ функций по self-time за окно замеров
const out = arg('out', `${root}/dist/perf/cpu_${file.replace(/\.html$/, '')}.json`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${root}/dist/${file}?autotest=1&q=${q}&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });

// обёртки модулей: накапливаем время в window.__acc[name]
await page.evaluate(() => {
  const g = window.__rakis;
  window.__acc = {};
  for (const { name, mod } of g.modules) {
    for (const fn of ['update', 'lateUpdate']) {
      const f = mod[fn]; if (!f) continue;
      mod[fn] = function (...a) { const t0 = performance.now(); try { return f.apply(this, a); } finally { window.__acc[name] = (window.__acc[name] || 0) + performance.now() - t0; } };
    }
  }
  const colTick = g.colliders.tick ? g.colliders.tick.bind(g.colliders) : null;
  window.__step = (dt) => {
    g.realTime += dt;
    if (colTick) { const t0 = performance.now(); colTick(); window.__acc.collidersTick = (window.__acc.collidersTick || 0) + performance.now() - t0; }
    g.dt = dt; g.time += dt;
    for (const { mod } of g.modules) { if (mod.update) { try { mod.update(mod.alwaysUpdate ? dt : dt, g.time); } catch (e) { /* */ } } }
    for (const { mod } of g.modules) { if (mod.lateUpdate) { try { mod.lateUpdate(dt, g.time); } catch (e) { /* */ } } }
    g.input.endFrame?.();
  };
  g.paused = true; // рендер-цикл не двигает время сам
});

const cdp = PROF ? await page.context().newCDPSession(page) : null;
if (cdp) await cdp.send('Profiler.enable');
const result = { when: new Date().toISOString(), file, q, ticks: TICKS, reps: REPS, points: {} };
for (const name of points) {
  await page.evaluate(async (name) => {
    const g = window.__rakis;
    g.paused = false;
    if (name === 'harvester') {
      const h = g.harvester;
      if (g.ui?.startGame && !g.ui.started) g.ui.startGame({ silent: true });
      if (h?.position) { g.player.teleport(h.position.x - 30, g.heightAt(h.position.x - 30, h.position.z), h.position.z, 0); if (h.state === 'off') h.start?.() || h.toggle?.(); }
    } else await g.debug.goto(name);
    g.paused = true;
    window.__fwd = false;
  }, name);
  let best = null, topFns = null;
  for (let rep = 0; rep < REPS; rep++) {
    if (cdp && rep === REPS - 1) await cdp.send('Profiler.start');
    const r = await page.evaluate((TICKS) => {
      const g = window.__rakis, st = window.__step;
      for (let i = 0; i < 90; i++) st(1 / 60); // прогрев JIT/кэшей
      const per = {}, tot = [];
      for (let i = 0; i < TICKS; i++) {
        window.__acc = {};
        st(1 / 60);
        let sum = 0;
        for (const [k, v] of Object.entries(window.__acc)) { (per[k] || (per[k] = [])).push(v); sum += v; }
        tot.push(sum);
      }
      const pct = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
      const mods = {};
      for (const [k, a] of Object.entries(per)) mods[k] = { med: +pct(a, 0.5).toFixed(3), p95: +pct(a, 0.95).toFixed(3) };
      return { totalMed: +pct(tot, 0.5).toFixed(3), totalP95: +pct(tot, 0.95).toFixed(3), totalMax: +Math.max(...tot).toFixed(2), mods, space: g.space, zone: g.zone, bodies: g.colliders.size };
    }, TICKS);
    if (cdp && rep === REPS - 1) {
      const { profile } = await cdp.send('Profiler.stop');
      const self = new Map(), idx = new Map(profile.nodes.map((n) => [n.id, n]));
      profile.samples.forEach((id, i) => { const cf = idx.get(id).callFrame; const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber}`; self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0)); });
      self.delete('(idle) :-1');
      const tot = [...self.values()].reduce((a, b) => a + b, 0) || 1;
      topFns = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${(100 * v / tot).toFixed(1)}%`);
    }
    if (!best || r.totalMed < best.totalMed) best = r;
  }
  if (topFns) best.topFns = topFns;
  result.points[name] = best;
  const top = Object.entries(best.mods).sort((a, b) => b[1].med - a[1].med).slice(0, 6).map(([k, v]) => `${k}=${v.med}`).join(' ');
  if (topFns) console.log('   top fns: ' + topFns.slice(0, 8).join(' | '));
  console.log(`[${q}] ${name.padEnd(9)} JS/tick med ${String(best.totalMed).padStart(6)} ms  p95 ${String(best.totalP95).padStart(6)}  max ${String(best.totalMax).padStart(6)} | ${best.space}/${best.zone} bodies ${best.bodies} | ${top}`);
}
result.errors = [...new Set(errors)].slice(0, 6);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 1));
console.log('report →', out);
await browser.close();
