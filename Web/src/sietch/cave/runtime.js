// Загрузка запечённой пещеры (src/assets/sietch_cave.js): геометрия по чанкам, сетки пола/стен, зонды света, якоря.
import * as THREE from 'three';
import data, { HASH } from '../../assets/sietch_cave.js';
import { unpack, expandBits, octDec } from './pack.js';

export function loadCave() {
  const t0 = performance.now();
  const { header: H, A } = unpack(data);
  const NV = H.NV, q = H.quant;
  const pos = new Float32Array(NV * 3), nor = new Int8Array(NV * 3), nv = [0, 0, 0];
  for (let v = 0; v < NV; v++) {
    pos[v * 3] = q.o[0] + A.pos[v * 3] * q.s; pos[v * 3 + 1] = q.o[1] + A.pos[v * 3 + 1] * q.s; pos[v * 3 + 2] = q.o[2] + A.pos[v * 3 + 2] * q.s;
    octDec(A.nor, v, nv);
    nor[v * 3] = Math.round(nv[0] * 127); nor[v * 3 + 1] = Math.round(nv[1] * 127); nor[v * 3 + 2] = Math.round(nv[2] * 127);
  }
  const QB = H.qbits;
  A.tint = expandBits(A.tint, QB.tint); A.par = expandBits(A.par, QB.par); A.glow = expandBits(A.glow, QB.glow); A.probes = expandBits(A.probes, QB.probes);
  const aPos = new THREE.BufferAttribute(pos, 3), aNor = new THREE.BufferAttribute(nor, 3, true);
  const aTint = new THREE.BufferAttribute(A.tint, 4, true), aPar = new THREE.BufferAttribute(A.par, 4, true), aGlow = new THREE.BufferAttribute(A.glow, 4, true);
  const chunks = H.chunks.map((c) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', aPos); g.setAttribute('normal', aNor); g.setAttribute('aTint', aTint); g.setAttribute('aPar', aPar); g.setAttribute('aGlow', aGlow);
    g.setIndex(new THREE.BufferAttribute(A.idx.subarray(c.start, c.start + c.count), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(c.bs[0], c.bs[1], c.bs[2]), c.bs[3]);
    return g;
  });
  const chunkIndexByKey = new Map(H.chunks.map((c, i) => [c.key, i]));
  const CHUNK = 16;
  const DCELL = 32;   // декали режем на ячейки 32 м (меньше draw calls); видимость — по любому из покрытых чанков 16 м
  const cellKey = (x, y, z) => `${Math.floor(x / DCELL)},${Math.floor(y / DCELL)},${Math.floor(z / DCELL)}`;
  const decals = H.decals.map((d, i) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(A[`d${i}pos`], 3));
    g.setAttribute('normal', new THREE.BufferAttribute(A[`d${i}nor`], 3));
    g.setAttribute('uv', new THREE.BufferAttribute(A[`d${i}uv`], 2));
    g.setAttribute('aGlow', new THREE.BufferAttribute(A[`d${i}glow`], 3));
    const ao = A[`d${i}ao`], col = new Float32Array(ao.length * 3);
    for (let k = 0; k < ao.length; k++) { col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = ao[k]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPar', new THREE.BufferAttribute(new Float32Array(ao.length * 3), 3));
    g.setIndex(new THREE.BufferAttribute(A[`d${i}idx`], 1));
    g.computeBoundingSphere();
    // деление декалей по ячейкам 16 м (для frustum/PVS-отсечения): отдельные геометрии с общими атрибутами
    const I = g.index.array, P = A[`d${i}pos`], parts = new Map();
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const k = cellKey((P[a * 3] + P[b * 3] + P[c * 3]) / 3, (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3);
      let arr = parts.get(k); if (!arr) parts.set(k, arr = []);
      arr.push(a, b, c);
    }
    const pieces = [];
    for (const [k, arr] of parts) {
      const gg = new THREE.BufferGeometry();
      for (const name of Object.keys(g.attributes)) gg.setAttribute(name, g.attributes[name]);
      gg.setIndex(new THREE.BufferAttribute(new Uint32Array(arr), 1));
      gg.computeBoundingSphere(); gg.computeBoundingBox();
      pieces.push({ geometry: gg, bbox: gg.boundingBox });
    }
    return { tex: d.tex, count: d.count, layer: d.layer, geometry: g, pieces };
  });
  console.info(`[sietch] cave decode ${(performance.now() - t0).toFixed(0)} ms (hash ${HASH}), verts ${NV}, tris ${H.NI / 3}, chunks ${chunks.length}`);
  return { header: H, chunks, decals, grids: { f0: A.f0, f1: A.f1, w0: A.w0, w1: A.w1, grid: H.grid, noFloor: H.noFloor }, probes: { ...H.probes, data: A.probes }, globes: H.globes, anchors: H.anchors, hash: HASH,
    pvs: { ...H.pvs, idx: A.pvsIdx, bits: A.pvsBits }, chunkMeta: H.chunks, chunkIndexByKey, cellKey, CHUNK };
}
