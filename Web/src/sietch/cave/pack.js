// Упаковка/распаковка запечённой пещеры: типизированные массивы → один буфер → zlib → base64 (в сборке — модуль-строка).
import { zlibSync, unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import { GRID, BOUNDS } from './consts.js';

const QS = 0.005;
const TYPES = { u8: Uint8Array, i8: Int8Array, u16: Uint16Array, i16: Int16Array, i32: Int32Array, f32: Float32Array };
const typeOf = (a) => (a instanceof Uint8Array ? 'u8' : a instanceof Int8Array ? 'i8' : a instanceof Uint16Array ? 'u16' : a instanceof Int16Array ? 'i16' : a instanceof Int32Array ? 'i32' : 'f32');

export function pack(baked) {
  const { mesh, att, chunks, grids, probes, decals } = baked;
  const NV = mesh.positions.length / 3;
  const o = [BOUNDS.min[0] - 1, BOUNDS.min[1] - 1, BOUNDS.min[2] - 1];
  const pos = new Uint16Array(NV * 3), nor = new Int8Array(NV * 4);
  for (let v = 0; v < NV; v++) {
    for (let c = 0; c < 3; c++) { pos[v * 3 + c] = Math.round((mesh.positions[v * 3 + c] - o[c]) / QS); nor[v * 4 + c] = Math.round(mesh.normals[v * 3 + c] * 127); }
  }
  // индексы: дельта + zigzag
  const I = mesh.indices, d = new Int32Array(I.length);
  let prev = 0;
  for (let i = 0; i < I.length; i++) { const dv = I[i] - prev; d[i] = (dv << 1) ^ (dv >> 31); prev = I[i]; }
  const sections = [
    ['pos', pos], ['nor', nor], ['tint', att.col], ['par', att.par], ['glow', att.glow], ['idx', d],
    ['f0', grids.f0], ['f1', grids.f1], ['w0', grids.w0], ['w1', grids.w1], ['probes', probes.data],
  ];
  const decalHdr = [];
  decals.forEach((g, i) => {
    sections.push([`d${i}pos`, g.positions], [`d${i}nor`, g.normals], [`d${i}uv`, g.uvs], [`d${i}glow`, g.glow], [`d${i}ao`, g.ao], [`d${i}idx`, g.indices.length ? new Int32Array(g.indices) : new Int32Array(0)]);
    decalHdr.push({ tex: g.tex, count: g.count, layer: g.layer, nv: g.positions.length / 3, ni: g.indices.length });
  });
  const header = {
    version: 1, NV, NI: I.length, quant: { o, s: QS }, bounds: BOUNDS, cell: baked.cell, chunks: chunks.list,
    grid: GRID, noFloor: grids.NOFLOOR, probes: { ox: probes.ox, oy: probes.oy, oz: probes.oz, h: probes.h, nx: probes.nx, ny: probes.ny, nz: probes.nz },
    globes: baked.globes, anchors: baked.anchors, decals: decalHdr, bakeMs: baked.bakeMs, sections: [],
  };
  // раскладка секций
  let off = 0;
  for (const [name, arr] of sections) {
    off = (off + 3) & ~3;
    header.sections.push({ name, type: typeOf(arr), n: arr.length, off });
    off += arr.byteLength;
  }
  const hj = new TextEncoder().encode(JSON.stringify(header));
  const hl = (hj.length + 3) & ~3;
  const total = 4 + hl + off;
  const buf = new Uint8Array(total);
  new DataView(buf.buffer).setUint32(0, hj.length, true);
  buf.set(hj, 4);
  header.sections.forEach((s, i) => { const a = sections[i][1]; buf.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), 4 + hl + s.off); });
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
  for (const s of header.sections) {
    const T = TYPES[s.type];
    const start = raw.byteOffset + 4 + hp + s.off;
    A[s.name] = new T(raw.buffer.slice(start, start + s.n * T.BYTES_PER_ELEMENT));
  }
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
