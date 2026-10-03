// Профайл-проба: грузит dist/rakis_demo.html в headless Chromium (SwiftShader), обходит ключевые точки и печатает
// CPU мс/кадр по модулям (update+lateUpdate), render(cpu), draw calls, треугольники, число теневых кастеров.
// CPU-время осмысленно и в SwiftShader; «GPU-прокси» — draw calls, треугольники, shadowCasters, число проходов.
//   node tools/perf_probe.mjs [--q=low,med] [--w=640] [--h=360] [--frames=16] [--points=start,erg,...] [--out=dist/perf/report.json] [--drs=0]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const qs = arg('q', 'low,med').split(',');
const W = +arg('w', 640), H = +arg('h', 360), FRAMES = +arg('frames', 16);
const out = arg('out', `${root}/dist/perf/report.json`);
const drs = arg('drs', '0'); // по умолчанию без динамического разрешения — честные сравнения
const ALL = ['start', 'erg', 'worm', 'harvester', 'trail', 'cleft', 'market', 'hall', 'garden'];
const points = arg('points', ALL.join(',')).split(',');
const label = arg('label', '');
const file = arg('file', 'rakis_demo.html');

const report = { when: new Date().toISOString(), label, viewport: [W, H], frames: FRAMES, results: {} };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });

for (const q of qs) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext/.test(m.text())) errors.push(m.text()); });
  await page.goto(`file://${root}/dist/${file}?autotest=1&q=${q}&lang=RU&perf=1&drs=${drs}`);
  await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
  await page.evaluate(() => { const g = window.__rakis; g.perf.overlay = false; g.perf.enable(true); });
  report.results[q] = {};
  for (const name of points) {
    await page.evaluate(async (name) => {
      const g = window.__rakis;
      if (name === 'harvester') {
        const h = g.harvester;
        if (g.ui?.startGame && !g.ui.started) g.ui.startGame({ silent: true });
        if (h?.position) { g.player.teleport(h.position.x - 30, g.heightAt(h.position.x - 30, h.position.z), h.position.z, 0); if (h.state === 'off') h.start?.() || h.toggle?.(); }
      } else await g.debug.goto(name);
    }, name);
    // прогрев (компиляция шейдеров, загрузка), затем окно замеров
    // прогрев: ждём, пока число шейдерных программ перестанет расти (компиляция шейдеров — разовая, не «стационарная» стоимость)
    await page.evaluate(() => { const P = window.__rakis.perf; P.reset(); window.__stab = { last: -1, same: 0 }; });
    await page.waitForFunction(() => {
      const g = window.__rakis, P = g.perf, s = window.__stab, n = g.renderer.info.programs?.length ?? 0;
      if (P.acc.n < 4) return false;
      if (n === s.last) s.same++; else { s.same = 0; s.last = n; }
      return s.same >= 5 && P.acc.n >= 8;
    }, null, { timeout: 600000, polling: 700 }).catch(() => {});
    await page.evaluate(() => window.__rakis.perf.reset());
    await page.waitForFunction((n) => window.__rakis.perf.acc.n >= n, FRAMES, { timeout: 600000, polling: 500 });
    const snap = await page.evaluate(() => { const g = window.__rakis; return { ...g.perf.snapshot(), space: g.space, zone: g.zone, bodies: g.colliders.size }; });
    report.results[q][name] = snap;
    const top = Object.entries(snap.modulesMs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`[${q}] ${name.padEnd(9)} cpu ${String(snap.cpuMs).padStart(6)}ms render ${String(snap.renderCpuMs).padStart(6)}ms | draw ${String(snap.calls).padStart(4)} tri ${String(Math.round(snap.triangles / 1000)).padStart(5)}k prog ${snap.programs} | casters ${snap.scene.shadowCasters}/${snap.scene.visible} | heap ${snap.heapMB}MB | ${top}`);
  }
  report.results[q].__errors = [...new Set(errors)].slice(0, 8);
  if (errors.length) console.log(`[${q}] errors:`, report.results[q].__errors);
  await page.close();
}
await browser.close();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 1));
console.log('report →', out);
