// Снимки корпуса харвестера СНАРУЖИ с разных углов: проверка, что внутреннее не просвечивает (дыры/швы/открытая дверь).
// node tools/harvester_studio_build.mjs && node tools/harvester_seal_shots.mjs [--tag=seal] [--dist=9]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const outDir = join(root, 'dist', 'shots', arg('tag', 'seal'));
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(900000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext|GPU stall/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'harvester_studio.html'))}?q=med`, { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.__rakis && window.__rakis.harvester, null, { timeout: 300000 });
const D = Number(arg('dist', 9));
// [имя, камера (локально x,y,z), цель (локально)]
const VIEWS = [
  ['door_closed_far', [11, 14, 46], [11, 11, 20]],
  ['door_close', [11, 13, 31], [11, 11, 20]],
  ['starboard_low', [-10, 12, 20.2 + D], [-10, 13, 20]],
  ['starboard_mid', [20, 18, 20.2 + D], [20, 17, 20]],
  ['port_low', [-10, 12, -20.2 - D], [-10, 13, -20]],
  ['port_hall', [-20, 20, -20.2 - D], [-20, 20, -16]],
  ['rear', [-51 - D, 14, 0], [-51, 14, 0]],
  ['front_bridge', [38 + D, 24, 0], [38, 24, 0]],
  ['bridge_side', [30, 24, 18.4 + D], [30, 24, 18]],
  ['roof_hall', [-14, 30, 12], [-14, 24, 0]],
  ['under_hull', [-10, 6, 20.2 + D], [-10, 10, 0]],
];
await page.evaluate(() => { const g = window.__rakis; g.harvester.debugSet('off'); g.paused = false; });
for (const [name, c, t] of VIEWS) {
  const url = await page.evaluate(([c, t]) => {
    const g = window.__rakis, h = g.harvester, T = g.THREE;
    const W = (a) => h.toWorld(a[0], a[1], a[2], new T.Vector3());
    const p = W(c), q = W(t);
    // игрок далеко от двери (дверь закрыта), камера у корпуса
    g.player.position.set(p.x, p.y - 1.5, p.z);
    g.camera.position.copy(p); g.camera.fov = 62; g.camera.updateProjectionMatrix(); g.camera.lookAt(q);
    g.step(20, 0.1);
    return g.shot();
  }, [c, t]);
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name);
}
await browser.close();
if (errors.length) console.error('КОНСОЛЬ:\n' + [...new Set(errors)].slice(0, 10).join('\n'));
