#!/usr/bin/env node
/**
 * Geometry gap checker. Loads the scene headless (shot mode), stops the app's own rendering and renders the NEAR
 * scene only (no far scene, post, AO, fog, shadows) with id/depth materials from automatically placed cameras:
 *   exterior — orbits around every station collider (modules, nodes, truss, ring, hub, arrays, radiators…)
 *   ships    — orbits around every ship (close = L0, far = L1)
 *   interior — cameras inside every compartment volume looking along its axes and through every hatch
 * and reports holes (background enclosed by geometry), cracks (thin slits between surfaces at equal depth),
 * back faces of single-sided materials seen from behind, and z-fighting (see tools/gapcheck/probe.js).
 *
 *   node tools/gapcheck.mjs --set=exterior|interior|ships|all [--areas=node,lab] [--zones=lab,cupola]
 *        [--quality=high] [--w=640 --h=360] [--max=400] [--minpx=6] [--out=dir] [--params="shipshow=clean"]
 *        [--only=hole,crack,backface,zfight] [--every=1 | --sample=60 [--phase=k]] [--shots=40]
 * Output: <out>/report.json (every view with its issues), <out>/summary.txt (counts per area and kind) and
 * review PNGs <out>/<n>_<view>.png (left: real near-scene render on magenta, right: false colour per mesh with
 * flags — red hole, yellow crack, orange back face, cyan z-fight, blue large enclosed opening).
 */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const set = args.set || 'exterior';
const w = +(args.w || 640), h = +(args.h || 360);
const out = args.out || '/tmp/gapcheck';
const max = +(args.max || 400);
const every = +(args.every || 1);
const shots = +(args.shots || 60);
const only = args.only ? args.only.split(',') : ['hole', 'crack', 'backface', 'zfight'];
const quality = args.quality || 'high';
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(out)) if (f.endsWith('.png')) fs.unlinkSync(path.join(out, f));

const { createServer } = await import('vite');
const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const close = async () => { try { await browser.close(); } catch (_) { /* ignore */ } try { await server.close(); } catch (_) { /* ignore */ } };
process.on('SIGINT', async () => { await close(); process.exit(130); });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('console', (m) => { if (m.type() === 'error' || args.log) console.log(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now();
const url = `${base}/?shot=1&autostart=1&observer=1&view=overview&t=${args.t || 600}&quality=${quality}&minh=0&pr=0.25&ao=0${set === 'ships' ? '&shipshow=clean' : ''}${args.params ? '&' + args.params : ''}`;
console.log('open', url);
await page.goto(url, { waitUntil: 'load', timeout: 900000 });
await page.waitForFunction(() => window.__APP_READY__ === true, null, { timeout: 900000 });
console.log(`app ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const views = await page.evaluate(async ({ set, areas, zones, w, h, types }) => {
  const P = await import('/tools/gapcheck/probe.js');
  const app = window.__app;
  window.__gap = new P.GapProbe(app, { w, h });
  window.__gapP = P;
  let v = [];
  if (set === 'exterior' || set === 'all') v = v.concat(P.exteriorViews(app, { areas }));
  if (set === 'ships' || set === 'all') v = v.concat(P.shipViews(app, { types }));
  if (set === 'interior' || set === 'all') v = v.concat(P.interiorViews(app, { zones }));
  window.__gapViews = v;
  return v.map((x) => ({ name: x.name, area: x.area }));
}, { set, areas: args.areas ? args.areas.split(',') : null, zones: args.zones ? args.zones.split(',') : null, w, h, types: args.types ? args.types.split(',') : null });
const step = args.sample ? Math.max(1, Math.floor(views.length / +args.sample)) : every;
const picked = views.map((v, i) => ({ ...v, i })).filter((_, i) => i % step === (+(args.phase || 0)) % step).slice(0, max);
console.log(`${views.length} viewpoints, checking ${picked.length}`);

const report = [];
const perArea = {};
let nShots = 0, invalid = 0;
for (const v of picked) {
  const r = await page.evaluate(async ({ i, minPx, only, wantShot }) => {
    const g = window.__gap, P = window.__gapP, V = window.__gapViews[i];
    const THREE = P.THREE;
    await g.place(new THREE.Vector3(...V.pos), new THREE.Vector3(...V.target), V.up ? new THREE.Vector3(...V.up) : null);
    const res = g.analyse({ minPx });
    res.issues = res.issues.filter((x) => only.includes(x.kind) || x.kind === 'opening');
    const bad = res.issues.filter((x) => x.kind !== 'opening');
    let png = null;
    if (bad.length && wantShot && res.vis) png = P.reviewPng(res, g.w, g.h, res.issues);
    return { issues: res.issues, counts: res.counts, png, invalid: !!res.invalid, zone: window.__app.station.interior?.cameraZone?.id || null };
  }, { i: v.i, minPx: +(args.minpx || 6), only, wantShot: nShots < shots }).catch((e) => ({ error: e.message, issues: [] }));
  if (r.error) { console.log(`${v.name}: ERROR ${r.error}`); continue; }
  if (r.invalid) { console.log(`${v.name}: skipped (camera inside a solid / behind a wall)`); invalid++; continue; }
  const bad = r.issues.filter((x) => x.kind !== 'opening');
  const a = perArea[v.area] || (perArea[v.area] = { views: 0, flagged: 0, hole: 0, crack: 0, backface: 0, zfight: 0 });
  a.views++;
  if (bad.length) a.flagged++;
  for (const x of bad) a[x.kind] = (a[x.kind] || 0) + 1;
  let file = null;
  if (r.png) {
    file = path.join(out, `${String(nShots).padStart(3, '0')}_${v.name.replace(/[^\w.-]+/g, '_')}.png`);
    fs.writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'));
    nShots++;
  }
  report.push({ view: v.name, area: v.area, zone: r.zone, issues: r.issues, file });
  if (bad.length) console.log(`${v.name}: ${bad.map((x) => `${x.kind} ${x.px}px @${x.world?.join(',')} ${x.parts.slice(0, 2).join(' | ')}`).join(' ;; ')}${file ? ' -> ' + path.basename(file) : ''}`);
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
const lines = [`gapcheck set=${set} quality=${quality} ${w}x${h}  ${picked.length} views (${invalid} skipped: camera inside a solid)  ${((Date.now() - t0) / 1000).toFixed(0)} s`, 'area                     views flagged  hole crack backface zfight'];
const tot = { views: 0, flagged: 0, hole: 0, crack: 0, backface: 0, zfight: 0 };
for (const [k, a] of Object.entries(perArea).sort()) {
  lines.push(`${k.padEnd(24)} ${String(a.views).padStart(5)} ${String(a.flagged).padStart(7)} ${String(a.hole).padStart(5)} ${String(a.crack).padStart(5)} ${String(a.backface).padStart(8)} ${String(a.zfight).padStart(6)}`);
  for (const q of Object.keys(tot)) tot[q] += a[q] || 0;
}
lines.push(`${'TOTAL'.padEnd(24)} ${String(tot.views).padStart(5)} ${String(tot.flagged).padStart(7)} ${String(tot.hole).padStart(5)} ${String(tot.crack).padStart(5)} ${String(tot.backface).padStart(8)} ${String(tot.zfight).padStart(6)}`);
// most frequent offending meshes
const parts = {};
for (const r of report) for (const x of r.issues) if (x.kind !== 'opening') for (const p of x.parts.slice(0, 2)) { const k = `${x.kind} ${p}`; parts[k] = (parts[k] || 0) + x.px; }
lines.push('', 'top offenders (kind, mesh[material], total px):');
for (const [k, n] of Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 30)) lines.push(`  ${String(n).padStart(7)}  ${k}`);
fs.writeFileSync(path.join(out, 'summary.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
await close();
process.exit(0);
