#!/usr/bin/env node
/**
 * Offline render + analysis of every procedural foley entry (src/audio/foley.js) under Node.
 *
 *   node tools/audio/foley-render.mjs [--out=DIR] [--sr=48000] [--only=name,name] [--wav=0]
 *
 * Writes DIR/<name>_<v>.wav (16-bit) and DIR/foley-report.json, and prints a table: duration, peak, RMS,
 * DC, spectral centroid, high-frequency click score, loop seam step (loops) and generation time.
 * Fails (exit 1) on NaN/Inf, clipping (> 0 dBFS), |DC| > 1e-3, or a loop seam step above 6x the median step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { FOLEY, generate } from '../../src/audio/foley.js';
import { fft, Biquad } from '../../src/audio/dsp.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const sr = parseInt(args.sr || '48000', 10);
const out = args.out || 'foley-out';
const writeWav = args.wav !== '0';
const only = args.only ? new Set(args.only.split(',')) : null;
fs.mkdirSync(out, { recursive: true });

function wav16(file, channels) {
  const n = channels[0].length, nc = channels.length, buf = Buffer.alloc(44 + n * nc * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * nc * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(nc, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * nc * 2, 28); buf.writeUInt16LE(nc * 2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * nc * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) { buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(channels[c][i] * 32767))), o); o += 2; }
  fs.writeFileSync(file, buf);
}

function centroid(x) {
  const N = 1 << Math.min(16, Math.ceil(Math.log2(Math.max(256, x.length))));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < Math.min(N, x.length); i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / Math.min(N, x.length)));
  fft(re, im);
  let s = 0, w = 0;
  for (let k = 1; k < N / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; s += p; w += p * k * sr / N; }
  return s > 0 ? w / s : 0;
}

/** Click score: max over 1 ms blocks of the >7 kHz envelope / median block level (for loops only; one-shots are transients by nature). */
function clickScore(x) {
  const hp = new Biquad(sr).set('hp', 7000, 0.7), hp2 = new Biquad(sr).set('hp', 7000, 0.7);
  const blk = Math.round(sr / 1000), nb = Math.floor(x.length / blk), m = new Float64Array(nb);
  for (let b = 0; b < nb; b++) { let mx = 0; for (let i = 0; i < blk; i++) { const v = Math.abs(hp2.tick(hp.tick(x[b * blk + i]))); if (v > mx) mx = v; } m[b] = mx; }
  const sorted = Float64Array.from(m).sort();
  const med = sorted[Math.floor(nb / 2)] + 1e-9;
  let worst = 0; for (let b = 8; b < nb; b++) worst = Math.max(worst, m[b] / med);
  return worst;
}

const rows = [], report = {};
let bad = 0;
for (const name of Object.keys(FOLEY)) {
  if (only && !only.has(name)) continue;
  const e = FOLEY[name];
  for (let v = 0; v < e.n; v++) {
    const t0 = performance.now();
    const g = generate(name, sr, v);
    const ms = performance.now() - t0;
    const ch = g.channels;
    let pk = 0, ss = 0, dc = 0, finite = true;
    for (const c of ch) for (let i = 0; i < c.length; i++) { const a = c[i]; if (!Number.isFinite(a)) finite = false; pk = Math.max(pk, Math.abs(a)); ss += a * a; dc += a; }
    const n = ch[0].length * ch.length;
    const r = {
      dur: +(ch[0].length / sr).toFixed(3), ch: ch.length, peakDb: +(20 * Math.log10(pk + 1e-12)).toFixed(1), rmsDb: +(10 * Math.log10(ss / n + 1e-20)).toFixed(1),
      dc: +(dc / n).toExponential(1), centroid: Math.round(centroid(ch[0])), genMs: +ms.toFixed(1), loop: g.loop,
    };
    if (g.loop) {
      let med = 0; const st = [];
      for (let i = 1; i < ch[0].length; i += 7) st.push(Math.abs(ch[0][i] - ch[0][i - 1]));
      st.sort((a, b) => a - b); med = st[st.length >> 1] + 1e-12;
      let seam = 0; for (const c of ch) seam = Math.max(seam, Math.abs(c[0] - c[c.length - 1]));
      r.seam = +(seam / med).toFixed(2);
      // wrap the loop twice and scan for clicks around the seam
      const two = new Float32Array(ch[0].length * 2); two.set(ch[0]); two.set(ch[0], ch[0].length);
      r.clicks = +clickScore(two).toFixed(1);
    }
    const fail = !finite || pk > 1.0 || Math.abs(dc / n) > 1e-3 || (g.loop && r.seam > 6);
    if (fail) { bad++; r.FAIL = true; }
    report[`${name}_${v}`] = r;
    rows.push(`${(name + '_' + v).padEnd(20)} ${String(r.dur).padStart(6)} s ${String(r.ch)}ch  pk ${String(r.peakDb).padStart(6)}  rms ${String(r.rmsDb).padStart(6)}  dc ${String(r.dc).padStart(8)}  c ${String(r.centroid).padStart(5)} Hz  ${String(r.genMs).padStart(6)} ms${g.loop ? `  seam ${r.seam}  hfspike ${r.clicks}` : ''}${fail ? '  <-- FAIL' : ''}`);
    if (writeWav) wav16(path.join(out, `${name}_${v}.wav`), ch);
  }
}
console.log(rows.join('\n'));
const total = Object.values(report).reduce((s, r) => s + r.genMs, 0);
console.log(`\n${rows.length} sounds, generation ${total.toFixed(0)} ms total at ${sr} Hz, ${bad} failures`);
fs.writeFileSync(path.join(out, 'foley-report.json'), JSON.stringify(report, null, 1));
process.exit(bad ? 1 : 0);
