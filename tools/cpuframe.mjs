#!/usr/bin/env node
/**
 * Main-thread (CPU) cost per frame, independent of the GPU: CDP-profiles the page for N seconds and divides
 * the non-idle JavaScript time by the number of frames. On a machine without a GPU frames are slow, but the
 * JS work per frame (scene update + three.js render submission) is what a real GPU machine also pays.
 *   node tools/cpuframe.mjs --quality=ultra --w=1920 --h=1080 --view=eva --seconds=20
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-compositing'] });
const page = await browser.newPage({ viewport: { width: +(args.w || 1920), height: +(args.h || 1080) } });
await page.goto(`${server.resolvedUrls.local[0]}?autostart=1&nolock=1&governor=0&quality=${args.quality || 'ultra'}&t=${args.t || 600}&view=${args.view || 'eva'}${args.params ? '&' + args.params : ''}`, { waitUntil: 'load', timeout: 900000 });
await page.waitForFunction(() => window.__APP_READY__ === true, null, { timeout: 900000 });
await page.waitForTimeout(5000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
const f0 = await page.evaluate(() => window.__app.frameCount);
await cdp.send('Profiler.start');
await page.waitForTimeout(+(args.seconds || 20) * 1000);
const { profile } = await cdp.send('Profiler.stop');
const f1 = await page.evaluate(() => window.__app.frameCount);
const info = await page.evaluate(() => { const gl = window.__app.renderer.renderer; return { calls: gl.info.render.calls, tris: gl.info.render.triangles, buf: `${gl.getContext().drawingBufferWidth}x${gl.getContext().drawingBufferHeight}` }; });
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
let busy = 0; const self = new Map();
profile.samples.forEach((id, i) => { const n = byId.get(id), f = n.callFrame, dt = profile.timeDeltas[i] || 0; if (f.functionName === '(idle)') return; busy += dt; const k = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop().split('?')[0]}`; self.set(k, (self.get(k) || 0) + dt); });
const frames = f1 - f0;
const waiting = self.get('(program) ') || 0;
console.log(`${args.quality || 'ultra'} ${info.buf} view ${args.view || 'eva'}: ${frames} frames, JavaScript + GC ${((busy - waiting) / 1000 / frames).toFixed(2)} ms/frame, waiting on the (software) GPU ${(waiting / 1000 / frames).toFixed(0)} ms/frame (${info.calls} draw calls, ${info.tris} triangles per frame)`);
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, +(args.top || 12))) console.log(`  ${(v / 1000 / frames).toFixed(2).padStart(6)} ms  ${k}`);
// --callers=fnName: the call stacks that lead to fnName, by time
if (args.callers) {
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const stacks = new Map();
  profile.samples.forEach((id, i) => {
    if (byId.get(id).callFrame.functionName !== args.callers) return;
    const chain = []; for (let p = parent.get(id); p && chain.length < 7; p = parent.get(p)) chain.push(byId.get(p).callFrame.functionName || '(anon)');
    const k = chain.join(' < '); stacks.set(k, (stacks.get(k) || 0) + (profile.timeDeltas[i] || 0));
  });
  for (const [k, v] of [...stacks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${(v / 1000 / frames).toFixed(2).padStart(6)} ms  ${args.callers} < ${k}`);
}
await browser.close(); await server.close(); process.exit(0);
