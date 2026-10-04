// Толпа сиетча: 40–80 горожан, LOD (полные фигуры рядом / инстанс-болванки вдали), деятельность у точек (станки, прилавки, кувшины,
// мастерская, дети, старики, молитвы). Движение: nav.js (сетка + A*, правая полоса) и agents.js (рулёжка без дрожания и скольжения);
// распорядок дня, разговоры, взгляд, шаг в сторону, барки, тревога: social.js; здесь — состав, LOD, позы, импостеры, ритуальный сбор в зал B5.
import * as THREE from 'three';
import { makeFigure, PALETTES } from '../core/figures.js';
import { clamp, lerp, damp, dampAngle, rng } from '../core/util.js';
import { HALL, heightAtLocal, hallHeightSmooth } from './plan.js';
import { faceYaw, pathZ } from './props.js';
import { PATHS } from './cave/layout.js';
import { U } from './mats.js';
import * as plan from './plan.js';
import { createNav } from './nav.js';
import { createMover, MOVE_CFG } from './agents.js';
import { createSocial, SOCIAL_CFG } from './social.js';

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
  // твёрдые капсулы людей (мировые координаты) — чтобы игрок/спутники/червь не проходили сквозь толпу
  const capsules = [];
  const _tw = new THREE.Vector3();
  const mkCap = (n) => {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const id = game.colliders?.add({ type: 'capsule', a, b, r: n.arch === 'Child' ? 0.22 : 0.3, owner: 'sietch', tags: new Set(['npc']) });
    capsules.push({ n, a, b, id });
  };
  const maxFull = q === 'low' ? 3 : q === 'high' ? 8 : 5;
  const fullR = q === 'low' ? 7 : q === 'high' ? 12 : 9.5;
  const out = { npcs, ritualState: 'idle', seated: 0, guardReleased: false };

  // Навигация и движение (замена графа лейнов): сетка строится из запечённых сеток пола/стен по всем помещениям.
  const nav = createNav(plan);
  const xs = [44, 52, 60, 68, 76, 84, 92];

  // ------------------------------------------------------------------ создание ----
  const ARCH_FALLBACK = { Trader: 1, Artisan: 1, WaterCarrier: 1, Child: 1, Guard: 1, Pilgrim: 1, Elder: 1, Weaver: 1 };
  function look(archId, o = {}) {
    const a = arch[archId] || {}; const P = PALETTES[archId] || {};
    const pal = a.palette || ['#8a6a48', '#2c3e57', '#4a4038', '#c9a46a'];
    const child = archId === 'Child' || a.age === 'Child';
    const base = P.height || (child ? 1.2 : a.age === 'Elder' ? 1.66 : 1.75);
    const height = o.height || base * (child ? 0.88 + R() * 0.28 : 0.94 + R() * 0.13);
    // Именные персонажи: внешность из пресета core/figures.js (без случайной палитры толпы).
    if (o.preset) return { preset: o.preset, height, cloth: o.cloth, accent: o.accent, hood: o.hood, mask: o.mask, eyesIbad: !!o.eyesIbad, robe: o.robe, bulk: 1, speed: (a.walkSpeed || 1.1) };
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
    const fig = makeFigure({ preset: lk.preset, height: lk.height, cloth: lk.cloth, accent: lk.accent, suit: lk.suit, skin: lk.skin, hood: lk.hood, mask: lk.mask, bulk: lk.bulk, pack: lk.pack, eyesIbad: lk.eyesIbad, robe: lk.robe, name: `NPC_${archId}_${seq}` });
    const n = {
      id: seq++, arch: archId, kind, fig, lk, scale: lk.height / 1.75, speed: lk.speed, x: spot.x, z: spot.z, y: 0, yaw: spot.yaw ?? R() * TAU, goalYaw: spot.yaw ?? 0,
      pose: 'stand', mode: 'act', timer: R() * 5, path: null, pi: 0, spot, home: { x: spot.x, z: spot.z, yaw: spot.yaw ?? 0 }, lod: 'off', imp: -1, talk: false, group: o.group ?? -1,
      barkT: 1 + R() * 10, stranger: false, silent: 0, walkAnim: 0, irregular: 0, special: !!o.special, role: spot.role || '', phase: R() * 10, after: null, sitH: 0, speedNow: 0, dwell: 0,
      vx: 0, vz: 0, walkYaw: spot.yaw ?? 0, task: null, chat: null, goal: null, pathReq: null, pathT: 0, blockedT: 0, slowIgnore: 0, stuckCount: 0, lookNpc: null, prayAt: 0, mealAt: 0,
    };
    n.layer = spot.level ? 6.5 : 0; n.bedY = spot.y;
    n.y = ground(n.x, n.z, n.layer);
    n.fig.group.position.set(n.x, n.y, n.z); n.fig.group.rotation.y = n.yaw;
    npcs.push(n);
    return n;
  }
  const ground = (x, z, yf = 0) => heightAtLocal(x, z, yf);

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
  { const c = { x: 72.6, z: 2.4 }; [0, 1, 2].forEach((i) => { const a = i * 2.1 + 0.4; place(['Trader', 'WaterCarrier', 'Trader'][i], 'quarrel', { x: c.x + Math.cos(a) * 0.85, z: c.z + Math.sin(a) * 0.85, yaw: faceYaw(-Math.cos(a), -Math.sin(a)) }, { group: 100 }); }); }
  // Паломники шепчутся о Шиане (B2, у лестницы) и молятся у ниши в B3.
  { const c = { x: 52.2, z: 2.6 }; [0, 1].forEach((i) => place('Pilgrim', 'whisper', { x: c.x + i * 0.9, z: c.z - i * 0.2, yaw: faceYaw(i ? -1 : 1, -0.2) }, { group: 101 })); }
  S.shrine.forEach((s) => place('Pilgrim', 'shrine', s));
  S.funeral.forEach((s, i) => place(i ? 'Elder' : 'Pilgrim', 'funeral', s, { look: { cloth: '#2c3e57', accent: '#1f2d46', hood: true, mask: false } }));
  S.hooks.forEach((s) => place('Guard', 'hooks', s));
  S.guard.forEach((s) => place('Guard', s.role === 'check' ? 'guardCheck' : s.role === 'grate' ? 'guardGrate' : 'guardPost', s, { look: { mask: true } }));
  // Спящие в комнатах и эркерах, семьи за столом, дети в уголках, повара, музыкант с публикой, погреб (стража, писец, водоносы у бассейна).
  S.sleep.forEach((sp, i) => place(['Elder', 'Child', 'Weaver', 'Pilgrim'][i % 4], 'sleep', { x: sp.x, z: sp.z, yaw: sp.yaw, y: sp.y, level: sp.level, role: 'sleep' }, { look: { hood: false, mask: false } }));
  S.family.forEach((sp, i) => place(['Weaver', 'Elder', 'Trader', 'Child'][i % 4], 'family', sp, { look: { hood: false, mask: false } }));
  S.kidroom.forEach((sp, i) => { const n = place('Child', 'play', { x: sp.x + 0.3, z: sp.z, yaw: R() * TAU, role: i % 2 ? 'stomp' : 'rider' }); n.arena = { x: sp.x, z: sp.z, r: 0.9 }; });
  S.cook.forEach((sp) => place('Weaver', 'cook', sp, { look: { hood: false, mask: false } }));
  S.musician.forEach((sp) => { out.musician = place('Elder', 'musician', sp, { look: { hood: false, mask: false } }); });
  S.audience.forEach((sp) => place(['Pilgrim', 'Child'][Math.floor(R() * 2)], 'audience', sp));
  S.cellarGuard.forEach((sp) => place('Guard', 'cellarGuard', sp, { look: { mask: true } }));
  S.scribe.forEach((sp) => place('Elder', 'scribe', sp, { look: { hood: false, mask: false } }));
  S.pool.forEach((sp) => place('WaterCarrier', 'poolWatch', sp));
  // Дети в проходах B3: догонялки по коридору.
  {
    const mk = (x) => { const n = place('Child', 'play', { x, z: pathZ(PATHS.C, x), yaw: R() * TAU, role: 'chase' }); n.arena = { line: true, x0: 100, x1: 148 }; return n; };
    const a = mk(116), b = mk(121); a.buddy = b; b.buddy = a; b.role = 'chased';
    if (q !== 'low') { const c = mk(134); c.role = 'rider'; }
  }
  // Блуждающие по галерее.
  const wanderArchs = ['Weaver', 'Pilgrim', 'Trader', 'WaterCarrier', 'Artisan', 'Weaver', 'Pilgrim', 'Elder', 'Trader', 'WaterCarrier', 'Pilgrim', 'Artisan'];
  const nWander = q === 'low' ? 6 : q === 'high' ? 24 : 16;
  for (let i = 0; i < nWander; i++) { const p = nav.randomPoint(xs[0], xs[xs.length - 1], -3.4, 3.4, 0.9, R) || { x: 60, z: 0 }; place(wanderArchs[i % wanderArchs.length], 'wander', { x: p.x, z: p.z, yaw: R() * TAU }); }
  // Жители проходов B3.
  if (q !== 'low') for (let i = 0; i < 3; i++) { const wx = 106 + R() * 36; place(i ? 'Elder' : 'Weaver', 'wanderB3', { x: wx, z: pathZ(PATHS.C, wx) + (R() - 0.5) * 0.8, yaw: R() * TAU }); }

  // Водоносы несут кувшин на плече (лишь деталь для близких).
  const jarGeo = new THREE.LatheGeometry([[0, 0], [0.13, 0], [0.16, 0.08], [0.16, 0.22], [0.1, 0.34], [0.07, 0.4], [0, 0.4]].map((p) => new THREE.Vector2(p[0], p[1])), 12);
  const jarMat = new THREE.MeshStandardMaterial({ color: '#8a5c3c', roughness: 0.8 });
  for (const n of npcs) if (n.arch === 'WaterCarrier' && n.kind !== 'water') { const j = new THREE.Mesh(jarGeo, jarMat); j.position.set(0.2, 0.62, 0.02); j.rotation.z = -0.12; n.fig.parts.spine.add(j); n.jar = true; }

  // Музыкант: уд (лютня) на груди; повар: ложка в правой руке.
  for (const n of npcs) {
    if (n.kind === 'musician') {
      const g = new THREE.Group();
      const bodyM = new THREE.MeshStandardMaterial({ color: '#7a4a28', roughness: 0.55 }), neckM = new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.6 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), bodyM); body.scale.set(1, 0.42, 1.25); g.add(body);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), new THREE.MeshBasicMaterial({ color: 0x120a06 })); hole.rotation.x = -Math.PI / 2; hole.position.set(0, 0.085, 0.02); g.add(hole);
      const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.55), neckM); neck.position.set(0, 0.0, 0.42); g.add(neck);
      const peg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.16), neckM); peg.position.set(0, 0.0, 0.74); peg.rotation.x = 0.35; g.add(peg);
      g.position.set(0.02, -0.12, 0.2); g.rotation.set(-0.5, 0, -0.0);
      n.fig.parts.chest.add(g);
    } else if (n.kind === 'cook') {
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), new THREE.MeshStandardMaterial({ color: '#6a4a2c' })); sp.position.set(0, -0.1, 0.1); n.fig.parts.limbs.R.hand.add(sp);
    }
  }

  // ------------------------------------------------------------------ спец-персонажи зала ----
  const cx = HALL.cx, cz = HALL.cz;
  const rimY = heightAtLocal(HALL.cx, HALL.cz - 6.35, 0);
  const priestess = spawn('Elder', 'priestess', { x: cx, z: cz - 6.35, yaw: 0 }, { special: true, look: { preset: 'Priestess', height: 1.86, cloth: '#d9cfae', accent: '#2c3e57', hood: false, mask: false, robe: true } });
  { // головной убор-конус
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.55, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#cbbf9a', roughness: 0.9, side: THREE.DoubleSide }));
    cone.position.set(0, 0.28, -0.02); priestess.fig.parts.headPivot.add(cone);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 16), new THREE.MeshStandardMaterial({ color: '#2c4a96', roughness: 0.8 }));
    band.rotation.x = Math.PI / 2; band.position.set(0, 0.08, 0); priestess.fig.parts.headPivot.add(band);
  }
  priestess.y = rimY; priestess.yaw = 0; priestess.goalYaw = 0;
  const harmat = spawn('Elder', 'harmat', { x: cx + 17.3, z: cz + 0.2, yaw: -Math.PI / 2 }, { special: true, look: { preset: 'Harmat', height: 1.72, hood: false, mask: false, robe: true, eyesIbad: true } });
  { // седые волосы, коса бороды, посох с крюком творца
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 2.15, 8), new THREE.MeshStandardMaterial({ color: '#5a4430', roughness: 0.8 }));
    shaft.position.y = 1.0;
    const hk = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.016, 6, 12, 4.4), new THREE.MeshStandardMaterial({ color: '#2a2a2e', metalness: 0.8, roughness: 0.4 }));
    hk.position.set(0, 2.14, 0); hk.rotation.z = 0.5;
    staff.add(shaft, hk); staff.position.set(0.4, -0.12, 0.28);
    harmat.fig.parts.limbs.R.sh.add(staff); staff.rotation.x = 0;
    harmat.staff = staff;
  }
  harmat.y = ground(harmat.x, harmat.z); harmat.faceCam = 0;
  const dancer = spawn('Weaver', 'dancer', { x: cx + 0.5, z: cz + 0.4, yaw: 1 }, { special: true, look: { height: 1.4, cloth: '#2c4a96', accent: '#c9a46a', suit: '#7a5a40', hood: false, mask: false, bulk: 0.85, robe: false } });
  { const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.34, 0.6, 16, 1, true), new THREE.MeshStandardMaterial({ color: '#2c4a96', roughness: 0.9, side: THREE.DoubleSide }));
    sk.position.y = -0.28; dancer.fig.parts.pelvis.add(sk); }
  dancer.dance = { fx: cx + 0.5, fz: cz + 0.4, tx: cx + 1.2, tz: cz - 0.8, t: 0, dur: 0.6, kick: 0 };
  out.priestess = priestess; out.harmat = harmat; out.dancer = dancer;
  const specials = [priestess, harmat, dancer];
  const guardCheck = npcs.find((n) => n.kind === 'guardCheck');
  out.guard = guardCheck;

  // ------------------------------------------------------------------ импостеры ----
  npcs.forEach(mkCap);
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
  // Окружение движения/социальной жизни: игрок и спутники в ЛОКАЛЬНЫХ координатах сиетча, скорость игрока (сглаженная).
  const plV = { x: 0, z: 0 }, plPrev = new THREE.Vector3(), compL = [];
  let barkGlobal = 3, envSeq = 0;
  const say = (n, ctxName) => {
    if (n.barkT > 0 || game.space !== 'sietch') return false;
    if (game.dialogue?.isBusy || game.cinematic?.active) return false;
    n.barkT = 38 + R() * 30;
    game.dialogue?.bark?.(n.arch, ctxName, ctx.toWorld(n.x, n.y + 1.5, n.z));
    return true;
  };
  const env = { game, ctx, nav, plan, npcs, S, R, out, plL, plV, say, time: () => ctxTime, comps: () => compL, get seq() { return envSeq; }, set seq(v) { envSeq = v; }, onGiveUp: null };
  const mover = createMover(env);
  env.onGiveUp = (n) => { mover.halt(n); if (n.rit && out.ritualState !== 'idle') { n.mode = 'wait'; n.timer = 4; return; } if (n.task) social.release(n); else if (n.home && !social.isWander(n) && n.kind !== 'play') { if ((n.giveUps = (n.giveUps || 0) + 1) <= 2) social.goHome(n); else n.excT = 40; } };
  const social = createSocial({ ...env, mover, get seq() { return envSeq; }, set seq(v) { envSeq = v; } });
  out.nav = nav; out.social = social; out.mover = mover;
  // тревога по событиям червя: замолкают и поворачиваются на гул (в сиетче рядом с залом/цистерной — глухой удар)
  const alertLocal = (x, z) => { if (x === undefined) return null; const l = ctx.toLocal(new THREE.Vector3(x, game.camera.position.y, z)); return { x: l.x, z: l.z }; };
  game.bus.on('worm:breach', (e) => social.alert('panic', alertLocal(e?.x, e?.z)));
  game.bus.on('worm:devour', (e) => { if (e?.phase !== 'done') social.alert('panic'); });
  game.bus.on('worm:state', (e) => { if (e?.to === 'Approach' || e?.to === 'Surface') social.alert('hush'); });

  function actAt(n, mode, pose, dwell) { n.mode = mode; n.pose = pose; n.timer = dwell ?? 0; n.speedNow = 0; }

  function think(n, dt, t) {
    switch (n.kind) {
      case 'loom': n.pose = 'weave'; break;
      case 'stall': n.pose = 'trade'; n.talk = (n.cust.length ? !!n.vtalk : ((t * 0.13 + n.phase) % 10) < 3.5) && !n.silent; break;
      case 'water': n.pose = 'measure'; n.talk = n.cust.length ? !!n.vtalk && !n.silent : false; break;
      case 'repair': n.pose = n.role === 'artisan' ? 'repair' : 'stand'; if (n.role !== 'artisan') n.talk = ((t * 0.17 + n.phase) % 8) < 3 && !n.silent; break;
      case 'elder': n.pose = 'sitBench'; n.talk = (n.id % 2 === 0) && !n.silent; break;
      case 'coffee': n.pose = n.role === 'pour' ? 'pour' : 'sitFloor'; break;
      case 'quarrel': n.pose = 'argue'; n.talk = !n.silent; break;
      case 'whisper': n.pose = 'whisper'; n.talk = !n.silent; break;
      case 'shrine': n.pose = n.role === 'stand' ? 'stand' : 'pray'; break;
      case 'funeral': n.pose = 'mourn'; break;
      case 'hooks': n.pose = n.role === 'sharpen' ? 'sharpen' : 'inspect'; break;
      case 'guardPost': case 'guardGrate': n.pose = 'stand'; break;
      case 'play': playThink(n, dt, t); break;
      case 'sleep': n.pose = 'sleep'; n.talk = false; break;
      case 'family': n.pose = 'sitFloor'; n.talk = (n.id % 3 === 0) && !n.silent; break;
      case 'cook': n.pose = 'stir'; n.talk = false; break;
      case 'musician': n.pose = 'play'; n.talk = false; break;
      case 'audience': n.pose = 'sitFloor'; n.talk = false; break;
      case 'scribe': n.pose = 'scribe'; break;
      case 'poolWatch': n.pose = 'measure'; break;
      case 'cellarGuard': cellarGuardThink(n, dt); break;
      case 'guardCheck': guardThink(n, dt, t); break;
      case 'wander': case 'wanderB3': n.pose = 'stand'; break;
      default: break;
    }
    // разговорные группы на месте: говорит по очереди, остальные слушают и смотрят на говорящего
    if (n.sg && !n.silent) { n.talk = n.sg.speaker === n; n.lookNpc = n.sg.speaker === n ? n.sg.listener : n.sg.speaker; }
  }
  // группы на месте (ссора, шёпот, семья за столом, старейшины, кофе): очередь говорящих
  const staticGroups = [];
  {
    const byKey = new Map();
    for (const n of npcs) {
      const key = n.kind === 'quarrel' ? 'q' : n.kind === 'whisper' ? 'w' : n.kind === 'family' ? `f${n.spot.room || ''}` : n.kind === 'elder' ? `e${n.x < 70 ? 0 : 1}` : n.kind === 'coffee' ? 'c' : null;
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, { members: [], speaker: null, listener: null, t: 0 });
      byKey.get(key).members.push(n);
    }
    for (const g of byKey.values()) { if (g.members.length < 2) continue; g.speaker = g.members[0]; g.listener = g.members[1]; g.members.forEach((m) => { m.sg = g; }); staticGroups.push(g); }
  }
  function updateGroups(dt) {
    for (const g of staticGroups) {
      g.t -= dt; if (g.t > 0) continue;
      g.t = 2.4 + R() * 3.4;
      const k = g.members.length, i = g.members.indexOf(g.speaker), j = (i + 1 + Math.floor(R() * (k - 1))) % k;
      g.speaker = g.members[j]; g.listener = g.members[(j + 1 + Math.floor(R() * (k - 1))) % k];
      if (g.members.some((m) => m.lod === 'full')) social.stats.groupTalk++;
    }
  }

  // дети: нерегулярный бег по площадке / в комнате / по коридору, догонялки; «хвост» за матерью
  function arenaPoint(n) {
    const A = n.arena;
    if (A && A.line) { const x = A.x0 + R() * (A.x1 - A.x0); return [x, pathZ(PATHS.C, x) + (R() - 0.5) * 0.9]; }
    const cx = A ? A.x : 47, cz = A ? A.z : -0.3, rr = A ? A.r : 2.6;
    for (let k = 0; k < 4; k++) {
      const a = R() * TAU, r = (0.25 + 0.75 * R()) * rr, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r * 0.9;
      if (nav.walkable(x, z) && nav.clearanceAt(x, z) > 0.5) return [x, z];
    }
    const s = nav.snap(cx, cz, 3); return s ? [s.x, s.z] : [cx, cz];
  }
  function playThink(n, dt) {
    if (n.mode !== 'act') return;
    n.pose = n.role === 'stomp' ? 'stomp' : n.role === 'worm' ? 'crouch' : 'stand';
    if (n.timer > 0) return;
    if (n.leader) { // мать рядом: если она идёт — бегут следом, если стоит — играют вокруг неё
      const L = n.leader, dl = Math.hypot(L.x - n.x, L.z - n.z), walking = L.mode === 'walk';
      if (walking || dl > 4.5 || L.task) {
        if (!walking && dl < 2.6) { n.timer = 0.6 + R(); return; }
        const hy = walking ? L.walkYaw : Math.atan2(n.x - L.x, n.z - L.z), side = (n.id % 2 ? 1 : -1) * 0.55;
        const tx = L.x - Math.sin(hy) * 1.1 + Math.cos(hy) * side, tz = L.z - Math.cos(hy) * 1.1 - Math.sin(hy) * side;
        const p = nav.snap(tx, tz, 1.5);
        mover.goTo(n, p ? p.x : L.x, p ? p.z : L.z, () => { n.timer = 0.15; }, { speed: clamp(0.8 + dl * 0.45, 0.8, 2.3), irregular: walking ? 0 : 0.5 });
        n.timer = 0.5; return;
      }
      n.arena = { x: L.x, z: L.z, r: SOCIAL_CFG.kids.playRadius };
    }
    let tgt, boost = 1.9 + R() * 0.8;
    if ((n.role === 'chase' || n.role === 'chased') && n.buddy) {
      const bd = n.buddy;
      if (n.role === 'chase') { tgt = [bd.x + (R() - 0.5) * 0.4, bd.z + (R() - 0.5) * 0.3]; if (Math.hypot(bd.x - n.x, bd.z - n.z) < 0.9) { n.role = 'chased'; bd.role = 'chase'; n.timer = 0.4; bd.timer = 0.2; n.talk = true; return; } boost = 2.3; }
      else { tgt = arenaPoint(n); boost = 2.5; }
    } else {
      tgt = arenaPoint(n);
      if (!n.arena && R() < 0.12) tgt = [52 + R() * 6, (R() - 0.5) * 5];
      if (n.role === 'worm') boost = 0.35;
    }
    mover.goTo(n, tgt[0], tgt[1], () => { actAt(n, 'act', 'stand', (n.role === 'chase' || n.role === 'chased') ? 0.05 : 0.3 + R() * 1.6); }, { speed: boost, irregular: 1, direct: !!n.arena || Math.hypot(tgt[0] - n.x, tgt[1] - n.z) < 4 });
  }

  // стража погреба: у входа — стоит/сидит, патруль — ходит вдоль нефа
  function cellarGuardThink(n, dt) {
    if (n.role === 'sit') { n.pose = 'sitBench'; return; }
    if (n.role === 'patrol') {
      if (n.mode === 'act' && n.timer <= 0) {
        n.patI = ((n.patI ?? 0) + 1) % 4;
        const pts = [[116, 32.0], [126, 32.0], [138, 32.0], [126, 32.0]], p = pts[n.patI];
        mover.goTo(n, p[0], p[1], () => { actAt(n, 'act', 'stand', 4 + R() * 6); n.baseYaw = faceYaw(0, 1); }, { speed: 0.7 });
      }
      return;
    }
    n.pose = 'stand';
    if (dtPlayerClose(n) < 6) n.goalYaw = Math.atan2(plL.x - n.x, plL.z - n.z);
  }
  const dtPlayerClose = (n) => Math.hypot(plL.x - n.x, plL.z - n.z);

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
    } else if (n.mode === 'act' && Math.abs(n.z - (pathZ(PATHS.B1, n.x) - 1.25)) > 0.15) {
      const gz = pathZ(PATHS.B1, n.x) - 1.25;
      n.talk = false; mover.goTo(n, n.x + 0.5, gz, () => { actAt(n, 'act', 'stand', 0); n.baseYaw = faceYaw(0, 1); n.goalYaw = n.baseYaw; n.stand = true; }, { direct: true, speed: 0.9 });
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
    social.onRitual();
    const seats = buildSeats();
    // на сбор в зал идут жители галереи; те, кто «дома» (спящие, семьи за столом, дети в комнатах/коридоре, повара, музыкант, стража и писец погреба), остаются
    const STAY = new Set(['guardGrate', 'guardPost', 'funeral', 'sleep', 'family', 'cook', 'musician', 'audience', 'scribe', 'poolWatch', 'cellarGuard']);
    const eligible = npcs.filter((n) => !n.special && !STAY.has(n.kind) && !(n.kind === 'play' && n.arena));
    // ближайшие к выходу из галереи идут первыми
    eligible.sort((a, b) => b.x - a.x);
    let si = 0;
    eligible.forEach((n, i) => {
      const s = seats[si++ % seats.length];
      n.rit = { seat: s, delay: i * (0.8 + R() * 0.5) + R() * 3 };
      mover.cancel(n); n.vx = n.vz = 0; n.speedNow = 0; n.yielded = null;
      n.mode = 'wait'; n.timer = n.rit.delay; n.talk = false; n.irregular = 0;
      n.pose = 'stand'; n.after = null;
      n.fig.setTalking?.(false);
    });
    game.bus.emit('sietch:ritualStart', { count: eligible.length });
    return true;
  };
  function ritualDepart(n) {
    const s = n.rit.seat;
    const seatCb = () => { n.mode = 'seat'; n.pose = n.rit.seat.k > 3 && R() < 0.3 ? 'stand' : 'sitFloor'; n.goalYaw = Math.atan2(cx - n.x, cz - n.z); n.sway = R() * 6; out.seated++; if (out.seated === 24) game.bus.emit('sietch:seated', { count: out.seated }); };
    const go = () => mover.goTo(n, s.x, s.z, seatCb, { speed: 1.0 });
    // стоящие за прилавком/станком (другая компонента навигации) сперва выходят в проход кратчайшим путём
    if (!n.canLeave && n.exitPortal) mover.goTo(n, n.exitPortal.x, n.exitPortal.z, go, { direct: true, speed: 0.9 }); else go();
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
      case 'sleep': { P.spine.rotation.x = 0; arms(-0.15, 0.05, -0.5); P.chest.scale.y = 1 + Math.sin(tt * 1.1) * 0.012; break; }
      case 'stir': { P.spine.rotation.x = 0.18; arms(-0.5, -1.05 + Math.sin(tt * 2.4) * 0.12, -1.2 + Math.sin(tt * 2.4 + 1) * 0.15); P.headPivot.rotation.x = 0.35; P.spine.rotation.y = Math.sin(tt * 2.4) * 0.05; break; }
      case 'play': { // музыкант: сидит по-турецки, левая рука на грифе, правая перебирает струны
        P.pelvis.position.y = 0.16 / s; L.L.hip.rotation.x = L.R.hip.rotation.x = -1.4; L.L.hip.rotation.z = 0.5; L.R.hip.rotation.z = -0.5; L.L.kn.rotation.x = L.R.kn.rotation.x = 2.3;
        const beat = Math.sin(tt * 6.2), dn = Math.max(0, beat);
        P.spine.rotation.x = 0.12 + Math.sin(tt * 1.55) * 0.03; P.spine.rotation.z = Math.sin(tt * 1.55) * 0.05;
        arms(-1.55, -1.0 + dn * 0.28, -0.9 - dn * 0.22);
        P.headPivot.rotation.x = 0.25 + Math.sin(tt * 1.55) * 0.08; P.headPivot.rotation.z = Math.sin(tt * 0.8) * 0.08; break;
      }
      case 'scribe': { P.spine.rotation.x = 0.4; arms(-1.1, -1.2 + Math.sin(tt * 4.6) * 0.07, -1.0 + Math.sin(tt * 4.6) * 0.08); P.headPivot.rotation.x = 0.55; break; }
      case 'stomp': { const k = Math.abs(Math.sin(tt * 4.2)); P.pelvis.position.y = (0.92 - 0.1 * k) ; L.L.hip.rotation.x = -k * 0.6; L.R.hip.rotation.x = -(1 - k) * 0.4; arms(-1.3 + k * 0.6, -1.3 + (1 - k) * 0.6, -0.4); break; }
      case 'crouch': { P.pelvis.position.y = 0.55; L.L.kn.rotation.x = L.R.kn.rotation.x = 1.4; L.L.hip.rotation.x = L.R.hip.rotation.x = -1.0; P.spine.rotation.x = 0.7; arms(-1.2, -1.2, -0.4); break; }
      case 'gesture': { // говорит: жесты руками, голова оживлена
        const k = Math.sin(tt * 2.1);
        arms(-0.7 + Math.sin(tt * 1.9) * 0.45, -0.55 + Math.sin(tt * 2.6 + 1) * 0.5, -0.9 - Math.max(0, k) * 0.25); P.spine.rotation.x = 0.06; P.spine.rotation.y = Math.sin(tt * 0.9) * 0.05; break;
      }
      case 'listen': { // слушает: руки опущены/скрещены, редкие кивки
        arms(-0.25, -0.3, -1.1); const nod = Math.max(0, Math.sin(tt * 0.9 + n.id)) ** 6; P.headPivot.rotation.x = 0.04 + nod * 0.18; P.spine.rotation.x = 0.03; break;
      }
      case 'eat': { const b = Math.max(0, Math.sin(tt * 0.9)); arms(-0.9, -0.5 - b * 1.5, -1.3 - b * 0.4); P.spine.rotation.x = 0.1; P.headPivot.rotation.x = 0.15 - b * 0.1; break; }
      case 'sitEat': { P.pelvis.position.y = 0.16 / s; L.L.hip.rotation.x = L.R.hip.rotation.x = -1.4; L.L.hip.rotation.z = 0.5; L.R.hip.rotation.z = -0.5; L.L.kn.rotation.x = L.R.kn.rotation.x = 2.3; const b = Math.max(0, Math.sin(tt * 0.8 + n.id)); arms(-0.9, -0.5 - b * 1.5, -1.3 - b * 0.4); P.spine.rotation.x = 0.12; P.headPivot.rotation.x = 0.2 - b * 0.1; break; }
      case 'tidy': { P.spine.rotation.x = 0.25; arms(-0.95 + Math.sin(tt * 1.4) * 0.15, -1.0 + Math.sin(tt * 1.9 + 1) * 0.2, -0.8); P.headPivot.rotation.x = 0.3; break; }
      case 'drink': { const b = Math.min(1, (Math.sin(tt * 0.5) + 1.2)); arms(-0.3, -0.5 - b * 1.4, -1.4 - b * 0.3); P.headPivot.rotation.x = -0.1 * b; break; }
      case 'stretch': { const b = 0.5 + 0.5 * Math.sin(tt * 0.6); arms(-2.3 * b, -2.3 * b, -0.2); P.spine.rotation.x = -0.15 * b; P.headPivot.rotation.x = -0.2 * b; break; }
      case 'invoke': { arms(-2.2 + Math.sin(tt * 0.5) * 0.12, -2.2 + Math.sin(tt * 0.5 + 1) * 0.12, -0.5); L.L.sh.rotation.z = 0.4; L.R.sh.rotation.z = -0.4; P.headPivot.rotation.x = -0.35; break; }
      case 'sitPray': { sit(0.5, 1.5); arms(-0.95, -0.95, -1.4); P.headPivot.rotation.x = 0.45; P.spine.rotation.x = 0.2 + Math.sin(tt * 0.4) * 0.05; break; }
      default: break;
    }
  }

  // ------------------------------------------------------------------ обновление ----
  let lodT = 0, glowT = 0, ctxTime = 0, capT = 0;
  const upA = new THREE.Vector3(0, 1, 0);
  function glowAt(x, y, z) {
    const p = ctx.probes.sample(x, y, z);
    return [0.05 + p.r * 0.8, 0.03 + p.g * 0.8, 0.015 + p.b * 0.8];
  }
  const regionAt = (x) => (x < 40 ? 'B1' : x < 100 ? 'B2' : x < 150 ? 'B3' : 'B5');

  out.prof = { lod: 0, caps: 0, loop: 0, ai: 0, pose: 0, imp: 0 };
  const PF = out.prof, pnow = () => performance.now();
  const _lt = new THREE.Vector3();
  const reachP = new THREE.Vector3(), zeroP = new THREE.Vector3();
  /** Горожанин на ходу раздвигает занавесь рукой (если идёт на неё): лёгкий жест через IK фигуры. */
  function curtainHand(n) {
    if (game.settings?.curtainHand === false || !n.fig.reachTo) return;
    let best = null, bw = 0;
    if (n.mode === 'walk' && n.speedNow > 0.3) {
      const fx = Math.sin(n.yaw), fz = Math.cos(n.yaw);
      for (const c of ctx.curtains) {
        if (c.axis !== 'x') continue;
        const lat = n.x - c.x; if (Math.abs(lat) > c.w / 2 + 0.1) continue;
        const sd = (n.z - c.z) * c.side; if (Math.abs(sd) > 1.0) continue;
        if (-Math.sign(sd || 1) * fz * c.side < 0.3) continue;
        const w = clamp((1.0 - Math.abs(sd)) / 0.55, 0, 1); if (w > bw) { bw = w; best = c; }
      }
      if (best) { reachP.set(clamp(n.x + fx * 0.35, best.x - best.w / 2 + 0.2, best.x + best.w / 2 - 0.2), n.y + 1.2, best.z); ctx.toWorld(reachP.x, reachP.y, reachP.z, reachP); n.fig.reachTo(reachP, 'R', bw * 0.35); n.reaching = true; out.curtainHands++; return; }
    }
    if (n.reaching) { n.fig.reachTo(zeroP, 'R', 0); n.reaching = false; }
  }
  out.curtainHands = 0;

  out.update = (dt, t) => {
    const q0 = pnow();
    ctxTime = t;
    root.worldToLocal(camL.copy(game.camera.position));
    const pw = game.player?.position;
    if (pw) root.worldToLocal(plL.copy(pw)); else plL.copy(camL);
    // скорость игрока в локальных координатах (сглаженная; прыжок телепорта отбрасываем) и спутники
    if (dt > 0) {
      const ivx = (plL.x - plPrev.x) / dt, ivz = (plL.z - plPrev.z) / dt;
      if (Math.hypot(ivx, ivz) < 9) { plV.x = damp(plV.x, ivx, 9, dt); plV.z = damp(plV.z, ivz, 9, dt); } else plV.x = plV.z = 0;
      plPrev.copy(plL);
      const cl = game.companions?.list || [];
      for (let i = 0; i < cl.length; i++) {
        const c = compL[i] || (compL[i] = { x: 0, z: 0, vx: 0, vz: 0, init: false });
        ctx.toLocal(cl[i].position, _lt);
        if (c.init) { const vx = (_lt.x - c.x) / dt, vz = (_lt.z - c.z) / dt; if (Math.hypot(vx, vz) < 9) { c.vx = vx; c.vz = vz; } else c.vx = c.vz = 0; }
        c.x = _lt.x; c.z = _lt.z; c.init = true;
      }
      compL.length = cl.length;
    }
    lodT -= dt; glowT -= dt;
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
    const q1 = pnow();
    capT -= dt;
    const capAll = capT <= 0; if (capAll) capT = 0.4;
    for (const c of capsules) {
      if (!capAll && c.n.d2 > 900) continue;
      const n = c.n, sitting = n.pose === 'sitFloor' || n.pose === 'sitEat' || n.pose === 'sitPray' || n.mode === 'seat' || n.pose === 'pray' || n.pose === 'crouch' || n.pose === 'play' || n.pose === 'sleep', h = n.lk.height * (n.pose === 'sleep' ? 0.35 : sitting ? 0.6 : 1);
      ctx.toWorld(n.x, n.y + 0.3, n.z, c.a); ctx.toWorld(n.x, n.y + Math.max(0.5, h - 0.2), n.z, c.b);
    }
    const q2 = pnow();
    // социальная жизнь: часы суток, разговоры, навигация (порционный A*)
    social.update(dt, t); updateGroups(dt); nav.pump();
    const q2b = pnow();
    let poolT = 0, impT = 0;
    const dyn = glowT <= 0; if (dyn) glowT = 0.4;
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      // редкий тик для дальних
      n.acc = (n.acc || 0) + dt;
      const far = n.lod !== 'full';
      if (far) { if (n.acc < (n.d2 > 4900 ? 0.6 : n.d2 > 1600 ? 0.3 : 0.12)) { if (n.mode === 'walk' || dyn) writeImpostor(n, i, t, dyn); continue; } }
      // «полные» фигуры (дорогая анимация: походка, ткань, лицо) вдали и в статичных позах обновляем реже: 60 → 30/15/8 Гц
      else if (n.mode !== 'walk' && !n.special && n.acc < (n.d2 > 144 ? 0.12 : n.d2 > 49 ? 0.066 : n.d2 > 20 ? 0.033 : 0)) continue;
      const sdt = n.acc; n.acc = 0;
      n.timer -= sdt; n.barkT -= sdt; n.bark2 -= sdt;
      const dxp = plL.x - n.x, dzp = plL.z - n.z, dp = Math.hypot(dxp, dzp);
      // замолкание разговоров рядом с игроком
      if (n.group >= 0 || n.kind === 'stall' || n.chat || n.sg) { if (dp < 3.4) n.silent = 5; else n.silent = Math.max(0, n.silent - sdt); }
      if (n.mode === 'wait') { if (n.timer <= 0) ritualDepart(n); }
      if (n.mode === 'walk') {
        const rit = n.rit && out.ritualState !== 'idle';
        mover.step(n, sdt, n.lod !== 'full' && n.d2 > 900, rit ? (camL.x > 100 && n.d2 > 625 ? 3.2 : 1.55) : 1);
      } else if (n.mode === 'seat') { /* сидит */ }
      else if (n.mode === 'act') {
        if (!n.special) {
          n.goalYaw = n.baseYaw;
          if (!social.tick(n, sdt) && !social.pauseTick(n)) { think(n, sdt, t); social.think(n, sdt); }
        } else think(n, sdt, t);
      }
      if (n.mode !== 'walk') { n.speedNow = 0; n.vx = n.vz = 0; }
      if (!n.special && n.mode !== 'wait') social.react(n, sdt, dp, dxp, dzp);
      n.yaw = dampAngle(n.yaw, n.mode === 'walk' ? n.walkYaw : n.goalYaw, n.mode === 'walk' ? MOVE_CFG.turnLambda : MOVE_CFG.idleTurnLambda, sdt);
      if (n.lod === 'full' && n.mode === 'act' && (n.pose === 'weave' || n.pose === 'measure' || n.pose === 'repair') && dp < 12) {
        n.sfxT = (n.sfxT ?? R() * 2) - sdt;
        if (n.sfxT <= 0) { n.sfxT = n.pose === 'weave' ? 1.1 + R() * 0.6 : 5 + R() * 4; game.audio?.event?.(n.pose === 'weave' ? 'Loom.Clack' : n.pose === 'measure' ? 'Water.Measure' : 'Stillsuit.Repair', ctx.toWorld(n.x, n.y + 1.0, n.z)); }
      }
      if (n.lod === 'full') {
        const gy = n.special && n.kind === 'priestess' ? rimY : ground(n.x, n.z, n.layer || 0);
        n.y = n.mode === 'walk' && Math.abs(gy - n.y) < 0.5 ? damp(n.y, gy, 16, sdt) : gy;
        const g = n.fig.group;
        g.position.set(n.x, n.y, n.z); g.rotation.y = n.yaw;
        if (n.kind === 'sleep') layDown(n);
        n.fig.setTalking?.(n.talk && !n.silent);
        const qa = pnow();
        if (n.special) specialPose(n, sdt, t); else { applyPose(n, sdt, t); social.applyLook(n); curtainHand(n); }
        poolT += pnow() - qa;
      } else { n.y = n.special ? n.y : ground(n.x, n.z, n.layer || 0); if (n.kind === 'dancer') specialMove(n, sdt, t); }
      const qi = pnow(); writeImpostor(n, i, t, dyn); impT += pnow() - qi;
    }
    impBody.instanceMatrix.needsUpdate = impHead.instanceMatrix.needsUpdate = impSash.instanceMatrix.needsUpdate = true;
    if (dyn) { impBody.geometry.attributes.aGlow.needsUpdate = impHead.geometry.attributes.aGlow.needsUpdate = impSash.geometry.attributes.aGlow.needsUpdate = true; }
    const q3 = pnow(), e = 0.05;
    PF.lod += (q1 - q0 - PF.lod) * e; PF.caps += (q2 - q1 - PF.caps) * e; PF.ai += (q3 - q2 - poolT - impT - PF.ai) * e; PF.pose += (poolT - PF.pose) * e; PF.imp += (impT - PF.imp) * e;
    PF.loop = PF.ai + PF.lod + PF.caps;
  };

  const _e2 = new THREE.Euler();
  /** Спящий: лежит на спине головой по направлению n.yaw (фигура поворачивается вокруг стоп, стопы смещены назад на полдлины тела). */
  function layDown(n) {
    const g = n.fig.group, hx = Math.sin(n.yaw), hz = Math.cos(n.yaw), len = 0.85 * n.scale;
    g.rotation.order = 'YXZ'; g.rotation.set(-Math.PI / 2, n.yaw + Math.PI, 0);
    g.position.set(n.x - hx * len, (n.bedY ?? n.y) + 0.1, n.z - hz * len);
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
    if (n.mode === 'seat' || n.pose === 'sitFloor' || n.pose === 'sitEat' || n.pose === 'pray') { sy = s * 0.55; }
    else if (n.pose === 'sitBench' || n.pose === 'sitPray' || n.pose === 'weave') { sy = s * 0.72; }
    else if (n.pose === 'crouch') sy = s * 0.7;
    if (n.mode === 'walk') { yoff = Math.abs(Math.sin(t * 6 * (n.speed) + n.phase)) * 0.035; lean = 0.06; }
    else if (n.mode !== 'seat') lean = Math.sin(t * 0.6 + n.phase) * 0.012;
    const yy = n.special && n.kind === 'priestess' ? rimY : n.y;
    if (n.kind === 'sleep') {
      const hx = Math.sin(n.yaw), hz = Math.cos(n.yaw), len = 0.85 * s;
      _e.set(-Math.PI / 2, n.yaw + Math.PI, 0, 'YXZ'); _q.setFromEuler(_e);
      _p.set(n.x - hx * len, (n.bedY ?? n.y) + 0.1, n.z - hz * len); _s.set(bulk * s, s, bulk * s);
      _m.compose(_p, _q, _s); impBody.setMatrixAt(i, _m); impSash.setMatrixAt(i, _m); impHead.setMatrixAt(i, _m);
      if (dyn) { const g = glowAt(n.x, n.y + 0.4, n.z); impGlow[i * 3] = g[0]; impGlow[i * 3 + 1] = g[1]; impGlow[i * 3 + 2] = g[2]; }
      return;
    }
    _e.set(lean, n.yaw, n.mode === 'seat' && out.ritualState !== 'idle' ? Math.sin(t * 0.7 + (n.sway || 0)) * 0.06 : 0, 'YXZ'); _q.setFromEuler(_e);
    const ex = n.mode === 'walk' ? Math.min(n.acc, 0.7) : 0;
    _p.set(n.x + (n.vx || 0) * ex, yy + yoff, n.z + (n.vz || 0) * ex); _s.set(bulk * s, sy, bulk * s);
    _m.compose(_p, _q, _s); impBody.setMatrixAt(i, _m); impSash.setMatrixAt(i, _m);
    // голова не должна «проваливаться» — масштаб по Y как у тела
    impHead.setMatrixAt(i, _m);
    if (dyn) { const g = glowAt(n.x, n.y + 1, n.z); impGlow[i * 3] = g[0]; impGlow[i * 3 + 1] = g[1]; impGlow[i * 3 + 2] = g[2]; }
  }

  // ------------------------------------------------------------------ прочее API ----
  out.speakerPos = (id) => {
    const n = id === 'Harmat' ? harmat : id === 'Priestess' ? priestess : id === 'Dancer' ? dancer : id === 'Guard' ? guardCheck : null;
    if (!n) return null;
    return ctx.toWorld(n.x, n.y + n.lk.height * 0.95, n.z);
  };
  out.count = npcs.length;
  // тестовый хук: мгновенно рассадить толпу по местам
  out.debugSeatAll = () => {
    out.startRitual();
    for (const n of npcs) if (n.rit) { n.mode = 'seat'; n.pose = 'sitFloor'; n.x = n.rit.seat.x; n.z = n.rit.seat.z; n.y = ground(n.x, n.z, n.layer || 0); n.yaw = n.goalYaw = Math.atan2(cx - n.x, cz - n.z); n.sway = R() * 6; out.seated++; }
  };
  return out;
}
