// Добывающий комбайн («харвестер») гильдии Сарт-Макр: ~113 x 45 x 35 м, рабочий — запускается пультом у трапа.
// Модуль: game.harvester. См. README.md.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, rng } from '../core/util.js';
import { Parts } from './parts.js';
import { createHullMaterial, createGlowMaterial, createDecalTexture, createDecalMaterial, buildDecals } from './material.js';
import { buildHarvester, SCOOP_PIVOT, AUGER_POS, TOWERS, FANS, STACKS, KLAXON, BEACONS, BELT, CONSOLE_POS, SPILL, FLOODS, DIM, C } from './hull.js';
import { createTracks, TRK, UNITS } from './tracks.js';
import { createParticles, createBeams, P_SPICE, P_SAND, P_SMOKE, P_HEAT } from './fx.js';
import { createCarryall } from './carryall.js';
import { colliders } from '../core/colliders.js';

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
  const mainMesh = mk(G.main, hullMat);
  const glowMesh = mk(G.glow, glowMat, near, false);
  const decalMesh = new THREE.Mesh(buildDecals(G.decals), decalMat);
  decalMesh.frustumCulled = false; decalMesh.renderOrder = 2; near.add(decalMesh);
  const farMesh = mk(G.far, hullMat, far, false);

  // гусеницы
  const tracks = createTracks(game, hullMat, quality);
  near.add(tracks.group);
  tracks.meshes.forEach((m) => { m.castShadow = shadows; m.receiveShadow = shadows; });

  // ковш + шнек
  const scoopGroup = new THREE.Group();
  scoopGroup.position.copy(SCOOP_PIVOT);
  near.add(scoopGroup);
  const scoopMesh = mk(G.scoop, hullMat, scoopGroup);
  const augerMesh = mk(G.auger, hullMat, scoopGroup);
  const scoopDecalMesh = new THREE.Mesh(buildDecals(G.scoopDecals.map((d) => ({ ...d, c: [d.c[0] - SCOOP_PIVOT.x, d.c[1] - SCOOP_PIVOT.y, d.c[2] - SCOOP_PIVOT.z] }))), decalMat);
  scoopDecalMesh.frustumCulled = false; scoopDecalMesh.renderOrder = 2; scoopGroup.add(scoopDecalMesh);
  augerMesh.position.copy(AUGER_POS).sub(SCOOP_PIVOT);

  // барабаны центрифуг, вентиляторы, радар
  const drums = new THREE.InstancedMesh(G.drum, hullMat, TOWERS.length);
  const fans = new THREE.InstancedMesh(G.fan, hullMat, 2);
  const radar = mk(G.radar, hullMat);
  radar.position.set(28, 32.6, 10);
  for (const m of [drums, fans]) { m.frustumCulled = false; m.castShadow = shadows; m.receiveShadow = shadows; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); near.add(m); }

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
  workLight.position.set(50, 7.5, 0); root.add(workLight);
  const consoleLight = new THREE.PointLight(0xffd9a0, 0, 26, 2);
  consoleLight.position.set(CONSOLE_POS.x - 1.5, 5.0, CONSOLE_POS.z + 0.5); root.add(consoleLight);

  // частицы
  const particles = createParticles(game, Math.round(1100 * qf));
  scene.add(particles.mesh);

  // перевозчик (тяжёлый орнитоптер)
  const carryall = createCarryall(game, hullMat, glowMat, lampMat, quality);
  scene.add(carryall.group);

  // ------------------------------------------------------------ состояние
  const S = { state: 'off', t: 0, eng: 0, scoop: 0, belt: 0, drive: 0, plume: 0, smoke: 0, heat: 0, klax: 0, klaxT: 0 };
  const H = {
    x: START.x, z: START.z, h: START.heading, v: 0, omega: 0, y: 0, pitch: 0, roll: 0,
    beltPhase: 0, blockT: 0, brake: 0, blockedByWorm: false, drumA: 0, fanA: 0, augerA: 0, radarA: 0, klaxA: 0, footAcc: 0, footSide: 0, noiseT: 0, trackSpeed: [0, 0, 0, 0],
  };
  const dir = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  const consoleWorld = new THREE.Vector3();
  const interactable = {
    position: new THREE.Vector3(), radius: 4.0, tag: 'Rakis.Harvester', enabled: true,
    label: { RU: 'Завести харвестер', EN: 'Start the harvester' },
    onInteract: () => harvester.toggle(),
  };
  game.interactables.push(interactable);

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
  }

  // ------------------------------------------------------------ коллизия
  const BOXES = [[-55.5, -22.8, 40.8, 22.8], [40.8, -20.8, 58, 20.8]];   // [x0, z0, x1, z1] в локальной системе
  function collideLocal(pos, r) {
    const dx = pos.x - H.x, dz = pos.z - H.z;
    if (dx * dx + dz * dz > 75 * 75) return false;
    const c = Math.cos(H.h), s = Math.sin(H.h);
    let lx = dx * c + dz * s, lz = -dx * s + dz * c;
    let hit = false;
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
    }
    if (hit) { pos.x = H.x + lx * c - lz * s; pos.z = H.z + lx * s + lz * c; }
    return hit;
  }

  // Твёрдые тела в общем реестре (core/colliders.js): корпус и ковш — повёрнутые боксы (owner 'harvester'); обновляются по ходу движения.
  const COL_DEFS = [
    { name: 'hull', x0: BOXES[0][0], z0: BOXES[0][1], x1: BOXES[0][2], z1: BOXES[0][3], h: 35 },
    { name: 'scoop', x0: BOXES[1][0], z0: BOXES[1][1], x1: BOXES[1][2], z1: BOXES[1][3], h: 22 },
  ];
  const cols = COL_DEFS.map((d) => {
    const id = colliders.add({ type: 'box', owner: 'harvester', c: new THREE.Vector3(), half: new THREE.Vector3((d.x1 - d.x0) / 2, d.h / 2, (d.z1 - d.z0) / 2), yaw: 0, tags: new Set(['harvester', d.name]) });
    return { def: d, e: colliders.get(id) };
  });
  let colsEnabled = true;
  function syncColliders() {
    const c = Math.cos(H.h), s = Math.sin(H.h);
    for (const { def, e } of cols) {
      const lx = (def.x0 + def.x1) / 2, lz = (def.z0 + def.z1) / 2;
      e.c.set(H.x + lx * c - lz * s, H.y + def.h / 2 - 0.5, H.z + lx * s + lz * c);
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
        probe.c.set(x + lx * c, H.y + 6, z + lx * s);
        if (colliders.overlaps(probe, { ignore: 'harvester' }).some((o) => o.entry.owner === 'worm')) return true;
      }
      for (let i = 0; i < 10; i++) { h -= om * 0.1; x += Math.cos(h) * v * 0.1; z += Math.sin(h) * v * 0.1; }
    }
    return false;
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
  function applyTransform(dt, first) {
    const g = sampleGround();
    const k = first ? 1 : 1 - Math.exp(-dt * 3);
    H.y += (g.y - 0.25 - H.y) * k; H.pitch += (g.pitch - H.pitch) * k; H.roll += (g.roll - H.roll) * k;
    root.position.set(H.x, H.y, H.z);
    root.rotation.set(H.roll, -H.h, H.pitch, 'YZX');
    root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------ выбросы частиц
  const acc = { spice: 0, sand: 0, lip: 0, smoke: 0, heat: 0 };
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
        toWorld(u.x + (rear ? -TRK.sprocketDX - 3 : TRK.sprocketDX + 3.5) + (rnd() - 0.5) * 3, 0.4, u.z + (rnd() - 0.5) * 6.5, pw);
        dirWorld(rear ? -(2 + rnd() * 5) : (1 + rnd() * 3), 2 + rnd() * 5, (rnd() - 0.5) * 5, vw);
        particles.emit(P_SAND, pw.x, pw.y, pw.z, vw.x, vw.y, vw.z, 1.6 + rnd() * 1.8, 1.6 + rnd() * 1.6, 0.4, 3, { wind: 0.7, buoy: 0, drag: 0.9 });
      }
    }
    if (S.scoop > 0.7 && S.belt > 0.3) {
      acc.lip += dt * 28 * qf * S.belt;
      while (acc.lip >= 1) {
        acc.lip -= 1;
        toWorld(55 + rnd() * 3, 0.4, (rnd() - 0.5) * 38, pw);
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

  // ------------------------------------------------------------ обновление
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere(new THREE.Vector3(), 78);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), yAx = new THREE.Vector3(0, 1, 0), xAx = new THREE.Vector3(1, 0, 0);
  let lastNight = 0;

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
    stageValues(dt);

    // не ползти на червя: раз в 0.25 с проверяем, не заденет ли корпус (сейчас и через ~5 с по дуге) тело червя; тормозим и ждём
    H.blockT -= dt;
    if (H.blockT <= 0) { H.blockT = 0.25; H.blockedByWorm = S.drive > 0.05 && wormInTheWay(); }
    H.brake += ((H.blockedByWorm ? 1 : 0) - H.brake) * (1 - Math.exp(-dt * (H.blockedByWorm ? 2.5 : 0.8)));
    // кинематика: ползёт по большой петле влево (к -z)
    H.v = V_MAX * S.drive * (1 - H.brake);
    H.omega = H.v / R_TURN;
    if (H.v > 1e-4) {
      H.h -= H.omega * dt;
      H.x += Math.cos(H.h) * H.v * dt; H.z += Math.sin(H.h) * H.v * dt;
      H.footAcc += H.v * dt;
      if (H.footAcc > FOOT_STEP) { H.footAcc = 0; stampTracks(); }
    }
    applyTransform(dt, false);
    syncColliders();
    const camD = game.camera.position.distanceTo(root.position);

    // видимость и LOD
    pm.multiplyMatrices(game.camera.projectionMatrix, game.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    sph.center.set(H.x, H.y + 16, H.z);
    const inView = inDesert && frustum.intersectsSphere(sph);
    root.visible = inView;
    const isNear = camD < 420;
    near.visible = isNear; far.visible = !isNear;
    const shadowOn = shadows && camD < 260;
    mainMesh.castShadow = scoopMesh.castShadow = shadowOn;
    particles.mesh.visible = inDesert; carryall.group.visible = inDesert;

    // интерактив: пульт у трапа
    consoleWorld.set(CONSOLE_POS.x, 0, CONSOLE_POS.z).applyMatrix4(root.matrixWorld);
    interactable.position.set(consoleWorld.x, ground(consoleWorld.x, consoleWorld.z), consoleWorld.z);
    interactable.enabled = (S.state === 'running' || S.state === 'off') && inDesert;

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
    consoleLight.intensity = 260 * night;
    // маяки
    const tt = game.time;
    const blinkRed = Math.pow(0.5 + 0.5 * Math.sin(tt * (S.state === 'off' ? 2.2 : 4.0)), S.state === 'off' ? 14 : 4);
    const col = new THREE.Color();
    for (let i = 0; i < BEACONS.length; i++) { const k = 0.1 + 1.6 * blinkRed * (0.35 + 0.65 * (i % 2 ? 1 : 0.7)); lamps.setColorAt(i, col.setRGB(k, k * 0.14, k * 0.07)); }
    H.klaxA += dt * 3.6;
    const kl = S.klax * (0.5 + 0.5 * Math.sin(H.klaxA * 2.2));
    for (let i = 0; i < KLAXON.length; i++) { const k = 0.12 + 1.9 * S.klax * (0.55 + 0.45 * Math.sin(H.klaxA * 2 + i)); lamps.setColorAt(BEACONS.length + i, col.setRGB(k, k * 0.52, k * 0.08)); }
    lamps.instanceColor.needsUpdate = true;
    lampMat.color.setScalar(1.0);
    beams.update(H.klaxA, S.klax * (0.6 + 0.4 * (1 - night * 0.5)));

    // частицы
    particles.flush(time);
    if (inDesert && (inView || camD < 300) && S.state !== 'off' || S.plume > 0.01 || S.smoke > 0.01 || S.heat > 0.01) emitParticles(dt);

    // тряска, шум, звук
    if (S.state !== 'off' && inDesert) {
      const d = Math.max(0, camD - 38);
      const amp = (0.06 + 0.3 * S.drive) * S.eng * (1 - smoothstep(20, 150, d));
      if (amp > 0.002) game.shake = Math.max(game.shake || 0, amp);
      H.noiseT -= dt;
      if (H.noiseT <= 0) {
        H.noiseT = 1.0;
        bus.emit('noise', { x: H.x, z: H.z, loudness: clamp(0.35 + 0.65 * S.eng, 0, 1), source: 'Harvester' });
      }
    }
    carryall.update(dt, time, { x: H.x, y: H.y, z: H.z, h: H.h, running: S.state !== 'off', eng: S.eng, night });
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
    collide(pos, r = 0.4) { return collideLocal(pos, r); },
    /** Включить/выключить твёрдость (на время проглатывания червём). */
    setCollidersEnabled(b) { colsEnabled = !!b; syncColliders(); },
    get colliderEntries() { return cols.map((c) => c.e); },
    /** Для тестов: мгновенно в состояние 'off' | 'running' (поза «ковш опущен»). */
    debugSet(st, t = 0) {
      if (st === 'running') { Object.assign(S, { state: 'running', t: 0, eng: 1, scoop: 1, belt: 1, drive: 1, plume: 1, smoke: 0.08, heat: 1, klax: 1, klaxT: 0 }); emitState('running'); }
      else if (st === 'starting') { S.state = 'starting'; S.t = t; emitState('starting'); }
      else { Object.assign(S, { state: 'off', t: 0, eng: 0, scoop: 0, belt: 0, drive: 0, plume: 0, smoke: 0, heat: 0, klax: 0 }); emitState('off'); }
      updateInteractable();
    },
    place(x, z, heading = 0) { H.x = x; H.z = z; H.h = heading; applyTransform(0, true); syncColliders(); },
    get blockedByWorm() { return H.blockedByWorm; },
    setVisible(b) { root.visible = b; },
  };
  game.add('harvester', harvester);

  // Коллизия — через game.colliders (боксы выше); game.collide() выталкивает персонажей автоматически, обёртка world.collide не нужна.

  applyTransform(0, true);
  H.y = sampleGround().y - 0.25;
  applyTransform(0, true);
  syncColliders();
  updateInteractable();
  emitState('off');
  return harvester;
}
