// Скриншоты для оценки реализма: node tools/realism_shots.mjs [--file=real.html] [--q=med] [--tag=real] [--only=sand,claw]
// Виды: start, sand (песок у ног), claw (Коготь на средней дистанции), rock (скала вблизи), harvester (крупно), dusk (закат).
// Параметр --perf=1: после кадров печатает средние мс на кадр (SwiftShader, только для сравнения до/после).
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const q = arg('q', 'med');
const only = arg('only', '').split(',').filter(Boolean);
const outDir = join(root, 'dist', 'shots', arg('tag', 'real'));
mkdirSync(outDir, { recursive: true });

function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}

// [имя, часы, пресет, камера(x,hAbove,z), цель(x,hAbove,z), fov]; камера==null → вид старта игрока
const SHOTS = [
  ['start', 9, 'Morning_Erg', null, null, 62],
  ['sand', 10, 'Noon_Approach', [-30, 1.6, -40], [-33, -0.4, -43.4], 62],
  ['sand_low', 16.5, 'Morning_Erg', [-30, 0.45, -40], [-26.5, 0.0, -42.5], 55],
  ['claw', 16, 'Morning_Erg', [380, 2, 160], [715, 60, 270], 60],
  ['rock', 11, 'Noon_Approach', 'ROCK', 'ROCKt', 62],
  ['rock_far', 17, 'Morning_Erg', 'ROCKF', 'ROCKFt', 60],
  ['harvester', 11, 'Noon_Approach', 'H1', 'H1t', 55],
  ['harvester2', 17.5, 'Morning_Erg', 'H2', 'H2t', 60],
  ['dusk', 18.8, 'Morning_Erg', [0, 1.8, 0], [680, 14, 270], 62],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(arg('w', 1280)), height: Number(arg('h', 720)) } });
page.setDefaultTimeout(600000);
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/AudioContext/.test(m.text())) errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'real.html'))}?autotest=1&q=${q}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.post && window.__rakis.harvester && window.__rakis.realTime > 1.5, null, { timeout: 600000 });
await page.evaluate(() => { const g = window.__rakis; g.paused = true; });
const Hpos = await page.evaluate(() => { const p = window.__rakis.harvester.position; return { x: p.x, y: p.y, z: p.z }; });
console.log('harvester at', JSON.stringify(Hpos));

for (const [name, hours, preset, cp, tp, fov] of SHOTS) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  await page.evaluate(({ name, hours, preset, cp, tp, fov, H }) => {
    const g = window.__rakis, w = g.weather;
    w.clearOverride?.(); w.request(preset, 0);
    if (w.setHours) w.setHours(hours, true);
    w.timeScale = 0;
    w.setOverride?.({ storm: 0, dust: 0.05, clouds: 0.25 }, 0);
    w.snap();
    const hy = (x, z) => g.world.heightAt(x, z);
    let c = cp, t = tp;
    if (cp === 'H1') { c = [H.x - 20, 2, H.z + 70]; t = [H.x - 6, 14, H.z]; }
    if (cp === 'H2') { c = [H.x + 30, 1.8, H.z + 36]; t = [H.x + 30, 7, H.z + 18]; }
    if (cp === 'ROCK' || cp === 'ROCKF') {
      const a = [400, 150], b = [715, 270], L = Math.hypot(b[0] - a[0], b[1] - a[1]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      let s0 = 0, base = hy(a[0], a[1]);
      for (let s = 0; s < L; s += 2) { if (hy(a[0] + d[0] * s, a[1] + d[1] * s) > base + 14) { s0 = s; break; } base = Math.min(base + 0.1, hy(a[0] + d[0] * s, a[1] + d[1] * s)); }
      const back = cp === 'ROCK' ? 16 : 90, sc = s0 - back;
      c = [a[0] + d[0] * sc, cp === 'ROCK' ? 1.7 : 6, a[1] + d[1] * sc];
      t = [a[0] + d[0] * (s0 + 6), cp === 'ROCK' ? 3 : 25, a[1] + d[1] * (s0 + 6)];
    }
    if (!c) { c = [0, 1.7, 0]; t = [680, 6, 270]; }
    const cam = g.camera;
    cam.position.set(c[0], hy(c[0], c[2]) + c[1], c[2]);
    cam.fov = fov; cam.updateProjectionMatrix();
    cam.lookAt(t[0], hy(t[0], t[2]) + t[1], t[2]);
    cam.updateMatrixWorld(true);
  }, { name, hours, preset, cp, tp, fov, H: Hpos });
  for (let i = 0; i < 3; i++) {
    await page.evaluate(async () => {
      const g = window.__rakis; g.weather.update(1.0); g.desertRoot?.update?.(0.016, g.realTime); g.post?.refreshEnv?.();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
  }
  if (arg('perf', '0') === '1') {
    const ms = await page.evaluate(async () => {
      const g = window.__rakis; const t0 = performance.now(); const N = 6;
      for (let i = 0; i < N; i++) await new Promise((r) => requestAnimationFrame(r));
      return (performance.now() - t0) / N;
    });
    console.log('frame ms', name, ms.toFixed(0));
  }
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('shot', name);
}
const uniq = [...new Set(errors)];
console.log(uniq.length ? 'ERRORS:\n' + uniq.slice(0, 20).join('\n') : 'no console errors');
await browser.close();
