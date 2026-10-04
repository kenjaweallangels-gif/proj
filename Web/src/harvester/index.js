// Добывающий комбайн («харвестер») гильдии Сарт-Макр: ~113 x 45 x 35 м, рабочий — запускается пультом у трапа.
// Модуль: game.harvester. См. README.md.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, rng } from '../core/util.js';
import { Parts } from './parts.js';
import { createHullMaterial, createGlowMaterial, createDecalTexture, createDecalMaterial, buildDecals, createSandMaterial } from './material.js';
import { SINK, DOOR, FA, CC } from './layout.js';
import { EXT_SOLIDS } from './plan_ext.js';
import { createInterior } from './interior.js';
import { createBerm } from './berm.js';
import { buildHarvester, SCOOP_PIVOT, AUGER_POS, TOWERS, FANS, STACKS, KLAXON, BEACONS, BELT, CONSOLE_POS, SPILL, FLOODS, DIM, C } from './hull.js';
import { createTracks, TRK, UNITS } from './tracks.js';
import { createParticles, createBeams, P_SPICE, P_SAND, P_SMOKE, P_HEAT } from './fx.js';
import { createCarryall } from './carryall.js';
import { colliders } from '../core/colliders.js';
import { createWreck, createStain } from './wreck.js';

export const START = { x: 330, z: -60, heading: 0 };   // метры раскладки; heading — направление (cos, sin) в (x, z); 0 = вдоль +X
const V_MAX = 1.5;           // м/с
const R_TURN = 30;           // радиус большой петли, м (диаметр 60 м — не уходит далеко от старта)
const SCOOP_RAISE = 0.22;     // рад, подъём ковша
const FOOT_STEP = 3.6;       // м между штампами колеи

export function create(game) {
  const { scene, bus } = game;
  const quality = game.settings?.quality || 'med';
  const qf = quality === 'low' ? 0.45 : quality === 'high' ? 1.4 : 1;
  const shadows = quality !== 'low';
  const R = rng(2025);
  const rnd = Math.random;

  const ground = (x, z) => game.world?.heightAt?.(x, z) ?? 0;

  // ------------------------------------------------------------ геометрия и материалы
  const G = buildHarvester(quality);
  const hullMat = createHullMaterial(quality);
  const glowMat = createGlowMaterial(true);
  const lampMat = createGlowMaterial(false);
  const decalTex = createDecalTexture();
  const decalMat = createDecalMaterial(decalTex);

  const root = new THREE.Group();
  root.name = 'Harvester';
  scene.add(root);
  const near = new THREE.Group();   // детальная часть
  const far = new THREE.Group();    // упрощённый корпус
  root.add(near, far);

  const mk = (geo, mat, parent = near, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.castShadow = shadow && shadows; m.receiveShadow = shadows;
    parent.add(m); return m;
  };
  const mainMesh = mk(G.main, hullMat, near, false);
  const glowMesh = mk(G.glow, glowMat, near, false);
  const decalMesh = new THREE.Mesh(buildDecals(G.decals), decalMat);
  decalMesh.frustumCulled = false; decalMesh.renderOrder = 2; near.add(decalMesh);
  const farMesh = mk(G.far, hullMat, far, false);
  // прокси-кастер теней: упрощённая геометрия (в десятки раз легче детального корпуса), не рисуется в основном проходе,
  // чуть уменьшена (0.97), чтобы корпус не затенял сам себя
  const shadowProxy = (() => {
    const g = G.far.clone();
    const S = new THREE.Matrix4().makeTranslation(0, 17, 0).multiply(new THREE.Matrix4().makeScale(0.97, 0.97, 0.97)).multiply(new THREE.Matrix4().makeTranslation(0, -17, 0));
    g.applyMatrix4(S);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    m.frustumCulled = false; m.castShadow = shadows; m.receiveShadow = false; m.name = 'HarvesterShadowProxy';
    root.add(m); return m;
  })();
  const sandMesh = mk(G.sand, hullMat, root, false);   // наносы на кровлях (видны и издали)
  sandMesh.receiveShadow = shadows;
  // наносы: материал ландшафта (тот же шейдер → без шва по цвету/ряби), маски грунта — из поля пустыни; в студии без пустыни — запасной песок
  const surfMat = game.world?.terrain?.makeSurfaceMaterial?.();
  const fieldMasks = game.world?._field?.masks;
  const berm = createBerm(surfMat || createSandMaterial(quality), { maskAt: fieldMasks ? (x, z, out) => fieldMasks(x, z, out) : null });
  root.add(berm.mesh);
  // интерьер (строится лениво, рисуется только когда камера у корпуса/внутри)
  const interior = createInterior(game, root, quality);
  // дверь-шторка у трапа: закрыта издали, поднимается, когда камера рядом
  const doorW = DOOR.x1 - DOOR.x0, doorH = DOOR.y1 - DOOR.y0;
  const doorMesh = (() => {
    const P = new Parts(81);
    P.box(0, 0, 0, doorW + 0.2, doorH + 0.1, 0.3, '#4b554f', 0);
    P.box(0, 0, 0.17, doorW - 0.5, doorH - 0.5, 0.05, '#2c3234', 3);
    for (let i = 0; i < 5; i++) P.box(0, -doorH / 2 + 0.35 + i * 0.7, 0.2, doorW - 0.3, 0.12, 0.05, '#c79a1c', 4);
    P.box(doorW / 2 - 0.5, 0, 0.22, 0.12, 0.8, 0.1, '#8c8e8b', 1);
    const m = new THREE.Mesh(P.merge(), hullMat);
    m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
    m.position.set((DOOR.x0 + DOOR.x1) / 2, DOOR.y0 + doorH / 2, DOOR.z + 0.05);
    root.add(m); return m;
  })();
  const doorC = new THREE.Vector3((DOOR.x0 + DOOR.x1) / 2, FA + 1.8, DOOR.z + 2);
  let doorOpen = 0;
  const _inv = new THREE.Matrix4(), _cl = new THREE.Vector3(), _lp = new THREE.Vector3(), _wp = new THREE.Vector3();

  // гусеницы
  const tracks = createTracks(game, hullMat, quality);
  near.add(tracks.group);
  tracks.meshes.forEach((m) => { m.castShadow = false; m.receiveShadow = shadows; });

  // ковш + шнек
  const scoopGroup = new THREE.Group();
  scoopGroup.position.copy(SCOOP_PIVOT);
  near.add(scoopGroup);
  const scoopMesh = mk(G.scoop, hullMat, scoopGroup, false);
  const augerMesh = mk(G.auger, hullMat, scoopGroup);
  const scoopDecalMesh = new THREE.Mesh(buildDecals(G.scoopDecals.map((d) => ({ ...d, c: [d.c[0] - SCOOP_PIVOT.x, d.c[1] - SCOOP_PIVOT.y, d.c[2] - SCOOP_PIVOT.z] }))), decalMat);
  scoopDecalMesh.frustumCulled = false; scoopDecalMesh.renderOrder = 2; scoopGroup.add(scoopDecalMesh);
  augerMesh.position.copy(AUGER_POS).sub(SCOOP_PIVOT);

  // барабаны центрифуг, вентиляторы, радар
  const drums = new THREE.InstancedMesh(G.drum, hullMat, TOWERS.length);
  const fans = new THREE.InstancedMesh(G.fan, hullMat, 2);
  const radar = mk(G.radar, hullMat);
  radar.position.set(28, 32.6, 10);
  for (const m of [drums, fans]) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = shadows; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); near.add(m); }

  // перила (стойки), болты, рёбра радиатора, планки ленты
  const inst = (geo, list, fn, mat = hullMat, shadow = false) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    list.forEach((it, i) => { fn(it, p, q, s); m4.compose(p, q, s); m.setMatrixAt(i, m4); });
    m.count = list.length; m.frustumCulled = false; m.castShadow = shadow && shadows; m.receiveShadow = shadows;
    m.instanceMatrix.needsUpdate = true; near.add(m); return m;
  };
  const postGeo = new Parts(1).box(0, 0.5, 0, 0.09, 1, 0.09, C.YEL, 1).merge();
  inst(postGeo, G.posts, (it, p, q, s) => { p.set(it.x, it.y, it.z); q.identity(); s.set(1, it.h, 1); });
  const boltGeo = new Parts(2).cyl(0, 0, 0, 0.17, 0.17, 0.16, '#8a8176', 1, { axis: 'z', seg: 6 }).merge();
  inst(boltGeo, G.bolts, (it, p, q, s) => { p.set(it.x, it.y, it.z); q.identity(); s.set(1, 1, 1); });
  const finGeo = new Parts(3).box(0, 0, 0, 3.4, 7.2, 0.07, '#6b6259', 1).merge();
  inst(finGeo, G.fins, (it, p, q, s) => { p.set(it.x, it.y, it.z); q.identity(); s.set(1, 1, 1); });

  // планки ленты (движутся)
  const beltA = new THREE.Vector2(...BELT.a), beltB = new THREE.Vector2(...BELT.b);
  const beltDir = beltB.clone().sub(beltA); const beltLen = beltDir.length(); beltDir.normalize();
  const beltAng = Math.atan2(beltDir.y, beltDir.x);
  const cleatGeo = new Parts(4).box(0, 0.22, 0, 0.32, 0.4, BELT.halfW * 2 - 0.3, '#4a443d', 3).merge();
  const nCleat = Math.floor(beltLen / 1.5);
  const cleats = new THREE.InstancedMesh(cleatGeo, hullMat, nCleat);
  cleats.frustumCulled = false; cleats.instanceMatrix.setUsage(THREE.DynamicDrawUsage); near.add(cleats);

  // маяки: красные (навигационные) + янтарные (клаксоны)
  const lampGeo = new THREE.SphereGeometry(0.4, 10, 8);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, BEACONS.length + KLAXON.length);
  lamps.frustumCulled = false; near.add(lamps);
  {
    const m4 = new THREE.Matrix4();
    [...BEACONS, ...KLAXON].forEach((p, i) => { m4.makeScale(i < BEACONS.length ? 1 : 1.4, i < BEACONS.length ? 1 : 1.4, i < BEACONS.length ? 1 : 1.4).setPosition(p[0], p[1], p[2]); lamps.setMatrixAt(i, m4); lamps.setColorAt(i, new THREE.Color(1, 0.2, 0.1)); });
    lamps.instanceMatrix.needsUpdate = true;
  }
  const beams = createBeams(KLAXON);
  near.add(beams.mesh);

  // свет (ровно 4, интенсивность — по времени суток; число источников не меняем, чтобы не пересобирать шейдеры)
  const spots = FLOODS.map((p) => {
    const l = new THREE.SpotLight(0xfff0d0, 0, 170, 0.5, 0.65, 2);
    l.position.set(p[0], p[1], p[2]);
    l.target.position.set(p[0] + 60, 0, p[2] - 4);
    root.add(l, l.target);
    return l;
  });
  const workLight = new THREE.PointLight(0xffb060, 0, 55, 2);
  workLight.position.set(50, SINK + 7.5, 0); root.add(workLight);
  const consoleLight = new THREE.PointLight(0xffd9a0, 0, 26, 2);
  consoleLight.position.set(CONSOLE_POS.x - 1.5, SINK + 4.0, CONSOLE_POS.z + 0.5); root.add(consoleLight);

  // частицы
  const particles = createParticles(game, Math.round(1100 * qf));
  scene.add(particles.mesh);

  // перевозчик (тяжёлый орнитоптер)
  const carryall = createCarryall(game, hullMat, glowMat, lampMat, quality, decalMat);
  scene.add(carryall.group, carryall.cabMesh, carryall.pod);
  const wreck = createWreck(game);
  const stain = createStain(game);
  const stainGroup = new THREE.Group(); stainGroup.add(stain.mesh);
  scene.add(wreck.group, stainGroup);

  // ------------------------------------------------------------ состояние
  const S = { state: 'off', t: 0, eng: 0, scoop: 0, belt: 0, drive: 0, plume: 0, smoke: 0, heat: 0, klax: 0, klaxT: 0 };
  const H = {
    x: START.x, z: START.z, h: START.heading, v: 0, omega: 0, y: 0, pitch: 0, roll: 0,
    occupied: false, beltPhase: 0, alarm: 0, alarmTarget: 0, flareT: -1, flareP: new THREE.Vector3(), flareV: new THREE.Vector3(), lift: 0, devoured: false, blockT: 0, brake: 0, blockedByWorm: false, drumA: 0, fanA: 0, augerA: 0, radarA: 0, klaxA: 0, footAcc: 0, footSide: 0, noiseT: 0, trackSpeed: [0, 0, 0, 0],
  };
  const dir = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  const consoleWorld = new THREE.Vector3();
  const interactable = {
    position: new THREE.Vector3(), radius: 4.0, tag: 'Rakis.Harvester', enabled: true,
    label: { RU: 'Завести харвестер', EN: 'Start the harvester' },
    onInteract: () => harvester.toggle(),
  };
  game.interactables.push(interactable);
  // второй пульт — на мостике (внутри): та же команда
  const interactable2 = { position: new THREE.Vector3(1e6, 0, 0), radius: 2.4, tag: 'Rakis.Harvester', enabled: false, label: { RU: 'Завести харвестер', EN: 'Start the harvester' }, onInteract: () => harvester.toggle() };
  game.interactables.push(interactable2);

  // ------------------------------------------------------------ управление
  const emitState = (st) => bus.emit('harvester', { state: st });
  function worldPos(out = new THREE.Vector3()) { return out.set(H.x, H.y + 10, H.z); }
  const audio = (id) => { try { game.audio?.event?.(id, worldPos(tmpV2)); } catch (e) { /* аудио не критично */ } };

  function setState(st) {
    S.state = st; S.t = 0;
    emitState(st);
    updateInteractable();
  }
  function updateInteractable() {
    const run = S.state === 'running', off = S.state === 'off';
    interactable.enabled = run || off;
    interactable.label = run ? { RU: 'Заглушить', EN: 'Shut down' } : { RU: 'Завести харвестер', EN: 'Start the harvester' };
    interactable2.label = interactable.label;
  }

  // ------------------------------------------------------------ коллизия
  const BOXES = [[-55.5, -22.8, 40.8, 22.8], [40.8, -20.8, 58, 20.8]];   // [x0, z0, x1, z1] в локальной системе
  function collideLocal(pos, r) {
    const dx = pos.x - H.x, dz = pos.z - H.z;
    if (dx * dx + dz * dz > 75 * 75) return false;
    const c = Math.cos(H.h), s = Math.sin(H.h);
    let lx = dx * c + dz * s, lz = -dx * s + dz * c;
    let hit = false;
    // высота ступней в локальной системе (для боксов с вертикальным диапазоном: опоры трапа, пульт, балки)
    const ly = pos.y - H.y;
    for (let it = 0; it < 2; it++) {
      for (const [x0, z0, x1, z1] of BOXES) {
        const cx = clamp(lx, x0, x1), cz = clamp(lz, z0, z1);
        let ex = lx - cx, ez = lz - cz;
        const d2 = ex * ex + ez * ez;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); lx = cx + ex / d * (r + 0.01); lz = cz + ez / d * (r + 0.01); }
        else { // внутри: выталкиваем через ближайшую грань
          const o = [lx - x0, x1 - lx, lz - z0, z1 - lz]; const m = Math.min(...o);
          if (m === o[0]) lx = x0 - r - 0.01; else if (m === o[1]) lx = x1 + r + 0.01; else if (m === o[2]) lz = z0 - r - 0.01; else lz = z1 + r + 0.01;
        }
        hit = true;
      }
      for (const b of EXT_SOLIDS) {
        if (b.y1 <= ly + 0.38 || b.y0 >= ly + 1.75) continue;
        const cx = clamp(lx, b.x0, b.x1), cz = clamp(lz, b.z0, b.z1);
        const ex = lx - cx, ez = lz - cz, d2 = ex * ex + ez * ez;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); lx = cx + ex / d * (r + 0.01); lz = cz + ez / d * (r + 0.01); }
        else { const o = [lx - b.x0, b.x1 - lx, lz - b.z0, b.z1 - lz]; const m = Math.min(...o); if (m === o[0]) lx = b.x0 - r - 0.01; else if (m === o[1]) lx = b.x1 + r + 0.01; else if (m === o[2]) lz = b.z0 - r - 0.01; else lz = b.z1 + r + 0.01; }
        hit = true;
      }
    }
    if (hit) { pos.x = H.x + lx * c - lz * s; pos.z = H.z + lx * s + lz * c; }
    return hit;
  }

  // Твёрдые тела в общем реестре (core/colliders.js): корпус и ковш — повёрнутые боксы (owner 'harvester'); обновляются по ходу движения.
  const COL_DEFS = [
    { name: 'hull', x0: BOXES[0][0], z0: BOXES[0][1], x1: BOXES[0][2], z1: BOXES[0][3], h: 38 },
    { name: 'scoop', x0: BOXES[1][0], z0: BOXES[1][1], x1: BOXES[1][2], z1: BOXES[1][3], h: 22 },
  ];
  const cols = COL_DEFS.map((d) => {
    const id = colliders.add({ type: 'box', owner: 'harvester', c: new THREE.Vector3(), half: new THREE.Vector3((d.x1 - d.x0) / 2, d.h / 2, (d.z1 - d.z0) / 2), yaw: 0, tags: new Set(['harvester', d.name]) });
    return { def: d, e: colliders.get(id) };
  });
  // Мелкие твёрдые элементы входа (пульт, опоры и настил трапа, ноги площадки, фонари): боксы того же реестра, всегда твёрдые.
  // Игрок на борту (трап/интерьер) их игнорирует вместе с корпусом (ignore 'harvester' в game.collide).
  const extCols = EXT_SOLIDS.map((b) => {
    const id = colliders.add({ type: 'box', owner: 'harvester', c: new THREE.Vector3(), half: new THREE.Vector3((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, (b.z1 - b.z0) / 2), yaw: 0, tags: new Set(['harvester', 'entrance']) });
    return { b, e: colliders.get(id) };
  });
  let colsEnabled = true;
  function syncColliders() {
    const c = Math.cos(H.h), s = Math.sin(H.h);
    for (const { def, e } of cols) {
      const lx = (def.x0 + def.x1) / 2, lz = (def.z0 + def.z1) / 2;
      e.c.set(H.x + lx * c - lz * s, H.y + def.h / 2 - 0.5, H.z + lx * s + lz * c);
      e.yaw = H.h;
      e.solid = colsEnabled && !H.occupied;
    }
    for (const { b, e } of extCols) {
      const lx = (b.x0 + b.x1) / 2, lz = (b.z0 + b.z1) / 2;
      e.c.set(lx, (b.y0 + b.y1) / 2, lz).applyMatrix4(root.matrixWorld);   // с учётом крена/тангажа машины на рельефе
      e.yaw = H.h;
      e.solid = colsEnabled;
    }
  }

  const probe = { type: 'sphere', c: new THREE.Vector3(), r: 28 };
  const WORM_PROBE_X = [-48, -28, -8, 12, 32, 52];
  /** Заденет ли корпус тело червя (owner 'worm') — сейчас или через 1…5 с по дуге петли. */
  function wormInTheWay() {
    let x = H.x, z = H.z, h = H.h;
    const v = V_MAX, om = v / R_TURN;
    for (let k = 0; k <= 5; k++) {
      const c = Math.cos(h), s = Math.sin(h);
      for (const lx of WORM_PROBE_X) {
        probe.c.set(x + lx * c, H.y + SINK + 6, z + lx * s);
        if (colliders.overlaps(probe, { ignore: 'harvester' }).some((o) => o.entry.owner === 'worm')) return true;
      }
      for (let i = 0; i < 10; i++) { h -= om * 0.1; x += Math.cos(h) * v * 0.1; z += Math.sin(h) * v * 0.1; }
    }
    return false;
  }

  // ------------------------------------------------------------ борт: «подпространство» харвестера (как сиетч): трап, интерьер
  // Объём корпуса (локальные координаты): внутри него, пока игрок «на борту», он остаётся на борту, даже если на миг нет пола под ногами
  // (шов комнат, прыжок, подоконник): без этого contains() мигало в false и игрока выталкивали наружу силуэтом корпуса.
  const HULL_VOL = { x0: -51.5, x1: 38.0, z0: -20.0, z1: 20.0, y0: FA - 1.5, y1: CC + 1.0 };
  let stickyIn = false;
  const inHullVol = (v) => v.x > HULL_VOL.x0 && v.x < HULL_VOL.x1 && v.z > HULL_VOL.z0 && v.z < HULL_VOL.z1 && v.y > HULL_VOL.y0 && v.y < HULL_VOL.y1;
  const nearPlayer = (pos) => { const pp = game.player?.position; return !!pp && (pos === pp || (Math.abs(pos.x - pp.x) < 0.8 && Math.abs(pos.z - pp.z) < 0.8 && Math.abs(pos.y - pp.y) < 1.6)); };
  function containsPos(pos) {
    if (!interior.ready) return false;
    const dx = pos.x - H.x, dz = pos.z - H.z;
    if (dx * dx + dz * dz > 85 * 85) return false;
    _lp.copy(pos).applyMatrix4(_inv);
    const np = nearPlayer(pos);
    if (interior.contains(_lp.x, _lp.z, _lp.y)) { if (np) stickyIn = true; return true; }
    if (stickyIn && np) {
      if (inHullVol(_lp)) return true;
      stickyIn = false;
    }
    return false;
  }
  /** Игрок на борту, а машину подняли/потащили (сценарий): высаживаем у подножия трапа. */
  function evacuate() {
    const pl = game.player;
    if (!pl?.teleport) return;
    const w = harvester.toWorld(CONSOLE_POS.x + 6, 0, CONSOLE_POS.z + 4, new THREE.Vector3());
    pl.teleport(w.x, ground(w.x, w.z), w.z, undefined, false);
    bus.emit('harvester:board', { inside: false });
  }
  /** Высота пола в точке (x, z), если игрок (ступни на y) находится на борту; иначе высота грунта. */
  function heightAtBoard(x, z, y) {
    if (interior.ready && y !== undefined) {
      const dx = x - H.x, dz = z - H.z;
      if (dx * dx + dz * dz < 85 * 85) {
        _lp.set(x, y, z).applyMatrix4(_inv);
        const f = interior.floorAt(_lp.x, _lp.z, _lp.y);
        if (f && (interior.contains(_lp.x, _lp.z, _lp.y) || y - ground(x, z) > 1.5)) { _wp.set(_lp.x, f.y, _lp.z).applyMatrix4(root.matrixWorld); return _wp.y; }
        // на борту, но под ногами на миг нет пола: стоим на месте (а не «падаем» на грунт сквозь корпус)
        if (stickyIn && !f && inHullVol(_lp) && nearPlayer(_wp.set(x, y, z))) return y;
      }
    }
    return ground(x, z);
  }
  /** Высота пола борта под точкой (мир) или null, если точка не на борту. Для камеры (не уходит под пол). */
  function boardFloorAt(x, z, y) {
    if (!interior.ready) return null;
    const dx = x - H.x, dz = z - H.z;
    if (dx * dx + dz * dz > 85 * 85) return null;
    _lp.set(x, y, z).applyMatrix4(_inv);
    if (!interior.contains(_lp.x, _lp.z, _lp.y)) return null;
    const f = interior.floorAt(_lp.x, _lp.z, _lp.y);
    if (!f) return null;
    _wp.set(_lp.x, f.y, _lp.z).applyMatrix4(root.matrixWorld); return _wp.y;
  }
  /** Нижняя поверхность плиты над головой (мир), Infinity — открыто. Работает, пока точка на борту. */
  function ceilingAtBoard(x, z, y) {
    if (!interior.ready) return Infinity;
    const dx = x - H.x, dz = z - H.z;
    if (dx * dx + dz * dz > 85 * 85) return Infinity;
    _lp.set(x, y, z).applyMatrix4(_inv);
    if (!interior.contains(_lp.x, _lp.z, _lp.y) && !(stickyIn && inHullVol(_lp))) return Infinity;
    const c = interior.ceilingAt(_lp.x, _lp.z, _lp.y, 0);
    if (c === Infinity) return Infinity;
    _wp.set(_lp.x, c, _lp.z).applyMatrix4(root.matrixWorld); return _wp.y;
  }
  const _co = { x: 0, z: 0 };
  /** Столкновения на борту (стены, мебель, перила); снаружи — силуэт корпуса. true — было столкновение. */
  function collideBoard(pos, r) {
    if (containsPos(pos)) {
      _lp.copy(pos).applyMatrix4(_inv);
      _co.x = _lp.x; _co.z = _lp.z;
      if (!interior.collide(_co, _lp.y, r)) return false;
      _wp.set(_co.x, _lp.y, _co.z).applyMatrix4(root.matrixWorld);
      pos.x = _wp.x; pos.z = _wp.z;
      return true;
    }
    return collideLocal(pos, r);
  }

  // ------------------------------------------------------------ посадка на рельеф
  const SX = [TRK.cx, -TRK.cx], SZ = [-TRK.cz, TRK.cz];
  function sampleGround(first) {
    const c = Math.cos(H.h), s = Math.sin(H.h);
    const hs = [];
    for (const lx of SX) for (const lz of SZ) hs.push(ground(H.x + lx * c - lz * s, H.z + lx * s + lz * c));
    // порядок: [rear-port, rear-star?]: SX[0]=front
    const hFL = hs[0], hFR = hs[1], hRL = hs[2], hRR = hs[3];
    const y = (hFL + hFR + hRL + hRR) / 4;
    const pitch = Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, 2 * TRK.cx);
    const roll = -Math.atan2((hFR + hRR) / 2 - (hFL + hRL) / 2, 2 * TRK.cz);
    return { y, pitch, roll };
  }
  // Сценарная поза (червь «пожирает» харвестер): {x,y,z — начало координат модели (мир), pitch — нос вниз, рад, roll}. null — штатное движение.
  let scriptPose = null;
  const _eul = new THREE.Euler(), _qq = new THREE.Quaternion();
  function applyTransform(dt, first) {
    if (scriptPose) {
      root.position.set(scriptPose.x, scriptPose.y, scriptPose.z);
      root.rotation.set(scriptPose.roll || 0, -H.h, -scriptPose.pitch, 'YZX');
      root.updateMatrixWorld(true);
      _inv.copy(root.matrixWorld).invert();
      return;
    }
    const g = sampleGround();
    const k = first ? 1 : 1 - Math.exp(-dt * 3);
    H.y += (g.y - SINK + 0.1 - H.y) * k; H.pitch += (g.pitch - H.pitch) * k; H.roll += (g.roll - H.roll) * k;
    root.position.set(H.x, H.y + H.lift, H.z);
    root.rotation.set(H.roll, -H.h, H.pitch, 'YZX');
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
  }

  // ------------------------------------------------------------ выбросы частиц
  const acc = { spice: 0, sand: 0, lip: 0, smoke: 0, heat: 0, slide: 0 };
  const _cs = { x: 0, y: 0, z: 0, dx: 0, dz: 0, slope: 0 };
  const rot = new THREE.Matrix3();
  function toWorld(lx, ly, lz, out) { return out.set(lx, ly, lz).applyMatrix4(root.matrixWorld); }
  function dirWorld(lx, ly, lz, out) { return out.set(lx, ly, lz).transformDirection(root.matrixWorld).multiplyScalar(Math.hypot(lx, ly, lz)); }
  const pw = new THREE.Vector3(), vw = new THREE.Vector3();

  function emitParticles(dt) {
    const moving = Math.abs(H.v) > 0.02;
    // 1) шлейф пряной пыли из выгрузного раструба
    acc.spice += dt * 70 * qf * S.plume;
    while (acc.spice >= 1) {
      acc.spice -= 1;
      toWorld(SPILL.x - rnd() * 1.5, SPILL.y + rnd() * 2, (rnd() - 0.5) * 12, pw);
      dirWorld(-(9 + rnd() * 6), 3.5 + rnd() * 5, (rnd() - 0.5) * 5, vw);
      particles.emit(P_SPICE, pw.x, pw.y, pw.z, vw.x, vw.y, vw.z, 6 + rnd() * 5, 4 + rnd() * 4, 0.24, 3.8, { wind: 1.25, buoy: 0.7, drag: 0.32 });
    }
    // 2) песок из-под гусениц и из ковша
    if (moving && S.drive > 0.05) {
      acc.sand += dt * 12 * qf * S.drive * 4;
      while (acc.sand >= 1) {
        acc.sand -= 1;
        const u = UNITS[Math.floor(rnd() * 4)], rear = rnd() < 0.55;
        toWorld(u.x + (rear ? -TRK.sprocketDX - 3 : TRK.sprocketDX + 3.5) + (rnd() - 0.5) * 3, SINK + 0.4, u.z + (rnd() - 0.5) * 6.5, pw);
        dirWorld(rear ? -(2 + rnd() * 5) : (1 + rnd() * 3), 2 + rnd() * 5, (rnd() - 0.5) * 5, vw);
        particles.emit(P_SAND, pw.x, pw.y, pw.z, vw.x, vw.y, vw.z, 1.6 + rnd() * 1.8, 1.6 + rnd() * 1.6, 0.4, 3, { wind: 0.7, buoy: 0, drag: 0.9 });
      }
    }
    // песок сыплется по осыпям наноса у борта и пылит ветром с гребней (пока машина работает); без игрока рядом не считаем
    if (S.state !== 'off' && S.eng > 0.3 && berm.ready && game.camera.position.distanceToSquared(root.position) < 160 * 160) {
      acc.slide += dt * 16 * qf * S.eng;
      while (acc.slide >= 1) {
        acc.slide -= 1;
        if (!berm.crestSample(rnd, _cs)) break;
        // дрожь корпуса подрывает гребни: зерно скользит вниз по склону, часть уносится ветром (мелкая пыль вдоль гребня)
        toWorld(_cs.x, _cs.y + 0.15, _cs.z, pw);
        dirWorld(_cs.dx * (0.6 + rnd() * 1.4), -0.2, _cs.dz * (0.6 + rnd() * 1.4), vw);
        particles.emit(P_SAND, pw.x, pw.y, pw.z, vw.x, vw.y, vw.z, 1.4 + rnd() * 1.4, 0.5 + rnd() * 0.6, 0.35, 2.2, { wind: 0.9, buoy: 0.05, drag: 1.4 });
      }
    }
    if (S.scoop > 0.7 && S.belt > 0.3) {
      acc.lip += dt * 28 * qf * S.belt;
      while (acc.lip >= 1) {
        acc.lip -= 1;
        toWorld(55 + rnd() * 3, SINK + 0.4, (rnd() - 0.5) * 38, pw);
        dirWorld(3 + rnd() * 7, 3 + rnd() * 6, (rnd() - 0.5) * 4, vw);
        particles.emit(P_SAND, pw.x, pw.y, pw.z, vw.x, vw.y, vw.z, 1.8 + rnd() * 1.8, 2.2 + rnd() * 2, 0.4, 2.8, { wind: 0.7, buoy: 0, drag: 0.8 });
      }
      // клубы пряности над горловиной
      if (rnd() < dt * 6 * qf) {
        toWorld(46 + rnd() * 6, 9 + rnd() * 3, (rnd() - 0.5) * 30, pw);
        particles.emit(P_SPICE, pw.x, pw.y, pw.z, 0, 1.5, 0, 3 + rnd() * 2, 3 + rnd() * 2, 0.25, 3, { wind: 1, buoy: 1.2, drag: 0.5 });
      }
    }
    // 3) дым и марево из труб
    const nSt = STACKS.length;
    if (S.smoke > 0.02) {
      acc.smoke += dt * 9 * nSt * qf * S.smoke;
      while (acc.smoke >= 1) {
        acc.smoke -= 1;
        const st = STACKS[Math.floor(rnd() * nSt)];
        toWorld(st[0], st[1] + 1.4, st[2], pw);
        dirWorld((rnd() - 0.5) * 1.5, 4 + rnd() * 4, (rnd() - 0.5) * 1.5, vw);
        particles.emit(P_SMOKE, pw.x, pw.y, pw.z, vw.x, vw.y, vw.z, 5 + rnd() * 3, 1.4 + rnd() * 1.0, 0.6, 5, { wind: 1.0, buoy: 1.4, drag: 0.55 });
      }
    }
    if (S.heat > 0.02) {
      acc.heat += dt * 7 * nSt * qf * S.heat;
      while (acc.heat >= 1) {
        acc.heat -= 1;
        const st = STACKS[Math.floor(rnd() * nSt)];
        toWorld(st[0] + (rnd() - 0.5) * 1.2, st[1] + 1.2, st[2] + (rnd() - 0.5) * 1.2, pw);
        particles.emit(P_HEAT, pw.x, pw.y, pw.z, 0, 4 + rnd() * 3, 0, 2.5 + rnd(), 2.2 + rnd() * 1.5, 0.18, 2.5, { wind: 1.0, buoy: 2.2, drag: 0.4 });
      }
      // лёгкий серый выхлоп на ходу
      if (S.state === 'running' && rnd() < dt * 2 * qf) {
        const st = STACKS[Math.floor(rnd() * nSt)];
        toWorld(st[0], st[1] + 1.4, st[2], pw);
        particles.emit(P_SMOKE, pw.x, pw.y, pw.z, 0, 4, 0, 4, 1.2, 0.16, 4, { wind: 1, buoy: 1.8, drag: 0.5 });
      }
    }
  }

  // ------------------------------------------------------------ колея
  function stampTracks() {
    const w = game.world;
    if (!w?.addFootprint) return;
    const c = Math.cos(H.h), s = Math.sin(H.h);
    const yaw = Math.atan2(c, s);
    // две колеи на борт (передняя и задняя тележки идут по одной линии → углубляют её)
    H.footSide = (H.footSide + 1) % 2;
    for (const u of UNITS) {
      if ((u.x > 0 ? 0 : 1) !== H.footSide && quality === 'low') continue;
      const x = H.x + u.x * c - u.z * s, z = H.z + u.x * s + u.z * c;
      w.addFootprint(x, z, yaw, { type: 'worm', size: 4.3, depth: 1.0 });
    }
  }


  // Колея за гусеницами у СТОЯЩЕЙ машины: несколько штампов «позади» по дуге петли (у идущей — их ставит stampTracks). Один штамп-поза за кадр, когда игрок рядом.
  const rut = { k: 0, n: 7, x: 0, z: 0, h: 0, done: false };
  function stampRutPose() {
    const w = game.world;
    if (!w?.addFootprint) { rut.done = true; return; }
    if (rut.k === 0) { rut.x = H.x; rut.z = H.z; rut.h = H.h; }
    rut.x -= Math.cos(rut.h) * FOOT_STEP; rut.z -= Math.sin(rut.h) * FOOT_STEP; rut.h += FOOT_STEP / R_TURN;
    const c = Math.cos(rut.h), s = Math.sin(rut.h), yaw = Math.atan2(c, s);
    for (const u of UNITS) w.addFootprint(rut.x + u.x * c - u.z * s, rut.z + u.x * s + u.z * c, yaw, { type: 'worm', size: 4.3, depth: 0.7 });
    if (++rut.k >= rut.n) rut.done = true;
  }

  // ------------------------------------------------------------ сценарий «червь пожирает харвестер»: тревога, ракета, поза, обломки
  const _flareTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,235,1)'); g.addColorStop(0.18, 'rgba(255,170,110,0.9)'); g.addColorStop(0.5, 'rgba(255,60,30,0.28)'); g.addColorStop(1, 'rgba(255,40,10,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const flareSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: _flareTex, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  flareSprite.visible = false; flareSprite.renderOrder = 8; scene.add(flareSprite);
  const flashK = () => (0.55 + 0.45 * Math.sin(game.time * 31)) * (H.flareT < 1 ? H.flareT : H.flareT > 12 ? Math.max(0, (16 - H.flareT) / 4) : 1);
  function flareTick(dt, inDesert) {
    if (H.flareT < 0) { flareSprite.visible = false; return; }
    H.flareT += dt;
    const t = H.flareT;
    if (t > 16) { H.flareT = -1; flareSprite.visible = false; return; }
    // взлёт ~3 с (быстрое торможение), затем медленно падает на парашюте со сносом ветром
    const wind = game.weather?.windDir, ws = game.weather?.windSpeed ?? 4;
    if (t < 3.2) H.flareV.y = 62 * Math.exp(-t * 0.9) - 2;
    else H.flareV.y += ((-4.5) - H.flareV.y) * (1 - Math.exp(-dt * 1.5));
    H.flareP.x += (wind ? wind.x * ws * 0.7 : 2) * dt + H.flareV.x * dt; H.flareP.z += (wind ? wind.z * ws * 0.7 : 1) * dt + H.flareV.z * dt; H.flareP.y += H.flareV.y * dt;
    flareSprite.position.copy(H.flareP);
    const f = flashK();
    flareSprite.scale.setScalar(16 + 10 * f);
    flareSprite.material.opacity = Math.min(1, 0.55 + 0.45 * f);
    flareSprite.visible = inDesert;
    if (t < 3.2 || (rnd() < dt * 8 * qf)) particles.emit(P_SMOKE, H.flareP.x, H.flareP.y, H.flareP.z, 0, t < 3.2 ? -2 : 0.5, 0, 3.5 + rnd() * 2, 1.4 + rnd(), 0.45, 4, { wind: 1, buoy: 0.2, drag: 0.8 });
  }
  const _lug = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const LUG_TOP = [[-4, 29.7, 10.5], [-4, 29.7, -10.5], [-26.5, 34.9, 8], [-26.5, 34.9, -8]];
  /** Мировые точки крышевых захватов переносчика (4: нос ±z, корма ±z) — к ним крепятся тросы. */
  function hookPoints(out = _lug) {
    root.updateMatrixWorld(true);
    for (let i = 0; i < 4; i++) out[i].set(LUG_TOP[i][0], LUG_TOP[i][1], LUG_TOP[i][2]).applyMatrix4(root.matrixWorld);
    return out;
  }
  /** Вихрь от винтов переносчика: песчаное кольцо у земли под ним. */
  function carryallFx(dt, inDesert) {
    const cs = carryall.script;
    if (!cs.on || !inDesert || cs.hidden) return;
    const gx = cs.pos.x, gz = cs.pos.z, gy = ground(gx, gz);
    const alt = cs.pos.y - gy;
    const k = 1 - smoothstep(60, 190, alt);
    if (k <= 0.02) return;
    acc.wash = (acc.wash || 0) + dt * 90 * qf * k * (0.6 + 0.4 * cs.strain);
    while (acc.wash >= 1) {
      acc.wash -= 1;
      const a = rnd() * 6.2832, r0 = 6 + rnd() * 26, sp = 12 + rnd() * 16;
      particles.emit(P_SAND, gx + Math.cos(a) * r0, gy + 0.5, gz + Math.sin(a) * r0, Math.cos(a) * sp, 1.5 + rnd() * 3, Math.sin(a) * sp, 2 + rnd() * 2, 3 + rnd() * 3, 0.35, 3.5, { wind: 0.5, buoy: 0, drag: 0.7 });
    }
    game.shake = Math.max(game.shake || 0, 0.05 * k * (1 - smoothstep(40, 260, game.camera.position.distanceTo(cs.pos))));
  }
  function devourNow() {
    if (H.occupied && game.player?.position && containsPos(game.player.position)) evacuate();
    H.occupied = false;
    H.devoured = true; H.alarmTarget = 0; H.alarm = 0;
    Object.assign(S, { state: 'devoured', t: 0, eng: 0, scoop: 0, belt: 0, drive: 0, plume: 0, smoke: 0, heat: 0, klax: 0 });
    scriptPose = null; colsEnabled = false; syncColliders();
    root.visible = false;
    interactable.enabled = false;
    H.v = 0;
    emitState('devoured');
  }
  function restore() {
    H.devoured = false; scriptPose = null; colsEnabled = true;
    H.x = START.x; H.z = START.z; H.h = START.heading; H.lift = 0; H.pitch = 0; H.roll = 0; H.v = 0; H.alarm = 0; H.alarmTarget = 0; H.flareT = -1; H.brake = 0;
    Object.assign(S, { state: 'off', t: 0, eng: 0, scoop: 0, belt: 0, drive: 0, plume: 0, smoke: 0, heat: 0, klax: 0, klaxT: 0 });
    wreck.clear(); stain.hide();
    carryall.script.on = false; carryall.script.hidden = false; carryall.setCables(null); carryall.setPod(_lug[0], 0, false);
    applyTransform(0, true); syncColliders(); updateInteractable(); emitState('off');
  }
  function devouredTick(dt, time, inDesert) {
    root.visible = false;
    particles.mesh.visible = inDesert;
    particles.flush(time);
    carryall.update(dt, time, { x: H.x, y: H.y + SINK, z: H.z, h: H.h, running: false, eng: 0, night: lastNight });
    carryall.group.visible = inDesert && carryall.script.on && !carryall.script.hidden;
    carryall.cabMesh.visible = carryall.group.visible;
    carryallFx(dt, inDesert);
    flareTick(dt, inDesert);
    wreck.update(dt);
    wreck.group.visible = inDesert; stainGroup.visible = inDesert;
  }

  // ------------------------------------------------------------ обновление
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere(new THREE.Vector3(), 78);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), yAx = new THREE.Vector3(0, 1, 0), xAx = new THREE.Vector3(1, 0, 0);
  let lastNight = 0;
  const bermAt = { x: 1e9, z: 0, h: 0, w: 0 };

  function stageValues(dt) {
    S.t += dt;
    const t = S.t, ss = smoothstep;
    if (S.state === 'starting') {
      S.eng = ss(0.4, 6, t); S.scoop = ss(3, 6.5, t); S.belt = ss(5, 7.5, t); S.drive = ss(6, 10, t);
      S.plume = ss(5.5, 9.5, t); S.smoke = t < 6 ? Math.min(1, t / 1.2) : 1 - ss(6, 8.5, t) * 0.92; S.heat = ss(5.5, 9, t); S.klax = 1;
      if (t >= 10) { setState('running'); audio('Harvester.Run'); S.klaxT = 0; }
    } else if (S.state === 'running') {
      S.eng = 1; S.scoop = 1; S.belt = 1; S.drive = 1; S.plume = 1; S.smoke = 0.08; S.heat = 1;
      S.klaxT += dt; S.klax = 1 - smoothstep(3, 5, S.klaxT);
    } else if (S.state === 'stopping') {
      S.drive = 1 - ss(0, 3.8, t); S.plume = 1 - ss(0.5, 4.5, t); S.belt = 1 - ss(1, 4, t); S.scoop = 1 - ss(1, 4.2, t);
      S.eng = 1 - ss(3, 6, t); S.smoke = 0.08 + 0.3 * (1 - ss(0, 2, t)) * (t < 3 ? 1 : 0); S.heat = 1 - ss(2, 6, t); S.klax = 0;
      if (t >= 6.2) { Object.assign(S, { eng: 0, scoop: 0, belt: 0, drive: 0, plume: 0, smoke: 0, heat: 0, klax: 0 }); setState('off'); }
    }
  }

  function update(dt, time) {
    if (dt <= 0) return;
    const inDesert = game.space !== 'sietch';
    if (H.devoured) { devouredTick(dt, time, inDesert); return; }
    stageValues(dt);
    H.alarm += (H.alarmTarget - H.alarm) * (1 - Math.exp(-dt * 4));

    // игрок на борту (трап/интерьер): машина стоит, пока он там; твёрдость корпуса снимается (проходит по схеме интерьера)
    {
      const pp = game.player?.position;
      let occ = !!(pp && interior.ready && containsPos(pp));
      if (occ && (scriptPose || H.lift > 0.4)) { evacuate(); occ = false; }   // машину поднимают/уводят сценарием — игрока высаживаем
      if (occ !== H.occupied) {
        H.occupied = occ;
        bus.emit('harvester:board', { inside: occ });
        audio(occ ? 'Harvester.Board' : 'Harvester.Leave');
      }
    }
    // не ползти на червя: раз в 0.25 с проверяем, не заденет ли корпус (сейчас и через ~5 с по дуге) тело червя; тормозим и ждём
    H.blockT -= dt;
    if (H.blockT <= 0) { H.blockT = 0.25; H.blockedByWorm = S.drive > 0.05 && wormInTheWay(); }
    H.brake += ((H.blockedByWorm ? 1 : 0) - H.brake) * (1 - Math.exp(-dt * (H.blockedByWorm ? 2.5 : 0.8)));
    // кинематика: ползёт по большой петле влево (к -z)
    H.v = (scriptPose || H.holdScript || H.occupied) ? 0 : V_MAX * S.drive * (1 - H.brake);
    H.omega = H.v / R_TURN;
    if (H.v > 1e-4) {
      H.h -= H.omega * dt;
      H.x += Math.cos(H.h) * H.v * dt; H.z += Math.sin(H.h) * H.v * dt;
      H.footAcc += H.v * dt;
      if (H.footAcc > FOOT_STEP) { H.footAcc = 0; stampTracks(); }
    }
    applyTransform(dt, false);
    syncColliders();
    // вал песка вокруг корпуса: привязка к рельефу порциями; при подвесе/сценарной позе — убирается
    const wd = game.weather?.windDir, wAng = wd ? Math.atan2(wd.z, wd.x) : 0;
    let dW = Math.abs(wAng - bermAt.w); if (dW > Math.PI) dW = 2 * Math.PI - dW;
    if (!scriptPose && (berm.busy || !berm.ready || Math.hypot(H.x - bermAt.x, H.z - bermAt.z) > 3 || Math.abs(H.h - bermAt.h) > 0.12 || dW > 0.35)) {
      if (!berm.busy) { bermAt.x = H.x; bermAt.z = H.z; bermAt.h = H.h; bermAt.w = wAng; }
      berm.conform(ground, root, 900, wd ? { x: wd.x, z: wd.z } : null);
    }
    const bermK = scriptPose ? 0 : 1 - smoothstep(0.3, 2.5, H.lift);
    berm.mesh.scale.y = Math.max(bermK, 0.001); berm.mesh.position.y = SINK * (1 - Math.max(bermK, 0.001));
    const camD = game.camera.position.distanceTo(root.position);
    if (!rut.done && inDesert && camD < 90 && S.state === 'off' && !scriptPose) stampRutPose();

    // видимость и LOD
    pm.multiplyMatrices(game.camera.projectionMatrix, game.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    sph.center.set(0, 17, 0).applyMatrix4(root.matrixWorld);
    const inView = inDesert && frustum.intersectsSphere(sph);
    root.visible = inView;
    const isNear = camD < 420;
    near.visible = isNear; far.visible = !isNear;
    shadowProxy.visible = shadows && camD < 450;
    particles.mesh.visible = inDesert; carryall.group.visible = inDesert && !carryall.script.hidden;
    carryall.cabMesh.visible = inDesert && !carryall.script.hidden; wreck.group.visible = inDesert; stainGroup.visible = inDesert;

    // интерактив: пульт у трапа
    consoleWorld.set(CONSOLE_POS.x, 0, CONSOLE_POS.z).applyMatrix4(root.matrixWorld);
    interactable.position.set(consoleWorld.x, ground(consoleWorld.x, consoleWorld.z), consoleWorld.z);
    interactable.enabled = (S.state === 'running' || S.state === 'off') && inDesert;

    // интерьер: строим заранее (камера ближе 170 м), показываем, когда камера у корпуса/внутри; дверь открывается вблизи
    _inv.copy(root.matrixWorld).invert();
    _cl.copy(game.camera.position).applyMatrix4(_inv);
    {
      // Интерьер рисуется, только когда камера ВНУТРИ объёма корпуса, либо снаружи у открытой двери (смотрит в проём).
      // Снаружи при закрытой двери корпус непрозрачен и интерьер скрыт (visible=false): не просвечивает через швы и не тратит кадр.
      const inHull = _cl.x > -52 && _cl.x < 38.5 && _cl.z > -20.7 && _cl.z < 20.7 && _cl.y > FA - 2 && _cl.y < CC + 2;
      const atDoor = doorOpen > 0.02 && _cl.x > -8 && _cl.x < 32 && _cl.z > 19 && _cl.z < 46 && _cl.y > SINK - 3 && _cl.y < FA + 14;
      interior.update(dt, time, S, { build: inDesert && camD < 170 && !scriptPose, visible: inDesert && (inHull || atDoor) && !scriptPose, alarm: H.alarm });
      // шлюз открыт, пока игрок на борту или стоит у двери (трап/площадка); камера, «отъехавшая» от корпуса, дверь не открывает
      const pp = game.player?.position;
      let near = H.occupied;
      if (!near && pp) { _wp.copy(pp).applyMatrix4(_inv); near = _wp.distanceTo(doorC) < 9; }
      const want = interior.ready && inDesert && near && !scriptPose ? 1 : 0;
      doorOpen += (want - doorOpen) * (1 - Math.exp(-dt * 1.6));
      doorMesh.position.y = DOOR.y0 + doorH / 2 + doorOpen * (doorH + 0.3);
      doorMesh.visible = doorOpen < 0.995;
      // створка твёрдая, пока шторка ниже роста игрока (проём закрыт); поднята — проход свободен
      const db = interior.plan.doorBlock;
      if (db) { const shut = doorOpen < 0.47; db.y0 = shut ? db.home.y0 : -1e9; db.y1 = shut ? db.home.y1 : -1e9; }
      if (interior.interactions[0]) {
        const it = interior.interactions[0];
        interactable2.position.set(it.c[0], it.c[1], it.c[2]).applyMatrix4(root.matrixWorld);
        interactable2.enabled = (S.state === 'running' || S.state === 'off') && inDesert && interior.ready;
      }
    }
    // механика (только когда видно и рядом)
    const speeds = H.trackSpeed;
    const B = TRK.cz;
    speeds[0] = speeds[2] = H.v - H.omega * B; speeds[1] = speeds[3] = H.v + H.omega * B;
    if (inView && isNear) {
      tracks.update(dt, speeds);
      H.augerA += dt * 5.5 * S.belt; H.beltPhase += dt * 6.0 * S.belt; H.drumA += dt * 2.6 * S.belt * (0.4 + 0.6 * S.eng); H.fanA += dt * 14 * S.eng; H.radarA += dt * (0.8 + 2.2 * S.eng);
      scoopGroup.rotation.z = (1 - S.scoop) * SCOOP_RAISE;
      augerMesh.rotation.z = H.augerA;
      // барабаны
      TOWERS.forEach(([tx, tz], i) => { q.setFromAxisAngle(yAx, H.drumA * (i ? -1 : 1)); m4.compose(p.set(tx, 29.2, tz), q, one); drums.setMatrixAt(i, m4); });
      drums.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < 2; i++) { q.setFromAxisAngle(xAx, H.fanA * (i ? -1 : 1)); m4.compose(p.set(FANS[i][0], FANS[i][1], FANS[i][2]), q, one); fans.setMatrixAt(i, m4); }
      fans.instanceMatrix.needsUpdate = true;
      radar.rotation.y = H.radarA;
      // лента
      for (let i = 0; i < nCleat; i++) {
        const s = ((i * 1.5 + H.beltPhase) % (nCleat * 1.5));
        const pos = s;
        q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), beltAng);
        m4.compose(p.set(beltA.x + beltDir.x * pos * (beltLen / (nCleat * 1.5)), beltA.y + beltDir.y * pos * (beltLen / (nCleat * 1.5)), 0), q, one);
        cleats.setMatrixAt(i, m4);
      }
      cleats.instanceMatrix.needsUpdate = true;
    }

    // ночное освещение
    const sunY = game.world?.sunDir?.y ?? 0.5;
    const night = 1 - smoothstep(-0.03, 0.2, sunY);
    lastNight = night;
    const run = S.eng;
    const lit = clamp(night + run * 0.25, 0, 1);
    glowMat.color.setScalar(lerp(0.2, 0.95, night) + run * 0.2);
    spots.forEach((l) => { l.intensity = 3200 * night * (0.6 + 0.4 * run) + 400 * run; });
    workLight.intensity = 1400 * lit * S.scoop;
    if (H.flareT >= 0 && H.flareT < 16) { workLight.color.setHex(0xff4a2a); workLight.intensity += 5200 * flashK(); } else if (workLight.color.getHex() !== 0xffb060) workLight.color.setHex(0xffb060);
    consoleLight.intensity = 260 * night;
    // маяки
    const tt = game.time;
    const blinkRed = Math.pow(0.5 + 0.5 * Math.sin(tt * (S.state === 'off' ? 2.2 : 4.0)), S.state === 'off' ? 14 : 4);
    const col = new THREE.Color();
    for (let i = 0; i < BEACONS.length; i++) { const k = 0.1 + 1.6 * blinkRed * (0.35 + 0.65 * (i % 2 ? 1 : 0.7)); lamps.setColorAt(i, col.setRGB(k, k * 0.14, k * 0.07)); }
    H.klaxA += dt * 3.6;
    const klx = Math.max(S.klax, H.alarm);
    for (let i = 0; i < KLAXON.length; i++) { const k = 0.12 + 1.9 * klx * (0.55 + 0.45 * Math.sin(H.klaxA * 2 + i)); lamps.setColorAt(BEACONS.length + i, col.setRGB(k, k * 0.52, k * 0.08)); }
    lamps.instanceColor.needsUpdate = true;
    lampMat.color.setScalar(1.0);
    beams.update(H.klaxA, klx * (0.6 + 0.4 * (1 - night * 0.5)));
    flareTick(dt, inDesert);

    // частицы
    particles.flush(time);
    if (inDesert && (inView || camD < 300) && S.state !== 'off' || S.plume > 0.01 || S.smoke > 0.01 || S.heat > 0.01) emitParticles(dt);

    // тряска, шум, звук
    if (S.state !== 'off' && inDesert) {
      const d = Math.max(0, camD - 38);
      // лёгкая вибрация только вплотную к машине (раньше трясло до 150 м — «землетрясение»)
      const amp = (0.015 + 0.05 * S.drive) * S.eng * (1 - smoothstep(5, 45, d));
      if (amp > 0.002) game.shake = Math.max(game.shake || 0, amp);
      H.noiseT -= dt;
      if (H.noiseT <= 0) {
        H.noiseT = 1.0;
        bus.emit('noise', { x: H.x, z: H.z, loudness: clamp(0.35 + 0.65 * S.eng, 0, 1), source: 'Harvester' });
      }
    }
    carryall.update(dt, time, { x: H.x, y: H.y + SINK, z: H.z, h: H.h, running: S.state !== 'off', eng: S.eng, night });
    carryallFx(dt, inDesert);
    wreck.update(dt);
    harvester.rpm = S.eng;
  }

  // ------------------------------------------------------------ API
  const harvester = {
    root, alwaysUpdate: false, update, carryall,
    get state() { return S.state; },
    get running() { return S.state === 'running'; },
    get position() { return new THREE.Vector3(H.x, H.y, H.z); },
    get heading() { return H.h; },
    get speed() { return H.v; },
    rpm: 0, dims: DIM, interactable,
    start() {
      if (S.state !== 'off') return false;
      setState('starting'); audio('Harvester.Start');
      bus.emit('noise', { x: H.x, z: H.z, loudness: 0.5, source: 'Harvester' });
      return true;
    },
    stop() {
      if (S.state !== 'running') return false;
      setState('stopping'); audio('Harvester.Stop');
      return true;
    },
    toggle() { return S.state === 'off' ? this.start() : this.stop(); },
    /** Выталкивает pos (Vector3) из силуэта корпуса/ковша. true — было столкновение. */
    collide(pos, r = 0.4) { return collideBoard(pos, r); },
    /** true — точка (ступни, мир) на борту: трап/посадочная площадка/комнаты. Как game.sietch.contains для ядра выбора земли. */
    contains(pos) { return containsPos(pos); },
    /** Высота пола в точке; y — высота ступней (обязателен, чтобы отличить «на трапе» от «под трапом»). Вне борта — грунт. */
    heightAt(x, z, y) { return heightAtBoard(x, z, y); },
    /** Пол борта под точкой (мир) или null; потолок над головой (мир) или Infinity — для прыжка и камеры. */
    boardFloorAt(x, z, y) { return boardFloorAt(x, z, y); },
    ceilingAt(x, z, y) { return ceilingAtBoard(x, z, y); },
    surfaceAt(x, z, y) { return (y !== undefined && containsPos(_wp.set(x, y, z))) ? 'rock' : 'sand'; },
    /** Помещение под точкой (мир): {id, name} или null. */
    roomAt(pos) { _lp.copy(pos).applyMatrix4(_inv); const R = interior.roomAt(_lp.x, _lp.z, _lp.y); return R ? { id: R.id, name: R.name } : null; },
    /** Игрок на борту: машина стоит, твёрдость корпуса снята. */
    get occupied() { return H.occupied; },
    interior,
    /** 'devoured' — харвестер съеден (скрыт, без коллизий, интерактив отключён); 'off'|'running'|'starting' — отладочное состояние (снимает 'devoured'). */
    setState(st, t = 0) {
      if (st === 'devoured') { devourNow(); return true; }
      if (H.devoured) restore();
      if (st === 'off' || st === 'running' || st === 'starting') { harvester.debugSet(st, t); return true; }
      return false;
    },
    get isDevoured() { return H.devoured; },
    /** Вернуть харвестер на место и убрать обломки/пятно (повторный запуск сценария). */
    restore,
    /** Поза сценария {x,y,z,pitch,roll}: начало координат модели в мире; pitch>0 — нос вниз. null — штатное движение. */
    script(pose) { scriptPose = pose; if (!pose) applyTransform(0, true); },
    get scripted() { return !!scriptPose; },
    /** Поднять над землёй на m метров (штатное движение, без наклона): подвес на тросах переносчика. */
    setLift(m) { H.lift = m; },
    get lift() { return H.lift; },
    /** Тревога экипажа: клаксон и проблесковые маяки даже при остановленных двигателях. */
    alarm(on) { H.alarmTarget = on ? 1 : 0; if (on) audio('Harvester.Start'); },
    /** Сигнальная ракета наблюдателя (красная, взлетает с крыши и снижается на парашюте). */
    flare() { H.flareT = 0; hookPoints(); H.flareP.copy(_lug[2]); H.flareP.y += 6; H.flareV.set(0, 60, 0); },
    /** Мировые точки крышевых захватов [нос+z, нос-z, корма+z, корма-z] (переносчик цепляет тросы). */
    hookPoints,
    /** Мировая точка в локальной системе модели. */
    toWorld(lx, ly, lz, out = new THREE.Vector3()) { root.updateMatrixWorld(true); return out.set(lx, ly, lz).applyMatrix4(root.matrixWorld); },
    /** Сценарий «Червь и харвестер» из панели харвестера: то же, что game.worm.playDevour(opts) → Promise. */
    provokeWorm(opts) { return game.worm?.playDevour?.(opts) ?? Promise.resolve({ skipped: true, devoured: false }); },
    /** Тормоз по сценарию (останавливает ход, не трогая двигатели). */
    hold(b) { H.holdScript = !!b; },
    wreck, stain, particles, H, S,
    /** Включить/выключить твёрдость (на время проглатывания червём). */
    setCollidersEnabled(b) { colsEnabled = !!b; syncColliders(); },
    get colliderEntries() { return cols.map((c) => c.e); },
    /** Для тестов: мгновенно в состояние 'off' | 'running' (поза «ковш опущен»). */
    debugSet(st, t = 0) {
      if (H.devoured) restore();
      if (st === 'running') { Object.assign(S, { state: 'running', t: 0, eng: 1, scoop: 1, belt: 1, drive: 1, plume: 1, smoke: 0.08, heat: 1, klax: 1, klaxT: 0 }); emitState('running'); }
      else if (st === 'starting') { S.state = 'starting'; S.t = t; emitState('starting'); }
      else { Object.assign(S, { state: 'off', t: 0, eng: 0, scoop: 0, belt: 0, drive: 0, plume: 0, smoke: 0, heat: 0, klax: 0 }); emitState('off'); }
      updateInteractable();
    },
    place(x, z, heading = 0) { rut.k = 0; rut.done = false; H.x = x; H.z = z; H.h = heading; applyTransform(0, true); syncColliders(); },
    get blockedByWorm() { return H.blockedByWorm; },
    setVisible(b) { root.visible = b; },
  };
  game.add('harvester', harvester);

  // Коллизия — через game.colliders (боксы выше); game.collide() выталкивает персонажей автоматически, обёртка world.collide не нужна.

  applyTransform(0, true);
  H.y = sampleGround().y - SINK + 0.1;
  applyTransform(0, true);
  { const wd0 = game.weather?.windDir; berm.conform(ground, root, 1e9, wd0 ? { x: wd0.x, z: wd0.z } : null); bermAt.x = H.x; bermAt.z = H.z; bermAt.h = H.h; bermAt.w = wd0 ? Math.atan2(wd0.z, wd0.x) : 0; }
  syncColliders();
  updateInteractable();
  emitState('off');

  // потолок/пол борта для прыжка и камеры игрока (идемпотентно; не зависят от harvesterWired)
  if (!game.__hvCeil) { game.__hvCeil = true; game.ceilingAt = (x, z, y) => ceilingAtBoard(x, z, y); game.boardFloorAt = (x, z, y) => boardFloorAt(x, z, y); }
  // Подключение к ядру. Если core сам выбирает землю по точке через game.harvester (contains/heightAt/surfaceAt/collide) —
  // выставьте game.harvesterWired = true до create(); иначе подменяем game.heightAt/surfaceAt/collide здесь (идемпотентно).
  harvester.autoWired = false;
  if (!game.harvesterWired && !game.__hvWrapped) {
    game.__hvWrapped = true; harvester.autoWired = true;
    const h0 = game.heightAt.bind(game), s0 = game.surfaceAt.bind(game), c0 = game.collide.bind(game);
    const tp = new THREE.Vector3();
    const addIgnore = (ig, o) => { const st = new Set(); if (ig instanceof Set) ig.forEach((v) => st.add(v)); else if (ig) st.add(ig); st.add(o); return st; };
    game.heightAt = (x, z, y) => {
      if (y !== undefined && interior.ready) { const dx = x - H.x, dz = z - H.z; if (dx * dx + dz * dz < 85 * 85 && containsPos(tp.set(x, y, z))) return heightAtBoard(x, z, y); }
      return h0(x, z, y);
    };
    game.surfaceAt = (x, z) => { const p = game.player?.position; if (p && Math.abs(x - p.x) < 2 && Math.abs(z - p.z) < 2 && containsPos(p)) return 'rock'; return s0(x, z); };
    game.collide = (pos, r, opt) => {
      if (containsPos(pos)) { const a = collideBoard(pos, r); const b = colliders.push(pos, r, { ...(opt || {}), ignore: addIgnore(opt?.ignore, 'harvester') }); return a || b; }
      return c0(pos, r, opt);
    };
  }
  return harvester;
}
