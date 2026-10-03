// Подход к скрытому входу сиетча: тропа по западной грани Когтя (осыпь, полки, валуны, арка, узкая полка над обрывом,
// щель между плавником и стеной, ниша-вход). Модуль game.approach. См. README.md.
//
// Геометрия — SDF-скульптура (level/scene.js) → surface nets → один меш в материале Когтя. Высота/коллизия берутся из той же сетки,
// поэтому всё, что видно, — ходимо или твёрдо. Игрок — шагающий по карте высот, поэтому heightAt(x,z,yФ) выбирает поверхность
// не выше ступней+1.1 м (проходы под арками и ярусы).
import * as THREE from 'three';
import { ENTRY, ROCK } from '../core/layout.js';
import { smoothstep, lerp, rng, clamp } from '../core/util.js';
import { buildClawGeometry } from '../desert/rock.js';
import { buildWallTable } from './wall.js';
import { createApproachScene, ZONE } from './scene.js';
import { createLevelRockMaterial, geometryFromMesh } from './rockmat.js';
import { markMaterial } from './marks.js';
import { makeHeightAt, makeCollide } from './physics.js';

const V3 = THREE.Vector3;

export function create(game) {
  const world = game.world;
  if (!world) { console.warn('[approach] нет game.world'); return null; }
  const { scene, bus } = game;
  const quality = game.settings?.quality || 'med';
  const shadows = quality !== 'low';
  const R = rng(9021);
  const t0 = performance.now();

  // ---------- исходная земля (до обёрток) ----------
  const prevHeight = world.heightAt.bind(world);
  const prevSurface = world.surfaceAt?.bind(world);
  const prevCollide = world.collide.bind(world);
  const bx0 = ZONE.x0 - 4, bz0 = ZONE.z0 - 4, bn = Math.ceil(ZONE.x1 - ZONE.x0) + 9, bm = Math.ceil(ZONE.z1 - ZONE.z0) + 9;
  const bg = new Float32Array(bn * bm);
  for (let k = 0; k < bm; k++) for (let i = 0; i < bn; i++) bg[i + bn * k] = prevHeight(bx0 + i, bz0 + k);
  const base = (x, z) => {
    const fx = clamp(x - bx0, 0, bn - 1.001), fz = clamp(z - bz0, 0, bm - 1.001);
    const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k, o = i + bn * k;
    return (bg[o] * (1 - u) + bg[o + 1] * u) * (1 - v) + (bg[o + bn] * (1 - u) + bg[o + bn + 1] * u) * v;
  };

  // ---------- сцена и сетка ----------
  let clawGeo = null;
  scene.traverse((o) => { if (!clawGeo && o.isMesh && o.material?.customProgramCacheKey?.() === 'rk-rock' && o.geometry?.boundingSphere?.radius > 150) clawGeo = o.geometry; });
  const wallX = buildWallTable(() => clawGeo || buildClawGeometry(quality), { z0: ZONE.z0, z1: ZONE.z1, yMax: ZONE.y1 }, quality);
  const S = createApproachScene({ base, wallX, quality });
  const vol = S.build();
  const NOTCH_X_MAX = 652.4;       // дальше — внутренность сиетча (его коллизия/меш)
  const nz = ENTRY.cleft.z;

  // обрезка граней: под ландшафтом и «лицо стены» (оно совпадает с мешем Когтя)
  const wxPlane = (z, y) => wallX(z, y) - 0.55;
  const cull = (x0, y0, z0, x1, y1, z1, x2, y2, z2, nxv, nyv, nzv) => {
    const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, cz = (z0 + z1 + z2) / 3;
    // под землёй
    if (y0 < base(x0, z0) + 0.07 && y1 < base(x1, z1) + 0.07 && y2 < base(x2, z2) + 0.07) return true;
    // за входом (внутри скалы) — сиетч рисует свой интерьер
    if (cx > NOTCH_X_MAX && Math.abs(cz - nz) < 6 && cy > 24 && cy < 40) return true;
    // «лицо» массы стены: совпадает с Когтем
    if (nxv < -0.55) {
      const dd = Math.hypot(cx - NOTCH_X_MAX, cz - nz);
      const w0 = wxPlane(z0, y0), w1 = wxPlane(z1, y1), w2 = wxPlane(z2, y2);
      if (Math.abs(x0 - w0) < 0.4 && Math.abs(x1 - w1) < 0.4 && Math.abs(x2 - w2) < 0.4 && Math.hypot(cz - nz, (cy - 32) * 0.7) > 6.5) return true;
    }
    return false;
  };
  const mark = (x, y, z, nxv, nyv, nzv, out) => {
    const pd = S.pathDist(x, z);
    let worn = 0;
    if (nyv > 0.7 && Math.abs(y - pd.yp) < 0.55) worn = 1 - smoothstep(0.0, 1.1, pd.d);
    if (pd.leg && pd.leg.slot) worn *= 0.8;
    const drift = nyv > 0.6 ? clamp(0.5 * (0.5 + 0.5 * Math.sin(x * 0.9 + z * 0.7 + y)) * smoothstep(0.7, 1.0, nyv) * 0.6, 0, 1) : 0;
    out[0] = worn; out[1] = drift;
  };
  const msh = vol.mesh({ cull, mark });
  const geo = geometryFromMesh(msh);
  const rockMat = createLevelRockMaterial();
  const rock = new THREE.Mesh(geo, rockMat);
  rock.name = 'ApproachRock';
  rock.castShadow = shadows; rock.receiveShadow = shadows;
  rock.frustumCulled = true;
  const root = new THREE.Group(); root.name = 'Approach';
  root.add(rock);
  scene.add(root);

  // ---------- вспомогательное: поверхность и нормаль ----------
  const _g = [0, 0, 0];
  /** Найти грань, идя от (x,y,z) по горизонтальному направлению (dx,dz) до нуля SDF. → {p: Vector3, n: Vector3} | null */
  function findFace(x, y, z, dx, dz, maxD = 6) {
    let prev = vol.sample(x, y, z);
    for (let t = 0.1; t <= maxD; t += 0.1) {
      const d = vol.sample(x + dx * t, y, z + dz * t);
      if (d < 0 && prev >= 0) {
        // уточнить
        let a = t - 0.1, b = t;
        for (let k = 0; k < 6; k++) { const m = (a + b) / 2; if (vol.sample(x + dx * m, y, z + dz * m) < 0) b = m; else a = m; }
        const px = x + dx * b, pz = z + dz * b;
        vol.grad(px, y, pz, _g, 0.3);
        return { p: new V3(px, y, pz), n: new V3(_g[0], _g[1], _g[2]) };
      }
      prev = d;
    }
    return null;
  }

  // ---------- траектория тропы (для игры, подсказок, тестов) ----------
  const trail = [];
  {
    let s = 0, prevP = null;
    for (const L of S.LEGS) for (let i = 0; i < L.line.length; i++) {
      const p = new V3(L.line[i][0], L.ys[i], L.line[i][1]);
      if (prevP) { const d = p.distanceTo(prevP); if (d < 0.2) continue; s += Math.hypot(p.x - prevP.x, p.z - prevP.z); }
      p.s = s; p.leg = L.id; trail.push(p); prevP = p;
    }
  }
  const trailLength = trail[trail.length - 1].s;
  const cleftPos = new V3(ENTRY.cleft.x, ENTRY.cleft.y, ENTRY.cleft.z);

  // ---------- метки на камне ----------
  const decals = [];
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const mats = { notches: markMaterial('notches'), hook: markMaterial('hook'), sigil: markMaterial('sigil') };
  function placeMark(kind, face, size, up = new V3(0, 1, 0), roll = 0) {
    if (!face) return null;
    const m = new THREE.Mesh(decalGeo, mats[kind]);
    m.scale.set(size, size, 1);
    const n = face.n.clone().normalize();
    m.position.copy(face.p).addScaledVector(n, 0.04);
    const zAxis = n, xAxis = new V3().crossVectors(up, zAxis).normalize(), yAxis = new V3().crossVectors(zAxis, xAxis);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    m.rotateZ(roll);
    m.renderOrder = 3;
    root.add(m); decals.push(m);
    return m;
  }
  function trailPoint(legId, f) {
    const L = S.LEGS.find((l) => l.id === legId);
    const i = Math.floor((L.line.length - 1) * f);
    return { x: L.line[i][0], z: L.line[i][1], y: L.ys[i], i, L };
  }
  function faceBeside(legId, f, side, height = 1.35, maxD = 7) {
    const P = trailPoint(legId, f), L = P.L;
    const a = L.line[Math.max(0, P.i - 1)], b = L.line[Math.min(L.line.length - 1, P.i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const lx = -dz * side, lz = dx * side;
    return findFace(P.x, P.y + height, P.z, lx, lz, maxD);
  }
  // 1) крюк на валуне у конца первого подъёма; 2) три зарубки на стене у входа в слот; 3) три зарубки + крюк у ниши; 4) роспись возрожденцев
  const hookFace = faceBeside('z2', 0.52, -1, 1.2, 8) || faceBeside('z2', 0.52, 1, 1.2, 8);
  placeMark('hook', hookFace, 0.85, new V3(0, 1, 0), -0.12);
  const slotL = S.LEGS.find((l) => l.id === 'slot');
  const entryFace = faceBeside('slot', 0.12, 1, 1.4, 4) || faceBeside('slot', 0.12, -1, 1.4, 4);
  placeMark('notches', entryFace, 0.7, new V3(0, 1, 0), 0.06);
  const nicheFace = (() => { const wxN = wallX(nz, 31); return findFace(wxN - 3, ENTRY.cleft.y + 2.4, nz + 2.2, 1, 0, 4); })();
  placeMark('hook', nicheFace, 0.55, new V3(0, 1, 0), 0.2);
  const notchFace2 = faceBeside('slot', 0.62, 1, 1.5, 4);
  placeMark('notches', notchFace2, 0.6, new V3(0, 1, 0), -0.1);
  placeMark('sigil', faceBeside('z3', 0.2, -1, 1.1, 8) || faceBeside('z3', 0.2, 1, 1.1, 8), 0.9, new V3(0, 1, 0), 0.15);

  // ---------- каирны (пирамидки), мелкие камни ----------
  const stoneGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.18 * Math.sin(x * 5.1 + z * 3.3) * Math.cos(y * 4.7 + x * 2.2) + 0.1 * Math.sin(z * 9.0 + y * 6.1);
      p.setXYZ(i, x * k, y * k * 0.82, z * k);
    }
    g.computeVertexNormals();
    return g;
  })();
  const cairnPlaces = [];
  for (const [leg, f, side] of [['apron', 0.3, 1], ['z1', 0.1, -1], ['z1', 0.8, 1], ['z2', 0.45, 1], ['z3', 0.2, -1], ['z3', 0.85, 1], ['shelf', 0.45, -1], ['slot', 0.02, -1]]) {
    const P = trailPoint(leg, f), L = P.L;
    const a = L.line[Math.max(0, P.i - 1)], b = L.line[Math.min(L.line.length - 1, P.i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const off = L.w + 0.55;
    cairnPlaces.push({ x: P.x - dz * side * off, z: P.z + dx * side * off, y: P.y });
  }
  const stones = [];
  for (const c of cairnPlaces) {
    let y = vol.surfaceY(c.x, c.z, c.y + 0.5); if (!Number.isFinite(y)) y = c.y;
    const n = 3 + (R() * 3 | 0);
    let r = 0.42 + R() * 0.12, yy = y;
    for (let i = 0; i < n; i++) {
      stones.push({ x: c.x + (R() - 0.5) * 0.08, y: yy + r * 0.34, z: c.z + (R() - 0.5) * 0.08, rx: r * 1.25, ry: r * 0.5, rz: r * 1.1, yaw: R() * 6 });
      yy += r * 0.62; r *= 0.74;
    }
    game.colliders?.add({ type: 'sphere', c: new V3(c.x, y + 0.5, c.z), r: 0.5, owner: 'approach', tags: new Set(['cairn']) });
  }
  // россыпь камней на склоне вне тропы
  const nPeb = quality === 'low' ? 220 : 520;
  for (let tries = 0; tries < nPeb * 4 && stones.length < nPeb + 40; tries++) {
    const x = ZONE.x0 + 5 + R() * (ZONE.x1 - ZONE.x0 - 25), z = ZONE.z0 + 5 + R() * (ZONE.z1 - ZONE.z0 - 12);
    const pd = S.pathDist(x, z);
    if (pd.d < 0.5 || pd.d > 16) continue;
    const y = vol.surfaceY(x, z);
    if (!Number.isFinite(y) || y < base(x, z) + 0.1) continue;
    vol.grad(x, y + 0.3, z, _g);
    if (_g[1] < 0.55) continue;
    const r = 0.1 + Math.pow(R(), 2.2) * 0.4;
    stones.push({ x, y: y + r * 0.2, z, rx: r * (1 + R() * 0.5), ry: r * (0.6 + R() * 0.4), rz: r * (1 + R() * 0.4), yaw: R() * 6.28 });
  }
  const stoneMesh = new THREE.InstancedMesh(stoneGeo, rockMat, stones.length);
  {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pp = new V3(), sc = new V3();
    stones.forEach((s, i) => {
      e.set((R() - 0.5) * 0.3, s.yaw, (R() - 0.5) * 0.3); q.setFromEuler(e);
      m4.compose(pp.set(s.x, s.y, s.z), q, sc.set(s.rx, s.ry, s.rz)); stoneMesh.setMatrixAt(i, m4);
    });
    stoneMesh.castShadow = shadows; stoneMesh.receiveShadow = shadows; stoneMesh.frustumCulled = false;
    root.add(stoneMesh);
  }

  // ---------- коллайдеры валунов для остальных систем (червь/NPC); игрок и так сталкивается с сеткой ----------
  for (const b of S.BOULDERS) {
    if (b.R < 1.6) continue;
    game.colliders?.add({ type: 'sphere', c: new V3(b.x, b.y, b.z), r: Math.min(b.rx, b.rz) * 0.8, owner: 'approach', tags: new Set(['boulder']) });
  }

  // ---------- обёртки мира: высота, поверхность, коллизия ----------
  const nativePassage = typeof world.addPassage === 'function';
  const passagePts = [];
  for (const L of S.LEGS) if (L.slot) for (let i = 0; i < L.line.length; i += 2) passagePts.push({ x: L.line[i][0], y: L.ys[i], z: L.line[i][1] });
  passagePts.push({ x: wallX(nz, 31), y: ENTRY.cleft.y, z: nz }, { x: ENTRY.cleft.x + 4, y: ENTRY.cleft.y, z: nz });
  if (nativePassage) {
    try { world.addPassage({ points: passagePts, r: 2.6 }); } catch (e) { console.warn('[approach] addPassage', e); }
    // Вся тропа по грани Когтя: контур скалы не должен выталкивать с уступов (стены тропы держит собственная сетка vol).
    try {
      const along = [];
      for (let i = 0; i < trail.length; i += 3) along.push({ x: trail[i].x, y: trail[i].y ?? 0, z: trail[i].z });
      if (along.length > 1) world.addPassage({ points: along, r: 3.0 });
    } catch (e) { console.warn('[approach] addPassage(trail)', e); }
  }
  world.heightAt = makeHeightAt(vol, prevHeight);
  // нормаль мира у нас — по карте высот, как у пустыни
  if (prevSurface) {
    world.surfaceAt = (x, z) => {
      if (!vol.inZone(x, z, 1)) return prevSurface(x, z);
      const pd = S.pathDist(x, z);
      const y = vol.surfaceY(x, z);
      if (Number.isFinite(y) && y > base(x, z) + 0.6) return 'rock';
      return prevSurface(x, z);
    };
  }
  const hasHole = typeof world.addRockHole === 'function';
  world.collide = makeCollide(vol, prevCollide, { passagePts, nativePassage, xMax: NOTCH_X_MAX });

  // ---------- отверстие в скале у ниши (до интеграции desert — свой запасной вариант) ----------
  const holeC = { x: wallX(nz, 32) + 0.2, y: ENTRY.cleft.y + 2.0, z: nz, r: 2.5 };
  let holeIdx = -1;
  if (hasHole) { try { holeIdx = world.addRockHole(holeC); } catch (e) { console.warn('[approach] addRockHole', e); } }
  else patchClawHole(scene, holeC);

  // заглушка у конца ниши, пока интерьер сиетча не подключён (в интеграции есть addPassage → интерьер сам открывает проём)
  let plug = null;
  // Бесшовный сиетч внутри скалы виден сквозь проём — заглушка нужна только без него.
  if (typeof game.sietch?.contains !== 'function') {
    plug = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ color: 0x0a0604 }));
    plug.position.set(NOTCH_X_MAX + 0.3, ENTRY.cleft.y + 2, nz); plug.rotation.y = -Math.PI / 2;
    root.add(plug);
  }

  // ---------- события ----------
  bus.on('space', (e) => { root.visible = e.space === 'desert'; });
  let atCleft = false, progressMax = 0;
  const api = {
    root, rock, trail, trailLength, cleftPos, volume: vol, scene: S, zone: ZONE, hasNativeApi: nativePassage,
    start: new V3(ENTRY.trailStart.x, base(ENTRY.trailStart.x, ENTRY.trailStart.z), ENTRY.trailStart.z),
    /** Лежит ли (x,z) в зоне подхода. */
    inZone: (x, z) => vol.inZone(x, z, 0),
    /** Прогресс по тропе 0..1 для позиции (по ближайшей точке). */
    progress(pos) {
      let best = 1e9, bi = 0;
      for (let i = 0; i < trail.length; i++) { const p = trail[i]; const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2 + ((p.y - pos.y) * 2) ** 2; if (d < best) { best = d; bi = i; } }
      return trail[bi].s / trailLength;
    },
    /** Скрыт ли вход от наблюдателя в точке p: луч к нише пересекает твёрдое. */
    hiddenFrom(p) {
      const a = new V3(p.x, p.y + 1.6, p.z), b = new V3(wallX(nz, 31) - 0.2, ENTRY.cleft.y + 1.5, nz);
      const n = Math.ceil(a.distanceTo(b) / 0.5);
      for (let i = 1; i < n; i++) { const t = i / n; if (vol.sample(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t) < 0) return true; }
      return false;
    },
    stats: { tris: msh.index.length / 3, verts: msh.position.length / 3, stones: stones.length, boulders: S.BOULDERS.length, buildMs: performance.now() - t0 },
    update(dt) {
      const p = game.player?.position;
      if (!p || game.space !== 'desert') return;
      if (vol.inZone(p.x, p.z, 2)) {
        const pr = api.progress(p);
        if (pr > progressMax) progressMax = pr;
        const d = Math.hypot(p.x - cleftPos.x, p.z - cleftPos.z);
        const near = d < 3.5 && Math.abs(p.y - cleftPos.y) < 3;
        if (near && !atCleft) { atCleft = true; bus.emit('approach:cleft', { x: p.x, z: p.z }); }
        else if (!near && d > 6) atCleft = false;
      }
    },
  };
  game.add('approach', api);
  console.log(`[approach] ${api.stats.tris | 0} tris, ${api.stats.buildMs.toFixed(0)} ms, wallFromGeometry=${wallX.fromGeometry}, native=${nativePassage}`);
  return api;
}

/** Запасной вариант без world.addRockHole: прорезать шейдер Когтя сферой (если шейдер понятен). */
function patchClawHole(scene, h) {
  let claw = null;
  scene.traverse((o) => { if (o.isMesh && o.material?.customProgramCacheKey?.() === 'rk-rock' && o.geometry?.boundingSphere && o.geometry.boundingSphere.radius > 150) claw = o; });
  if (!claw) return;
  const mat = claw.material, prev = mat.onBeforeCompile;
  const U = { value: new THREE.Vector4(h.x, h.y, h.z, h.r) };
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    if (!shader.fragmentShader.includes('vec3 N = normalize(vWN);')) return;
    shader.uniforms.uLvHole = U;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec4 uLvHole;')
      .replace('vec3 N = normalize(vWN);', 'if (distance(vWP, uLvHole.xyz) < uLvHole.w) discard;\nvec3 N = normalize(vWN);');
  };
  mat.customProgramCacheKey = () => 'rk-rock-lvhole';
  mat.needsUpdate = true;
}
