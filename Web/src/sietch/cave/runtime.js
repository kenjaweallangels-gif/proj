// Загрузка запечённой пещеры (src/assets/sietch_cave.js): геометрия по чанкам, сетки пола/стен, зонды света, якоря.
import * as THREE from 'three';
import data, { HASH } from '../../assets/sietch_cave.js';
import { unpack } from './pack.js';

export function loadCave() {
  const t0 = performance.now();
  const { header: H, A } = unpack(data);
  const NV = H.NV, q = H.quant;
  const pos = new Float32Array(NV * 3), nor = new Int8Array(NV * 3);
  for (let v = 0; v < NV; v++) {
    pos[v * 3] = q.o[0] + A.pos[v * 3] * q.s; pos[v * 3 + 1] = q.o[1] + A.pos[v * 3 + 1] * q.s; pos[v * 3 + 2] = q.o[2] + A.pos[v * 3 + 2] * q.s;
    nor[v * 3] = A.nor[v * 4]; nor[v * 3 + 1] = A.nor[v * 4 + 1]; nor[v * 3 + 2] = A.nor[v * 4 + 2];
  }
  const aPos = new THREE.BufferAttribute(pos, 3), aNor = new THREE.BufferAttribute(nor, 3, true);
  const aTint = new THREE.BufferAttribute(A.tint, 4, true), aPar = new THREE.BufferAttribute(A.par, 4, true), aGlow = new THREE.BufferAttribute(A.glow, 4, true);
  const chunks = H.chunks.map((c) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', aPos); g.setAttribute('normal', aNor); g.setAttribute('aTint', aTint); g.setAttribute('aPar', aPar); g.setAttribute('aGlow', aGlow);
    g.setIndex(new THREE.BufferAttribute(A.idx.subarray(c.start, c.start + c.count), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(c.bs[0], c.bs[1], c.bs[2]), c.bs[3]);
    return g;
  });
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
    return { tex: d.tex, count: d.count, layer: d.layer, geometry: g };
  });
  console.info(`[sietch] cave decode ${(performance.now() - t0).toFixed(0)} ms (hash ${HASH}), verts ${NV}, tris ${H.NI / 3}, chunks ${chunks.length}`);
  return { header: H, chunks, decals, grids: { f0: A.f0, f1: A.f1, w0: A.w0, w1: A.w1, grid: H.grid, noFloor: H.noFloor }, probes: { ...H.probes, data: A.probes }, globes: H.globes, anchors: H.anchors, hash: HASH };
}
