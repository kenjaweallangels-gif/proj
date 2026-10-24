#!/usr/bin/env node
/**
 * Interior build statistics: zones, triangles per zone, build time, atlas usage.
 *   node tools/interior-stats.mjs [--quality=high]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${server.resolvedUrls.local[0]}?shot=1&autostart=1&quality=${args.quality || 'high'}&minh=0`, { waitUntil: 'load', timeout: 900000 });
await page.waitForFunction(() => window.__APP_READY__ === true, null, { timeout: 900000 });
const r = await page.evaluate(() => {
  const I = window.__app.station.interior, A = I.atlas;
  return { build: I.buildTimeMs, tris: I.triangles, atlas: `${A.S}x${A.SH} used to y=${A.shelfY + A.shelfH}`, carved: I._carvedMaterials,
    zones: I.zones.map((z) => `${z.id}:${Math.round(z.tris / 1000)}k`).join(' '), stationBuild: window.__app.station.buildTimeMs };
});
console.log(JSON.stringify(r, null, 1));
await browser.close(); await server.close(); process.exit(0);
