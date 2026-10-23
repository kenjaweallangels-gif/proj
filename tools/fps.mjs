#!/usr/bin/env node
/**
 * Measure real-time frame rate in headless Chromium (normal render loop, no ?shot=1).
 *   node tools/fps.mjs --quality=low --w=640 --h=360 --views=eva,overview --seconds=8 [--params=...]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const w = +(args.w || 640), h = +(args.h || 360), secs = +(args.seconds || 8);
const views = (args.views || 'eva,overview').split(',');
let server = null, base = args.url;
if (!base) {
  server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
  await server.listen(); base = server.resolvedUrls.local[0];
}
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--disable-frame-rate-limit', '--disable-gpu-vsync', ...(process.env.FLAGS ? process.env.FLAGS.split(' ') : [])] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
const url = `${base.replace(/\/$/, '')}/?autostart=1&quality=${args.quality || 'low'}&t=${args.t || 600}&view=${views[0]}${args.params ? '&' + args.params : ''}`;
await page.goto(url, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction(() => window.__APP_READY__ === true, null, { timeout: 600000 });
for (const v of views) {
  await page.evaluate((n) => window.__app.setView(n), v);
  await page.waitForTimeout(+(args.warmup || 4000));
  const r = await page.evaluate(async (s) => {
    const a = window.__app; const f0 = a.frameCount, t0 = performance.now();
    await new Promise((res) => setTimeout(res, s * 1000));
    const gl = a.renderer.renderer;
    return { fps: (a.frameCount - f0) / ((performance.now() - t0) / 1000), calls: gl.info.render.calls, tris: gl.info.render.triangles, pr: gl.getPixelRatio() };
  }, secs);
  console.log(`${v}: ${r.fps.toFixed(1)} fps  (${w}x${h} @${r.pr}, ${r.calls} calls, ${r.tris} tris)`);
}
await browser.close(); if (server) await server.close();
process.exit(0);
