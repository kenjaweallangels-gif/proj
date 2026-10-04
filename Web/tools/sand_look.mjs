// Скриншоты ряби песка (до/после): node tools/sand_look.mjs --file=sand_before.html --tag=sand_before. Основа — desert_look.mjs.
// Скриншоты пустыни для арт-ревью: node tools/desert_look.mjs [--q=med] [--file=desert.html] [--only=a,b] [--tag=look] [--w=1280 --h=720]
// Виды задаются массивом SHOTS: [имя, часы, пресет, override|null, камера{x,z,h,yaw,pitch}].
// Камера yaw: радианы от +X к +Z (как у игрока); toClaw — к скале.
// --perf=1: после снимков замеряет CPU мс/кадр update() модуля пустыни и время кадра (swiftshader — только относительные числа).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const q = arg('q', 'med');
const only = arg('only', '').split(',').filter(Boolean);
const outDir = join(root, 'dist', 'shots', arg('tag', 'look'));
mkdirSync(outDir, { recursive: true });
const toClaw = Math.atan2(270, 680);
const clear = { storm: 0, dust: 0.05, clouds: 0.25, wind: 6 };
// Ряби: ближние планы (1.5–5 м, от 1-го/3-го лица) и средняя дистанция (20–80 м) на рассвете, в полдень, на закате.
const TOD = [['dawn', 6.4, 'Dawn_Ridge'], ['noon', 12, 'Noon_Approach'], ['dusk', 17.7, 'Dusk_Gold']];
const SHOTS = [];
for (const [t, h, pr] of TOD) {
  SHOTS.push([`${t}_fp15`, h, pr, clear, { x: 160, z: 52, h: 1.7, yaw: 0.9, pitch: -0.55 }]);
  SHOTS.push([`${t}_fp4`, h, pr, clear, { x: 160, z: 52, h: 1.7, yaw: 0.9, pitch: -0.2 }]);
  SHOTS.push([`${t}_tp`, h, pr, clear, { x: 160, z: 52, h: 3.0, yaw: 0.9, pitch: -0.32 }]);
  SHOTS.push([`${t}_mid30`, h, pr, clear, { x: 160, z: 52, h: 1.8, yaw: 2.2, pitch: -0.05 }]);
  SHOTS.push([`${t}_mid80`, h, pr, clear, { x: 160, z: 52, h: 4.5, yaw: -0.4, pitch: -0.06 }]);
}

const todo = SHOTS.filter(([n]) => !only.length || only.some((o) => n.includes(o)));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: Number(arg('w', 1280)), height: Number(arg('h', 720)) } });
page.setDefaultTimeout(600000);
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('AudioContext')) errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'desert.html'))}?autotest=1&q=${q}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.post && window.__rakis.audio, null, { timeout: 600000 });
await page.evaluate(() => { window.__rakis.paused = true; });
for (const [name, hours, preset, ov, cm] of todo) {
  await page.evaluate(({ hours, preset, ov, cm }) => {
    const g = window.__rakis, w = g.weather;
    w.clearOverride?.(); w.request(preset, 0); w.setHours(hours, true); w.timeScale = 0;
    if (ov) w.setOverride(ov, 0);
    w.snap();
    const cam = g.camera;
    if (cm.find) {
      // крутой подветренный склон скольжения в радиусе 300 м от (100, 40): ставим камеру у подошвы, взгляд вверх по склону
      let best = null; const n = [0, 1, 0];
      for (let x = -200; x <= 400; x += 5) for (let z = -260; z <= 340; z += 5) {
        const nn = g.world.normalAt(x, z); const sl = 1 - nn.y;
        const hl = Math.hypot(nn.x, nn.z) + 1e-4; const lee = (nn.x * w.windDir.x + nn.z * w.windDir.z) / hl;
        if (lee > 0.8 && (!best || sl > best.sl)) best = { x, z, sl, dx: nn.x / hl, dz: nn.z / hl };
      }
      cm.x = best.x + best.dx * 26; cm.z = best.z + best.dz * 26; cm.yaw = Math.atan2(-best.dz, -best.dx); cm.pitch = 0.1; cm.h = 2.2;
      window.__slip = best;
    }
    cam.position.set(cm.x, g.world.heightAt(cm.x, cm.z) + cm.h, cm.z);
    cam.fov = 62; cam.updateProjectionMatrix();
    const c = Math.cos(cm.pitch);
    cam.lookAt(cam.position.x + Math.cos(cm.yaw) * c, cam.position.y + Math.sin(cm.pitch), cam.position.z + Math.sin(cm.yaw) * c);
    cam.updateMatrixWorld(true);
  }, { hours, preset, ov, cm });
  for (let i = 0; i < 2; i++) {
    await page.evaluate(async () => {
      const g = window.__rakis; g.weather.update(1.0); g.desertRoot.update(0.016, g.realTime);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
  }
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('shot', name);
}
if (arg('perf', '0') === '1') {
  // CPU: update() модуля пустыни при ходьбе 6 м/с (шаг 0.1 м/кадр) по эргу и у скалы; среднее / p99 / максимум, мс
  const r = await page.evaluate(async () => {
    const g = window.__rakis;
    const cam = g.camera;
    const out = {};
    const run = (name, x0, z0, dx, dz, n) => {
      g.weather.setOverride({ wind: 9 }, 0); g.weather.snap();
      const ts = [];
      cam.position.set(x0, g.world.heightAt(x0, z0) + 1.7, z0);
      g.desertRoot.update(0.016, g.realTime);
      for (let i = 0; i < n; i++) {
        cam.position.set(x0 + dx * i, g.world.heightAt(x0 + dx * i, z0 + dz * i) + 1.7, z0 + dz * i);
        const t0 = performance.now();
        g.desertRoot.update(0.016, g.realTime + i * 0.016);
        ts.push(performance.now() - t0);
      }
      ts.sort((a, b) => a - b);
      out[name] = { mean: +(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(2), p99: +ts[Math.floor(ts.length * 0.99)].toFixed(2), max: +ts[ts.length - 1].toFixed(2) };
    };
    run('walk_erg', 40, 20, 0.1, 0.04, 600);
    run('walk_claw', 560, 260, 0.1, 0.02, 600);
    const t0 = performance.now(); g.world.terrain.invalidate(); g.desertRoot.update(0.016, g.realTime);
    out.teleport_full_refill_ms = +(performance.now() - t0).toFixed(0);
    let t1 = performance.now(); let n = 0;
    while (performance.now() - t1 < 6000) { await new Promise((r) => requestAnimationFrame(r)); n++; }
    out.frameMs_swiftshader = +(6000 / n).toFixed(0);
    out.stats = g.world.stats;
    return out;
  });
  console.log('perf', JSON.stringify(r));
}
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].slice(0, 20).join('\n') : 'no console errors');
await browser.close();
