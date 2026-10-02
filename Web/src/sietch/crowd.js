// Толпа сиетча: 40–80 горожан с простыми конечными автоматами, LOD (полные фигуры рядом / инстанс-болванки вдали),
// деятельность у точек (станки, прилавки, кувшины, мастерская, дети, старики, молитвы), блуждание по лейнам,
// взгляд на игрока, уступание дороги, замолкание разговоров, барки с кулдаунами, ритуальный сбор в зал B5.
import * as THREE from 'three';
import { makeFigure, PALETTES } from '../core/figures.js';
import { clamp, lerp, damp, dampAngle, rng } from '../core/util.js';
import { HALL, heightAtLocal, hallHeightSmooth } from './plan.js';
import { faceYaw } from './props.js';
import { U } from './mats.js';

const SKIN = ['#9c7458', '#8a6048', '#b08462', '#7a523c', '#c09470', '#a07050'];
const TAU = Math.PI * 2;

export function createCrowd(ctx) {
  const { game, root, origin: O } = ctx;
  const q = ctx.quality;
  const R = rng(4242);
  const S = ctx.spots;
  const arch = Object.fromEntries((game.data?.CrowdArchetypes || []).map((a) => [a.id, a]));
  const npcs = [];
  const camL = new THREE.Vector3(), plL = new THREE.Vector3();
  const maxFull = q === 'low' ? 4 : q === 'high' ? 10 : 7;
  const fullR = q === 'low' ? 8 : q === 'high' ? 13 : 11;
  const out = { npcs, ritualState: 'idle', seated: 0, guardReleased: false };

  // ------------------------------------------------------------------ граф лейнов ----
  const nodes = [];
  const node = (x, z, tag = '') => { const n = { x, z, nb: [], tag }; nodes.push(n); return n; };
  const link = (a, b) => { if (!a || !b) return; a.nb.push(b); b.nb.push(a); };
  const xs = [44, 52, 60, 68, 76, 84, 92, 98], zs = [-2.8, 0, 2.8];
  const grid = xs.map((x) => zs.map((z) => node(x, z, 'B2')));
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < 3; j++) { if (j < 2) link(grid[i][j], grid[i][j + 1]); if (i < xs.length - 1) link(grid[i][j], grid[i + 1][j]); }
  const b1 = [4, 12, 20, 28, 37].map((x) => node(x, 0, 'B1')); for (let i = 0; i < b1.length - 1; i++) link(b1[i], b1[i + 1]); link(b1[b1.length - 1], grid[0][1]);
  const b3 = [104, 112, 120, 128, 136, 144, 152].map((x) => node(x, 0, 'B3')); for (let i = 0; i < b3.length - 1; i++) link(b3[i], b3[i + 1]); link(grid[xs.length - 1][1], b3[0]);
  const ring = []; const NR = 20;
  for (let i = 0; i < NR; i++) { const a = (i / NR) * TAU; ring.push(node(HALL.cx + Math.cos(a) * 21, HALL.cz + Math.sin(a) * 15.8, 'B5')); }
  for (let i = 0; i < NR; i++) link(ring[i], ring[(i + 1) % NR]);
  link(b3[b3.length - 1], ring[NR / 2]);
  // ближайший узел
  const nearestNode = (x, z, tag) => { let b = null, bd = 1e9; for (const n of nodes) { if (tag && n.tag !== tag) continue; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; b = n; } } return b; };
  const tagOf = (x) => (x < 40 ? 'B1' : x < 100 ? 'B2' : x < 150 ? 'B3' : 'B5');
  function route(from, to) {
    const a = nearestNode(from.x, from.z, tagOf(from.x)), b = nearestNode(to.x, to.z, tagOf(to.x));
    const prev = new Map([[a, null]]); const qd = [a];
    while (qd.length) { const c = qd.shift(); if (c === b) break; for (const n of c.nb) if (!prev.has(n)) { prev.set(n, c); qd.push(n); } }
    const path = []; let c = b; while (c) { path.unshift([c.x, c.z]); c = prev.get(c); }
    path.push([to.x, to.z]);
    return path;
  }

  // ------------------------------------------------------------------ создание ----
  const ARCH_FALLBACK = { Trader: 1, Artisan: 1, WaterCarrier: 1, Child: 1, Guard: 1, Pilgrim: 1, Elder: 1, Weaver: 1 };
  function look(archId, o = {}) {
    const a = arch[archId] || {}; const P = PALETTES[archId] || {};
    const pal = a.palette || ['#8a6a48', '#2c3e57', '#4a4038', '#c9a46a'];
    const child = archId === 'Child' || a.age === 'Child';
    const base = P.height || (child ? 1.2 : a.age === 'Elder' ? 1.66 : 1.75);
    const height = o.height || base * (child ? 0.88 + R() * 0.28 : 0.94 + R() * 0.13);
    return {
      height, bulk: (P.bulk || 1) * (child ? 0.9 : 0.88 + R() * 0.26),
      cloth: o.cloth || pal[Math.floor(R() * 4)], accent: o.accent || pal[(1 + Math.floor(R() * 3)) % 4], suit: o.suit || P.suit || '#4a4038',
      skin: SKIN[Math.floor(R() * SKIN.length)], hood: o.hood ?? R() < 0.78, mask: o.mask ?? (child ? false : R() < (archId === 'Guard' ? 0.7 : 0.3)),
      pack: !!P.pack && R() < 0.6, speed: (a.walkSpeed || 1.1) * (0.9 + R() * 0.2), eyesIbad: !!o.eyesIbad, robe: o.robe,
    };
  }
  let seq = 0;
  function spawn(archId, kind, spot, o = {}) {
    const lk = look(archId, o.look || {});
    const fig = makeFigure({ height: lk.height, cloth: lk.cloth, accent: lk.accent, suit: lk.suit, skin: lk.skin, hood: lk.hood, mask: lk.mask, bulk: lk.bulk, pack: lk.pack, eyesIbad: lk.eyesIbad, robe: lk.robe, name: `NPC_${archId}_${seq}` });
    const n = {
      id: seq++, arch: archId, kind, fig, lk, scale: lk.height / 1.75, speed: lk.speed, x: spot.x, z: spot.z, y: 0, yaw: spot.yaw ?? R() * TAU, goalYaw: spot.yaw ?? 0,
      pose: 'stand', mode: 'act', timer: R() * 5, path: null, pi: 0, spot, home: { x: spot.x, z: spot.z, yaw: spot.yaw ?? 0 }, lod: 'off', imp: -1, talk: false, group: o.group ?? -1,
      barkT: 1 + R() * 10, stranger: false, silent: 0, walkAnim: 0, irregular: 0, special: !!o.special, role: spot.role || '', phase: R() * 10, after: null, sitH: 0, speedNow: 0, dwell: 0,
    };
    n.y = ground(n.x, n.z);
    n.fig.group.position.set(n.x, n.y, n.z); n.fig.group.rotation.y = n.yaw;
    npcs.push(n);
    return n;
  }
  const ground = (x, z) => heightAtLocal(x, z, 0);

  // ------------------------------------------------------------------ состав ----
  const full = q !== 'low';
  const place = (arch, kind, spot, o) => spawn(arch, kind, spot, o);
  S.loom.forEach((s) => place('Weaver', 'loom', s));
  S.stall.forEach((s, i) => place(i % 3 === 2 ? 'Artisan' : 'Trader', 'stall', { ...s, x: s.x, z: s.z, yaw: s.yaw }));
  S.water.forEach((s) => place('WaterCarrier', 'water', s));
  S.repair.forEach((s) => place(s.role === 'artisan' ? 'Artisan' : 'Pilgrim', 'repair', s));
  // Дети: «червь и наездники».
  const nKids = q === 'low' ? 4 : 6;
  for (let i = 0; i < nKids; i++) place('Child', 'play', { x: 47 + (R() - 0.5) * 4, z: -0.5 + (R() - 0.5) * 3, yaw: R() * TAU, role: i === 0 ? 'worm' : i === 1 ? 'stomp' : 'rider' });
  S.elder.forEach((s, i) => place('Elder', 'elder', s));
  S.coffee.forEach((s) => place(s.role === 'pour' ? 'Weaver' : 'Elder', 'coffee', s));
  // Ссора о десятине Кина: трое у прилавка.
  { const c = { x: 73.2, z: 3.1 }; [0, 1, 2].forEach((i) => { const a = i * 2.1 + 0.4; place(['Trader', 'WaterCarrier', 'Trader'][i], 'quarrel', { x: c.x + Math.cos(a) * 0.85, z: c.z + Math.sin(a) * 0.85, yaw: faceYaw(-Math.cos(a), -Math.sin(a)) }, { group: 100 }); }); }
  // Паломники шепчутся о Шиане (B2, у лестницы) и молятся у ниши в B3.
  { const c = { x: 51.4, z: 3.8 }; [0, 1].forEach((i) => place('Pilgrim', 'whisper', { x: c.x + i * 0.9, z: c.z - i * 0.2, yaw: faceYaw(i ? -1 : 1, -0.2) }, { group: 101 })); }
  S.shrine.forEach((s) => place('Pilgrim', 'shrine', s));
  S.funeral.forEach((s, i) => place(i ? 'Elder' : 'Pilgrim', 'funeral', s, { look: { cloth: '#2c3e57', accent: '#1f2d46', hood: true, mask: false } }));
  S.hooks.forEach((s) => place('Guard', 'hooks', s));
  S.guard.forEach((s) => place('Guard', s.role === 'check' ? 'guardCheck' : s.role === 'grate' ? 'guardGrate' : 'guardPost', s, { look: { mask: true } }));
  // Блуждающие по галерее.
  const wanderArchs = ['Trader', 'Pilgrim', 'WaterCarrier', 'WaterCarrier', 'Artisan', 'Weaver', 'Pilgrim', 'Elder', 'Trader', 'Child'];
  const nWander = q === 'low' ? 5 : q === 'high' ? 24 : 16;
  for (let i = 0; i < nWander; i++) { const nd = grid[Math.floor(R() * xs.length)][Math.floor(R() * 3)]; place(wanderArchs[i % wanderArchs.length], 'wander', { x: nd.x + (R() - 0.5), z: nd.z + (R() - 0.5), yaw: R() * TAU }); }
  // Жители проходов B3.
  if (q !== 'low') for (let i = 0; i < 3; i++) place(i ? 'Elder' : 'Weaver', 'wanderB3', { x: 106 + R() * 36, z: (R() - 0.5) * 1.6, yaw: R() * TAU });

  // Водоносы несут кувшин на плече (лишь деталь для близких).
  const jarGeo = new THREE.LatheGeometry([[0, 0], [0.13, 0], [0.16, 0.08], [0.16, 0.22], [0.1, 0.34], [0.07, 0.4], [0, 0.4]].map((p) => new THREE.Vector2(p[0], p[1])), 12);
  const jarMat = new THREE.MeshStandardMaterial({ color: '#8a5c3c', roughness: 0.8 });
  for (const n of npcs) if (n.arch === 'WaterCarrier' && n.kind !== 'water') { const j = new THREE.Mesh(jarGeo, jarMat); j.position.set(0.2, 0.62, 0.02); j.rotation.z = -0.12; n.fig.parts.spine.add(j); n.jar = true; }

  // ------------------------------------------------------------------ спец-персонажи зала ----
  const cx = HALL.cx, cz = HALL.cz;
  const rimY = HALL.bowlY + 0.55;
  const priestess = spawn('Elder', 'priestess', { x: cx, z: cz - 6.35, yaw: 0 }, { special: true, look: { height: 1.86, cloth: '#d9cfae', accent: '#2c3e57', suit: '#d9cfae', hood: false, mask: false, robe: true } });
  priestess.fig.parts.root.scale.x *= 0.82; priestess.lk.bulk = 0.8;
  { // головной убор-конус
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.55, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#cbbf9a', roughness: 0.9, side: THREE.DoubleSide }));
    cone.position.set(0, 0.28, -0.02); priestess.fig.parts.headPivot.add(cone);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 16), new THREE.MeshStandardMaterial({ color: '#2c4a96', roughness: 0.8 }));
    band.rotation.x = Math.PI / 2; band.position.set(0, 0.08, 0); priestess.fig.parts.headPivot.add(band);
  }
  { const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.3, 1.0, 18, 1, true), new THREE.MeshStandardMaterial({ color: '#d9cfae', roughness: 0.9, side: THREE.DoubleSide }));
    sk.position.y = -0.46; priestess.fig.parts.pelvis.add(sk);
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.014, 6, 24), new THREE.MeshStandardMaterial({ color: '#2c4a96', roughness: 0.8 }));
    hem.rotation.x = Math.PI / 2; hem.position.y = -0.95; priestess.fig.parts.pelvis.add(hem); }
  priestess.y = rimY; priestess.yaw = 0; priestess.goalYaw = 0;
  const harmat = spawn('Elder', 'harmat', { x: cx + 14.3, z: cz + 0.2, yaw: -Math.PI / 2 }, { special: true, look: { height: 1.72, cloth: '#5a4838', accent: '#2c62b8', suit: '#2a221b', hood: false, mask: false, robe: true, eyesIbad: true } });
  harmat.lk.bulk = 1.25; harmat.fig.parts.root.scale.x *= 1.22; harmat.fig.parts.root.scale.z *= 1.14;
  { // седые волосы, коса бороды, посох с крюком творца
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.118, 12, 8, 0, TAU, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: '#c9c6bd', roughness: 0.9 }));
    hair.position.set(0, 0.02, -0.01); hair.rotation.x = -0.3; harmat.fig.parts.headPivot.add(hair);
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 8), new THREE.MeshStandardMaterial({ color: '#d3d0c8', roughness: 0.9 }));
    beard.position.set(0, -0.14, 0.075); beard.rotation.x = Math.PI; harmat.fig.parts.headPivot.add(beard);
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 2.15, 8), new THREE.MeshStandardMaterial({ color: '#5a4430', roughness: 0.8 }));
    shaft.position.y = 1.0;
    const hk = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 6, 12, 4.4), new THREE.MeshStandardMaterial({ color: '#2a2a2e', metalness: 0.8, roughness: 0.4 }));
    hk.position.set(0, 2.14, 0); hk.rotation.z = 0.5;
    staff.add(shaft, hk); staff.position.set(0.4, -0.12, 0.28);
    harmat.fig.parts.limbs.R.sh.add(staff); staff.rotation.x = 0;
    harmat.staff = staff;
  }
  { const dark = new THREE.MeshStandardMaterial({ color: '#3a2e24', roughness: 0.95, side: THREE.DoubleSide });
    const blue = new THREE.MeshStandardMaterial({ color: '#2c62b8', roughness: 0.7, emissive: '#10285a', emissiveIntensity: 0.4 });
    const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 0.98, 20, 1, true), dark); sk.position.y = -0.46; harmat.fig.parts.pelvis.add(sk);
    const hem = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.022, 6, 28), blue); hem.rotation.x = Math.PI / 2; hem.position.y = -0.95; harmat.fig.parts.pelvis.add(hem);
    const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.36, 0.7, 20, 1, true), dark); mantle.position.y = 0.3; harmat.fig.parts.spine.add(mantle);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.02, 6, 24), blue); trim.rotation.x = Math.PI / 2; trim.position.y = -0.05; harmat.fig.parts.spine.add(trim);
    const coll = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.026, 6, 20), blue); coll.rotation.x = Math.PI / 2; coll.position.y = 0.64; harmat.fig.parts.spine.add(coll); }
  harmat.y = ground(harmat.x, harmat.z); harmat.faceCam = 0;
  const dancer = spawn('Weaver', 'dancer', { x: cx + 0.5, z: cz + 0.4, yaw: 1 }, { special: true, look: { height: 1.4, cloth: '#2c4a96', accent: '#c9a46a', suit: '#7a5a40', hood: false, mask: false, bulk: 0.85 } });
  { const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.34, 0.6, 16, 1, true), new THREE.MeshStandardMaterial({ color: '#2c4a96', roughness: 0.9, side: THREE.DoubleSide }));
    sk.position.y = -0.28; dancer.fig.parts.pelvis.add(sk); }
  dancer.dance = { fx: cx + 0.5, fz: cz + 0.4, tx: cx + 1.2, tz: cz - 0.8, t: 0, dur: 0.6, kick: 0 };
  out.priestess = priestess; out.harmat = harmat; out.dancer = dancer;
  const specials = [priestess, harmat, dancer];
  const guardCheck = npcs.find((n) => n.kind === 'guardCheck');
  out.guard = guardCheck;

  // ------------------------------------------------------------------ импостеры ----
  const NI = npcs.length;
  const bodyGeo = new THREE.LatheGeometry([[0, 0], [0.3, 0], [0.33, 0.06], [0.26, 0.7], [0.21, 1.02], [0.2, 1.22], [0.1, 1.32], [0, 1.33]].map((p) => new THREE.Vector2(p[0], p[1])), 10);
  const headGeo = new THREE.SphereGeometry(0.125, 8, 6); headGeo.translate(0, 1.43, 0);
  const sashGeo = new THREE.TorusGeometry(0.2, 0.025, 4, 10); sashGeo.rotateX(Math.PI / 2); sashGeo.translate(0, 0.92, 0);
  const impGlow = new Float32Array(NI * 3);
  const mkImp = (geo, rough) => {
    const g = geo.clone();
    g.setAttribute('aGlow', new THREE.InstancedBufferAttribute(impGlow, 3));
    const m = new THREE.MeshStandardMaterial({ roughness: rough, color: '#ffffff' });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aGlow; varying vec3 vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGlow;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow;');
    };
    m.customProgramCacheKey = () => 'sietch-imp';
    const im = new THREE.InstancedMesh(g, m, NI);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NI * 3), 3);
    im.frustumCulled = false; im.count = NI;
    root.add(im);
    return im;
  };
  const impBody = mkImp(bodyGeo, 0.95), impHead = mkImp(headGeo, 0.6), impSash = mkImp(sashGeo, 0.9);
  const tmpC = new THREE.Color();
  npcs.forEach((n, i) => {
    n.imp = i;
    tmpC.set(n.lk.cloth); impBody.setColorAt(i, tmpC);
    tmpC.set(n.lk.skin); impHead.setColorAt(i, tmpC);
    tmpC.set(n.lk.accent); impSash.setColorAt(i, tmpC);
  });
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

  // ------------------------------------------------------------------ поведение ----
  const say = (n, ctxName) => {
    if (n.barkT > 0 || game.space !== 'sietch') return false;
    if (game.dialogue?.isBusy || game.cinematic?.active) return false;
    if (barkGlobal > 0) return false;
    n.barkT = 38 + R() * 30; barkGlobal = 4.5;
    game.dialogue?.bark?.(n.arch, ctxName, new THREE.Vector3(n.x + O.x, n.y + O.y + 1.5, n.z + O.z));
    return true;
  };
  let barkGlobal = 3;

  function setPath(n, path, after) { n.path = path; n.pi = 0; n.mode = 'walk'; n.after = after || null; }
  const toSpot = (n, x, z, after) => setPath(n, route(n, { x, z }), after);

  function actAt(n, mode, pose, dwell) { n.mode = mode; n.pose = pose; n.timer = dwell ?? 0; n.speedNow = 0; }

  function pickWander(n) {
    const roll = R();
    let tx, tz;
    if (n.kind === 'wanderB3') { tx = 104 + R() * 42; tz = (R() - 0.5) * 1.4; }
    else if (roll < 0.34 && S.stall.length) { const s = S.stall[Math.floor(R() * S.stall.length)]; tx = s.x + (R() - 0.5) * 1.6; tz = s.side * 3.95; }
    else if (roll < 0.46 && S.water.length) { const s = S.water[0]; tx = s.x + (R() - 0.5) * 1.4; tz = s.z - 1.85; }
    else if (roll < 0.56) { const s = S.loom[Math.floor(R() * S.loom.length)]; tx = s.x; tz = s.z - 1.9; }
    else { const nd = grid[Math.floor(R() * xs.length)][Math.floor(R() * 3)]; tx = nd.x + (R() - 0.5) * 2; tz = nd.z + (R() - 0.5); }
    toSpot(n, tx, tz, () => {
      const r = R();
      actAt(n, 'act', r < 0.7 ? 'stand' : 'stand', 6 + R() * 14); n.talk = r < 0.45 && n.arch !== 'Child'; n.pose = 'stand';
      n.goalYaw = n.yaw + (R() - 0.5) * 1.6;
    });
  }

  function think(n, dt, t) {
    switch (n.kind) {
      case 'loom': n.pose = 'weave'; break;
      case 'stall': n.pose = 'trade'; n.talk = !n.silent; break;
      case 'water': n.pose = 'measure'; break;
      case 'repair': n.pose = n.role === 'artisan' ? 'repair' : 'stand'; break;
      case 'elder': n.pose = 'sitBench'; n.talk = (n.id % 2 === 0) && !n.silent; break;
      case 'coffee': n.pose = n.role === 'pour' ? 'pour' : 'sitFloor'; break;
      case 'quarrel': n.pose = 'argue'; n.talk = !n.silent; break;
      case 'whisper': n.pose = 'whisper'; n.talk = !n.silent; break;
      case 'shrine': n.pose = n.role === 'stand' ? 'stand' : 'pray'; break;
      case 'funeral': n.pose = 'mourn'; break;
      case 'hooks': n.pose = n.role === 'sharpen' ? 'sharpen' : 'inspect'; break;
      case 'guardPost': case 'guardGrate': n.pose = 'stand'; break;
      case 'play': playThink(n, dt, t); break;
      case 'guardCheck': guardThink(n, dt, t); break;
      case 'wander': case 'wanderB3': if (n.mode === 'act' && n.timer <= 0) pickWander(n); break;
      default: break;
    }
  }

  // дети: нерегулярный бег по площадке
  function playThink(n, dt) {
    if (n.mode === 'act') {
      n.pose = n.role === 'stomp' ? 'stomp' : n.role === 'worm' ? 'crouch' : 'stand';
      if (n.timer <= 0) {
        const a = R() * TAU, r = 0.6 + R() * 2.6;
        let tx = 47 + Math.cos(a) * r, tz = -0.3 + Math.sin(a) * r * 0.9;
        if (R() < 0.12) { tx = 52 + R() * 6; tz = (R() - 0.5) * 5; }
        n.path = [[tx, tz]]; n.pi = 0; n.mode = 'walk'; n.irregular = 1; n.after = () => { n.irregular = 0; actAt(n, 'act', 'stand', 0.3 + R() * 1.6); };
        n.speedBoost = n.role === 'worm' ? 0.35 : 1.9 + R() * 0.8;
      }
    }
  }

  // страж: проверяет маски, уступает дорогу после реплики
  let guardTalkT = -1;
  game.bus.on('line:end', (e) => { if (e?.id === 'DLG_B1_004' || e?.id === 'DLG_B1_002') { if (e.id === 'DLG_B1_004') out.guardRelease(); } });
  out.guardRelease = () => { out.guardReleased = true; };
  function guardThink(n, dt) {
    const dx = plL.x - n.x, dz = plL.z - n.z, d = Math.hypot(dx, dz);
    if (!out.guardReleased) {
      n.pose = guardTalkT >= 0 ? 'trade' : 'stand';
      n.mode = 'act';
      if (d < 7 && plL.x < n.x) n.goalYaw = Math.atan2(dx, dz);
      else n.goalYaw = faceYaw(-1, 0);
      if (d < 4.5 && plL.x < n.x + 0.5 && guardTalkT < 0) { guardTalkT = 0; n.talk = true; n.barkT = 0; barkGlobal = 0; say(n, 'Stranger'); }
      if (guardTalkT < 0 && plL.x > n.x + 1.6) out.guardReleased = true;
      if (guardTalkT >= 0) { guardTalkT += dt; n.talk = guardTalkT < 14; if (guardTalkT > 16 || plL.x > n.x + 2.0) out.guardReleased = true; }
    } else if (n.mode === 'act' && Math.abs(n.z - (-1.45)) > 0.15) {
      n.talk = false; n.path = [[n.x, -1.45], [n.x + 0.5, -1.45]]; n.pi = 0; n.mode = 'walk'; n.speedBoost = 0.9; n.after = () => { actAt(n, 'act', 'stand', 0); n.goalYaw = faceYaw(0, 1); n.stand = true; };
    } else if (n.mode === 'act') { n.pose = 'stand'; n.goalYaw = faceYaw(0, 1); if (d < 5) n.goalYaw = Math.atan2(dx, dz); }
  }

  // ------------------------------------------------------------------ ритуал ----
  const clusters = [0.65, 1.3, 1.95, 2.6, -0.65, -2.2, -2.75];
  function buildSeats() {
    const seats = [];
    clusters.forEach((th) => {
      const cl = [];
      for (const k of [1, 2, 3]) {
        const r = HALL.bowlR + (k + 0.5) * HALL.tierW;
        for (const c of [-1, 0, 1]) {
          const a = th + (c * 0.95) / r + (R() - 0.5) * 0.08;
          const rr = r + (R() - 0.5) * 0.5;
          cl.push({ x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr, k, th: a });
        }
      }
      seats.push(cl);
    });
    // порядок: ближние к входу — первыми
    seats.sort((a, b) => Math.abs(Math.abs(b[0].th) - Math.PI) - Math.abs(Math.abs(a[0].th) - Math.PI));
    return seats.flat();
  }
  out.startRitual = () => {
    if (out.ritualState !== 'idle') return false;
    out.ritualState = 'gathering';
    const seats = buildSeats();
    const eligible = npcs.filter((n) => !n.special && n.kind !== 'guardGrate' && n.kind !== 'guardPost' && n.kind !== 'funeral');
    // ближайшие к выходу из галереи идут первыми
    eligible.sort((a, b) => b.x - a.x);
    let si = 0;
    eligible.forEach((n, i) => {
      const s = seats[si++ % seats.length];
      n.rit = { seat: s, delay: i * (0.8 + R() * 0.5) + R() * 3 };
      n.mode = 'wait'; n.timer = n.rit.delay; n.talk = false; n.irregular = 0;
      n.pose = 'stand'; n.after = null;
      n.fig.setTalking?.(false);
    });
    game.bus.emit('sietch:ritualStart', { count: eligible.length });
    return true;
  };
  function ritualDepart(n) {
    const s = n.rit.seat;
    // маршрут: до внешнего кольца у входа → по кольцу (ближайший узел к месту) → радиально к месту
    const pEnd = [s.x, s.z];
    const ringNode = nearestNode(s.x, s.z, 'B5');
    const p0 = route(n, { x: ringNode.x, z: ringNode.z });
    p0.push(pEnd);
    setPath(n, p0, () => { n.mode = 'seat'; n.pose = n.rit.seat.k > 3 && R() < 0.3 ? 'stand' : 'sitFloor'; n.goalYaw = Math.atan2(cx - n.x, cz - n.z); n.sway = R() * 6; out.seated++; if (out.seated === 24) game.bus.emit('sietch:seated', { count: out.seated }); });
    n.speedBoost = 1.0;
  }

  // ------------------------------------------------------------------ позы ----
  function applyPose(n, dt, t) {
    const f = n.fig, P = f.parts, L = P.limbs, s = n.scale;
    const walkSp = n.mode === 'walk' ? n.speedNow : 0;
    const ph = f.animate(walkSp, dt, n.irregular);
    const tt = t + n.phase;
    const sit = (h = 0.5, kn = 1.5) => { P.pelvis.position.y = (h + 0.1) / s * 1.0; L.L.hip.rotation.x = L.R.hip.rotation.x = -1.5; L.L.kn.rotation.x = L.R.kn.rotation.x = kn; P.spine.rotation.x = 0.05; };
    const arms = (a, b, e = 0) => { L.L.sh.rotation.x = a; L.R.sh.rotation.x = b; L.L.el.rotation.x = L.R.el.rotation.x = e; };
    if (n.mode === 'walk') {
      if (n.jar) { L.R.sh.rotation.x = -2.7; L.R.sh.rotation.z = -0.2; L.R.el.rotation.x = -1.2; }
      if (n.pose === 'crouch') { P.pelvis.position.y = 0.55 / s * s; L.L.kn.rotation.x = L.R.kn.rotation.x = 1.4; P.spine.rotation.x = 0.8; arms(-1.2, -1.2, -0.4); }
      return;
    }
    switch (n.pose) {
      case 'weave': { sit(0.42, 1.45); P.spine.rotation.x = 0.25; arms(-1.3 + Math.sin(tt * 5.4) * 0.28, -1.3 - Math.sin(tt * 5.4 + 1.2) * 0.28, -0.5 - Math.sin(tt * 5.4) * 0.2); break; }
      case 'trade': case 'argue': {
        arms(-0.5 + Math.sin(tt * 1.7) * 0.4, -0.4 + Math.sin(tt * 2.3 + 1) * 0.5, -0.8);
        if (n.pose === 'argue' && n.talk) { arms(-0.9 + Math.sin(tt * 3.1) * 0.5, -0.7 + Math.sin(tt * 2.7 + 1) * 0.6, -0.9); P.spine.rotation.x = 0.1; }
        if (!n.talk) arms(-0.15, -0.15, -0.5);
        break;
      }
      case 'measure': { P.spine.rotation.x = 0.28; arms(-0.9, -0.7 + Math.sin(tt * 0.8) * 0.25, -0.9); P.headPivot.rotation.x = 0.35; break; }
      case 'repair': { P.spine.rotation.x = 0.45; arms(-1.15 + Math.sin(tt * 3.0) * 0.15, -1.0 + Math.sin(tt * 3.4) * 0.2, -0.7); P.headPivot.rotation.x = 0.4; break; }
      case 'sitBench': { sit(0.5, 1.5); arms(-0.35, -0.25, -0.9); if (n.talk) arms(-0.5 + Math.sin(tt * 1.5) * 0.3, -0.35, -0.9); break; }
      case 'sitFloor': { P.pelvis.position.y = 0.16 / s; L.L.hip.rotation.x = L.R.hip.rotation.x = -1.4; L.L.hip.rotation.z = 0.5; L.R.hip.rotation.z = -0.5; L.L.kn.rotation.x = L.R.kn.rotation.x = 2.3; P.spine.rotation.x = 0.1 + Math.sin(tt * 0.5) * 0.02; arms(-0.35, -0.35, -0.9); P.spine.rotation.z = Math.sin(tt * 0.7 + (n.sway || 0)) * (out.ritualState !== 'idle' ? 0.07 : 0.015); break; }
      case 'pour': { P.spine.rotation.x = 0.12; arms(-0.9, -1.3 + Math.sin(tt * 0.3) * 0.08, -0.6); break; }
      case 'whisper': { P.spine.rotation.x = 0.18; arms(-0.3, -0.5, -1.4); P.headPivot.rotation.z = 0.15; break; }
      case 'pray': { P.pelvis.position.y = 0.42 / s; L.L.kn.rotation.x = L.R.kn.rotation.x = 2.6; P.spine.rotation.x = 0.55 + Math.sin(tt * 0.35) * 0.18; arms(-1.0, -1.0, -1.3); break; }
      case 'mourn': { P.spine.rotation.x = 0.28; arms(-0.35, -0.35, -1.1); P.headPivot.rotation.x = 0.4; break; }
      case 'sharpen': { P.spine.rotation.x = 0.35; arms(-0.9 + Math.sin(tt * 9) * 0.2, -0.8, -1.0); P.headPivot.rotation.x = 0.4; break; }
      case 'inspect': { P.spine.rotation.x = 0.2; arms(-1.1, -0.6, -1.0 + Math.sin(tt * 0.9) * 0.2); break; }
      case 'stomp': { const k = Math.abs(Math.sin(tt * 4.2)); P.pelvis.position.y = (0.92 - 0.1 * k) ; L.L.hip.rotation.x = -k * 0.6; L.R.hip.rotation.x = -(1 - k) * 0.4; arms(-1.3 + k * 0.6, -1.3 + (1 - k) * 0.6, -0.4); break; }
      case 'crouch': { P.pelvis.position.y = 0.55; L.L.kn.rotation.x = L.R.kn.rotation.x = 1.4; L.L.hip.rotation.x = L.R.hip.rotation.x = -1.0; P.spine.rotation.x = 0.7; arms(-1.2, -1.2, -0.4); break; }
      default: break;
    }
  }

  // ------------------------------------------------------------------ обновление ----
  let lodT = 0, glowT = 0, ctxTime = 0;
  const upA = new THREE.Vector3(0, 1, 0);
  function glowAt(x, y, z, region) {
    let r = 0.05, g = 0.03, b = 0.015;
    for (const s of ctx.sources) {
      if (s.kind !== 'omni' || s.region !== region) continue;
      const dx = s.x - x, dy = s.y - y, dz = s.z - z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > s.radius * s.radius) continue;
      const d = Math.sqrt(d2);
      const w = (1 / (1 + (d / s.d0) ** 2)) * (1 - d / s.radius) ** 1.5 * s.intensity * 0.8;
      r += s.color[0] * w; g += s.color[1] * w; b += s.color[2] * w;
    }
    return [r, g, b];
  }
  const regionAt = (x) => (x < 40 ? 'B1' : x < 100 ? 'B2' : x < 150 ? 'B3' : 'B5');

  out.update = (dt, t) => {
    ctxTime = t;
    camL.copy(game.camera.position).sub(root.position);
    const pw = game.player?.position;
    if (pw) plL.set(pw.x - O.x, pw.y - O.y, pw.z - O.z); else plL.copy(camL);
    barkGlobal -= dt; lodT -= dt; glowT -= dt;
    // LOD: ближайшие — полные фигуры.
    if (lodT <= 0) {
      lodT = 0.3;
      const cand = [];
      for (const n of npcs) { const d2 = (n.x - camL.x) ** 2 + (n.z - camL.z) ** 2 + (n.y - camL.y) ** 2 * 0.3; n.d2 = d2; if (!n.special && d2 < fullR * fullR) cand.push(n); }
      cand.sort((a, b) => a.d2 - b.d2);
      const set = new Set(cand.slice(0, maxFull));
      for (const n of npcs) {
        if (n.special) { const vis = camL.x > 118 && n.d2 < 2800; n.lod = vis ? 'full' : 'off'; }
        else n.lod = set.has(n) ? 'full' : n.d2 > 75 * 75 ? 'off' : 'imp';
        const inScene = n.fig.group.parent === root;
        if (n.lod === 'full' && !inScene) root.add(n.fig.group);
        else if (n.lod !== 'full' && inScene) root.remove(n.fig.group);
      }
    }
    const dyn = glowT <= 0; if (dyn) glowT = 0.4;
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      // редкий тик для дальних
      n.acc = (n.acc || 0) + dt;
      const far = n.lod !== 'full';
      if (far && n.acc < 0.12) { writeImpostor(n, i, t, dyn); continue; }
      const sdt = n.acc; n.acc = 0;
      n.timer -= sdt; n.barkT -= sdt;
      const dxp = plL.x - n.x, dzp = plL.z - n.z, dp = Math.hypot(dxp, dzp);
      // замолкание разговоров рядом с игроком
      if (n.group >= 0 || n.kind === 'stall') { if (dp < 3.4) n.silent = 5; else n.silent = Math.max(0, n.silent - sdt); }
      if (n.mode === 'wait') { if (n.timer <= 0) ritualDepart(n); }
      if (n.mode === 'walk') walk(n, sdt);
      else if (n.mode === 'seat') { /* сидит */ }
      else think(n, sdt, t);
      if (n.mode !== 'walk') n.speedNow = 0;
      // взгляд / поворот к игроку
      const nearTalk = dp < 3.2 && (n.kind === 'stall' || n.kind === 'water' || n.kind === 'wander' || n.kind === 'elder' || n.kind === 'play' || n.kind === 'guardPost' || n.kind === 'hooks');
      if (nearTalk && n.mode !== 'walk' && !n.special) n.goalYaw = Math.atan2(dxp, dzp);
      n.yaw = dampAngle(n.yaw, n.mode === 'walk' ? n.walkYaw : n.goalYaw, n.mode === 'walk' ? 6 : 3.5, sdt);
      // барки
      if (dp < 6.5 && n.mode !== 'wait' && !n.special) {
        if (!n.stranger && dp < 4.5) { if (R() < 0.5) n.stranger = true; else if (say(n, 'Stranger')) n.stranger = true; }
        else if (n.barkT <= 0) {
          const c = out.ritualState !== 'idle' ? 'Ritual' : n.kind === 'stall' ? 'Market' : (n.kind === 'water' || n.arch === 'WaterCarrier') ? 'Water' : n.kind === 'whisper' || n.kind === 'shrine' ? 'Shiana' : n.kind === 'quarrel' ? 'Kin' : n.kind === 'loom' ? 'Market' : 'Idle';
          if (n.silent <= 0 || n.kind === 'play') say(n, c);
        }
      }
      // уступить дорогу
      if (dp < 1.15 && !n.special && n.mode !== 'seat') { const k = (1.15 - dp) / 1.15; n.x -= (dxp / (dp + 1e-3)) * k * sdt * 1.6; n.z -= (dzp / (dp + 1e-3)) * k * sdt * 1.6; }
      if (n.lod === 'full' && n.mode === 'act' && (n.pose === 'weave' || n.pose === 'measure' || n.pose === 'repair') && dp < 12) {
        n.sfxT = (n.sfxT ?? R() * 2) - sdt;
        if (n.sfxT <= 0) { n.sfxT = n.pose === 'weave' ? 1.1 + R() * 0.6 : 5 + R() * 4; game.audio?.event?.(n.pose === 'weave' ? 'Loom.Clack' : n.pose === 'measure' ? 'Water.Measure' : 'Stillsuit.Repair', new THREE.Vector3(n.x + O.x, n.y + O.y + 1.0, n.z + O.z)); }
      }
      if (n.lod === 'full') {
        n.y = n.special && n.kind === 'priestess' ? rimY : ground(n.x, n.z);
        const g = n.fig.group;
        g.position.set(n.x, n.y, n.z); g.rotation.y = n.yaw;
        n.fig.setTalking?.(n.talk && !n.silent);
        if (n.special) specialPose(n, sdt, t); else applyPose(n, sdt, t);
        if (dp < 7 && !n.special) n.fig.lookAt(game.camera.position, 0.85);
      } else { n.y = n.special ? n.y : ground(n.x, n.z); if (n.kind === 'dancer') specialMove(n, sdt, t); }
      writeImpostor(n, i, t, dyn);
    }
    impBody.instanceMatrix.needsUpdate = impHead.instanceMatrix.needsUpdate = impSash.instanceMatrix.needsUpdate = true;
    if (dyn) { impBody.geometry.attributes.aGlow.needsUpdate = impHead.geometry.attributes.aGlow.needsUpdate = impSash.geometry.attributes.aGlow.needsUpdate = true; }
  };

  function walk(n, dt) {
    const p = n.path[n.pi];
    if (!p) { n.mode = 'act'; n.after?.(); return; }
    let dx = p[0] - n.x, dz = p[1] - n.z; const d = Math.hypot(dx, dz);
    const rit = n.rit && out.ritualState !== 'idle';
    const sp = n.speed * (n.speedBoost ?? 1) * (rit ? (camL.x > 100 && n.d2 > 625 ? 3.2 : 1.55) : 1) * (n.irregular ? (0.6 + 0.8 * Math.abs(Math.sin(n.phase + ctxTime * 3.7))) : 1);
    if (d < 0.18) { n.pi++; if (n.pi >= n.path.length) { n.mode = 'act'; n.speedNow = 0; n.speedBoost = 1; const a = n.after; n.after = null; a?.(); } return; }
    const step = Math.min(d, sp * dt);
    n.x += (dx / d) * step; n.z += (dz / d) * step;
    n.walkYaw = Math.atan2(dx, dz);
    n.speedNow = sp;
  }

  // Спец-персонажи.
  function specialMove(n, dt, t) {
    if (n.kind !== 'dancer') return;
    const D = n.dance; D.t += dt;
    if (D.t >= D.dur) {
      D.fx = n.x; D.fz = n.z; D.t = 0; D.dur = 0.28 + R() * R() * 1.1 + (R() < 0.15 ? 0.8 : 0);
      const a = R() * TAU, r = 0.5 + R() * 1.6;
      let tx = n.x + Math.cos(a) * r, tz = n.z + Math.sin(a) * r;
      const dd = Math.hypot(tx - cx, tz - cz); if (dd > 4.2) { tx = cx + ((tx - cx) / dd) * 4.2; tz = cz + ((tz - cz) / dd) * 4.2; }
      D.tx = tx; D.tz = tz; D.kick = 1; D.spin = (R() - 0.5) * 5;
      if (n.lod === 'full' && ctx.lighting?.sand) ctx.lighting.sand(n.x, n.y + 0.05, n.z, 3 + Math.floor(R() * 3));
    }
    const k = clamp(D.t / D.dur, 0, 1), e = k * k * (3 - 2 * k);
    n.x = lerp(D.fx, D.tx, e); n.z = lerp(D.fz, D.tz, e);
    n.y = hallHeightSmooth(n.x, n.z);
    n.speedNow = Math.hypot(D.tx - D.fx, D.tz - D.fz) / D.dur;
    n.goalYaw += (D.spin || 0) * dt * 0.8;
    n.yaw = n.goalYaw;
  }
  function specialPose(n, dt, t) {
    const f = n.fig, P = f.parts, L = P.limbs, tt = t + n.phase;
    if (n.kind === 'dancer') {
      specialMove(n, dt, t);
      f.animate(n.speedNow * 1.1, dt, 1);
      n.fig.group.position.set(n.x, n.y + Math.abs(Math.sin(tt * 3.1)) * 0.05, n.z); n.fig.group.rotation.y = n.yaw;
      L.L.sh.rotation.x = -2.2 + Math.sin(tt * 2.1) * 0.9; L.R.sh.rotation.x = -2.0 + Math.sin(tt * 1.6 + 1.1) * 1.0;
      L.L.sh.rotation.z = 0.6 + Math.sin(tt * 1.3) * 0.4; L.R.sh.rotation.z = -0.6 - Math.sin(tt * 1.9) * 0.4;
      L.L.el.rotation.x = L.R.el.rotation.x = -0.3;
      P.spine.rotation.z = Math.sin(tt * 2.4) * 0.12; P.spine.rotation.x = 0.1 + Math.sin(tt * 1.1) * 0.12; P.headPivot.rotation.x = -0.25;
    } else if (n.kind === 'priestess') {
      f.animate(0, dt);
      n.fig.group.position.set(n.x, rimY, n.z);
      n.goalYaw = Math.atan2(cx - n.x, cz - n.z); n.yaw = dampAngle(n.yaw, n.goalYaw, 2, dt); n.fig.group.rotation.y = n.yaw;
      const s = Math.sin(tt * 0.8);
      L.L.sh.rotation.x = -0.9 + s * 0.4; L.R.sh.rotation.x = -0.7 - s * 0.35; L.L.sh.rotation.z = 0.5 + s * 0.2; L.R.sh.rotation.z = -0.5 - s * 0.2;
      L.L.el.rotation.x = -0.6 + s * 0.3; L.R.el.rotation.x = -0.6;
      P.headPivot.rotation.x = -0.28 + Math.sin(tt * 0.5) * 0.05; P.spine.rotation.x = -0.04; f.setTalking(false);
    } else if (n.kind === 'harmat') {
      f.animate(0, dt);
      n.fig.group.position.set(n.x, n.y, n.z);
      if (n.faceCam > 0) {
        const camYaw = Math.atan2(camL.x - n.x, camL.z - n.z);
        n.yaw = dampAngle(n.yaw, camYaw, 1.6 + n.faceCam * 1.4, dt);
        n.fig.lookAt(game.camera.position, 1);
      } else { n.goalYaw = Math.atan2(cx - n.x, cz - n.z + 4); n.yaw = dampAngle(n.yaw, n.goalYaw, 1.5, dt); }
      n.fig.group.rotation.y = n.yaw;
      L.R.sh.rotation.x = -0.15; L.R.sh.rotation.z = -0.05; L.R.el.rotation.x = -0.6; L.L.sh.rotation.x = -0.1; L.L.el.rotation.x = -0.3;
      P.spine.rotation.x = 0.05;
    }
  }

  function writeImpostor(n, i, t, dyn) {
    const show = n.lod === 'imp';
    if (!show) { _s.set(0, 0, 0); _p.set(0, -100, 0); _q.identity(); _m.compose(_p, _q, _s); impBody.setMatrixAt(i, _m); impHead.setMatrixAt(i, _m); impSash.setMatrixAt(i, _m); return; }
    const s = n.scale, bulk = n.lk.bulk;
    let sy = s, yoff = 0, lean = 0;
    if (n.mode === 'seat' || n.pose === 'sitFloor' || n.pose === 'pray') { sy = s * 0.55; }
    else if (n.pose === 'sitBench' || n.pose === 'weave') { sy = s * 0.72; }
    else if (n.pose === 'crouch') sy = s * 0.7;
    if (n.mode === 'walk') { yoff = Math.abs(Math.sin(t * 6 * (n.speed) + n.phase)) * 0.035; lean = 0.06; }
    else if (n.mode !== 'seat') lean = Math.sin(t * 0.6 + n.phase) * 0.012;
    const yy = n.special && n.kind === 'priestess' ? rimY : n.y;
    _e.set(lean, n.yaw, n.mode === 'seat' && out.ritualState !== 'idle' ? Math.sin(t * 0.7 + (n.sway || 0)) * 0.06 : 0, 'YXZ'); _q.setFromEuler(_e);
    _p.set(n.x, yy + yoff, n.z); _s.set(bulk * s, sy, bulk * s);
    _m.compose(_p, _q, _s); impBody.setMatrixAt(i, _m); impSash.setMatrixAt(i, _m);
    // голова не должна «проваливаться» — масштаб по Y как у тела
    impHead.setMatrixAt(i, _m);
    if (dyn) { const g = glowAt(n.x, n.y + 1, n.z, regionAt(n.x)); impGlow[i * 3] = g[0]; impGlow[i * 3 + 1] = g[1]; impGlow[i * 3 + 2] = g[2]; }
  }

  // ------------------------------------------------------------------ прочее API ----
  out.speakerPos = (id) => {
    const n = id === 'Harmat' ? harmat : id === 'Priestess' ? priestess : id === 'Dancer' ? dancer : id === 'Guard' ? guardCheck : null;
    if (!n) return null;
    return new THREE.Vector3(n.x + O.x, n.y + O.y + n.lk.height * 0.95, n.z + O.z);
  };
  out.count = npcs.length;
  // тестовый хук: мгновенно рассадить толпу по местам
  out.debugSeatAll = () => {
    out.startRitual();
    for (const n of npcs) if (n.rit) { n.mode = 'seat'; n.pose = 'sitFloor'; n.x = n.rit.seat.x; n.z = n.rit.seat.z; n.y = ground(n.x, n.z); n.yaw = n.goalYaw = Math.atan2(cx - n.x, cz - n.z); n.sway = R() * 6; out.seated++; }
  };
  return out;
}
