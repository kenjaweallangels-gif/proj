#!/usr/bin/env node
/**
 * Screenshots of the suit lab page (tools/suitlab/: the astronaut figures alone, fast to load).
 *   node tools/suitlab-shot.mjs --q="outfit=orlan&pose=eva&upm=1" --cams=front,back,helmet --out=/tmp/x
 * Options: --w=1000 --h=1000 --url=http://127.0.0.1:5173 (else a Vite server is started)
 * Output: <out>_<cam>.png per camera preset (see tools/suitlab/suitlab.js).
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const w = +(args.w || 1000), h = +(args.h || 1000);
const cams = (args.cams || 'front').split(',');
const out = args.out || '/tmp/suitlab';
let server = null, base = args.url;
if (!base) {
  const { createServer } = await import('vite');
  server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
  await server.listen(); base = server.resolvedUrls.local[0];
}
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
let errors = 0;
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[suitlab]')) console.log(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') errors++; });
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); errors++; });
const url = `${base.replace(/\/$/, '')}/tools/suitlab/index.html?${args.q || ''}`;
console.log('open', url);
await page.goto(url, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction(() => window.__LAB_READY__ === true, null, { timeout: 600000 });
fs.mkdirSync(path.dirname(out), { recursive: true });
for (const c of cams) {
  const data = await page.evaluate((n) => window.__lab.view(n), c);
  const file = `${out}_${c}.png`;
  fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  console.log('shot', file);
}
await browser.close();
if (server) await server.close();
process.exit(errors ? 1 : 0);
