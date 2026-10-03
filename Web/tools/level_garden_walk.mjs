// Браузерный прогон: бот идёт по тропе (первые звенья) и по саду, считает застревания. node tools/build.mjs --out=level.html && node tools/level_garden_walk.mjs
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function findChromium() { const b = '/opt/pw-browsers'; if (!existsSync(b)) return undefined; const d = readdirSync(b).find((n) => /^chromium-\d+$/.test(n)); return d ? join(b, d, 'chrome-linux', 'chrome') : undefined; }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`file://${join(root, 'dist', 'level.html')}?autotest=1&q=low&lang=RU&skip=1`);
await page.waitForFunction(() => window.__rakis?.garden && window.__rakis.player && window.__rakis.realTime > 1.5, null, { timeout: 900000 });
const res = await page.evaluate(() => new Promise((resolve) => {
  const g = window.__rakis, G = g.garden, p = g.player;
  g.timeScale = 3;
  const way = [[808, 395], [818, 399], [830, 392], [845, 399], [862, 399], [878, 396], [868, 380], [850, 368], [833, 380], [826, 410], [840, 420], [852, 415], [848, 405], [820, 405], [806, 395]];
  p.teleport(803, undefined, 395, 0);
  let wi = 0, stuckT = 0, lastD = 1e9, t = 0, outside = 0, enter = 0, leave = 0;
  g.bus.on('garden:enter', () => enter++); g.bus.on('garden:leave', () => leave++);
  const ax = g.input.axis;
  g.input.axis = () => {
    const tg = way[wi], dx = tg[0] - p.position.x, dz = tg[1] - p.position.z, d = Math.hypot(dx, dz);
    const cy = Math.atan2(g.camera.getWorldDirection(new g.THREE.Vector3()).z, g.camera.getWorldDirection(new g.THREE.Vector3()).x);
    const wx = dx / d, wz = dz / d;
    return { x: wx * -Math.sin(cy) + wz * Math.cos(cy), y: wx * Math.cos(cy) + wz * Math.sin(cy) };
  };
  let gt = g.time;
  const id = setInterval(() => {
    const dtg = g.time - gt; if (dtg < 0.1) return; gt = g.time;
    const tg = way[wi], d = Math.hypot(tg[0] - p.position.x, tg[1] - p.position.z);
    t += dtg;
    if (d < 3) { wi++; stuckT = 0; lastD = 1e9; if (wi >= way.length) { clearInterval(id); g.input.axis = ax; resolve({ done: true, t, outside, enter, leave, pos: [p.position.x, p.position.z] }); return; } }
    if (d > lastD - 0.05) stuckT += dtg; else { stuckT = 0; lastD = d; }
    if (!G.zoneAt(p.position)) outside++;
    if (stuckT > 25) { clearInterval(id); g.input.axis = ax; resolve({ done: false, wi, pos: [p.position.x, p.position.z], t }); }
  }, 100);
}));
console.log('garden walk:', JSON.stringify(res));
await browser.close();
process.exitCode = res.done ? 0 : 1;
