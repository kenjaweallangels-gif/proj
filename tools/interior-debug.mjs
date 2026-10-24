#!/usr/bin/env node
/**
 * Developer probe: loads the scene (shot mode, tiny viewport) and runs a JS snippet against window.__app.
 *   node tools/interior-debug.mjs --quality=lite --file=probe.js
 * The file's contents are the body of an async function (app) => result; the result is printed as JSON.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: +(args.w || 320), height: +(args.h || 180) } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || args.log) console.log(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${server.resolvedUrls.local[0]}?shot=1&autostart=1&quality=${args.quality || 'lite'}&minh=0&pr=0.3${args.params ? '&' + args.params : ''}`, { waitUntil: 'load', timeout: 900000 });
await page.waitForFunction(() => window.__APP_READY__ === true, null, { timeout: 900000 });
const body = fs.readFileSync(args.file, 'utf8');
const r = await page.evaluate(`(async (app) => { ${body} })(window.__app)`);
console.log(JSON.stringify(r, null, 1));
await browser.close(); await server.close(); process.exit(0);
