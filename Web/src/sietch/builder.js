// Сборщик статической геометрии: примитивы → слияние по (материал, регион), запечённый тёплый свет (aGlow).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp } from '../core/util.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

function normalize(g) {
  if (!g.index) { const n = g.attributes.position.count; const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

/** Если нормаль первого треугольника смотрит против want — разворачивает все треугольники. */
export function orient(g, want) {
  const P = g.attributes.position, I = g.index.array;
  const ax = P.getX(I[0]), ay = P.getY(I[0]), az = P.getZ(I[0]);
  const bx = P.getX(I[1]) - ax, by = P.getY(I[1]) - ay, bz = P.getZ(I[1]) - az;
  const cx = P.getX(I[2]) - ax, cy = P.getY(I[2]) - ay, cz = P.getZ(I[2]) - az;
  const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
  if (nx * want[0] + ny * want[1] + nz * want[2] < 0) {
    for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
  }
  g.computeVertexNormals();
}

export class Builder {
  constructor() { this.groups = new Map(); this.region = 'B2'; }
  /** Добавить готовую геометрию (уже в локальных координатах). color — множитель альбедо; par = [полировка, копоть, раскачка]. */
  add(mat, geo, color = [1, 1, 1], par = [0, 0, 0]) {
    normalize(geo);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3), p = new Float32Array(n * 3);
    const P = geo.attributes.position;
    for (let i = 0; i < n; i++) {
      c[i * 3] = color[0]; c[i * 3 + 1] = color[1]; c[i * 3 + 2] = color[2];
      const pp = typeof par === 'function' ? par(P.getX(i), P.getY(i), P.getZ(i)) : par;
      p[i * 3] = pp[0]; p[i * 3 + 1] = pp[1]; p[i * 3 + 2] = pp[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geo.setAttribute('aPar', new THREE.BufferAttribute(p, 3));
    // группировка по (материал, регион, ячейка 32 м): меши отсекаются frustum/PVS (см. index.js: видны, если виден любой из покрытых чанков 16 м)
    geo.computeBoundingBox();
    const bb = geo.boundingBox, CS = 48;
    const cell = `${Math.floor((bb.min.x + bb.max.x) / 2 / CS)},${Math.floor((bb.min.y + bb.max.y) / 2 / CS)},${Math.floor((bb.min.z + bb.max.z) / 2 / CS)}`;
    const key = `${mat}@${cell}`;
    if (!this.groups.has(key)) this.groups.set(key, { mat, region: this.region, cell, list: [] });
    this.groups.get(key).list.push(geo);
    return geo;
  }
  /** Примитив с трансформом. o: {pos, rot:[x,y,z], scale, color, par}. */
  geo(mat, g, o = {}) {
    const pos = o.pos || [0, 0, 0], rot = o.rot || [0, 0, 0], sc = o.scale || [1, 1, 1];
    _e.set(rot[0], rot[1], rot[2], 'YXZ'); _q.setFromEuler(_e); _p.set(pos[0], pos[1], pos[2]); _s.set(sc[0], sc[1], sc[2]);
    _m.compose(_p, _q, _s); g.applyMatrix4(_m);
    return this.add(mat, g, o.color, o.par);
  }
  box(mat, pos, size, o = {}) { return this.geo(mat, new THREE.BoxGeometry(size[0], size[1], size[2]), { ...o, pos }); }
  cyl(mat, pos, rTop, rBot, h, seg = 12, o = {}) { return this.geo(mat, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!o.open), { ...o, pos }); }
  sphere(mat, pos, r, o = {}) { return this.geo(mat, new THREE.SphereGeometry(r, o.ws || 14, o.hs || 10), { ...o, pos }); }
  lathe(mat, pts, pos, seg = 16, o = {}) { return this.geo(mat, new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), seg), { ...o, pos }); }
  /** Прямоугольник из 4 точек (против часовой при взгляде с нормали), uv 0..1 (×uvScale). */
  quad(mat, a, b, c, d, o = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c, ...d]), 3));
    const u = o.uv || [0, 0, 1, 0, 1, 1, 0, 1];
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(u), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
    if (o.want) orient(g, o.want);
    return this.add(mat, g, o.color, o.par);
  }
  /** Сетка по параметрам (i,j) → точка; subdiv uN×vN; flip меняет сторону. */
  grid(mat, fn, un, vn, o = {}) {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= vn; j++) for (let i = 0; i <= un; i++) { const p = fn(i / un, j / vn); pos.push(p[0], p[1], p[2]); uv.push(i / un * (o.uvu || 1), j / vn * (o.uvv || 1)); }
    for (let j = 0; j < vn; j++) for (let i = 0; i < un; i++) {
      const a = j * (un + 1) + i, b = a + 1, c = a + un + 1, d = c + 1;
      if (o.flip) idx.push(a, b, d, a, d, c); else idx.push(a, d, b, a, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals();
    if (o.want) orient(g, o.want);
    return this.add(mat, g, o.color, o.par);
  }
  /** Набор «рельс» (рядов вершин одинаковой длины) → сетка. rails[j][i] = [x,y,z]. */
  rails(mat, rails, o = {}) {
    const R = rails.length, N = rails[0].length;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < N; i++) { const p = rails[j][i]; pos.push(p[0], p[1], p[2]); uv.push(i / (N - 1) * (o.uvu || 1), j / (R - 1) * (o.uvv || 1)); }
    for (let j = 0; j < R - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i, b = a + 1, c = a + N, d = c + 1; idx.push(a, b, d, a, d, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.computeVertexNormals();
    if (o.want) orient(g, o.want);
    return this.add(mat, g, o.color, o.par);
  }
  /** Плоскость с центром pos, нормалью вверх/вниз/в сторону: orient 'up'|'down'|'x+'|'x-'|'z+'|'z-'. */
  plane(mat, pos, w, h, orient = 'up', o = {}) {
    const g = new THREE.PlaneGeometry(w, h, o.sw || 1, o.sh || 1);
    const rot = { up: [-Math.PI / 2, 0, 0], down: [Math.PI / 2, 0, 0], 'z+': [0, 0, 0], 'z-': [0, Math.PI, 0], 'x+': [0, Math.PI / 2, 0], 'x-': [0, -Math.PI / 2, 0] }[orient];
    return this.geo(mat, g, { ...o, pos, rot });
  }
  /** Ящик-«ступень» с полировкой; удобный shorthand. */
  merged() {
    const out = [];
    for (const [key, grp] of this.groups) {
      const geo = mergeGeometries(grp.list, false);
      grp.list.forEach((g) => g.dispose());
      out.push({ key, mat: grp.mat, region: grp.region, cell: grp.cell, geo });
    }
    return out;
  }
}

/** Источники запечённого света. kind: 'omni' (светошар), 'spot' (колодец/луч вниз). region — id помещения. */
export function bakeGlow(geo, sources, regionAt, opts = {}) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const n = pos.count;
  const glow = new Float32Array(n * 3);
  const par = geo.attributes.aPar;
  const amb = opts.ambient ?? 0.0;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    const reg = regionAt(x, z, y);
    let r = amb * 1.0, g = amb * 0.62, b = amb * 0.3;
    for (let k = 0; k < sources.length; k++) {
      const s = sources[k];
      if (s.region !== reg && !(s.regions && s.regions.includes(reg))) continue;
      if (s.kind === 'spot') {
        if (y > s.y) continue;
        const h = Math.hypot(x - s.x, z - s.z);
        const cone = 1 - clamp((h - s.coneR * 0.5) / (s.coneR * 1.2), 0, 1);
        const lamb = ny > 0 ? 0.35 + 0.65 * ny : clamp((nx * (s.x - x) + nz * (s.z - z)) / (h + 1e-3), 0, 1) * 0.4;
        const w2 = s.intensity * cone * cone * lamb * clamp((s.y - y) / 2, 0, 1) * (1 - clamp((s.y - y) / s.fall, 0, 1) * 0.4);
        r += s.color[0] * w2; g += s.color[1] * w2; b += s.color[2] * w2;
        continue;
      }
      const dx = s.x - x, dy = s.y - y, dz = s.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const R = s.radius;
      if (d2 > R * R) continue;
      const d = Math.sqrt(d2) + 1e-4;
      let w = 1 / (1 + (d / s.d0) ** 2);
      w *= (1 - d / R) ** 1.5;
      const ndl = (nx * dx + ny * dy + nz * dz) / d;
      w *= clamp(ndl * 0.65 + 0.35, 0.05, 1);
      w *= s.intensity;
      r += s.color[0] * w; g += s.color[1] * w; b += s.color[2] * w;
    }
    // копоть и тёмные углы приглушают запечённый свет
    const soot = par ? par.getY(i) : 0;
    const k = 1 - soot * 0.5;
    glow[i * 3] = r * k; glow[i * 3 + 1] = g * k; glow[i * 3 + 2] = b * k;
  }
  geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 3));
}

/** Делит треугольники так, чтобы ребро ≤ maxEdge (для запекания света по вершинам). Работает по индексам. */
export function refine(geo, maxEdge) {
  const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, C = geo.attributes.color, A = geo.attributes.aPar;
  const pos = Array.from(P.array), nor = Array.from(N.array), uv = Array.from(U.array), col = C ? Array.from(C.array) : null, par = A ? Array.from(A.array) : null;
  let idx = Array.from(geo.index.array);
  const mid = new Map();
  const midpoint = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    let m = mid.get(key); if (m !== undefined) return m;
    m = pos.length / 3;
    for (let k = 0; k < 3; k++) { pos.push((pos[a * 3 + k] + pos[b * 3 + k]) / 2); nor.push((nor[a * 3 + k] + nor[b * 3 + k]) / 2); if (col) col.push((col[a * 3 + k] + col[b * 3 + k]) / 2); if (par) par.push((par[a * 3 + k] + par[b * 3 + k]) / 2); }
    uv.push((uv[a * 2] + uv[b * 2]) / 2, (uv[a * 2 + 1] + uv[b * 2 + 1]) / 2);
    mid.set(key, m); return m;
  };
  const len = (a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);
  for (let pass = 0; pass < 6; pass++) {
    const out = []; let changed = false;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const lab = len(a, b), lbc = len(b, c), lca = len(c, a);
      const mx = Math.max(lab, lbc, lca);
      if (mx <= maxEdge) { out.push(a, b, c); continue; }
      changed = true;
      if (mx === lab) { const m = midpoint(a, b); out.push(a, m, c, m, b, c); }
      else if (mx === lbc) { const m = midpoint(b, c); out.push(a, b, m, a, m, c); }
      else { const m = midpoint(c, a); out.push(a, b, m, m, b, c); }
    }
    idx = out; if (!changed) break;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (par) g.setAttribute('aPar', new THREE.Float32BufferAttribute(par, 3));
  g.setIndex(idx);
  return g;
}
