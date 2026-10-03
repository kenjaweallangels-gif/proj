// Отладка переключателя режима: node tools/char_dbg3.mjs
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function findChromium() { const base = '/opt/pw-browsers'; if (!existsSync(base)) return undefined; const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n)); return d ? join(base, d, 'chrome-linux', 'chrome') : undefined; }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`file://${join(root, 'dist', 'char.html')}?autotest=1&q=low&lang=RU&skip=1`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.5, null, { timeout: 120000 });
await page.evaluate(() => { window.__kd = 0; addEventListener('keydown', (e) => { if (e.code === 'KeyC') window.__kd++; }); });
await page.keyboard.down('KeyW');
await page.waitForTimeout(2000);
await page.keyboard.press('KeyC');
page.on('crash', () => console.log('PAGE CRASH'));
browser.on('disconnected', () => console.log('BROWSER DISCONNECTED'));
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000);
  console.log(JSON.stringify(await page.evaluate(() => { const p = window.__rakis.player; return { kd: window.__kd, mode: p.moveMode, speed: +p.speed.toFixed(2), paused: window.__rakis.paused, cin: window.__rakis.cinematic.active, blk: !!window.__rakis.ui?.blocking, locked: p.inputLocked, env: +p.figure.gait.env.toFixed(2), mem: Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6), geo: window.__rakis.renderer.info.memory.geometries, tex: window.__rakis.renderer.info.memory.textures, prog: window.__rakis.renderer.info.programs?.length }; })));
}
await browser.close();
