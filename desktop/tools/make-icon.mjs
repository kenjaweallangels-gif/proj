#!/usr/bin/env node
/**
 * Draws the application icon procedurally (no image tools needed): a rounded dark tile with stars, the limb
 * of the Earth with its atmosphere and the station (ring, truss, modules, solar arrays) in orbit above it.
 * Writes desktop/build/icon.png (1024×1024; electron-builder derives the Linux sizes, .ico and .icns from it)
 * and desktop/build/icons/<size>x<size>.png for the Linux desktop entry.
 *
 *   node desktop/tools/make-icon.mjs [--if-missing]   (about a minute; the result is committed)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');

// ---------------------------------------------------------------- PNG encoder (RGBA, 8 bit)
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- scene (unit square, y down)
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => v / 255);

// deterministic star field
const stars = [];
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
for (let i = 0; i < 90; i++) stars.push([rnd(), rnd() * 0.75, 0.0015 + rnd() * rnd() * 0.0045, 0.5 + rnd() * 0.5]);

function roundedBoxSdf(x, y, r) { const qx = Math.abs(x - 0.5) - (0.5 - r), qy = Math.abs(y - 0.5) - (0.5 - r); return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; }
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

function shade(x, y) {
  const tile = roundedBoxSdf(x, y, 0.19);
  if (tile > 0) return [0, 0, 0, 0];
  // space background
  let c = mix(hex(0x0c1d3d), hex(0x02040b), clamp(Math.hypot(x - 0.62, y - 0.18) * 1.25));
  for (const [sx, sy, sr, sb] of stars) { if (Math.abs(x - sx) > sr * 3 || Math.abs(y - sy) > sr * 3) continue; const d = Math.hypot(x - sx, y - sy); if (d < sr * 3) c = mix(c, [1, 1, 1], sb * Math.exp(-(d * d) / (sr * sr))); }
  // Earth limb (centre below the tile) + atmosphere
  const ex = 0.5, ey = 1.62, er = 0.98;
  const de = Math.hypot(x - ex, y - ey) - er;
  if (de < 0.05) c = mix(c, hex(0x5fb4ff), 0.85 * (1 - smooth(0, 0.05, de)) * (de > 0 ? 1 : 0));
  if (de <= 0) {
    const lat = clamp(-de / 0.35);
    let g = mix(hex(0x2f7fd0), hex(0x0a2a5c), lat);
    // continents / clouds: cheap value noise bands
    const n = Math.sin(x * 23 + Math.sin(y * 17) * 2) * Math.sin(y * 31 + x * 7) + Math.sin(x * 51 - y * 13) * 0.4;
    if (n > 0.55) g = mix(g, hex(0x3d8a4a), 0.55);
    if (Math.sin(x * 37 + y * 11 + Math.sin(x * 9) * 3) > 0.82) g = mix(g, [0.95, 0.97, 1], 0.6);
    g = mix(g, hex(0xbfe6ff), Math.exp(de / 0.012) * 0.8);   // bright rim
    c = g;
  }
  // station: truss with solar arrays
  const cy = 0.43;
  const truss = inRect(x, y, 0.13, cy - 0.012, 0.87, cy + 0.012);
  const panelRow = (x0, x1) => inRect(x, y, x0, cy - 0.15, x1, cy - 0.025) || inRect(x, y, x0, cy + 0.025, x1, cy + 0.15);
  const panels = panelRow(0.08, 0.2) || panelRow(0.8, 0.92);
  if (panels) {
    const gx = ((x - 0.08) * 70) % 1, gy = ((y - cy) * 70 + 100) % 1;
    c = mix(hex(0x1d3f8f), hex(0xd9a441), 0.15);
    if (gx < 0.12 || gy < 0.12) c = hex(0x0e1e45);
  }
  if (truss) c = mix(hex(0xc9d2dc), hex(0x8a96a5), ((x * 120) % 1) < 0.5 ? 0 : 0.4);
  // rotating ring (ellipse outline)
  const rx = 0.27, ry = 0.095;
  const er2 = Math.hypot((x - 0.5) / rx, (y - cy) / ry);
  const ringW = 0.022 / ry;
  if (Math.abs(er2 - 1) < ringW * 0.5) { const front = y > cy; c = mix(hex(front ? 0xf2f5f8 : 0x9aa6b4), hex(0x6e7a88), Math.abs(er2 - 1) / (ringW * 0.5) * 0.6); }
  // spokes
  if (Math.abs(x - 0.5) < 0.007 && Math.abs(y - cy) < ry) c = hex(0xb7c1cc);
  // central modules (vertical stack) + cupola
  if (inRect(x, y, 0.468, cy - 0.17, 0.532, cy + 0.15)) { const l = 0.75 + 0.25 * Math.cos((x - 0.5) / 0.032 * 1.4); c = mix(hex(0x6d7886), hex(0xf4f6f8), l); if (Math.abs(((y - cy) * 22) % 1) < 0.08) c = hex(0x7b8794); }
  if (Math.hypot(x - 0.5, y - (cy - 0.19)) < 0.03) c = mix(hex(0xe7ecf2), hex(0x7fd3ff), 0.35);
  // sun glint
  const ds = Math.hypot(x - 0.8, y - 0.2);
  c = mix(c, [1, 0.96, 0.85], Math.exp(-ds * ds / 0.0006) * 0.95);
  const edge = clamp(-tile * 1024 / 1.5);   // anti-aliased tile edge (in pixels at 1024)
  return [...c.map((v) => clamp(v)), edge];
}

function render(size, ss) {
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const s = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
      acc[0] += s[0] * s[3]; acc[1] += s[1] * s[3]; acc[2] += s[2] * s[3]; acc[3] += s[3];
    }
    const a = acc[3] / (ss * ss), i = (py * size + px) * 4;
    buf[i] = acc[3] ? Math.round(255 * Math.pow(acc[0] / acc[3], 1 / 1.0)) : 0;
    buf[i + 1] = acc[3] ? Math.round(255 * acc[1] / acc[3]) : 0;
    buf[i + 2] = acc[3] ? Math.round(255 * acc[2] / acc[3]) : 0;
    buf[i + 3] = Math.round(255 * a);
  }
  return encodePng(size, size, buf);
}

if (process.argv.includes('--if-missing') && fs.existsSync(path.join(outDir, 'icon.png')) && fs.existsSync(path.join(outDir, 'icons', '512x512.png'))) process.exit(0);
fs.mkdirSync(path.join(outDir, 'icons'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), render(1024, 2));
for (const s of [16, 32, 48, 64, 128, 256, 512]) fs.writeFileSync(path.join(outDir, 'icons', `${s}x${s}.png`), render(s, s <= 64 ? 8 : 3));
console.log(`icon written to ${path.relative(process.cwd(), outDir)}/icon.png (+ icons/)`);
