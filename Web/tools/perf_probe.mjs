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
const warm = arg('warm', '1'); // 1 — с прогревом шейдеров (как у игрока): тогда число программ почти не растёт по ходу обхода
const PROF = arg('prof', '0') === '1'; // CDP-профиль CPU: топ функций по self-time в каждой точке

const report = { when: new Date().toISOString(), label, viewport: [W, H], frames: FRAMES, results: {} };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });

for (const q of qs) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext/.test(m.text())) errors.push(m.text()); });
  await page.goto(`file://${root}/dist/${file}?autotest=1&q=${q}&lang=RU&perf=1&drs=${drs}&warm=${warm}`);
  await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
  await page.evaluate(() => { const g = window.__rakis; g.perf.overlay = false; g.perf.enable(true); });
  report.results[q] = {};
  const cdp = PROF ? await page.context().newCDPSession(page) : null;
  if (cdp) await cdp.send('Profiler.enable');
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
    if (cdp) await cdp.send('Profiler.start');
    await page.waitForFunction((n) => window.__rakis.perf.acc.n >= n, FRAMES, { timeout: 600000, polling: 500 });
    let topFns = null;
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      const self = new Map(), idx = new Map(profile.nodes.map((n) => [n.id, n]));
      profile.samples.forEach((id, i) => { const n = idx.get(id), cf = n.callFrame; const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber}`; self.set(k, (self.get(k) || 0) + (profile.timeDeltas[i] || 0)); });
      const idle = (self.get('(idle) :-1') || 0) + (self.get('(program) :-1') || 0); self.delete('(idle) :-1'); self.delete('(program) :-1');
      const tot = [...self.values()].reduce((a, b) => a + b, 0) || 1; // только «работающий» JS: без ожидания GPU (idle)
      topFns = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ fn: k, ms: +(v / 1000).toFixed(1), pct: +(100 * v / tot).toFixed(1) }));
    }
    const snap = await page.evaluate(() => { const g = window.__rakis; return { ...g.perf.snapshot(), space: g.space, zone: g.zone, bodies: g.colliders.size }; });
    if (topFns) snap.topFns = topFns;
    report.results[q][name] = snap;
    const top = Object.entries(snap.modulesMedMs || snap.modulesMs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(' ');
    if (snap.scene?.byRoot?.length) console.log('   meshes by root: ' + snap.scene.byRoot.join(' '));
    if (snap.scene?.heavy?.length) console.log('   heavy meshes: ' + snap.scene.heavy.slice(0, 4).map((h) => `${h.name} ${Math.round(h.tris / 1000)}k${h.inst > 1 ? ' x' + h.inst : ''}${h.shadow ? ' sh' : ''}${h.culled ? '' : ' nocull'}`).join(' | '));
    if (topFns) console.log('   top fns: ' + topFns.slice(0, 6).map((t) => `${t.fn}=${t.pct}%`).join(' | '));
    console.log(`[${q}] ${name.padEnd(9)} cpu ${String(snap.cpuMedMs ?? snap.cpuMs).padStart(6)}ms(med) p10 ${String(snap.cpuP10Ms ?? '-').padStart(5)} render ${String(snap.renderMedMs ?? snap.renderCpuMs).padStart(6)}ms | draw ${String(snap.calls).padStart(4)} tri ${String(Math.round(snap.triangles / 1000)).padStart(5)}k prog ${snap.programs} | casters ${snap.scene.shadowCasters}/${snap.scene.visible} | heap ${snap.heapMB}MB | ${top}`);
  }
  report.results[q].__errors = [...new Set(errors)].slice(0, 8);
  if (errors.length) console.log(`[${q}] errors:`, report.results[q].__errors);
  await page.close();
}
await browser.close();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 1));
console.log('report →', out);
