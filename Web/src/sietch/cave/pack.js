// Упаковка/распаковка запечённой пещеры: типизированные массивы → один буфер → zlib → base64 (в сборке — модуль-строка).
import { zlibSync, unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import { GRID, BOUNDS } from './consts.js';

const QS = 0.016;
/** Число значащих бит каналов (остальное отбрасывается до дельта-кодирования; при загрузке восстанавливается репликацией старших бит). */
export const QBITS = { tint: [7, 7, 7, 6], par: [5, 5, 5, 5], glow: [6, 6, 6, 1], probes: [5, 5, 5, 6] };
function quantizeBits(arr, bits) { const out = new Uint8Array(arr.length); for (let i = 0; i < arr.length; i++) out[i] = arr[i] >> (8 - bits[i & 3]); return out; }
export function expandBits(q, bits) { const out = new Uint8Array(q.length); for (let i = 0; i < q.length; i++) { const b = bits[i & 3], v = q[i]; out[i] = b >= 8 ? v : (v << (8 - b)) | (b >= 4 ? v >> (2 * b - 8) : (v ? 255 >> b : 0) & 255); } return out; }
function octEnc(n, out, v) {
  const x = n[v * 3], y = n[v * 3 + 1], z = n[v * 3 + 2], l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let px = x / l, py = y / l;
  if (z < 0) { const tx = (1 - Math.abs(py)) * (px >= 0 ? 1 : -1), ty = (1 - Math.abs(px)) * (py >= 0 ? 1 : -1); px = tx; py = ty; }
  out[v * 2] = Math.round(px * 127); out[v * 2 + 1] = Math.round(py * 127);
}
export function octDec(q, v, out) {
  let x = q[v * 2] / 127, y = q[v * 2 + 1] / 127; const z0 = 1 - Math.abs(x) - Math.abs(y);
  let z = z0;
  if (z0 < 0) { const tx = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1), ty = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1); x = tx; y = ty; }
  const l = Math.hypot(x, y, z) || 1;
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
}
const TYPES = { u8: Uint8Array, i8: Int8Array, u16: Uint16Array, i16: Int16Array, i32: Int32Array, f32: Float32Array };
const typeOf = (a) => (a instanceof Uint8Array ? 'u8' : a instanceof Int8Array ? 'i8' : a instanceof Uint16Array ? 'u16' : a instanceof Int16Array ? 'i16' : a instanceof Int32Array ? 'i32' : 'f32');

const UT = { 1: Uint8Array, 2: Uint16Array, 4: Uint32Array };
/** Кодирование секции: по каналам (stride) — дельта по элементам (mod 2^8B) → разбиение на байтовые плоскости (улучшает zlib в 1.5–2 раза). */
function encodeSection(arr, stride, delta) {
  const B = arr.BYTES_PER_ELEMENT, n = arr.length, items = Math.floor(n / stride), U = UT[B];
  const u = new U(arr.buffer, arr.byteOffset, n);
  const out = new Uint8Array(arr.byteLength);
  let o = 0;
  const ch = new U(items), bytes = new Uint8Array(ch.buffer);
  for (let c = 0; c < stride; c++) {
    let prev = 0;
    for (let i = 0; i < items; i++) { const v = u[i * stride + c]; ch[i] = delta ? v - prev : v; prev = v; }
    for (let b = 0; b < B; b++) for (let i = 0; i < items; i++) out[o++] = bytes[i * B + b];
  }
  // хвост (n % stride) — как есть
  for (let i = items * stride; i < n; i++) { const v = u[i]; for (let b = 0; b < B; b++) out[o++] = (v >>> (8 * b)) & 255; }
  return out;
}
function decodeSection(buf, off, n, type, stride, delta) {
  const T = TYPES[type], B = T.BYTES_PER_ELEMENT, items = Math.floor(n / stride), U = UT[B];
  const res = new U(n);
  let o = off;
  const ch = new U(items), bytes = new Uint8Array(ch.buffer);
  for (let c = 0; c < stride; c++) {
    for (let b = 0; b < B; b++) for (let i = 0; i < items; i++) bytes[i * B + b] = buf[o++];
    if (delta) { let acc = 0; for (let i = 0; i < items; i++) { acc = (acc + ch[i]) >>> 0; res[i * stride + c] = acc; } }
    else for (let i = 0; i < items; i++) res[i * stride + c] = ch[i];
  }
  for (let i = items * stride; i < n; i++) { let v = 0; for (let b = 0; b < B; b++) v |= buf[o++] << (8 * b); res[i] = v; }
  return new T(res.buffer);
}

export function pack(baked) {
  const { mesh, att, chunks, grids, probes, decals, pvs } = baked;
  const NV = mesh.positions.length / 3;
  const o = [BOUNDS.min[0] - 1, BOUNDS.min[1] - 1, BOUNDS.min[2] - 1];
  const pos = new Uint16Array(NV * 3), nor = new Int8Array(NV * 2);
  for (let v = 0; v < NV; v++) {
    for (let c = 0; c < 3; c++) pos[v * 3 + c] = Math.round((mesh.positions[v * 3 + c] - o[c]) / QS);
    octEnc(mesh.normals, nor, v);
  }
  // индексы: дельта + zigzag
  const I = mesh.indices, d = new Int32Array(I.length);
  let prev = 0;
  for (let i = 0; i < I.length; i++) { const dv = I[i] - prev; d[i] = (dv << 1) ^ (dv >> 31); prev = I[i]; }
  // [имя, массив, число каналов, дельта по элементам]
  const sections = [
    ['pos', pos, 3, true], ['nor', nor, 2, true], ['tint', quantizeBits(att.col, QBITS.tint), 4, true], ['par', quantizeBits(att.par, QBITS.par), 4, true], ['glow', quantizeBits(att.glow, QBITS.glow), 4, true], ['idx', d, 1, false],
    ['f0', grids.f0, 1, true], ['f1', grids.f1, 1, true], ['w0', grids.w0, 1, true], ['w1', grids.w1, 1, true], ['probes', quantizeBits(probes.data, QBITS.probes), 4, true],
    ['pvsIdx', pvs.idx, 1, false], ['pvsBits', pvs.bits, 1, false],
  ];
  const decalHdr = [];
  decals.forEach((g, i) => {
    sections.push([`d${i}pos`, g.positions, 3, false], [`d${i}nor`, g.normals, 3, false], [`d${i}uv`, g.uvs, 2, false], [`d${i}glow`, g.glow, 3, false], [`d${i}ao`, g.ao, 1, false], [`d${i}idx`, g.indices.length ? new Int32Array(g.indices) : new Int32Array(0), 1, false]);
    decalHdr.push({ tex: g.tex, count: g.count, layer: g.layer, nv: g.positions.length / 3, ni: g.indices.length });
  });
  const header = {
    version: 2, qbits: QBITS, NV, NI: I.length, quant: { o, s: QS }, bounds: BOUNDS, cell: baked.cell, chunks: chunks.list,
    grid: GRID, noFloor: grids.NOFLOOR, probes: { ox: probes.ox, oy: probes.oy, oz: probes.oz, h: probes.h, nx: probes.nx, ny: probes.ny, nz: probes.nz },
    globes: baked.globes, anchors: baked.anchors, decals: decalHdr, bakeMs: baked.bakeMs, sections: [],
    pvs: { cs: pvs.cs, ox: pvs.ox, oy: pvs.oy, oz: pvs.oz, nx: pvs.nx, ny: pvs.ny, nz: pvs.nz, nb: pvs.nb, nc: pvs.nc, rows: pvs.rows },
  };
  // раскладка секций
  let off = 0;
  const enc = [];
  for (const [name, arr, stride, delta] of sections) {
    off = (off + 3) & ~3;
    header.sections.push({ name, type: typeOf(arr), n: arr.length, off, stride, delta: delta ? 1 : 0 });
    const e = encodeSection(arr, stride, delta);
    enc.push(e);
    off += e.byteLength;
  }
  const hj = new TextEncoder().encode(JSON.stringify(header));
  const hl = (hj.length + 3) & ~3;
  const total = 4 + hl + off;
  const buf = new Uint8Array(total);
  new DataView(buf.buffer).setUint32(0, hj.length, true);
  buf.set(hj, 4);
  header.sections.forEach((s, i) => { buf.set(enc[i], 4 + hl + s.off); });
  return { raw: buf, z: zlibSync(buf, { level: 9 }), header };
}

export function toBase64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}
export function fromBase64(b64) {
  if (typeof atob === 'function') { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Распаковка: возвращает {header, A: {секция → типизированный массив}}. */
export function unpack(b64) {
  const raw = unzlibSync(fromBase64(b64));
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const hl = dv.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + hl)));
  const hp = (hl + 3) & ~3;
  const A = {};
  for (const s of header.sections) A[s.name] = decodeSection(raw, 4 + hp + s.off, s.n, s.type, s.stride, s.delta);
  // индексы: обратная дельта
  const d = A.idx, I = new Uint32Array(d.length);
  let prev = 0;
  for (let i = 0; i < d.length; i++) { const z = d[i]; prev += (z >>> 1) ^ -(z & 1); I[i] = prev; }
  A.idx = I;
  header.decals.forEach((g, k) => {
    const dd = A[`d${k}idx`]; const out = new Uint32Array(dd.length);
    for (let i = 0; i < dd.length; i++) out[i] = dd[i];
    A[`d${k}idx`] = out;
  });
  return { header, A };
}
