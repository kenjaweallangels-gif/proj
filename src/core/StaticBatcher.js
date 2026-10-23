import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Static batching for CPU rasterisers (the 'lite' preset).
 *
 * On a software WebGL implementation each draw call costs ~1-4 ms and instanced meshes are several times
 * slower per triangle than plain geometry, so a scene built from ~200 per-material meshes and instanced
 * parts is draw-call bound. This pass merges every mesh that never moves relative to its nearest moving
 * ancestor into one mesh per (anchor, material, render flags), baking instance matrices.
 *
 * Moving objects are found empirically: `simulate()` runs the scene's animation for a while and every
 * object whose local matrix, visibility or instance/attribute data changed is treated as dynamic. Objects
 * that only move on events (e.g. a hatch) must carry `userData.animated = true`; `userData.noBatch = true`
 * excludes a single mesh.
 *
 * `cell` (metres, optional) also splits batches into spatial cells so frustum culling keeps working.
 * `detailRadius` (metres): parts smaller than this go into separate 'detail' batches (cells of `detailCell`),
 * flagged `userData.detail`, so the caller can hide them beyond some distance. With `splitIslands`, meshes that
 * were already merged at build time are split into connected parts first, so their small parts count as details.
 * Returns { before, after } draw-call counts for the processed subtree.
 */
export function batchStatic(root, simulate, { cell = 0, mergeMaterials = false, detailRadius = 0, detailCell = 24, splitIslands = false } = {}) {
  const objs = [];
  root.traverse((o) => objs.push(o));
  const sig = (o) => {
    o.updateMatrix();
    let s = o.matrix.elements.join(',') + (o.visible ? '|v' : '|h');
    if (o.isInstancedMesh) s += `|${o.count}|${o.instanceMatrix.version}|${o.instanceColor ? o.instanceColor.version : -1}`;
    if (o.isMesh && o.geometry) for (const k in o.geometry.attributes) s += `|${k}${o.geometry.attributes[k].version}`;
    return s;
  };
  const mats = new Set();
  for (const o of objs) for (const m of [].concat(o.material || [])) mats.add(m);
  const msig = (m) => [m.version, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.opacity, m.visible, m.map?.uuid].join('|');
  const beforeM = new Map([...mats].map((m) => [m, msig(m)]));
  const before = new Map(objs.map((o) => [o, sig(o)]));
  simulate();
  const dynamic = new Set();
  for (const o of objs) if (o.userData.animated || before.get(o) !== sig(o)) dynamic.add(o);
  const animatedMat = new Set([...mats].filter((m) => beforeM.get(m) !== msig(m)));
  // materials that can share one batch: plain Lambert, no glow, not animated; colour goes to vertex colours
  const plain = (m) => mergeMaterials && m.isMeshLambertMaterial && !animatedMat.has(m) && !m.emissiveMap
    && (m.emissiveIntensity === 0 || (m.emissive.r + m.emissive.g + m.emissive.b) === 0);
  const plainKey = (m) => ['plain', m.map ? m.map.uuid : '-', m.side, m.transparent, m.opacity.toFixed(3), m.alphaTest, m.depthWrite, m.depthTest,
    m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.blending, m.toneMapped, m.colorWrite].join('|');
  const plainMats = new Map();
  const plainMaterial = (m) => {
    const k = plainKey(m);
    if (!plainMats.has(k)) {
      const L = new THREE.MeshLambertMaterial({ name: `merged:${m.map ? (m.name || 'map') : 'flat'}`, map: m.map, vertexColors: true, side: m.side, transparent: m.transparent, opacity: m.opacity,
        alphaTest: m.alphaTest, depthWrite: m.depthWrite, depthTest: m.depthTest, polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor,
        polygonOffsetUnits: m.polygonOffsetUnits, blending: m.blending, toneMapped: m.toneMapped, colorWrite: m.colorWrite });
      L.forceSinglePass = !!m.forceSinglePass;
      plainMats.set(k, L);
    }
    return plainMats.get(k);
  };

  // nearest dynamic ancestor (or root) of each candidate mesh
  const anchorOf = (o) => { let p = o.parent; while (p && p !== root && !dynamic.has(p)) p = p.parent; return p || root; };
  const isCandidate = (o) => o.isMesh && !o.isSkinnedMesh && !dynamic.has(o) && !o.userData.noBatch && o.visible
    && !Array.isArray(o.material) && o.material && !o.morphTargetInfluences
    && o.onBeforeRender === THREE.Object3D.prototype.onBeforeRender
    && !(o.isInstancedMesh && o.instanceColor) && o.geometry && o.geometry.attributes.position;
  // (geometry groups are irrelevant with a single material: e.g. CylinderGeometry always has 3)
  // a mesh hidden by a static ancestor stays hidden: skip it entirely
  const shown = (o) => { let p = o; while (p && p !== root) { if (!p.visible) return false; p = p.parent; } return true; };

  const buckets = new Map();
  let drawBefore = 0;
  root.traverse((o) => { if (o.isMesh && shown(o)) drawBefore++; });
  root.updateMatrixWorld(true);
  const _inv = new THREE.Matrix4(), _rel = new THREE.Matrix4(), _inst = new THREE.Matrix4(), _mi = new THREE.Matrix4();
  const _c = new THREE.Vector3();
  const _sc = new THREE.Vector3();
  const cellKey = (m, geo) => {
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    _c.copy(geo.boundingSphere.center).applyMatrix4(m);
    const r = geo.boundingSphere.radius * Math.max(..._sc.setFromMatrixScale(m).toArray());
    const detail = detailRadius > 0 && r < detailRadius;
    const size = detail ? detailCell : cell;
    if (!size) return detail ? 'd' : '';
    return `${detail ? 'd' : 'c'}${Math.floor(_c.x / size)},${Math.floor(_c.y / size)},${Math.floor(_c.z / size)}`;
  };
  const batched = new Set();
  for (const o of objs) {
    if (!isCandidate(o) || !shown(o)) continue;
    const anchor = anchorOf(o);
    const m = o.material;
    const merge = plain(m);
    const color = merge || !!m.vertexColors;
    const bm = merge ? plainMaterial(m) : m;
    const tint = merge ? m.color.clone() : null;
    const baseKey = [anchor.uuid, merge ? plainKey(m) : m.uuid, o.castShadow, o.receiveShadow, o.renderOrder, o.layers.mask, o.frustumCulled, color].join('|');
    _inv.copy(anchor.matrixWorld).invert();
    _rel.multiplyMatrices(_inv, o.matrixWorld);
    const bucket = (ck) => {
      const key = baseKey + '|' + ck;
      if (!buckets.has(key)) buckets.set(key, { anchor, material: bm, color, src: o, entries: [], detail: ck[0] === 'd' });
      return buckets.get(key);
    };
    const add = (mat, inst) => bucket(cellKey(mat, o.geometry)).entries.push({ o, matrix: mat.clone(), inst, tint });
    if (o.isInstancedMesh) { for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, _inst); add(_mi.multiplyMatrices(_rel, _inst), true); } continue; }
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    const bigEnough = splitIslands && detailRadius > 0 && o.geometry.boundingSphere.radius * _sc.setFromMatrixScale(_rel).x > detailRadius;
    if (!bigEnough) { add(_rel, false); continue; }
    // pre-merged mesh: split into connected parts and bucket each part by its own size / position
    const g = normalise(o.geometry, color).applyMatrix4(_rel);
    for (const part of splitByIslands(g, (center, radius) => {
      const detail = radius < detailRadius, size = detail ? detailCell : cell;
      return size ? `${detail ? 'd' : 'c'}${Math.floor(center.x / size)},${Math.floor(center.y / size)},${Math.floor(center.z / size)}` : (detail ? 'd' : '');
    })) bucket(part.key).entries.push({ o, geo: part.geo, tint });
  }

  let merged = 0;
  const normCache = new Map();
  for (const b of buckets.values()) {
    if (b.entries.length < 2 && !b.entries[0].inst && !b.entries[0].tint && !b.entries[0].geo) continue;   // a lone mesh: nothing to gain
    const geos = [];
    for (const e of b.entries) {
      let g;
      if (e.geo) g = e.geo;
      else {
        let base = normCache.get(e.o.geometry.uuid + b.color);
        if (!base) { base = normalise(e.o.geometry, b.color); normCache.set(e.o.geometry.uuid + b.color, base); }
        g = base.clone().applyMatrix4(e.matrix);
      }
      if (e.tint) { const c = g.attributes.color; for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * e.tint.r, c.getY(i) * e.tint.g, c.getZ(i) * e.tint.b); }
      geos.push(g);
    }
    const geo = mergeGeometries(geos, false);
    if (!geo) continue;
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, b.material);
    const s = b.src;
    mesh.name = `batch:${b.material.name || b.material.type}`;
    mesh.castShadow = s.castShadow; mesh.receiveShadow = s.receiveShadow; mesh.renderOrder = s.renderOrder;
    mesh.layers.mask = s.layers.mask; mesh.frustumCulled = s.frustumCulled;
    if (b.detail) mesh.userData.detail = true;
    b.anchor.add(mesh);
    for (const e of b.entries) batched.add(e.o);
    merged++;
  }
  for (const o of batched) o.removeFromParent();
  let drawAfter = 0;
  root.traverse((o) => { if (o.isMesh && shown(o)) drawAfter++; });
  return { before: drawBefore, after: drawAfter, batches: merged };
}

/** Indexed copy with exactly position/normal/uv (+color) so heterogeneous geometries can be merged. */
function normalise(g, wantColor) {
  const out = new THREE.BufferGeometry();
  const pos = g.attributes.position;
  const n = pos.count;
  out.setAttribute('position', pos.clone());
  if (g.attributes.normal) out.setAttribute('normal', g.attributes.normal.clone());
  else { out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); }
  out.setAttribute('uv', g.attributes.uv && g.attributes.uv.itemSize === 2 ? g.attributes.uv.clone() : new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (wantColor) {
    const c = g.attributes.color;
    if (c && c.itemSize === 3) out.setAttribute('color', c.clone());
    else if (c && c.itemSize === 4) { const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.getX(i); a[i * 3 + 1] = c.getY(i); a[i * 3 + 2] = c.getZ(i); } out.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
    else out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }
  // interleaved / normalized / non-float attributes: de-interleave into plain Float32 arrays
  for (const k of Object.keys(out.attributes)) {
    const a = out.attributes[k];
    if (a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array) || a.normalized) {
      const arr = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) arr[i * a.itemSize + j] = a.getComponent ? a.getComponent(i, j) : [a.getX, a.getY, a.getZ, a.getW][j].call(a, i);
      out.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize));
    }
  }
  if (g.index) out.setIndex(Array.from(g.index.array));
  else { const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; out.setIndex(new THREE.BufferAttribute(idx, 1)); }
  if (!g.attributes.normal) out.computeVertexNormals();
  return out;
}

/**
 * Pack transparent canvas-texture decals (text labels) under `root` into one atlas texture so they can
 * be batched into a single draw. Each decal keeps its mesh; its UVs are remapped into the atlas.
 */
export function atlasDecals(root, { cellWidth = 512, atlasWidth = 2048 } = {}) {
  const list = [];
  root.traverse((o) => {
    const m = o.material;
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(m) || !m || !m.transparent || !m.map || !m.map.image) return;
    const img = m.map.image;
    if (!(typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement)) return;
    const uv = o.geometry.attributes.uv;
    if (!uv) return;
    for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); if (u < -1e-4 || u > 1.0001 || v < -1e-4 || v > 1.0001) return; }
    list.push(o);
  });
  if (list.length < 2) return 0;
  // shelf packing at a fixed width per decal (aspect preserved)
  const rects = new Map(); let x = 0, y = 0, rowH = 0;
  const images = [...new Set(list.map((o) => o.material.map.image))];
  for (const img of images) {
    const w = Math.min(cellWidth, atlasWidth), h = Math.max(8, Math.round(w * img.height / img.width));
    if (x + w > atlasWidth) { x = 0; y += rowH; rowH = 0; }
    rects.set(img, { x, y, w, h }); x += w; rowH = Math.max(rowH, h);
  }
  const H = THREE.MathUtils.ceilPowerOfTwo(y + rowH);
  const canvas = document.createElement('canvas'); canvas.width = atlasWidth; canvas.height = H;
  const g = canvas.getContext('2d');
  for (const [img, r] of rects) g.drawImage(img, r.x, r.y, r.w, r.h);
  const src = list[0].material.map;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = src.colorSpace; tex.anisotropy = src.anisotropy; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const shared = new Map();
  for (const o of list) {
    const m = o.material, r = rects.get(m.map.image);
    const key = [m.side, m.depthWrite, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.opacity, m.color.getHex(), m.type].join('|');
    if (!shared.has(key)) { const am = m.clone(); am.map = tex; am.name = 'decalAtlas'; shared.set(key, am); }
    const geo = o.geometry.clone();
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      // CanvasTexture is flipped (v = 1 at the top row): map into the atlas rectangle
      const u = uv.getX(i), v = uv.getY(i);
      uv.setXY(i, (r.x + u * r.w) / atlasWidth, 1 - (r.y + (1 - v) * r.h) / H);
    }
    o.geometry = geo;
    o.material = shared.get(key);
  }
  return list.length;
}

/**
 * Split an indexed geometry into connected parts (vertices welded by position, so the faces of a box or
 * the caps of a cylinder stay with their part) and group the parts by `keyOf(center, radius)`.
 * Returns [{ key, geo }] with one compacted geometry per key.
 */
function splitByIslands(g, keyOf) {
  const pos = g.attributes.position, n = pos.count, idx = g.index.array;
  // weld by quantised position
  const parent = new Int32Array(n); for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const weld = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
    const j = weld.get(k); if (j === undefined) weld.set(k, i); else unite(i, j);
  }
  for (let t = 0; t < idx.length; t += 3) { unite(idx[t], idx[t + 1]); unite(idx[t], idx[t + 2]); }
  // bounds per island
  const box = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i); let b = box.get(r);
    if (!b) { b = new THREE.Box3(); box.set(r, b); }
    b.expandByPoint(_p.fromBufferAttribute(pos, i));
  }
  const keyOfRoot = new Map(), _ctr = new THREE.Vector3();
  for (const [r, b] of box) { b.getCenter(_ctr); keyOfRoot.set(r, keyOf(_ctr, b.getSize(_p).length() * 0.5)); }
  // triangles per key
  const tris = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const k = keyOfRoot.get(find(idx[t]));
    let l = tris.get(k); if (!l) { l = []; tris.set(k, l); }
    l.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  const out = [];
  for (const [key, list] of tris) {
    const remap = new Map(); const newIdx = new Uint32Array(list.length);
    for (let i = 0; i < list.length; i++) { let v = remap.get(list[i]); if (v === undefined) { v = remap.size; remap.set(list[i], v); } newIdx[i] = v; }
    const geo = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name], sz = a.itemSize, arr = new Float32Array(remap.size * sz);
      for (const [o, nv] of remap) for (let c = 0; c < sz; c++) arr[nv * sz + c] = a.array[o * sz + c];
      geo.setAttribute(name, new THREE.BufferAttribute(arr, sz));
    }
    geo.setIndex(new THREE.BufferAttribute(newIdx, 1));
    out.push({ key, geo });
  }
  return out;
}
const _p = new THREE.Vector3();
