// Сад сиетча за Когтем: защищённая котловина с рукотворными грядками, желобами и ветроловушками, растениями и животными Ракиса.
// Модуль game.garden. См. README.md (раздел «Сад»).
import * as THREE from 'three';
import { C, FLOOR_Y, MOUTH, ringIn, ang, radius, floorHeight, PLAZA, inBed, nearChannel, R_FLOOR } from './layout.js';
import { createRim } from './rim.js';
import { createStructures } from './structures.js';
import { createFlora } from './flora.js';
import { createFauna } from './fauna.js';
import { createPeople } from './people.js';
import { GWIND } from './plants.js';
import { buildWallTable } from '../level/wall.js';
import { createLevelRockMaterial, geometryFromMesh } from '../level/rockmat.js';
import { buildClawGeometry } from '../desert/rock.js';
import { smoothstep, lerp, clamp } from '../core/util.js';

const V3 = THREE.Vector3;

export function create(game) {
  const world = game.world;
  if (!world) { console.warn('[garden] нет game.world'); return null; }
  const { scene, bus } = game;
  const quality = game.settings?.quality || 'med';
  const shadows = quality !== 'low';
  const t0 = performance.now();

  // ---------- рельеф: дно котловины через заплатку ландшафта ----------
  const hasPatch = typeof world.addGroundPatch === 'function';
  if (hasPatch) {
    try { world.addGroundPatch({ x: C.x, z: C.z, radius: 56, blend: 15, height: (x, z) => floorHeight(x, z) }); } catch (e) { console.warn('[garden] addGroundPatch', e); }
  }
  const prevHeight = world.heightAt.bind(world);
  const prevCollide = world.collide.bind(world);
  const prevSurface = world.surfaceAt?.bind(world);
  const ground = (x, z) => prevHeight(x, z);

  // ---------- карта «земли» и стена Когтя ----------
  const Zr = { x0: 764, x1: 916, z0: 322, z1: 470 };
  const gs = 1.5, gnx = Math.ceil((Zr.x1 - Zr.x0) / gs) + 1, gnz = Math.ceil((Zr.z1 - Zr.z0) / gs) + 1;
  const bg = new Float32Array(gnx * gnz);
  for (let k = 0; k < gnz; k++) for (let i = 0; i < gnx; i++) bg[i + gnx * k] = ground(Zr.x0 + i * gs, Zr.z0 + k * gs);
  const base = (x, z) => {
    const fx = clamp((x - Zr.x0) / gs, 0, gnx - 1.001), fz = clamp((z - Zr.z0) / gs, 0, gnz - 1.001);
    const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k, o = i + gnx * k;
    return (bg[o] * (1 - u) + bg[o + 1] * u) * (1 - v) + (bg[o + gnx] * (1 - u) + bg[o + gnx + 1] * u) * v;
  };
  let clawGeo = null;
  scene.traverse((o) => { if (!clawGeo && o.isMesh && o.material?.customProgramCacheKey?.() === 'rk-rock' && o.geometry?.boundingSphere?.radius > 150) clawGeo = o.geometry; });
  const faceX = buildWallTable(() => clawGeo || buildClawGeometry(quality), { z0: Zr.z0, z1: Zr.z1, yMax: 36 }, quality, 'east');
  const faceAt = (z) => faceX(z, 14);

  // ---------- кольцо гребней ----------
  const root = new THREE.Group(); root.name = 'Garden'; scene.add(root);
  const rim = createRim({ base, faceX, h: quality === 'low' ? 1.0 : 0.8 });
  const vol = rim.build();
  const cull = (x0, y0, z0, x1, y1, z1, x2, y2, z2, nx, ny, nz) => {
    if (y0 < base(x0, z0) + 0.07 && y1 < base(x1, z1) + 0.07 && y2 < base(x2, z2) + 0.07) return true;
    const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, cz = (z0 + z1 + z2) / 3;
    // внутри скалы (за гранью, где туннель) — рисует сиетч
    if (cx < faceX(cz, Math.max(cy, 8)) - 1.2 && Math.abs(cz - MOUTH.z) < 6 && cy < 14) return true;
    // лицо массы стены выше основания совпадает с мешем Когтя — не рисуем (низ оставляем: терраин опущен под скалой)
    if (nx > 0.55 && cy > 12.5) {
      const w0 = faceX(z0, y0) + 0.55, w1 = faceX(z1, y1) + 0.55, w2 = faceX(z2, y2) + 0.55;
      if (Math.abs(x0 - w0) < 0.45 && Math.abs(x1 - w1) < 0.45 && Math.abs(x2 - w2) < 0.45) return true;
    }
    return false;
  };
  const mark = (x, y, z, nx, ny, nz, out) => { out[0] = 0; out[1] = ny > 0.7 ? 0.25 * smoothstep(0.7, 1, ny) : 0; };
  const mesh = vol.mesh({ cull, mark });
  const rockMat = createLevelRockMaterial({ band: 5.5, sand: 0.9 });
  const rimMesh = new THREE.Mesh(geometryFromMesh(mesh), rockMat);
  rimMesh.name = 'GardenRim'; rimMesh.castShadow = shadows; rimMesh.receiveShadow = shadows;
  root.add(rimMesh);

  // ---------- проходимость ----------
  const inBasin = (x, z, m = 1.2) => radius(x, z) < ringIn(ang(x, z)) - m && x > faceAt(z) + 1.0;
  const walkable = (x, z) => inBasin(x, z, 1.8) && !nearChannel(x, z, 0.5) && !inBed(x, z, 0.3) && (Math.hypot(x - PLAZA.x, z - PLAZA.z) > 0.01);

  // ---------- сооружения, растения, живность, люди ----------
  const structures = createStructures(game, { ground, rim, root, quality });
  const flora = createFlora(game, { ground, faceAt, root, quality });
  const fauna = createFauna(game, { ground, flora, walkable, root, quality });
  const people = createPeople(game, { ground, root, quality, walkable, fauna });

  // ---------- обёртки мира ----------
  const nativePassage = typeof world.addPassage === 'function';
  const mouthPts = [{ x: MOUTH.x - 12, y: MOUTH.y, z: MOUTH.z }, { x: MOUTH.x - 1, y: MOUTH.y, z: MOUTH.z }, { x: MOUTH.x + 3.5, y: MOUTH.y - 0.7, z: MOUTH.z }];
  if (nativePassage) { try { world.addPassage({ points: mouthPts, r: 2.6 }); } catch (e) { console.warn('[garden] addPassage', e); } }
  const hasHole = typeof world.addRockHole === 'function';
  const holeC = { x: faceX(MOUTH.z, 7) + 0.4, y: MOUTH.y + 2.1, z: MOUTH.z, r: 3.1 };
  if (hasHole) { try { world.addRockHole(holeC); } catch (e) { console.warn('[garden] addRockHole', e); } }
  let plug = null;
  if (!nativePassage) {
    plug = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({ color: 0x0a0604 }));
    plug.position.set(faceX(MOUTH.z, 7) - 1.0, MOUTH.y + 3, MOUTH.z); plug.rotation.y = Math.PI / 2; root.add(plug);
  }
  const inMouthPassage = (x, z) => x < MOUTH.x + 4 && Math.abs(z - MOUTH.z) < 2.6;
  world.collide = (pos, r = 0.4) => {
    if (pos.x < Zr.x0 || pos.x > Zr.x1 || pos.z < Zr.z0 || pos.z > Zr.z1) return prevCollide(pos, r);
    let hit = false;
    const ox = pos.x, oz = pos.z;
    if (prevCollide(pos, r)) {
      if (!nativePassage && inMouthPassage(ox, oz)) { pos.x = ox; pos.z = oz; } else hit = true;
    }
    if (pos.x > faceAt(pos.z) - 0.2) hit = vol.collide(pos, r) || hit;
    // страховка: круг гребня
    const rr = radius(pos.x, pos.z), lim = ringIn(ang(pos.x, pos.z)) - 0.6;
    if (rr > lim && pos.x > faceAt(pos.z) + 2) { const k = lim / rr; pos.x = C.x + (pos.x - C.x) * k; pos.z = C.z + (pos.z - C.z) * k; hit = true; }
    return hit;
  };
  if (prevSurface) {
    world.surfaceAt = (x, z) => {
      if (x < Zr.x0 + 10 || x > Zr.x1 - 10 || z < Zr.z0 + 10 || z > Zr.z1 - 10) return prevSurface(x, z);
      if (inBasin(x, z, 0)) {
        if (inBed(x, z, 0.5)) return 'packed';
        if (Math.hypot(x - PLAZA.x, (z - PLAZA.z) / 0.85) < PLAZA.r) return 'rock';
      }
      return prevSurface(x, z);
    };
  }

  // ---------- зона, события, ветер ----------
  const zoneAt = (pos) => {
    const x = pos.x, z = pos.z;
    if (inBasin(x, z, -2)) return 'C1_Garden';
    if (x > MOUTH.x - 2 && x < MOUTH.x + 8 && Math.abs(z - MOUTH.z) < 5) return 'C1_Garden';
    return null;
  };
  let inside = false, shelter = 0;
  bus.on('space', (e) => { root.visible = e.space === 'desert'; });
  const camP = new V3();
  let flT = 0, firstRefresh = true;
  const api = {
    root, rim: rimMesh, structures, flora, fauna, people, volume: vol, FLOOR_Y, center: C, hasGroundPatch: hasPatch,
    zoneAt,
    /** 0..1: насколько точка защищена от ветра и песка (в котловине ≈ 0.85, у устья/на краю меньше). */
    shelterAt(pos) { const r = radius(pos.x, pos.z), lim = ringIn(ang(pos.x, pos.z)); return pos.x > faceAt(pos.z) ? 0.9 * (1 - smoothstep(lim - 6, lim + 14, r)) : 0; },
    get sheltered() { return shelter; },
    ground, walkable, faceAt,
    stats: { tris: mesh.index.length / 3, instances: flora.total, buildMs: 0 },
    update(dt, t) {
      // ветер: слабее из-за укрытия (амплитуда ≈ 1/4 пустынной), направление — как у погоды
      const w = game.weather, wd = w?.windDir, ws = w?.windSpeed ?? 4;
      let dx = GWIND.value.x, dz = GWIND.value.y;
      if (wd) { const l = Math.hypot(wd.x, wd.z) || 1; dx = wd.x / l; dz = wd.z / l; }
      GWIND.value.set(dx, dz, 0.045 + 0.16 * clamp(ws / 14, 0, 1) * (1 - 0.55 * shelter), t);
      const cam = game.camera.position;
      const dC = Math.hypot(cam.x - C.x, cam.z - C.z);
      const near = dC < 330 && game.space === 'desert';
      root.visible = game.space === 'desert' && dC < 520;
      if (!near) return;
      // игрок внутри котловины
      const p = game.player?.position;
      if (p) {
        const z = zoneAt(p) === 'C1_Garden';
        shelter = damp1(shelter, z ? 1 : 0, 2, dt);
        if (z && !inside) { inside = true; bus.emit('garden:enter', { x: p.x, z: p.z }); }
        else if (!z && inside) { inside = false; bus.emit('garden:leave', { x: p.x, z: p.z }); }
      }
      flT -= dt;
      if (flT <= 0 || firstRefresh) { flT = 0.35; camP.copy(cam); flora.refresh(camP, firstRefresh); firstRefresh = false; }
      structures.update(dt, t, cam);
      fauna.update(dt, t);
      people.update(dt, t, p || { x: 0, y: 0, z: 0 });
    },
  };
  api.stats.buildMs = performance.now() - t0;
  game.add('garden', api);
  console.log(`[garden] rim ${api.stats.tris | 0} tris, ${flora.total} instances, ${api.stats.buildMs.toFixed(0)} ms, groundPatch=${hasPatch}, native=${nativePassage}`);
  return api;
}
const damp1 = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
