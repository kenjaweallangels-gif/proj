// Декор (инстансинг): валуны и галька у скалы, острова, плиты A3, рёбра червя, стойка тамперов.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, noise2, smoothstep, clamp, lerp } from '../core/util.js';
import { SAFE_ISLANDS, A3_PLATES, clawCenter, clawHalfWidth, GOLDEN_PATH } from '../core/layout.js';
import { heightAt, solidSdf, plateQuery } from './field.js';
import { createRockMaterial, createPropMaterial } from './rockMaterial.js';

export function boulderGeo(seed, detail = 3) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise2(x * 1.3 + seed, y * 1.3 + z * 0.9) * 0.28 + noise2(z * 2.9 + seed * 3, x * 2.7 + y) * 0.1;
    const s = 1 + n;
    x *= s; y *= s * 0.78; z *= s * 1.06;
    // плоский низ и «сколы»
    if (y < -0.45) y = -0.45 + (y + 0.45) * 0.15;
    p.setXYZ(i, x, y, z);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const merged = mergeVertices(g, 1e-3);
  merged.computeVertexNormals();
  return merged;
}

/** Угловатый обломок породы (плита/блок/клин): подразбитый куб со сколотыми рёбрами и смещением по нормали; низ плоский. kind: 'block' | 'slab' | 'wedge'. */
export function rockChunkGeo(seed, kind = 'block', seg = 3) {
  let g = new THREE.BoxGeometry(1, 1, 1, seg, seg, seg);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const p = g.getAttribute('position');
  const sy = kind === 'slab' ? 0.38 : kind === 'wedge' ? 0.8 : 0.75;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(x) * 2, ay = Math.abs(y) * 2, az = Math.abs(z) * 2;
    const corner = Math.max(0, ax + ay + az - 1.9);            // сколы углов: вершины у рёбер втягиваются
    const k = 1 - 0.22 * corner;
    x *= k; y *= k; z *= k;
    const n = noise2(x * 2.1 + seed, y * 1.9 + z * 2.3) * 0.16 + noise2(z * 5.3 + seed * 3, x * 4.7 + y * 3.9) * 0.06;
    x += x * n * 2; z += z * n * 2; y += y * n * 1.2;
    if (kind === 'wedge') { const t = y + 0.5; x *= 1 - 0.55 * t; z *= 1 - 0.25 * t; }
    y = y * sy * 2 * 0.5 * (kind === 'slab' ? 1 : 1.3);
    if (y < -sy * 0.45) y = -sy * 0.45;                         // плоская подошва
    p.setXYZ(i, x * (1.0 + 0.25 * noise2(seed, i * 0.01)), y, z);
  }
  g.computeVertexNormals();
  return g;
}

function scatter(mesh, items) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  items.forEach((it, i) => {
    e.set(it.rx || 0, it.ry || 0, it.rz || 0); q.setFromEuler(e);
    s.set(it.sx, it.sy, it.sz); p.set(it.x, it.y, it.z);
    m.compose(p, q, s); mesh.setMatrixAt(i, m);
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
}

export function createDressing(game, world) {
  const { scene } = game;
  const q = game.settings.quality;
  const shadows = q !== 'low';
  const R = rng(777);
  const group = new THREE.Group();
  scene.add(group);
  const boulderMat = createRockMaterial({ band: 0.9, sand: 0.8, tex: 'rock_desert', texScale: 2.2, quality: q });
  const obstacles = (x, z, r) => world.addObstacle(x, z, r);

  // ---------- валуны ----------
  const variants = [rockChunkGeo(1.1, 'block'), rockChunkGeo(5.7, 'slab'), rockChunkGeo(9.3, 'wedge')];
  const lists = [[], [], []];
  const pebbleList = [];
  const addBoulder = (x, z, size, flat = 1) => {
    const v = Math.floor(R() * 3);
    const y = heightAt(x, z);
    lists[v].push({ x, y: y + size * 0.12, z, sx: size * (0.8 + R() * 0.5), sy: size * (0.6 + R() * 0.5) * flat, sz: size * (0.8 + R() * 0.5), ry: R() * 6.28, rx: (R() - 0.5) * 0.3, rz: (R() - 0.5) * 0.3 });
    if (size > 1.3) obstacles(x, z, size * 0.85);
  };
  const nB = q === 'low' ? 0.5 : 1;
  // осыпь у подножия скалы
  for (let i = 0; i < 230 * nB; i++) {
    const t = -0.96 + 1.92 * R();
    const [cx, cz] = clawCenter(t);
    const w = clawHalfWidth(t);
    const west = R() < 0.75 ? 1 : -1;
    const d = Math.pow(R(), 2.1) * 70 + 1;       // осыпь густеет у подножия и редеет к эргу
    const e = 0.004;
    const [ax, az] = clawCenter(t - e), [bx, bz] = clawCenter(t + e);
    let tx = bx - ax, tz = bz - az; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    const x = cx + (-tz) * west * (w + d), z = cz + tx * west * (w + d);
    if (solidSdf(x, z) < 1.5) continue;
    if (x > 596 && x < 660 && Math.abs(z - 326) < 14) continue;
    const size = lerp(5.0, 0.5, Math.min(1, d / 75)) * (0.35 + R() * 0.9);
    addBoulder(x, z, size);
  }
  // вокруг входа в расщелину — осыпь крупнее
  for (let i = 0; i < 18; i++) {
    const x = 575 + R() * 45, z = 326 + (R() - 0.5) * 70;
    if (Math.abs(z - 326) < 12 && x > 596) continue;
    addBoulder(x, z, 0.6 + R() * 2.2);
  }
  // острова: кольцо камней
  SAFE_ISLANDS.forEach((s) => {
    // остров — выход породы: несколько глыб вплотную к кромке, а не «рассыпанные по эргу» камни
    const n = 3 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, r = s.r * (0.6 + R() * 0.4);
      addBoulder(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, 0.5 + R() * 1.1);
    }
    addBoulder(s.x + (R() - 0.5) * 2, s.z + (R() - 0.5) * 2, s.r * 0.22 + 0.5, 0.8);
  });
  // плиты A3: торчащие обломки
  A3_PLATES.forEach((p) => {
    for (let i = 0; i < 2; i++) {
      const lx = (R() - 0.5) * 2 * p.w * 0.9, lz = (R() - 0.5) * 2 * p.d * 0.9;
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      addBoulder(p.x + lx * c - lz * s, p.z + lx * s + lz * c, 0.4 + R() * 0.8, 0.5);
    }
  });
  const bMeshes = variants.map((g, i) => {
    const m = new THREE.InstancedMesh(g, boulderMat, Math.max(1, lists[i].length));
    scatter(m, lists[i]);
    m.castShadow = shadows; m.receiveShadow = shadows; m.frustumCulled = false;
    group.add(m); return m;
  });

  // галька: только там, где её приносит геология — осыпь у подножия Когтя и кромки каменных островов.
  // Открытый эрг и плиты A3 — чистый песок (ветер выдувает и погребает мелочь).
  const pebGeo = rockChunkGeo(3.3, 'block', 1);
  const pebs = [];
  const nP = Math.round((q === 'low' ? 150 : q === 'med' ? 700 : 1300));
  for (let i = 0; i < nP; i++) {
    let x, z;
    if (R() < 0.8) { // у скалы: плотнее к подножию (talus)
      const t = -0.95 + 1.9 * R();
      const [cx, cz] = clawCenter(t); const w = clawHalfWidth(t);
      const d = Math.pow(R(), 2.0) * 60 + 3;
      x = cx - (w + d); z = cz + (R() - 0.5) * 20;
    } else {
      const s = SAFE_ISLANDS[Math.floor(R() * SAFE_ISLANDS.length)];
      const a = R() * 6.28, r = s.r * (0.7 + R() * 0.6);
      x = s.x + Math.cos(a) * r; z = s.z + Math.sin(a) * r;
    }
    if (solidSdf(x, z) < 0.5) continue;
    const s = 0.05 + R() * R() * 0.2;
    pebs.push({ x, y: heightAt(x, z) + s * 0.1, z, sx: s * (0.8 + R() * 0.6), sy: s * (0.5 + R() * 0.5), sz: s * (0.8 + R() * 0.6), ry: R() * 6.28 });
  }
  const pebMesh = new THREE.InstancedMesh(pebGeo, boulderMat, pebs.length);
  scatter(pebMesh, pebs);
  pebMesh.frustumCulled = false; pebMesh.receiveShadow = shadows;
  group.add(pebMesh);

  // ---------- рёбра мёртвого червя ----------
  const ribs = makeRibs(R);
  const rx = 432, rz = 118;
  ribs.position.set(rx, 0, rz);
  ribs.rotation.y = -0.5;
  group.add(ribs);
  ribs.updateMatrixWorld(true);
  ribs.children.forEach((rib) => {
    const wp = new THREE.Vector3(); rib.getWorldPosition(wp);
    rib.position.y = heightAt(wp.x, wp.z) - 1.3;
    for (const f of rib.userData.feet) {
      const fp = rib.localToWorld(new THREE.Vector3(f, 0, 0));
      obstacles(fp.x, fp.z, 1.7);
    }
  });
  ribs.traverse((o) => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; o.material.userData.baseYU && (o.material.userData.baseYU.value = heightAt(rx, rz)); } });

  // ---------- стойка тамперов у расщелины ----------
  const rack = makeThumperRack();
  const kx = 607, kz = 312;
  rack.position.set(kx, heightAt(kx, kz), kz);
  rack.rotation.y = 0.35;
  rack.traverse((o) => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; } });
  group.add(rack);
  obstacles(kx, kz, 1.4);

  return {
    group, setVisible(b) { group.visible = b; },
    ribs, rack,
  };
}

// ---------------- рёбра червя ----------------
function makeRibs(R) {
  const root = new THREE.Group();
  const mat = createPropMaterial({ color: 0xd8ccb4, roughness: 0.88, metalness: 0, sand: 0.8, vertexColors: false });
  const mats = [mat];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const H = 8 + 9 * Math.sin(Math.PI * (0.12 + 0.76 * u)) + (R() - 0.5) * 2;   // высота арки
    const Wd = 5.5 + 4 * Math.sin(Math.PI * (0.12 + 0.76 * u));                   // полупролёт
    const broken = (i === 2 || i === 6) ? 0.55 + 0.2 * R() : 1;
    const curve = new THREE.CatmullRomCurve3(
      Array.from({ length: 18 }, (_, k) => {
        const a = (k / 17) * Math.PI * broken;
        return new THREE.Vector3(Math.cos(a) * Wd, Math.sin(a) * H - 1.2, 0);
      }));
    const tube = new THREE.TubeGeometry(curve, 40, 0.9, 10, false);
    // сужение к концам и бугристость
    const pos = tube.getAttribute('position');
    const rs = 11;
    for (let a = 0; a <= 40; a++) {
      const c = curve.getPointAt(a / 40);
      const taper = 0.55 + 0.7 * Math.sin(Math.PI * (0.1 + 0.8 * a / 40)) ;
      for (let b = 0; b < rs; b++) {
        const k = a * rs + b;
        const px = pos.getX(k) - c.x, py = pos.getY(k) - c.y, pz = pos.getZ(k) - c.z;
        const bump = 1 + 0.12 * noise2(a * 0.4 + i * 3, b * 0.9);
        pos.setXYZ(k, c.x + px * taper * bump * 1.25, c.y + py * taper * bump * 1.25, c.z + pz * taper * bump * 1.9);
      }
    }
    tube.computeVertexNormals();
    const m = new THREE.Mesh(tube, mat);
    const rib = new THREE.Group();
    rib.add(m);
    rib.position.set(0, 0, (i - (N - 1) / 2) * 7.4);
    rib.rotation.y = (R() - 0.5) * 0.12;
    rib.userData.span = Wd; rib.userData.feet = [-Wd, Wd];
    // стороны арки лежат вдоль локальной оси x
    root.add(rib);
  }
  root.userData.mats = mats;
  return root;
}

// ---------------- стойка тамперов ----------------
function makeThumperRack() {
  const g = new THREE.Group();
  const wood = createPropMaterial({ color: 0x6b5340, roughness: 0.9, sand: 0.5 });
  const metal = createPropMaterial({ color: 0x4a4540, roughness: 0.55, metalness: 0.6, sand: 0.3, key: 'm' });
  const post = (x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.2, 0.16), wood); m.position.set(x, 1.1, z); g.add(m); };
  post(-1.3, 0); post(1.3, 0);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.12, 0.12), wood); bar.position.set(0, 1.9, 0); g.add(bar);
  const bar2 = bar.clone(); bar2.position.y = 0.8; g.add(bar2);
  for (let i = 0; i < 5; i++) {
    const t = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 1.5, 8), metal); rod.position.y = 0.0; t.add(rod);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.28, 8), metal); tip.position.y = -0.88; tip.rotation.x = Math.PI; t.add(tip);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), metal); cap.position.y = 0.78; t.add(cap);
    const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10), metal); coil.position.y = 0.4; t.add(coil);
    t.position.set(-1.0 + i * 0.5, 1.35, 0.18 + (i % 2) * 0.05);
    t.rotation.z = (i - 2) * 0.03; t.rotation.x = -0.08;
    g.add(t);
  }
  // уже воткнутый тампер рядом
  const t2 = new THREE.Group();
  const r2 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 1.5, 8), metal); r2.position.y = 0.55; t2.add(r2);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), metal); c2.position.y = 1.32; t2.add(c2);
  t2.position.set(2.1, 0, 1.0); t2.rotation.z = 0.14; g.add(t2);
  return g;
}
