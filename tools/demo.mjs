#!/usr/bin/env node
/**
 * Scripted real-time play session in headless Chromium (no ?shot=1: normal render loop, auto quality),
 * recorded to a video, with the frame rate logged once a second.
 *
 *   node tools/demo.mjs --out=<dir> [--w=960 --h=540] [--video=640x360] [--record=0] [--flags="--disable-gpu-compositing"]
 * Writes <dir>/demo.webm (when recording) and <dir>/fps.json, prints a per-phase fps summary.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const out = path.resolve(args.out || 'demo-out');
const w = +(args.w || 960), h = +(args.h || 540);
const record = args.record !== '0';
fs.mkdirSync(out, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const flags = (args.flags ?? '--disable-gpu-compositing').split(' ').filter(Boolean);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', ...flags] });
const [vw, vh] = (args.video || `${w}x${h}`).split('x').map(Number);
const context = await browser.newContext({ viewport: { width: w, height: h }, ...(record ? { recordVideo: { dir: out, size: { width: vw, height: vh } } } : {}) });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const url = `${server.resolvedUrls.local[0]}?nolock=1&t=${args.t || 600}`;
await page.goto(url, { waitUntil: 'load', timeout: 600000 });
await page.waitForFunction(() => window.__APP_READY__ === true, null, { timeout: 600000 });

// fps logger (in page): frames per wall-clock second
await page.evaluate(() => {
  const a = window.__app; window.__fpsLog = []; let f0 = a.frameCount, t0 = performance.now();
  setInterval(() => { const t = performance.now(); window.__fpsLog.push({ t: +(t / 1000).toFixed(1), fps: +((a.frameCount - f0) / ((t - t0) / 1000)).toFixed(1), pr: +a.renderer.renderer.getPixelRatio().toFixed(2), phase: window.__phase || '' }); f0 = a.frameCount; t0 = t; }, 1000);
});
const phase = (name) => page.evaluate((n) => { window.__phase = n; }, name);
const sleep = (ms) => page.waitForTimeout(ms);
// smooth mouse look: feeds the same per-frame deltas a real mouse would produce into the input layer
// (large turns exceed the window width, so real pointer moves cannot express them)
const look = async (dx, dy, steps = 30, ms = 2000) => {
  await page.evaluate(([dx, dy, steps, ms]) => new Promise((res) => { let i = 0; const id = setInterval(() => { const m = window.__app.input.mouse; m.dx += dx / steps; m.dy += dy / steps; if (++i >= steps) { clearInterval(id); res(); } }, ms / steps); }), [dx, dy, steps, ms]);
};
const quality = await page.evaluate(() => window.__app.quality.preset);

await phase('menu'); await sleep(4000);
await page.getByRole('button', { name: 'НАЧАТЬ' }).click();
await phase('airlock'); await sleep(1500);
await look(-220, 40); await look(220, -40); await sleep(1000);   // glance around, then face the hatch again
await phase('exit'); await page.keyboard.press('KeyE');
await page.waitForFunction(() => window.__app.player.state.mode === 'eva', null, { timeout: 120000 });
await sleep(800);
await phase('eva');
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW'); await sleep(3000);   // boosted push away from the hatch
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
await sleep(2000);
await look(0, 300, 30, 2500); await sleep(1500);                 // look down: the Earth below
await look(1430, -300, 60, 5000);                                 // turn around: the station, the open hatch, the tether
await page.keyboard.press('KeyV'); await sleep(3000);             // kill the drift (~20 m out)
await look(-300, -60, 40, 3000); await sleep(1500);
await phase('observer'); await page.keyboard.press('KeyF'); await sleep(1500);
for (const name of ['Кольцо', 'Стыковка', 'Обзор']) { await page.getByRole('button', { name, exact: true }).click(); await sleep(4000); }
await phase('timeX60'); await page.keyboard.press('KeyT'); await page.keyboard.press('KeyT'); await sleep(12000);
await page.keyboard.press('KeyT'); await page.keyboard.press('KeyT');
await phase('suit'); await page.keyboard.press('KeyF'); await sleep(4000);

const log = await page.evaluate(() => window.__fpsLog);
const sim = await page.evaluate(() => window.__app.time.sim);
await context.close();   // finalises the video
await browser.close(); await server.close();
fs.writeFileSync(path.join(out, 'fps.json'), JSON.stringify({ quality, size: [w, h], flags, record, log, errors }, null, 1));
if (record) { const vid = fs.readdirSync(out).filter((f) => f.endsWith('.webm')).map((f) => path.join(out, f)).sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0]; if (vid) fs.renameSync(vid, path.join(out, 'demo.webm')); }
const phases = {};
for (const r of log) { if (!r.phase) continue; (phases[r.phase] ||= []).push(r.fps); }
console.log(`quality ${quality}, ${w}x${h}, record=${record}, sim t=${sim.toFixed(0)} s, errors ${errors.length}`);
for (const [k, v] of Object.entries(phases)) { const s = [...v].sort((x, y) => x - y); console.log(`${k.padEnd(9)} avg ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)} fps, min ${s[0]}, median ${s[Math.floor(s.length / 2)]} (${v.length} s)`); }
const all = log.filter((r) => r.phase && r.phase !== 'menu').map((r) => r.fps);
console.log(`gameplay overall: avg ${(all.reduce((a, b) => a + b, 0) / all.length).toFixed(1)} fps, seconds below 25: ${all.filter((x) => x < 25).length}/${all.length}`);
if (errors.length) console.log('errors:', errors.slice(0, 5));
process.exit(0);
