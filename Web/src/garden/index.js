// Сад сиетча за Когтем: защищённая котловина с рукотворными грядками, желобами и ветроловушками, растениями и животными Ракиса.
// Модуль game.garden. См. README.md.
//
// Земля: ОДНА поверхность — сетка пола (ground.js, шаг 1 м), по которой и рисуется меш (groundmesh.js), и считает физика (physics.js).
// Ландшафт пустыни внутри котловины опускается на 30 см (ground patch), поэтому не торчит сквозь пол и не z-fight'ится.
import * as THREE from 'three';
import { C, FLOOR_Y, MOUTH, RAVINE, ringIn, ang, radius, PLAZA, inBed, nearChannel } from './layout.js';
import { GRID, createGroundField, buildGrid } from './ground.js';
import { createGroundMesh } from './groundmesh.js';
import { makeGardenHeight, makeGardenSurface } from './physics.js';
import { createRim } from './rim.js';
import { createStructures } from './structures.js';
import { createMouth } from './mouth.js';
import { createFlora } from './flora.js';
import { createFauna } from './fauna.js';
import { createPeople } from './people.js';
import { createLife } from './life.js';
import { GWIND } from './plants.js';
import { buildWallTable } from '../level/wall.js';
import { createLevelRockMaterial, geometryFromMesh } from '../level/rockmat.js';
import { buildClawGeometry } from '../desert/rock.js';
import { solidSdf } from '../desert/field.js';
import { smoothstep, lerp, clamp } from '../core/util.js';

const V3 = THREE.Vector3;
const DIP = 0.3;                     // насколько ландшафт пустыни опущен под полом сада, м

export function create(game) {
  const world = game.world;
  if (!world) { console.warn('[garden] нет game.world'); return null; }
  const { scene, bus } = game;
  const quality = game.settings?.quality || 'med';
  const shadows = quality !== 'low';
  const t0 = performance.now();

  // ---------- исходная пустыня (до любых наших заплаток): снимок 1 м ----------
  const prevHeight0 = world.heightAt.bind(world);
  const prevSurface = world.surfaceAt?.bind(world);
  const prevCollide = world.collide.bind(world);
  const RS = { x0: GRID.x0 - 8, z0: GRID.z0 - 8, x1: GRID.x1 + 8, z1: GRID.z1 + 8 };
  const rnx = RS.x1 - RS.x0 + 1, rnz = RS.z1 - RS.z0 + 1;
  const raw = new Float32Array(rnx * rnz);
  for (let k = 0; k < rnz; k++) for (let i = 0; i < rnx; i++) raw[i + rnx * k] = prevHeight0(RS.x0 + i, RS.z0 + k);
  const desertRaw = (x, z) => {
    const fx = clamp(x - RS.x0, 0, rnx - 1.001), fz = clamp(z - RS.z0, 0, rnz - 1.001);
    const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k, o = i + rnx * k;
    return (raw[o] * (1 - u) + raw[o + 1] * u) * (1 - v) + (raw[o + rnx] * (1 - u) + raw[o + rnx + 1] * u) * v;
  };

  // ---------- грань Когтя ----------
  const Zr = { x0: 764, x1: 960, z0: 322, z1: 470 };
  let clawGeo = null;
  scene.traverse((o) => { if (!clawGeo && o.isMesh && o.material?.customProgramCacheKey?.() === 'rk-rock' && o.geometry?.boundingSphere?.radius > 150) clawGeo = o.geometry; });
  const faceX = buildWallTable(() => clawGeo || buildClawGeometry(quality), { z0: Zr.z0, z1: Zr.z1, yMax: 36 }, quality, 'east');
  const faceAt = (z) => faceX(z, 4);

  // ---------- единая земля ----------
  const field = createGroundField({ desert: desertRaw, faceAt });
  const grid = buildGrid(field);
  const baseG = (x, z) => { const g = grid.sample(x, z); return Number.isFinite(g) ? g : desertRaw(x, z); };

  // ландшафт пустыни: под нашим полом — на DIP ниже (чтобы не торчал); на краях плавно возвращается к своей высоте
  world.addGroundPatch?.({
    x: (GRID.x0 + GRID.x1) / 2, z: (GRID.z0 + GRID.z1) / 2, radius: Math.hypot(GRID.x1 - GRID.x0, GRID.z1 - GRID.z0) / 2 + 2, blend: 0,
    height: (x, z, h) => { const c = grid.coverAt(x, z); if (c <= 0) return null; const g = grid.sample(x, z); if (!Number.isFinite(g)) return null; return Math.min(h, lerp(h, g - DIP * smoothstep(0, 1, c), smoothstep(0, 0.6, c))); },
  });
  const prevHeight = world.heightAt.bind(world);      // с заплаткой

  // ---------- меши: корень, пол, кольцо гребней ----------
  const root = new THREE.Group(); root.name = 'Garden'; scene.add(root);
  const gm = createGroundMesh({ grid, field, quality, shadows });
  root.add(gm.mesh);

  const rim = createRim({ base: baseG, faceX, h: quality === 'low' ? 1.0 : 0.8 });
  const vol = rim.build();
  const cull = (x0, y0, z0, x1, y1, z1, x2, y2, z2, nx, ny, nz) => {
    if (y0 < baseG(x0, z0) + 0.07 && y1 < baseG(x1, z1) + 0.07 && y2 < baseG(x2, z2) + 0.07) return true;
    const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, cz = (z0 + z1 + z2) / 3;
    // пологие грани у самой земли в зоне пола — рисует сетка пола
    if (ny > 0.7 && y0 < baseG(x0, z0) + 0.4 && y1 < baseG(x1, z1) + 0.4 && y2 < baseG(x2, z2) + 0.4 && grid.coverAt(cx, cz) > 0.85) return true;
    // внутри скалы (за гранью, где штольня) — рисует облицовка устья
    if (cx < faceX(cz, Math.max(cy, 8)) - 1.2 && Math.abs(cz - MOUTH.z) < 6 && cy < 14) return true;
    // лицо массы стены выше основания совпадает с мешем Когтя — не рисуем
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

  // ---------- проходимость (для живности/людей) ----------
  const inBasin = (x, z, m = 1.2) => radius(x, z) < ringIn(ang(x, z)) - m && x > faceAt(z) + 1.0;
  const walkable = (x, z) => inBasin(x, z, 1.8) && !nearChannel(x, z, 0.5) && !inBed(x, z, 0.3) && (Math.hypot(x - PLAZA.x, z - PLAZA.z) > 0.01);

  // ---------- пустынная «обстановка» внутри котловины ----------
  // Валуны/галька пустыни (desert/dressing.js) расставлены по ИСХОДНОМУ рельефу: у восточной грани Когтя они теперь висят над дном котловины,
  // а их круглые препятствия (world.addObstacle) стали бы невидимыми стенами. Прячем инстансы и снимаем сферы-коллайдеры внутри сада.
  const inGarden = (x, z) => grid.coverAt(x, z) > 0.01 || (radius(x, z) < ringIn(ang(x, z)) + 9 && x > faceAt(z) - 3);
  let hidden = 0, removed = 0;
  {
    const m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    scene.traverse((o) => {
      if (!o.isInstancedMesh || o.parent === root || o.parent?.name === 'Garden' || o.parent?.name === 'Approach') return;
      const key = o.material?.customProgramCacheKey?.();
      if (typeof key !== 'string' || !key.startsWith('rk-')) return;
      let any = false;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4);
        const x = m4.elements[12], z = m4.elements[14];
        if (x < 770 || x > 960 || z < 330 || z > 470) continue;
        if (inGarden(x, z)) { o.setMatrixAt(i, zero); any = true; hidden++; }
      }
      if (any) o.instanceMatrix.needsUpdate = true;
    });
    if (game.colliders?.all) {
      const kill = [];
      for (const e of game.colliders.all()) if (e.owner === 'desert' && e.type === 'sphere' && e.c && e.c.x > 770 && e.c.x < 960 && inGarden(e.c.x, e.c.z)) kill.push(e.id);
      for (const id of kill) { game.colliders.remove(id); removed++; }
    }
  }

  // ---------- физика мира ----------
  const heightAt = makeGardenHeight({ grid, field, vol, prevHeight });
  world.heightAt = heightAt;
  // «земля» для размещения объектов: без стенок (G), и «верх» — со стенками
  const groundBase = (x, z) => baseG(x, z);
  const groundTop = (x, z) => { const g = grid.sample(x, z); return Number.isFinite(g) ? g + field.bump(x, z) : prevHeight(x, z); };

  // ---------- сооружения, устье, растения, живность, люди ----------
  const structures = createStructures(game, { ground: groundBase, rim, root, quality });
  const mouth = createMouth(game, { root, faceAt, ground: groundBase, quality });
  const flora = createFlora(game, { ground: groundBase, faceAt, root, quality });
  const fauna = createFauna(game, { ground: groundTop, flora, walkable, root, quality });
  const people = createPeople(game, { ground: groundTop, root, quality, walkable, fauna });
  const life = createLife(game, { root, flora, structures, quality });

  // ---------- проходы и отверстия в скале ----------
  const nativePassage = typeof world.addPassage === 'function';
  if (nativePassage) {
    try { world.addPassage({ points: [{ x: MOUTH.x - MOUTH.lining - 2, y: MOUTH.y, z: MOUTH.z }, { x: MOUTH.x + 2.5, y: MOUTH.y, z: MOUTH.z }], r: 2.6 }); } catch (e) { console.warn('[garden] addPassage', e); }
  }
  if (typeof world.addRockHole === 'function') {
    // сфера чуть больше проёма арки (w × h); кромку закрывает рамка
    try { world.addRockHole({ x: faceAt(MOUTH.z) + 0.3, y: MOUTH.y + MOUTH.h * 0.5, z: MOUTH.z, r: Math.hypot(MOUTH.w / 2, MOUTH.h / 2) + 0.35 }); } catch (e) { console.warn('[garden] addRockHole', e); }
  }
  // Контур Когтя (2D SDF) — как в desert/index.js; внутри котловины круглые препятствия пустыни не применяются (см. выше).
  const clawPush = (pos, r) => {
    let hit = false;
    for (let it = 0; it < 3; it++) {
      const d = solidSdf(pos.x, pos.z); if (d >= r) break;
      const e = 0.25;
      let gx = solidSdf(pos.x + e, pos.z) - solidSdf(pos.x - e, pos.z), gz = solidSdf(pos.x, pos.z + e) - solidSdf(pos.x, pos.z - e);
      const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
      pos.x += gx * (r - d + 0.01); pos.z += gz * (r - d + 0.01); hit = true;
    }
    return hit;
  };
  const inMouthCorridor = (x, z) => x > MOUTH.x - MOUTH.lining - 3 && x < MOUTH.x + 3 && Math.abs(z - MOUTH.z) < 2.8;
  world.collide = (pos, r = 0.4) => {
    if (pos.x < Zr.x0 || pos.x > Zr.x1 || pos.z < Zr.z0 || pos.z > Zr.z1) return prevCollide(pos, r);
    let hit = false;
    if (inGarden(pos.x, pos.z)) {
      // свои правила: контур Когтя (кроме штольни устья и высоких уступов) + SDF гребней; препятствия пустыни здесь сняты
      if (!inMouthCorridor(pos.x, pos.z) && !(pos.y !== undefined && pos.y - prevHeight0(pos.x, pos.z) > 2.5)) hit = clawPush(pos, r);
    } else hit = prevCollide(pos, r);
    if (pos.x > faceAt(pos.z) - 0.2) hit = vol.collide(pos, r) || hit;
    return hit;
  };
  world.surfaceAt = makeGardenSurface({ grid, field, prevSurface, prevHeight, vol });

  // ---------- зона, события, ветер ----------
  const zoneAt = (pos) => {
    if (grid.coverAt(pos.x, pos.z) > 0.5 && pos.x > faceAt(pos.z) + 0.5) return 'C1_Garden';
    if (pos.x > MOUTH.x - 2 && pos.x < MOUTH.x + 8 && Math.abs(pos.z - MOUTH.z) < 5) return 'C1_Garden';
    return null;
  };
  let inside = false, shelter = 0;
  const camP = new V3();
  let flT = 0, firstRefresh = true;
  const perf = { ms: 0, avg: 0, n: 0, max: 0, first: 0 };
  const api = {
    root, rim: rimMesh, life, ground: groundBase, groundMesh: gm.mesh, structures, mouth, flora, fauna, people, volume: vol, FLOOR_Y, center: C, field, grid, perf,
    hasGroundPatch: true,
    zoneAt,
    /** 0..1: насколько точка защищена от ветра и песка (в котловине ≈ 0.85, у устья/на краю меньше; в овраге — меньше). */
    shelterAt(pos) { const r = radius(pos.x, pos.z), lim = ringIn(ang(pos.x, pos.z)); return pos.x > faceAt(pos.z) ? 0.9 * (1 - smoothstep(lim - 6, lim + 14, r)) : 0; },
    get sheltered() { return shelter; },
    /** Высота земли (без стенок) / вид поверхности / грань Когтя. */
    groundAt: groundBase, walkable, faceAt,
    surfaceKind: (x, z) => field.kind(x, z),
    stats: { tris: mesh.index.length / 3, groundTris: gm.tris, instances: flora.total, buildMs: 0 },
    update(dt, t) {
      const tp = performance.now();
      const w = game.weather, wd = w?.windDir, ws = w?.windSpeed ?? 4;
      let dx = GWIND.value.x, dz = GWIND.value.y;
      if (wd) { const l = Math.hypot(wd.x, wd.z) || 1; dx = wd.x / l; dz = wd.z / l; }
      GWIND.value.set(dx, dz, 0.045 + 0.16 * clamp(ws / 14, 0, 1) * (1 - 0.55 * shelter), t);
      const cam = game.camera.position;
      const dC = Math.hypot(cam.x - C.x, cam.z - C.z);
      const dM = Math.hypot(cam.x - MOUTH.x, cam.z - MOUTH.z);
      // сад виден в пустыне и из штольни у устья (вид наружу), но не из глубины сиетча
      const seen = game.space === 'desert' || dM < 70;
      const near = dC < 330 && seen;
      root.visible = seen && dC < 520;
      if (!near) { perf.ms = 0; return; }
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
      life.update(dt, t, cam, p, groundTop);
      const ms = performance.now() - tp;
      if (!perf.first) perf.first = ms;
      perf.ms = ms; perf.n++; perf.avg += (ms - perf.avg) / Math.min(perf.n, 120); if (ms > perf.max) perf.max = ms;
    },
  };
  api.stats.buildMs = performance.now() - t0;
  game.add('garden', api);
  // Прогрев шейдеров заранее (иначе первый взгляд на сад/устье даёт фриз компиляции программ): асинхронно, без блокировки кадра.
  try {
    const was = root.visible; root.visible = true;
    const pr = game.renderer?.compileAsync ? game.renderer.compileAsync(scene, game.camera) : Promise.resolve(game.renderer?.compile?.(scene, game.camera));
    Promise.resolve(pr).catch(() => {}).finally(() => { root.visible = was; });
  } catch (e) { /* не критично */ }
  console.log(`[garden] cleared dressing: ${hidden} instances, ${removed} colliders`);
  console.log(`[garden] rim ${api.stats.tris | 0} tris, ground ${gm.tris | 0} tris, ${flora.total} instances, ${api.stats.buildMs.toFixed(0)} ms, native=${nativePassage}`);
  return api;
}
const damp1 = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
