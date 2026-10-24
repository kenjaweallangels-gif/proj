import * as THREE from 'three';
import { bvToLinearRgb } from '../StarColor.js';

/**
 * Star catalogue files (public/data/sky/stars_*.bin, built by tools/sky/pack_sky.py), format "STR3":
 *   32-byte header: char[4] 'STR3', u32 version, u32 count, u32 recordSize (8), f32 epoch, f32 faintest V,
 *   u32 cells (0 = records sorted by V; else number of sky cells), u32 0;
 *   if cells > 0: (cells + 1) x u32 record offsets per cell (dec band k / 32 equal in sin(dec), RA column k % 32);
 *   records: u24 RA (v / 2^24 x 360 deg), u24 Dec (v / (2^24 - 1) x 180 - 90 deg), u8 V (v / 16 - 2), u8 B-V (v / 64 - 0.5).
 * Positions are ICRS (J2000 equator) at the header epoch (proper motion already applied).
 *
 * Chunks: a V<=7, b 7<V<=9.5, c 9.5<V<=10.5 (magnitude-sorted, indices continue a -> b -> c = star_names.json `i`),
 * d 10.5<V<=12 and gaia (Gaia DR3 sources without HIP/Tycho-2 counterpart, V<=12) sorted by sky cell (telescope).
 */

export const STAR_DISTANCE_KM = 1.5e6;
export const CELL_RA = 32, CELL_DEC = 16;

/** B-V code (0..255) -> linear RGB normalised to unit luminance (r, g, b in 0..255 after scaling by 1/2 for headroom). */
let BV_LUT = null;
function bvLut() {
  if (BV_LUT) return BV_LUT;
  BV_LUT = new Uint8Array(256 * 3);
  const rgb = [0, 0, 0];
  for (let i = 0; i < 256; i++) {
    bvToLinearRgb(i / 64 - 0.5, rgb);
    const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    // stored as rgb / y / 2 so a channel may reach 2x the luminance (red / blue stars) without clipping
    for (let k = 0; k < 3; k++) BV_LUT[i * 3 + k] = Math.min(255, Math.round((rgb[k] / y) * 0.5 * 255));
  }
  return BV_LUT;
}

/** V magnitude from the record byte. */
export const magFromCode = (c) => c / 16 - 2;

/** Parses a STR3 buffer -> { count, epoch, faintest, cells (Uint32Array | null), bytes (Uint8Array of records) }. */
export function parseStars(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x53 || u8[1] !== 0x54 || u8[2] !== 0x52 || u8[3] !== 0x33) throw new Error('not a STR3 star file');
  const dv = new DataView(buf);
  const count = dv.getUint32(8, true), rec = dv.getUint32(12, true);
  const epoch = dv.getFloat32(16, true), faintest = dv.getFloat32(20, true), ncell = dv.getUint32(24, true);
  let off = 32, cells = null;
  if (ncell > 0) { cells = new Uint32Array(buf.slice(off, off + (ncell + 1) * 4)); off += (ncell + 1) * 4; }
  return { count, rec, epoch, faintest, cells, bytes: new Uint8Array(buf, off, count * rec) };
}

/**
 * Builds the GPU attributes for records [start, end): position (unit ECI x STAR_DISTANCE_KM, Float32 xyz) and
 * aStar (Uint8 rgba: colour r, g, b (see bvLut), V code). Returns a BufferGeometry with a bounding sphere.
 * `out` (optional) receives the unit vectors as a Float32Array for CPU queries.
 */
export function buildStarGeometry(cat, start = 0, end = cat.count) {
  const n = Math.max(0, end - start);
  const pos = new Float32Array(n * 3), st = new Uint8Array(n * 4);
  const b = cat.bytes, R = cat.rec, lut = bvLut();
  const kRa = (2 * Math.PI) / 16777216, kDec = Math.PI / 16777215;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const o = (start + i) * R;
    const ra = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) * kRa;
    const dec = (b[o + 3] | (b[o + 4] << 8) | (b[o + 5] << 16)) * kDec - Math.PI / 2;
    const cd = Math.cos(dec);
    const x = cd * Math.cos(ra), y = cd * Math.sin(ra), z = Math.sin(dec);
    pos[i * 3] = x * STAR_DISTANCE_KM; pos[i * 3 + 1] = y * STAR_DISTANCE_KM; pos[i * 3 + 2] = z * STAR_DISTANCE_KM;
    cx += x; cy += y; cz += z;
    const bv = b[o + 7] * 3;
    st[i * 4] = lut[bv]; st[i * 4 + 1] = lut[bv + 1]; st[i * 4 + 2] = lut[bv + 2]; st[i * 4 + 3] = b[o + 6];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aStar', new THREE.BufferAttribute(st, 4));
  // bounding sphere: whole sky unless the chunk is a compact cell
  const cl = Math.hypot(cx, cy, cz);
  if (n > 0 && cl / n > 0.9) {
    const c = new THREE.Vector3(cx / cl, cy / cl, cz / cl);
    let minDot = 1;
    for (let i = 0; i < n; i++) minDot = Math.min(minDot, (pos[i * 3] * c.x + pos[i * 3 + 1] * c.y + pos[i * 3 + 2] * c.z) / STAR_DISTANCE_KM);
    const ang = Math.acos(Math.max(-1, minDot));
    geo.boundingSphere = new THREE.Sphere(c.multiplyScalar(STAR_DISTANCE_KM * Math.cos(ang)), STAR_DISTANCE_KM * Math.sin(ang) * 1.02 + 1);
  } else geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), STAR_DISTANCE_KM * 1.01);
  return geo;
}

/** Unit vector and V of record i (for labels, search, telescope readouts). */
export function starRecord(cat, i, out) {
  const b = cat.bytes, o = i * cat.rec;
  const ra = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) / 16777216 * 2 * Math.PI;
  const dec = (b[o + 3] | (b[o + 4] << 8) | (b[o + 5] << 16)) / 16777215 * Math.PI - Math.PI / 2;
  out.ra = ra; out.dec = dec; out.v = magFromCode(b[o + 6]); out.bv = b[o + 7] / 64 - 0.5;
  return out;
}

export async function fetchStars(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return parseStars(await r.arrayBuffer());
}
