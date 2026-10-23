#!/usr/bin/env node
/**
 * Headless visual check. Starts a Vite dev server (or uses --url), opens the scene in headless
 * Chromium (SwiftShader WebGL2) and screenshots one or more views.
 *
 *   node tools/screenshot.mjs --views=overview,docking,eva --t=600 --out=/tmp/shots/base
 *   node tools/screenshot.mjs --view=overview --out=/tmp/x.png
 * Options: --w=1280 --h=720 --quality=high --frames=12 --timescale=1 --url=http://127.0.0.1:5173
 *          --t: 600 day, 1165 sunset through the limb, 2000 night/eclipse, 3200 sunrise, 4500 day
 *          --params="foo=1&bar=2" (extra URL params)  --timeout=240000  --keep (leave server running)
 * Output: one PNG per view: <out>_<view>.png (or exactly <out> when a single --view and out ends with .png).
 * Prints browser console errors/warnings. Exit code 1 on page errors.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const views = (args.views || args.view || 'overview').split(',').map((s) => s.trim()).filter(Boolean);
const t = args.t ?? '600';
const w = parseInt(args.w || '1280', 10), h = parseInt(args.h || '720', 10);
const frames = parseInt(args.frames || '12', 10);
const quality = args.quality || 'high';
const timeout = parseInt(args.timeout || '300000', 10);
const out = args.out || '/tmp/shot';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let server = null, baseUrl = args.url;
if (!baseUrl) {
  const { createServer } = await import('vite');
  server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
}
const url = `${baseUrl.replace(/\/$/, '')}/?shot=1&autostart=1&t=${encodeURIComponent(t)}&quality=${quality}&timescale=${args.timescale || '1'}&view=${encodeURIComponent(views[0])}${args.params ? '&' + args.params : ''}`;

const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (msg) => { const ty = msg.type(); if (ty === 'error' || ty === 'warning') { console.log(`[browser ${ty}] ${msg.text()}`); if (ty === 'error') errors.push(msg.text()); } });
page.on('pageerror', (err) => { console.log(`[pageerror] ${err.message}`); errors.push(err.message); });

console.log('open', url);
process.on('exit', () => { try { browser.close(); } catch (_) { /* ignore */ } });
await page.goto(url, { waitUntil: 'load', timeout });
await page.waitForFunction(() => window.__APP_READY__ === true, null, { timeout });
console.log('app ready');
for (const v of views) {
  await page.evaluate((name) => window.__app.setView(name), v);
  await page.evaluate((n) => window.__app.renderFrames(n), frames).catch((e) => console.log('[renderFrames]', e.message));
  const file = views.length === 1 && out.endsWith('.png') ? out : `${out}_${v}.png`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, timeout: Math.min(timeout, 600000) });
  const info = await page.evaluate(() => { const a = window.__app; const r = a.renderer.renderer.info; return { calls: r.render.calls, tris: r.render.triangles, geoms: r.memory.geometries, tex: r.memory.textures, sim: a.time.sim, mode: a.mode }; });
  console.log(`shot ${v} -> ${file}  draw calls ${info.calls}, triangles ${info.tris}, geometries ${info.geoms}, textures ${info.tex}, sim t=${info.sim.toFixed(0)}s, mode ${info.mode}`);
}
await browser.close();
if (server && !args.keep) await server.close();
if (errors.length) { console.log(`${errors.length} browser error(s)`); process.exit(1); }
process.exit(0);
