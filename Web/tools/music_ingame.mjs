// Проверка музыки в настоящей сборке (реальный AudioContext в headless Chromium): состояния, подмена сад/ночь, Devour, ошибки консоли.
//   node tools/music_ingame.mjs [--file=rakis_demo.html] [--sec=8]
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const base = '/opt/pw-browsers';
const d = existsSync(base) ? readdirSync(base).find((n) => /^chromium-\d+$/.test(n)) : null;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || (d ? join(base, d, 'chrome-linux', 'chrome') : undefined), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'rakis_demo.html'))}?autotest=1&q=low&lang=RU`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => window.__rakis?.audio, null, { timeout: 240000 });
await page.evaluate(() => window.__rakis.audio.resume());
const sec = Number(arg('sec', 8));
const rows = [];
for (const [name, setup] of [
  ['DesertCalm', "a.setMusic('DesertCalm')"], ['DesertDrone', "a.setMusic('DesertDrone')"],
  ['garden(base DesertCalm)', "g.zone='C1_Garden'; a.setMusic('DesertCalm')"], ['Devour', "a.setMusic('Devour')"],
  ['SietchLife', "g.zone='B2_Gallery'; a.setMusic('SietchLife')"], ['HallChorale', "a.setMusic('HallChorale')"],
]) {
  rows.push(await page.evaluate(async ([name, setup, sec]) => {
    const g = window.__rakis, a = g.audio;
    new Function('g', 'a', setup)(g, a); // eslint-disable-line no-new-func
    await new Promise((r) => setTimeout(r, 1500));
    const rms = [], peaks = [], t0 = performance.now();
    while (performance.now() - t0 < sec * 1000) { await new Promise((r) => setTimeout(r, 60)); const l = a.level(); rms.push(l.rms); peaks.push(l.peak); }
    return { name, state: a.musicState, base: a.baseMusicState, rmsMax: Math.max(...rms).toFixed(1), peak: Math.max(...peaks).toFixed(1) };
  }, [name, setup, sec]));
}
console.table(rows);
console.log('console errors:', errors.length ? errors.slice(0, 8) : 'нет');
await browser.close();
