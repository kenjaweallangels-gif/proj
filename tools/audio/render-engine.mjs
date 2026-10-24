#!/usr/bin/env node
/**
 * Renders the real audio engine offline in headless Chromium (tools/audio/engine-test.js: scripted IVA ->
 * donning -> depress -> EVA -> repress -> gravity ring scenario) and checks it programmatically:
 *   - full mix: no clipping, no DC, the EVA segment is not silent (suit), CPU load (offline render time / audio time)
 *   - cabin-air path only: silent in vacuum (EVA, incl. an outside explosion), falls with the depress pressure,
 *     rises again with the repress
 *
 *   node tools/audio/render-engine.mjs [--out=DIR] [--seconds=64]
 * Writes DIR/engine-all.wav, DIR/engine-air.wav and DIR/engine-report.json; exit code 1 when a check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(args.out || 'engine-out');
const seconds = parseFloat(args.seconds || '64');
fs.mkdirSync(out, { recursive: true });

const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });

function wav(file, i16, sr) {
  const n = i16.length / 2, buf = Buffer.alloc(44 + i16.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + i16.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(i16.length * 2, 40);
  Buffer.from(i16.buffer).copy(buf, 44);
  fs.writeFileSync(file, buf);
  void n;
}
const db = (x) => +(20 * Math.log10(x + 1e-9)).toFixed(1);
function win(i16, sr, a, b) {
  const i0 = Math.max(0, Math.round(a * sr)) * 2, i1 = Math.min(i16.length / 2, Math.round(b * sr)) * 2;
  let s = 0, pk = 0, dc = 0;
  for (let i = i0; i < i1; i++) { const v = i16[i] / 32767; s += v * v; dc += v; pk = Math.max(pk, Math.abs(v)); }
  const n = Math.max(1, i1 - i0);
  return { rms: db(Math.sqrt(s / n)), peak: db(pk), dc: dc / n };
}

let failed = 0;
const checks = [];
const check = (name, ok, info) => { checks.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${info}`); if (!ok) failed++; };
try {
  await page.goto(`${server.resolvedUrls.local[0]}tools/audio/engine-test.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__engineTestReady === true, null, { timeout: 60000 });
  const res = {};
  for (const taps of ['all', 'air']) {
    const r = await page.evaluate((o) => window.renderEngine(o), { seconds, taps });
    const i16 = new Int16Array(Buffer.from(r.pcm, 'base64').buffer.slice(0));
    wav(path.join(out, `engine-${taps}.wav`), i16, r.sr);
    const secs = [];
    for (let t = 0; t < seconds; t += 1) secs.push(win(i16, r.sr, t, t + 1).rms);
    res[taps] = { wallMs: Math.round(r.wallMs), prepMs: Math.round(r.prepMs), syncMs: Math.round(r.syncMs), cached: r.cached, peakDb: db(r.peak), perSecondRmsDb: secs, marks: r.marks, whole: win(i16, r.sr, 0, seconds) };
    res[taps].i16 = i16; res[taps].sr = r.sr;
  }
  const A = res.all, B = res.air;
  check('full mix: no clipping', A.peakDb < -0.3, `peak ${A.peakDb} dBFS`);
  check('full mix: no DC', Math.abs(A.whole.dc) < 1e-3, `dc ${A.whole.dc.toExponential(1)}`);
  const evaAll = win(A.i16, A.sr, 25, 39);
  check('EVA: suit sounds audible', evaAll.rms > -50, `rms ${evaAll.rms} dBFS`);
  const evaAir = win(B.i16, B.sr, 25.5, 39.5);
  check('EVA: nothing through vacuum (air path, incl. outside explosion at 38 s)', evaAir.peak < -70, `air-path peak ${evaAir.peak} dBFS`);
  const d1 = win(B.i16, B.sr, 13, 14).rms, d2 = win(B.i16, B.sr, 16, 17).rms, d3 = win(B.i16, B.sr, 19, 19.9).rms;
  check('depress: air sound falls with the pressure', d1 > d2 + 3 && d2 > d3 + 3, `${d1} > ${d2} > ${d3} dBFS`);
  const r1 = win(B.i16, B.sr, 43.6, 44.2).rms, r2 = win(B.i16, B.sr, 45.5, 46.5).rms;
  check('repress: air sound rises out of silence', r2 > r1 + 6, `${r1} -> ${r2} dBFS`);
  const iva = win(B.i16, B.sr, 0.5, 7.5).rms;
  check('IVA: cabin ambience present', iva > -50 && iva < -18, `rms ${iva} dBFS`);
  const ring = win(A.i16, A.sr, 48.5, 60).rms;
  check('ring: footsteps + bed present', ring > -45, `rms ${ring} dBFS`);
  const load = A.wallMs / (seconds * 1000);
  check('CPU: offline render faster than 10 % of real time', load < 0.1, `${(load * 100).toFixed(1)} % (${A.wallMs} ms for ${seconds} s)`);
  check('no page errors', errors.filter((e) => !/manifest|music/.test(e)).length === 0, errors.slice(0, 5).join(' | ') || 'none');
  for (const k of ['all', 'air']) { delete res[k].i16; delete res[k].sr; }
  fs.writeFileSync(path.join(out, 'engine-report.json'), JSON.stringify({ checks, ...res, errors }, null, 1));
  console.log(`\nper-second RMS (full mix): ${A.perSecondRmsDb.join(' ')}`);
  console.log(`per-second RMS (air path): ${B.perSecondRmsDb.join(' ')}`);
  console.log(`bank prep ${A.prepMs} ms (worker), sync renders ${A.syncMs} ms, ${A.cached} buffers`);
} catch (e) {
  console.error(e); failed++;
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
