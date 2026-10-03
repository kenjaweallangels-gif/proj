// Отладочный прогон: время кадра на разных стадиях сцены (SwiftShader). Не для CI.
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('console', (m) => console.log('[c]', m.type(), m.text().slice(0, 400)));
page.on('pageerror', (e) => console.log('[pe]', String(e)));
await page.goto(`file://${join(root, 'dist', 'worm.html')}?autotest=1&q=med&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.5, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__rakis; g.zone = 'A2_Erg'; g.player.position.set(279, g.heightAt(279, 95), 95); g.paused = true;
  g.worm.playReveal();
  const step = (sec, dt) => { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) { g.dt = dt; g.time += dt; for (const { mod } of g.modules) { mod.update?.(dt, g.time); } for (const { mod } of g.modules) { mod.lateUpdate?.(dt, g.time); } } };
  const out = [];
  for (const s of [1, 5, 10]) { step(s, 1 / 30); const a = performance.now(); g.render(0.016); g.renderer.getContext().finish(); out.push([s, (performance.now() - a).toFixed(0), g.worm.state, g.worm.exposed, g.renderer.info.render.calls]); }
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
