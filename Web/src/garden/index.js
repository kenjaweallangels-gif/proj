// Сад сиетча: высокая скрытая котловина в скале «Коготь» (дно ≈ 36 м, стены 45–105 м, выхода в пустыню нет), тихое место с мелкими
// пустынными растениями, лишайниками и мелкой живностью. Модуль game.garden. См. README.md.
//
// Земля: ОДНА поверхность — сетка пола (ground.js, шаг 1 м), по которой и рисуется меш (groundmesh.js), и считает физика (physics.js).
// Пустыня лежит на ~30 м ниже и в саду не участвует (никаких заплаток/дюн сквозь пол). Каменная чаша — полярная оболочка (rim.js).
import * as THREE from 'three';
import { C, FLOOR_Y, MOUTH, ringIn, ang, radius } from './layout.js';
import { GRID, createGroundField, buildGrid } from './ground.js';
import { createGroundMesh } from './groundmesh.js';
import { makeGardenHeight, makeGardenSurface, makeGardenCollide, HIGH_Y } from './physics.js';
import { createRim } from './rim.js';
import { createMouth } from './mouth.js';
import { createFlora } from './flora.js';
import { createFauna } from './fauna.js';
import { createLife } from './life.js';
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

  // ---------- пустыня (для подошвы наружного склона и для мест вне чаши) ----------
  const prevHeight = world.heightAt.bind(world);
  const prevSurface = world.surfaceAt?.bind(world);
  const prevCollide = world.collide.bind(world);

  // ---------- грань Когтя (таблица x(z, y) до 150 м) ----------
  const Zr = { x0: 740, x1: 1000, z0: 322, z1: 470 };
  let clawGeo = null;
  scene.traverse((o) => { if (!clawGeo && o.isMesh && o.material?.customProgramCacheKey?.() === 'rk-rock' && o.geometry?.boundingSphere?.radius > 150) clawGeo = o.geometry; });
  const faceX = buildWallTable(() => clawGeo || buildClawGeometry(quality), { z0: Zr.z0, z1: Zr.z1, yMax: 150 }, quality, 'east');
  const faceAt = (z) => faceX(z, FLOOR_Y);

  // ---------- единая земля ----------
  const field = createGroundField({ faceAt });
  const grid = buildGrid(field);
  const baseG = (x, z) => { const g = grid.sample(x, z); return Number.isFinite(g) ? g : prevHeight(x, z); };

  // ---------- меши: корень, пол, каменная чаша ----------
  const root = new THREE.Group(); root.name = 'Garden'; scene.add(root);
  const gm = createGroundMesh({ grid, field, quality, shadows });
  root.add(gm.mesh);

  const rim = createRim({ faceX, desertAt: (x, z) => prevHeight(x, z), quality });
  const rimData = rim.build();
  const rockMat = createLevelRockMaterial({ band: 5.5, sand: 0.5 });
  const rimMesh = new THREE.Mesh(geometryFromMesh(rimData), rockMat);
  rimMesh.name = 'GardenRim'; rimMesh.castShadow = shadows; rimMesh.receiveShadow = shadows;
  root.add(rimMesh);

  // ---------- проходимость (для живности) ----------
  const inBasin = (x, z, m = 1.2) => radius(x, z) < ringIn(ang(x, z)) - m && x > faceAt(z) + 1.0;
  const walkable = (x, z) => inBasin(x, z, 1.8) && !(x < MOUTH.x + 8 && Math.abs(z - MOUTH.z) < 3);

  // ---------- пустынная «обстановка» внутри массива чаши ----------
  // Массив чаши стоит на пустыне: валуны/галька (desert/dressing.js) под его основанием не нужны (скрыты в скале), а их круглые препятствия
  // (world.addObstacle) создавали бы невидимые стены у подножия. Прячем инстансы и снимаем сферы-коллайдеры внутри основания.
  const footR = (th) => rim.footR(th);
  const inFoot = (x, z) => radius(x, z) < footR(ang(x, z)) + 2 && x > faceAt(z) - 3;
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
        if (x < 730 || x > 1000 || z < 290 || z > 510) continue;
        if (inFoot(x, z)) { o.setMatrixAt(i, zero); any = true; hidden++; }
      }
      if (any) o.instanceMatrix.needsUpdate = true;
    });
    if (game.colliders?.all) {
      const kill = [];
      for (const e of game.colliders.all()) if (e.owner === 'desert' && e.type === 'sphere' && e.c && e.c.x > 730 && e.c.x < 1000 && inFoot(e.c.x, e.c.z)) kill.push(e.id);
      for (const id of kill) { game.colliders.remove(id); removed++; }
    }
  }

  // ---------- физика мира ----------
  const heightAt = makeGardenHeight({ grid, prevHeight });
  world.heightAt = heightAt;
  const groundTop = baseG;                      // ровное дно без стенок/ступеней

  // ---------- лаз, растения, живность ----------
  const mouth = createMouth(game, { root, faceAt, quality });
  const flora = createFlora(game, { ground: baseG, faceAt, root, quality, rim });
  const ledges = rim.ledgePerches(14, 17);
  const fauna = createFauna(game, { ground: groundTop, flora, walkable, root, quality, ledges });
  // первая раскладка инстансов растений заранее (буферы выделены и заполнены до первого взгляда на сад — без фриза при входе)
  flora.refresh(new V3(C.x, 0, C.z), true);
  const life = createLife(game, { root, flora, rim, quality });
  // разовые затраты первого вызова (анимация фигур, первые матрицы) — на загрузке, а не при первом взгляде на сад
  { const far = new V3(C.x, -500, C.z); try { fauna.update(1 / 60, 0); life.update(1 / 60, 0, far, far, groundTop); } catch (e) { console.warn('[garden] warmup', e); } }

  // ---------- проходы и отверстия в скале ----------
  // Путь выходного туннеля сиетча с настоящей высотой пола
  const exitPts = (game.sietch?.exitPath || []).map((q) => {
    let y = q.y;
    try { const h = game.sietch.heightAt?.(q.x, q.z, q.y); if (Number.isFinite(h) && h > 0.5 && h < 80) y = h; } catch (e) { /* оставляем y узла */ }
    return { x: q.x, y, z: q.z };
  });
  const nativePassage = typeof world.addPassage === 'function';
  if (nativePassage) {
    try { world.addPassage({ points: [{ x: MOUTH.x - MOUTH.lining - 2, y: MOUTH.y, z: MOUTH.z }, { x: MOUTH.x + 1.5, y: MOUTH.y, z: MOUTH.z }], r: 1.6 }); } catch (e) { console.warn('[garden] addPassage', e); }
  }
  if (nativePassage && exitPts.length > 1) {
    try { world.addPassage({ points: exitPts, r: 3.0 }); } catch (e) { console.warn('[garden] addPassage(exit)', e); }
  }
  if (typeof world.addRockHole === 'function') {
    // сфера по размеру лаза (w × h): отверстие в меше Когтя
    try { world.addRockHole({ x: faceAt(MOUTH.z) + 0.2, y: MOUTH.y + MOUTH.h * 0.5, z: MOUTH.z, r: Math.hypot(MOUTH.w / 2, MOUTH.h / 2) + 0.15 }); } catch (e) { console.warn('[garden] addRockHole', e); }
  }
  // Весь выходной туннель сиетча: контур Когтя там не выталкивает (3D-капсулы r = 3 м вдоль ломаной).
  const inExitPassage = (pos) => {
    if (exitPts.length < 2) return false;
    const py = pos.y + 0.9;
    for (let i = 0; i < exitPts.length - 1; i++) {
      const a = exitPts[i], b = exitPts[i + 1], abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, l2 = abx * abx + aby * aby + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((pos.x - a.x) * abx + (py - a.y) * aby + (pos.z - a.z) * abz) / l2));
      const dx = pos.x - (a.x + abx * t), dy = py - (a.y + aby * t), dz = pos.z - (a.z + abz * t);
      if (dx * dx + dy * dy + dz * dz < 9) return true;
    }
    return false;
  };
  world.collide = makeGardenCollide({ prevCollide, faceAt, footR, inExitPassage, Zr });
  world.surfaceAt = makeGardenSurface({ grid, field, prevSurface });

  // ---------- зона, события, ветер ----------
  const zoneAt = (pos) => {
    if (grid.coverAt(pos.x, pos.z) > 0.5 && pos.x > faceAt(pos.z) + 0.5 && pos.y > HIGH_Y - 6) return 'C1_Garden';
    if (pos.x > MOUTH.x - 2 && pos.x < MOUTH.x + 8 && Math.abs(pos.z - MOUTH.z) < 5 && pos.y > HIGH_Y - 6) return 'C1_Garden';
    return null;
  };
  let inside = false, shelter = 0, worldForced = false;
  const camP = new V3();
  let flT = 0, firstRefresh = true;
  const perf = { ms: 0, avg: 0, n: 0, max: 0, first: 0, parts: {} };
  const api = {
    root, rim: rimMesh, rimApi: rim, life, ground: baseG, groundMesh: gm.mesh, mouth, flora, fauna, FLOOR_Y, center: C, field, grid, perf,
    heightAt, ledges,
    hasGroundPatch: false,
    zoneAt,
    /** 0..1: насколько точка защищена от ветра и песка (в чаше ≈ 0.92, у лаза меньше). */
    shelterAt(pos) { const r = radius(pos.x, pos.z), lim = ringIn(ang(pos.x, pos.z)); return pos.x > faceAt(pos.z) ? 0.92 * (1 - smoothstep(lim - 3, lim + 2, r)) : 0; },
    get sheltered() { return shelter; },
    /** Высота земли / вид поверхности / грань Когтя / стена чаши. */
    groundAt: baseG, walkable, faceAt, inBasin, footR, ringRadius: (x, z) => ringIn(ang(x, z)),
    /** Что сад отдаёт рендеру сейчас: вызовы отрисовки и треугольники (по видимым мешам корня, без учёта отсечения по пирамиде и теней). */
    renderStats() {
      let calls = 0, tris = 0, inst = 0; const by = {};
      root.traverseVisible((o) => {
        if (!(o.isMesh || o.isInstancedMesh) || !o.geometry) return;
        const n = o.isInstancedMesh ? o.count : 1; if (!n) return;
        calls++; inst += o.isInstancedMesh ? n : 0;
        const g = o.geometry, t = (g.index ? g.index.count : g.attributes.position.count) / 3 * n; tris += t;
        const k = o.name || o.parent?.name || o.type; const e = by[k] || (by[k] = { calls: 0, tris: 0 }); e.calls++; e.tris += Math.round(t);
      });
      const top = Object.entries(by).sort((a, b) => b[1].tris - a[1].tris).slice(0, 12).map(([k, v]) => `${k}:${v.calls}/${v.tris}`);
      return { calls, tris: Math.round(tris), instances: inst, top };
    },
    stats: { tris: rimData.index.length / 3, groundTris: gm.tris, instances: flora.total, buildMs: 0 },
    update(dt, t) {
      const tp = performance.now();
      const w = game.weather, wd = w?.windDir, ws = w?.windSpeed ?? 4;
      let dx = GWIND.value.x, dz = GWIND.value.y;
      if (wd) { const l = Math.hypot(wd.x, wd.z) || 1; dx = wd.x / l; dz = wd.z / l; }
      GWIND.value.set(dx, dz, 0.03 + 0.12 * clamp(ws / 14, 0, 1) * (1 - 0.7 * shelter), t);
      const cam = game.camera.position;
      const dC = Math.hypot(cam.x - C.x, cam.z - C.z);
      const dM = Math.hypot(cam.x - MOUTH.x, cam.z - MOUTH.z);
      // сад виден, когда игрок в пустыне рядом или в туннеле у лаза (вид наружу), но не из глубины сиетча
      const seen = game.space === 'desert' || dM < 70;
      // Из туннеля (пространство sietch) вид наружу: небо должно быть включено, пока лаз рядом (иначе в проёме чёрный фон).
      if (game.space === 'sietch') {
        if (dM < 36 && world.visible === false) { world.setVisible?.(true); worldForced = true; }
        else if (dM > 44 && worldForced) { world.setVisible?.(false); worldForced = false; }
      } else worldForced = false;
      const near = (dC < 150 && seen) || dM < 70;
      root.visible = seen && dC < 520;
      if (flora.visible !== near) { flora.visible = near; flora.setVisible(near); }
      if (!near) { perf.ms = 0; return; }
      const p = game.player?.position;
      if (p) {
        const z = zoneAt(p) === 'C1_Garden';
        shelter = damp1(shelter, z ? 1 : 0, 2, dt);
        if (z && !inside) { inside = true; bus.emit('garden:enter', { x: p.x, z: p.z }); }
        else if (!z && inside) { inside = false; bus.emit('garden:leave', { x: p.x, z: p.z }); }
      }
      // разбивка по частям — только для первых кадров (поиск разовых фризов)
      const prof = perf.n < 3; let tq = prof ? performance.now() : 0;
      const lap = (k) => { if (prof) { const n = performance.now(); perf.parts[k] = Math.max(perf.parts[k] || 0, n - tq); tq = n; } };
      flT -= dt;
      if (flT <= 0 || firstRefresh) { flT = 0.35; camP.copy(cam); flora.refresh(camP, firstRefresh); firstRefresh = false; }
      lap('flora');
      fauna.update(dt, t); lap('fauna');
      life.update(dt, t, cam, p, groundTop); lap('life');
      const ms = performance.now() - tp;
      if (!perf.first) perf.first = ms;
      perf.ms = ms; perf.n++;
      if (perf.n > 1) { perf.avg += (ms - perf.avg) / Math.min(perf.n - 1, 120); if (ms > perf.max) perf.max = ms; }   // первый кадр — отдельно (perf.first)
    },
  };
  api.stats.buildMs = performance.now() - t0;
  game.add('garden', api);
  // Прогрев шейдеров заранее (иначе первый взгляд на сад/лаз даёт фриз компиляции программ): асинхронно, без блокировки кадра.
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
