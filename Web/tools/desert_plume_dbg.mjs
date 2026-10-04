import { chromium } from 'playwright';
import { join } from 'node:path';
import { root, findChromium, GL } from './lib/harness.mjs';
const browser = await chromium.launch({ executablePath: findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(600000);
page.on('console', (m) => { if (m.type() === 'error') console.log('ERR', m.text().slice(0, 300)); });
await page.goto(`file://${join(root, 'dist', 'desert2.html')}?autotest=1&q=med&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.post && window.__rakis.audio, null, { timeout: 600000 });
const info = await page.evaluate(async () => {
  const g = window.__rakis, w = g.weather;
  g.paused = true;
  w.request('Dusk_Gold', 0); w.setHours(17.7, true); w.timeScale = 0; w.setOverride({ wind: 12, storm: 0, dust: 0.1, clouds: 0.3 }, 0); w.snap();
  const cam = g.camera; cam.position.set(100, g.world.heightAt(100, 40) + 2, 40);
  for (let i = 0; i < 12; i++) { g.weather.update(1.0); g.desertRoot.update(0.5, g.realTime + i); }
  const fx = g.world.fx;
  const pls = fx.plumes.filter((p) => p.k > 0.01 && p.age < p.life).map((p) => ({ x: Math.round(p.x), z: Math.round(p.z), len: Math.round(p.len), h: +p.h.toFixed(1), age: Math.round(p.age), life: Math.round(p.life) }));
  let best = null;
  for (const p of fx.plumes) { const d = Math.hypot(p.x - 100, p.z - 40); if (p.k > 0.01 && (!best || d < best.d)) best = { p, d }; }
  if (best) {
    const p = best.p, wd = w.windDir;
    const cx = p.x + wd.z * 40 + wd.x * p.len * 0.4, cz = p.z - wd.x * 40 + wd.z * p.len * 0.4;
    cam.position.set(cx, g.world.heightAt(cx, cz) + 3, cz);
    cam.lookAt(p.x + wd.x * p.len * 0.4, p.y + 2, p.z + wd.z * p.len * 0.4);
  }
  cam.updateMatrixWorld(true);
  for (let i = 0; i < 2; i++) { g.weather.update(1.0); g.desertRoot.update(0.016, g.realTime); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
  return { n: pls.length, pls: pls.slice(0, 6), vis: fx.plumeMesh?.visible, windSpeed: w.windSpeed };
});
console.log(JSON.stringify(info));
await page.screenshot({ path: join(root, 'dist', 'shots', 't4', 'plume_dbg.png') });
await browser.close();
