// Форма наносов в студии (запасной песок, без ландшафта): виды с 15 / 40 / 120 м и сверху. node tools/harvester_studio_build.mjs && node tools/harvester_berm_studio.mjs --tag=berm_studio
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const outDir = join(root, 'dist', 'shots', arg('tag', 'berm_studio'));
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(900000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext|GPU stall/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'harvester_studio.html'))}?q=low`, { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.__rakis && window.__rakis.harvester, null, { timeout: 300000 });
const VIEWS = [
  ['top', [-10, 190, 1], [-10, 0, 0], 'off'],
  ['d15', [10, 9, 38], [0, 8, 14], 'off'],
  ['d40', [40, 14, 62], [0, 8, 10], 'off'],
  ['d120', [30, 30, 160], [0, 8, 0], 'off'],
  ['run40', [40, 14, 62], [0, 8, 10], 'running'],
];
for (const [name, c, t, st] of VIEWS) {
  const url = await page.evaluate(([c, t, st]) => {
    const g = window.__rakis, h = g.harvester, T = g.THREE;
    h.debugSet(st, st === 'running' ? 12 : 0);
    const p = h.toWorld(c[0], c[1], c[2], new T.Vector3()), q = h.toWorld(t[0], t[1], t[2], new T.Vector3());
    g.player.position.set(p.x, p.y - 50, p.z);
    g.camera.position.copy(p); g.camera.fov = 60; g.camera.updateProjectionMatrix(); g.camera.lookAt(q);
    g.step(25, 0.1);
    return g.shot();
  }, [c, t, st]);
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name);
}
await browser.close();
if (errors.length) console.error('КОНСОЛЬ:\n' + [...new Set(errors)].slice(0, 10).join('\n'));
