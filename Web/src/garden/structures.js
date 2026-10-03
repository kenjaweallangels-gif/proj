// Рукотворное в саду: каменные желоба (qanat-подобные), чаша-распределитель, пруд, грядки с каменной кромкой, площадь у устья,
// каркас входа (косяки, перемычка, ступени), башни-ветроловушки на гребне с капающей конденсацией, носик перелива цистерны.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { chunkyBox } from '../desert/rock.js';
import { createLevelRockMaterial } from '../level/rockmat.js';
import { markMaterial } from '../level/marks.js';
import { rng, clamp, smoothstep } from '../core/util.js';
import { fogPatch, makePlantMaterial } from './plants.js';
import { adobeTexture, flagstoneTexture, soilTexture, waterNormalTexture, louverTexture } from './textures.js';
import { C, FLOOR_Y, MOUTH, CHANNELS, BASIN, POND, SPOUT, BEDS, PLAZA, windtrapSites, ringIn } from './layout.js';
import { WALL } from './ground.js';

const V3 = THREE.Vector3;

/** UV по мировым координатам (доминирующая ось нормали), plain для статичных каменных мешей. */
function worldUV(geo, scale = 0.5) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
function bakeColor(geo, c) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
}
function boxGeo(cx, cy, cz, sx, sy, sz, yaw = 0, col = [1, 1, 1]) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.rotateY(yaw); g.translate(cx, cy, cz);
  bakeColor(g, col);
  return g;
}
function finalize(list, mat, name, shadow = true) {
  if (!list.length) return null;
  const g = mergeGeometries(list.map((x) => { const c = x.index ? x.toNonIndexed() : x; return c; }), false);
  g.computeVertexNormals?.();
  worldUV(g, 0.5);
  const m = new THREE.Mesh(g, mat);
  m.name = name; m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = true;
  for (const x of list) x.dispose();
  return m;
}

export function createStructures(game, { ground, rim, root, quality }) {
  const R = rng(5150);
  const shadows = quality !== 'low';
  const out = { colliders: [], drips: [], water: [], meshes: [], interactables: [] };
  const add = (m) => { if (m) { root.add(m); out.meshes.push(m); } return m; };
  const col = (shape) => { const id = game.colliders?.add({ owner: 'garden', ...shape }); if (id) out.colliders.push(id); return id; };

  // ---------------- материалы ----------------
  const stoneTex = adobeTexture(); stoneTex.repeat.set(1, 1);
  const stoneMat = fogPatch(new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.93, color: 0xf0e0c6, vertexColors: true }), 'gd-stone');
  const stonePlain = fogPatch(new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.93, color: 0xf0e0c6 }), 'gd-stone-plain');
  const flagTex = flagstoneTexture();
  const flagMat = fogPatch(new THREE.MeshStandardMaterial({ map: flagTex, roughness: 0.9, color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 'gd-flag');
  const soilTex = soilTexture();
  const soilMat = fogPatch(new THREE.MeshStandardMaterial({ map: soilTex, roughness: 1, color: 0xd0c0b0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 'gd-soil');
  const wnorm = waterNormalTexture(); wnorm.repeat.set(1, 1);
  const waterMat = fogPatch(new THREE.MeshStandardMaterial({ color: 0x2f6c6a, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.88, normalMap: wnorm, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 2.2 }), 'gd-water');
  const rockMat = createLevelRockMaterial({ band: 5.5, sand: 0.3 });
  const louverTex = louverTexture(); louverTex.wrapS = THREE.RepeatWrapping; louverTex.repeat.set(4, 1);
  const towerMat = fogPatch(new THREE.MeshStandardMaterial({ map: louverTex, roughness: 0.95, color: 0xffffff }), 'gd-tower');
  out.waterNormal = wnorm;
  const snorm = wnorm.clone(); snorm.needsUpdate = true;          // отдельное смещение для падающей струи

  // ---------------- желоба ----------------
  function channelMeshes(ch, { wall = WALL.channelT, wh = WALL.channel, waterY = 0.17 } = {}) {
    // дискретизация ломаной (0.5 м)
    const S = [];
    let s = 0;
    for (let i = 0; i < ch.pts.length - 1; i++) {
      const [ax, az] = ch.pts[i], [bx, bz] = ch.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 0.5));
      for (let k = (i ? 1 : 0); k <= n; k++) { const t = k / n; S.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s: s + len * t }); }
      s += len;
    }
    for (let i = 0; i < S.length; i++) {
      const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      S[i].tx = tx; S[i].tz = tz; S[i].y = ch.yFn ? ch.yFn(S[i], i, S.length) : ground(S[i].x, S[i].z);
    }
    // стенки: плавно, чтобы лоток не «дрожал» на микрорельефе
    if (ch.yFn) for (let pass = 0; pass < 2; pass++) for (let i = 1; i < S.length - 1; i++) S[i].y = (S[i - 1].y + S[i].y * 2 + S[i + 1].y) / 4;
    const half = ch.w / 2;
    const P = [], N = [], U = [], I = [], Cc = [];
    const push = (x, y, z, nx, ny, nz, u, v) => { P.push(x, y, z); N.push(nx, ny, nz); U.push(u, v); return P.length / 3 - 1; };
    const rings = S.map((q) => {
      const nx = -q.tz, nz = q.tx;
      const f = (lat, dy) => [q.x + nx * lat, q.y + dy, q.z + nz * lat];
      return { oL: f(half + wall, -0.08), tOL: f(half + wall, wh), tIL: f(half, wh), bIL: f(half, 0.0), bIR: f(-half, 0.0), tIR: f(-half, wh), tOR: f(-half - wall, wh), oR: f(-half - wall, -0.08), nx, nz };
    });
    const strip = (a, b, nxFn) => {
      for (let i = 0; i < S.length - 1; i++) {
        const A = rings[i], B = rings[i + 1];
        const [n0x, n0y, n0z] = nxFn(A), [n1x, n1y, n1z] = nxFn(B);
        const a0 = push(...A[a], n0x, n0y, n0z, S[i].s, 0), a1 = push(...A[b], n0x, n0y, n0z, S[i].s, 1);
        const b0 = push(...B[a], n1x, n1y, n1z, S[i + 1].s, 0), b1 = push(...B[b], n1x, n1y, n1z, S[i + 1].s, 1);
        I.push(a0, b0, b1, a0, b1, a1);
      }
    };
    // стороны: нормали наружу
    strip('oL', 'tOL', (r) => [r.nx, 0, r.nz]);        // внешняя левая
    strip('tOL', 'tIL', () => [0, 1, 0]);               // верх левой
    strip('tIL', 'bIL', (r) => [-r.nx, 0, -r.nz]);      // внутренняя левая
    strip('bIL', 'bIR', () => [0, 1, 0]);               // дно
    strip('bIR', 'tIR', (r) => [r.nx, 0, r.nz]);        // внутренняя правая
    strip('tIR', 'tOR', () => [0, 1, 0]);               // верх правой
    strip('tOR', 'oR', (r) => [-r.nx, 0, -r.nz]);       // внешняя правая
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U.map((v, i) => (i % 2 ? v * 1.2 : v * 0.7)), 2));
    g.setIndex(I);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(P.length).fill(1), 3));
    const stone = new THREE.Mesh(g, stoneMat);
    stone.castShadow = shadows; stone.receiveShadow = true; stone.name = `Channel_${ch.id}`;
    // вода
    const WP = [], WN = [], WU = [], WI = [];
    S.forEach((q, i) => {
      const nx = -q.tz, nz = q.tx;
      for (const sg of [1, -1]) { WP.push(q.x + nx * half * sg * 0.98, q.y + waterY, q.z + nz * half * sg * 0.98); WN.push(0, 1, 0); WU.push(q.s * 0.7, sg > 0 ? 0 : 0.5); }
      if (i < S.length - 1) { const a = i * 2; WI.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    });
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(WP, 3)); wg.setAttribute('normal', new THREE.Float32BufferAttribute(WN, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(WU, 2)); wg.setIndex(WI);
    const water = new THREE.Mesh(wg, waterMat); water.name = `Water_${ch.id}`; water.renderOrder = 2; water.receiveShadow = true;
    return { stone, water, samples: S };
  }
  out.channelSamples = {};
  for (const ch of CHANNELS) {
    const m = channelMeshes(ch);
    add(m.stone); add(m.water); out.water.push(m.water); out.channelSamples[ch.id] = m.samples;
  }

  // ---------------- влажная земля вдоль желобов (тёмные мягкие полосы) ----------------
  {
    const wetMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    fogPatch(wetMat, 'gd-wet');
    const P = [], N = [], Cc = [], I = [];
    const prof = [[-2.6, 0], [-1.6, 0.35], [-0.7, 0.75], [0.7, 0.75], [1.6, 0.35], [2.6, 0]];
    for (const ch of CHANNELS) {
      const S = out.channelSamples[ch.id]; if (!S) continue;
      const base0 = P.length / 3;
      S.forEach((q) => {
        const nx = -q.tz, nz = q.tx;
        for (const [lat, a] of prof) {
          const x = q.x + nx * lat, z = q.z + nz * lat;
          P.push(x, ground(x, z) + 0.012, z); N.push(0, 1, 0); Cc.push(0.2, 0.15, 0.1, a * 0.85);
        }
      });
      for (let i = 0; i < S.length - 1; i++) for (let k = 0; k < prof.length - 1; k++) {
        const a = base0 + i * prof.length + k, b = a + 1, c = a + prof.length, d = c + 1;
        I.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 4)); g.setIndex(I);
    const m = new THREE.Mesh(g, wetMat); m.name = 'WetSoil'; m.renderOrder = 1; m.receiveShadow = true; add(m);
  }

  // ---------------- чаша-распределитель и пруд ----------------
  {
    const list = [];
    const { x, z, w, d } = BASIN, y = ground(x, z), wh = 0.6, t = 0.34;
    list.push(boxGeo(x, y + wh / 2 - 0.05, z - d / 2 - t / 2, w + 2 * t, wh + 0.1, t));
    list.push(boxGeo(x, y + wh / 2 - 0.05, z + d / 2 + t / 2, w + 2 * t, wh + 0.1, t));
    list.push(boxGeo(x - w / 2 - t / 2, y + wh / 2 - 0.05, z, t, wh + 0.1, d));
    list.push(boxGeo(x + w / 2 + t / 2, y + wh / 2 - 0.05, z, t, wh + 0.1, d));
    list.push(boxGeo(x, y + 0.03, z, w, 0.12, d));
    add(finalize(list, stoneMat, 'Basin'));
    const wg = new THREE.PlaneGeometry(w, d); wg.rotateX(-Math.PI / 2); wg.translate(x, y + 0.42, z);
    const wm = new THREE.Mesh(wg, waterMat); wm.renderOrder = 2; add(wm); out.water.push(wm);
    col({ type: 'box', c: new V3(x, y + 0.3, z), half: new V3(w / 2 + t, 0.3, d / 2 + t), yaw: 0, tags: new Set(['basin']) });
    out.drips.push({ x: x - w / 2 - 0.4, y: y + 0.6, z, h: 0.18 });
  }
  {
    // пруд: котлован (в сетке пола), каменная кромка-галька по берегу + вода на уровне «берег − 12 см»
    const { x, z, rx, rz } = POND, yShore = ground(x + rx + 2.2, z), yWater = yShore - 0.12;
    const list = [];
    const n = 40;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, wob = 1 + 0.08 * Math.sin(a * 3 + 1) + 0.04 * Math.sin(a * 7);
      const px = x + Math.cos(a) * (rx + 0.3) * wob, pz = z + Math.sin(a) * (rz + 0.3) * wob;
      const s = 0.5 + R() * 0.35;
      list.push(boxGeo(px, ground(px, pz) + 0.02, pz, s, 0.2 + R() * 0.12, s * 0.8, a + R(), [0.8 + R() * 0.3, 0.8 + R() * 0.3, 0.8 + R() * 0.3]));
    }
    add(finalize(list, stoneMat, 'PondRim'));
    const shape = new THREE.CircleGeometry(1, 40); shape.rotateX(-Math.PI / 2);
    const pm = new THREE.Mesh(shape, waterMat); pm.scale.set(rx + 0.45, 1, rz + 0.45); pm.position.set(x, yWater, z); pm.renderOrder = 2; add(pm); out.water.push(pm);
    out.pond = { x, z, rx, rz, y: yWater };
  }

  // ---------------- грядки: почва + низкая каменная кромка (перешагивается; высоты — из WALL, как в физике) ----------------
  // Кромка — лента, повторяющая землю (верх = G + WALL.bed), поэтому видимая стенка и «ступенька» в heightAt совпадают.
  function lowWall(x0, z0, x1, z1, t, top = WALL.bed, bottom = 0.14) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 0.5));
    const dx = (x1 - x0) / len, dz = (z1 - z0) / len, nx = -dz, nz = dx;
    const P = [], I = [], U = [], N = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f, y = ground(x, z);
      for (const sg of [-1, 1]) { const px = x + nx * sg * t / 2, pz = z + nz * sg * t / 2; P.push(px, y + top, pz, px, y - bottom, pz); U.push(f * len * 0.5, sg > 0 ? 1 : 0, f * len * 0.5, sg > 0 ? 0.6 : 0.4); }
    }
    // индексы: на сечение 4 вершины: [L top, L bottom, R top, R bottom]
    for (let i = 0; i < n; i++) {
      const a = i * 4, b = a + 4;
      I.push(a, b, b + 2, a, b + 2, a + 2);              // верх
      I.push(a + 1, b + 1, b, a + 1, b, a);              // левая сторона
      I.push(a + 2, b + 2, b + 3, a + 2, b + 3, a + 3);  // правая сторона
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I);
    const ng = g.toNonIndexed(); ng.computeVertexNormals();
    // ориентация: верхние грани должны смотреть вверх — иначе переворачиваем все треугольники ленты
    {
      const pa = ng.attributes.position, na = ng.attributes.normal;
      let up = 0, dn = 0; for (let i = 0; i < na.count; i += 3) { const y = na.getY(i); if (y > 0.9) up++; else if (y < -0.9) dn++; }
      if (dn > up) { for (let i = 0; i < pa.count; i += 3) { const x = pa.getX(i + 1), y = pa.getY(i + 1), z = pa.getZ(i + 1); pa.setXYZ(i + 1, pa.getX(i + 2), pa.getY(i + 2), pa.getZ(i + 2)); pa.setXYZ(i + 2, x, y, z); } ng.computeVertexNormals(); }
    }
    bakeColor(ng, [0.92 + R() * 0.1, 0.9 + R() * 0.1, 0.86 + R() * 0.1]);
    return ng;
  }
  {
    const list = [], soilGeos = [];
    for (const b of BEDS) {
      const g = new THREE.PlaneGeometry(b.hx * 2, b.hz * 2, Math.round(b.hx * 2), Math.round(b.hz * 2)); g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, ground(b.x + p.getX(i), b.z + p.getZ(i)) + WALL.bedSoil);
      g.translate(b.x, 0, b.z);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * b.hx * 0.6, uv.getY(i) * b.hz * 0.6);
      soilGeos.push(g);
      const t = WALL.bedT;
      list.push(lowWall(b.x - b.hx - t, b.z - b.hz - t / 2, b.x + b.hx + t, b.z - b.hz - t / 2, t));
      list.push(lowWall(b.x - b.hx - t, b.z + b.hz + t / 2, b.x + b.hx + t, b.z + b.hz + t / 2, t));
      list.push(lowWall(b.x - b.hx - t / 2, b.z - b.hz, b.x - b.hx - t / 2, b.z + b.hz, t));
      list.push(lowWall(b.x + b.hx + t / 2, b.z - b.hz, b.x + b.hx + t / 2, b.z + b.hz, t));
    }
    const wm = mergeGeometries(list.map((g) => g.index ? g.toNonIndexed() : g)); wm.computeVertexNormals();
    worldUV(wm, 0.5);
    const wmesh = new THREE.Mesh(wm, stoneMat); wmesh.name = 'BedWalls'; wmesh.castShadow = shadows; wmesh.receiveShadow = true; add(wmesh);
    const sg = mergeGeometries(soilGeos.map((g) => g.toNonIndexed())); sg.computeVertexNormals();
    const sm = new THREE.Mesh(sg, soilMat); sm.receiveShadow = true; sm.name = 'BedSoil'; add(sm);
  }

  // ---------------- площадь у устья ----------------
  {
    const cells = [], step = 0.5;
    const P = [], N = [], U = [], I = [];
    const inside = (x, z) => { const dx = (x - PLAZA.x) / PLAZA.r, dz = (z - PLAZA.z) / (PLAZA.r * 0.85); const a = Math.atan2(dz, dx); return Math.hypot(dx, dz) < 1 + 0.06 * Math.sin(a * 5) + 0.04 * Math.sin(a * 11); };
    for (let x = PLAZA.x - PLAZA.r - 1; x < PLAZA.x + PLAZA.r + 1; x += step) for (let z = PLAZA.z - PLAZA.r; z < PLAZA.z + PLAZA.r; z += step) {
      if (!inside(x + step / 2, z + step / 2) || x < MOUTH.x + 0.58 * (z - MOUTH.z) + 1.6) continue;
      const k = P.length / 3;
      for (const [dx, dz] of [[0, 0], [step, 0], [step, step], [0, step]]) { const px = x + dx, pz = z + dz; P.push(px, ground(px, pz) + 0.012, pz); N.push(0, 1, 0); U.push(px * 0.45, pz * 0.45); }
      I.push(k, k + 2, k + 1, k, k + 3, k + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I);
    const m = new THREE.Mesh(g, flagMat); m.receiveShadow = true; m.name = 'Plaza'; add(m);
  }

  // ---------------- носик перелива цистерны ----------------
  {
    const sy = ground(SPOUT.x + 1.5, SPOUT.z) + 0.95;
    const g = chunkyBox(0.5, 0.35, 1.6, 3, 41, 0); g.translate(SPOUT.x - 0.1, sy + 0.1, SPOUT.z);
    const m = new THREE.Mesh(g, rockMat); m.castShadow = shadows; m.receiveShadow = true; root.add(m); out.meshes.push(m);
    // струя падает в чашу у стены
    const sx = SPOUT.x + 0.75;
    const poolY = ground(sx + 1.6, SPOUT.z);
    const list = [];
    list.push(boxGeo(sx + 1.0, poolY + 0.05, SPOUT.z, 2.6, 0.15, 2.1));
    list.push(boxGeo(sx + 1.0, poolY + 0.28, SPOUT.z - 1.15, 2.9, 0.5, 0.3));
    list.push(boxGeo(sx + 1.0, poolY + 0.28, SPOUT.z + 1.15, 2.9, 0.5, 0.3));
    list.push(boxGeo(sx + 2.5, poolY + 0.28, SPOUT.z - 0.8, 0.3, 0.5, 0.7)); list.push(boxGeo(sx + 2.5, poolY + 0.28, SPOUT.z + 0.8, 0.3, 0.5, 0.7));
    add(finalize(list, stoneMat, 'SpoutPool'));
    const wg = new THREE.PlaneGeometry(2.5, 2.0); wg.rotateX(-Math.PI / 2); wg.translate(sx + 1.0, poolY + 0.3, SPOUT.z);
    const wm = new THREE.Mesh(wg, waterMat); wm.renderOrder = 2; add(wm); out.water.push(wm);
    // сама струя — две перекрёстные ленты с бегущей нормалью
    const sMat = new THREE.MeshStandardMaterial({ color: 0xcfe8ee, roughness: 0.1, transparent: true, opacity: 0.55, normalMap: snorm, normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide, depthWrite: false });
    fogPatch(sMat, 'gd-stream');
    const hFall = sy - poolY - 0.2;
    const stream = new THREE.Group();
    for (const a of [0, Math.PI / 2]) { const pg = new THREE.PlaneGeometry(0.22, hFall, 1, 6); const mm = new THREE.Mesh(pg, sMat); mm.rotation.y = a; stream.add(mm); }
    stream.position.set(sx, poolY + 0.2 + hFall / 2, SPOUT.z); stream.renderOrder = 3; root.add(stream);
    out.stream = { mat: sMat, tex: snorm };
    out.drips.push({ x: sx, y: sy - 0.1, z: SPOUT.z + 0.35, h: sy - poolY - 0.3 });
    col({ type: 'box', c: new V3(sx + 1.0, poolY + 0.3, SPOUT.z), half: new V3(1.5, 0.3, 1.2), yaw: 0, tags: new Set(['basin']) });
  }

  // ---------------- башни-ветроловушки на северном гребне + желоба вниз ----------------
  out.towers = [];
  const sites = windtrapSites();
  const crestY = (th) => rim.crestAt(th);
  sites.forEach((s, ti) => {
    const th = s.th, y0 = Math.max(rim.surf(s.x, s.z), 1) - 0.2;
    const group = new THREE.Group(); group.position.set(s.x, y0, s.z); group.rotation.y = -th + Math.PI / 4 * 0 + (ti - 1) * 0.12;
    // цоколь
    const plinth = new THREE.Mesh(chunkyBox(4.6, 1.0, 4.6, 3, 70 + ti, 0.05), rockMat); plinth.position.y = 0.4; plinth.castShadow = shadows; plinth.receiveShadow = true; group.add(plinth);
    // ствол: усечённая пирамида (4 граней) с щелями-жалюзи
    const H = 9.4;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 2.1, H, 4, 1, false), towerMat); shaft.rotation.y = Math.PI / 4; shaft.position.y = 0.9 + H / 2; shaft.castShadow = shadows; shaft.receiveShadow = true; group.add(shaft);
    // карниз/парапет и крестовина-флюгер
    const cap = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.5, 3.3), stonePlain); cap.position.y = 0.9 + H + 0.2; cap.castShadow = shadows; group.add(cap);
    const merl = [];
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) merl.push(boxGeo(dx, 0.9 + H + 0.75, dz, 0.55, 0.7, 0.55));
    const mm = finalize(merl, stoneMat, 'Merlons'); if (mm) group.add(mm);
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.8, 0.1), stonePlain); vane.position.y = 0.9 + H + 1.5; group.add(vane);
    const vane2 = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.08), stonePlain); vane2.position.y = 0.9 + H + 1.9; group.add(vane2);
    const vane3 = vane2.clone(); vane3.rotation.y = Math.PI / 2; group.add(vane3);
    root.add(group); out.meshes.push(group);
    out.towers.push({ x: s.x, y: y0, z: s.z, group, vane: [vane2, vane3] });
    col({ type: 'box', c: new V3(s.x, y0 + 5, s.z), half: new V3(2.2, 5.5, 2.2), yaw: -th + (ti - 1) * 0.12, tags: new Set(['windtrap']) });
    // желоб-«qanat» вниз по внутренней стороне гребня до дна, и далее к северному каналу
    const foot = ringIn(th) - 0.8;
    const pts = [];
    const dirx = -Math.cos(th), dirz = -Math.sin(th);          // к центру котловины
    const rTop = Math.hypot(s.x - C.x, s.z - C.z) - 2.4;
    for (let r = rTop; r >= foot - 0.5; r -= 1.2) {
      const x = C.x + Math.cos(th) * r, z = C.z + Math.sin(th) * r;
      pts.push([x, z]);
    }
    // продолжение по дну к началу северного канала
    const nStart = CHANNELS.find((c) => c.id === 'north').pts[0];
    const fx0 = C.x + Math.cos(th) * (foot - 0.5), fz0 = C.z + Math.sin(th) * (foot - 0.5);
    const k = 6;
    for (let i = 1; i <= k; i++) pts.push([fx0 + (nStart[0] - fx0) * (i / k), fz0 + (nStart[1] - fz0) * (i / k)]);
    const ch = { id: `qanat${ti}`, pts, w: 0.4, yFn: (q) => { const rr = Math.hypot(q.x - C.x, q.z - C.z); return rr > foot - 0.3 ? Math.max(rim.surf(q.x, q.z), ground(q.x, q.z)) + 0.08 : ground(q.x, q.z); } };
    const cm = channelMeshes(ch, { wall: 0.12, wh: 0.28, waterY: 0.14 });
    add(cm.stone); add(cm.water); out.water.push(cm.water);
    // конденсация капает с карниза и из желоба у основания башни
    out.drips.push({ x: s.x + Math.cos(th) * 0.2 - Math.sin(th) * 1.0, y: y0 + 2.4, z: s.z + Math.sin(th) * 0.2 + Math.cos(th) * 1.0, h: 1.8 });
    out.drips.push({ x: s.x - Math.sin(th) * -1.0, y: y0 + 2.4, z: s.z + Math.cos(th) * -1.0, h: 1.8 });
  });

  // ---------------- капли и круги на воде ----------------
  {
    const dGeo = new THREE.SphereGeometry(0.035, 6, 5); dGeo.scale(1, 1.6, 1);
    const dMat = new THREE.MeshStandardMaterial({ color: 0xd8f0f4, roughness: 0.1, transparent: true, opacity: 0.85, emissive: 0x335566, emissiveIntensity: 0.25 }); fogPatch(dMat, 'gd-drop');
    const maxN = out.drips.length;
    const drops = new THREE.InstancedMesh(dGeo, dMat, Math.max(1, maxN * 2));
    drops.frustumCulled = false; drops.count = 0; root.add(drops);
    const rGeo = new THREE.RingGeometry(0.06, 0.09, 14); rGeo.rotateX(-Math.PI / 2);
    const rMat = new THREE.MeshBasicMaterial({ color: 0xe4f4f6, transparent: true, opacity: 0.6, depthWrite: false }); rMat.fog = false;
    const rings = new THREE.InstancedMesh(rGeo, rMat, Math.max(1, maxN * 2));
    rings.frustumCulled = false; rings.count = 0; root.add(rings);
    out.dropState = out.drips.map((d, i) => ({ ...d, t: R() * 3, period: 0.9 + R() * 1.6, fall: 0, ring: -1, gy: 0 }));
    out.dropsMesh = drops; out.ringsMesh = rings;
  }
  // ---------------- фонари: ночью светятся (эмиссия + ореол; без реальных источников — не пересобирают шейдеры сцены) ----------------
  {
    const spots = [[806.3, 391.2], [806.3, 401.4], [821.5, 392.2], [836.4, 404.6], [856.0, 401.3], [876.4, 395.4], [877.0, 404.2], [846.6, 394.6]];
    const post = [], glass = [];
    for (const [x, z] of spots) {
      const y = ground(x, z);
      post.push(boxGeo(x, y + 0.9, z, 0.12, 1.8, 0.12, 0, [0.35, 0.27, 0.2]));
      post.push(boxGeo(x, y + 1.82, z, 0.3, 0.05, 0.3, 0, [0.3, 0.23, 0.17]));
      glass.push([x, y + 1.62, z]);
    }
    add(finalize(post, stoneMat, 'LampPosts'));
    const lg = new THREE.BoxGeometry(0.2, 0.3, 0.2);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.4 }); fogPatch(lampMat, 'gd-lamp');
    const lamps = new THREE.InstancedMesh(lg, lampMat, glass.length);
    const m4 = new THREE.Matrix4();
    glass.forEach((q, i) => { m4.makeTranslation(q[0], q[1], q[2]); lamps.setMatrixAt(i, m4); });
    lamps.frustumCulled = false; root.add(lamps); out.meshes.push(lamps);
    const hg = new THREE.PlaneGeometry(1.6, 1.6);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, map: (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,200,120,1)'); gr.addColorStop(0.35, 'rgba(255,160,70,0.35)'); gr.addColorStop(1, 'rgba(255,120,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })() });
    haloMat.fog = false;
    const halos = new THREE.InstancedMesh(hg, haloMat, glass.length);
    glass.forEach((q, i) => { m4.makeTranslation(q[0], q[1], q[2]); halos.setMatrixAt(i, m4); });
    halos.frustumCulled = false; halos.renderOrder = 5; root.add(halos); out.meshes.push(halos);
    out.lamps = { mat: lampMat, halo: haloMat, mesh: halos, pos: glass, k: 0 };
  }
  out.update = (dt, t, camPos) => {
    // течение: смещаем текстуру нормали (общая на всех водах)
    // вода течёт по ходу желоба (u растёт вдоль течения): узор сдвигается к большим u, значит смещение уменьшаем
    wnorm.offset.x = (wnorm.offset.x - dt * 0.16 + 1) % 1; wnorm.offset.y = (wnorm.offset.y + dt * 0.02) % 1;
    if (out.stream) out.stream.tex.offset.y = (out.stream.tex.offset.y - dt * 1.4) % 1;
    for (const tw of out.towers) { tw.vane[0].rotation.y += dt * 0.35; tw.vane[1].rotation.y += dt * 0.35; }
    if (out.lamps) {
      const se = game.weather?.sunElev;
      const k = se === undefined ? 0 : 1 - smoothstep(-3, 7, se);
      if (Math.abs(k - out.lamps.k) > 0.004) {
        out.lamps.k = k; out.lamps.mat.emissiveIntensity = 3.2 * k; out.lamps.halo.opacity = 0.75 * k; out.lamps.mesh.visible = k > 0.01;
      }
      if (out.lamps.mesh.visible) {
        // ореолы смотрят в камеру
        const mm = new THREE.Matrix4(), qq = new THREE.Quaternion().copy(game.camera.quaternion), pp = new V3(), sc = new V3(1, 1, 1);
        out.lamps.pos.forEach((q, i) => { mm.compose(pp.set(q[0], q[1], q[2]), qq, sc); out.lamps.mesh.setMatrixAt(i, mm); });
        out.lamps.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    // капли
    const m4 = new THREE.Matrix4(), p = new V3(), q = new THREE.Quaternion(), sc = new V3(1, 1, 1), scR = new V3(1, 1, 1);
    let nd = 0, nr = 0;
    for (const e of out.dropState) {
      e.t += dt;
      if (e.fall <= 0 && e.t > e.period) { e.fall = 0.0001; e.t = 0; e.period = 0.7 + R() * 1.8; }
      if (e.fall > 0) {
        e.fall += dt;
        const dy = 0.5 * 9.8 * e.fall * e.fall;
        if (dy >= e.h) { e.fall = 0; e.ring = 0; } else if (camPos.distanceToSquared(p.set(e.x, e.y, e.z)) < 90 * 90) { m4.compose(p.set(e.x, e.y - dy, e.z), q, sc); out.dropsMesh.setMatrixAt(nd++, m4); }
      }
      if (e.ring >= 0) {
        e.ring += dt * 1.7;
        if (e.ring > 1) e.ring = -1;
        else if (camPos.distanceToSquared(p.set(e.x, e.y - e.h, e.z)) < 60 * 60) { const s = 0.5 + e.ring * 3.2; m4.compose(p.set(e.x, e.y - e.h + 0.02, e.z), q, scR.set(s, 1, s)); out.ringsMesh.setMatrixAt(nr++, m4); }
      }
    }
    out.dropsMesh.count = nd; out.dropsMesh.instanceMatrix.needsUpdate = true;
    out.ringsMesh.count = nr; out.ringsMesh.instanceMatrix.needsUpdate = true;
    out.ringsMesh.material.opacity = 0.55;
  };
  return out;
}
