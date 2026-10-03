// Сиетч «Табр-ан-Нур»: пещерное поселение, вырезанное в живой скале «Когтя» (SDF → запечённый меш), свет, толпа, ритуал и финал.
// БЕСШОВНО: сиетч лежит внутри скалы в мировых координатах (core/layout.js: SIETCH_ORIGIN, ENTRY, GARDEN), без телепортов и затемнений.
// Проектная система сиетча (локальная): +X вглубь, +Z вправо, Y вверх; world = ORIGIN + R(ORIGIN.yaw + CAVE_YAW)·local, поэтому root повёрнут.
// Регистрируется как game.sietch; game.sietch.contains(pos) — «внутри пещер» (включая входную расщелину и выходной туннель);
// core/zones.js по нему переключает game.space ('sietch' | 'desert').
import * as THREE from 'three';
import { SIETCH_ORIGIN, ENTRY, GARDEN } from '../core/layout.js';
import { makeMaterials, U, MAX_PUSHERS } from './mats.js';
import * as plan from './plan.js';
import { loadCave } from './cave/runtime.js';
import { CAVE_YAW, EXIT, ENTRY_MOUTH } from './cave/layout.js';
import { createProbes } from './probes.js';
import { Builder, refine } from './builder.js';
import { buildProps } from './props.js';
import { planGlobes, planWells } from './lightplan.js';
import { createLighting } from './lighting.js';
import { createCrowd } from './crowd.js';
import { createDoors } from './doors.js';
import { createFinale } from './finale.js';
import { clamp, smoothstep, lerp } from '../core/util.js';

const LABEL_EXAMINE = { RU: 'Осмотреть', EN: 'Examine' };
// Точки входа для отладки (локальные координаты; yaw — локальный, как atan2(dz, dx) в проектной системе).
const SPAWN = { B1: { x: 2.4, z: 0, yaw: 0 }, B2: { x: 44, z: 0, yaw: 0 }, B3: { x: 104, z: 0.5, yaw: 0 }, B4: { x: 121.4, z: 7.0, yaw: Math.PI / 2 }, B5: { x: 153, z: 0, yaw: 0 }, bowl: { x: 167, z: 0, yaw: 0 }, exit: { x: 187, z: -44, yaw: 0 }, cleft: { x: -2.2, z: 7.2, yaw: Math.PI / 2 } };
const INTERIOR_FOG = new THREE.Color('#1c130e');

export function create(game) {
  const { scene } = game;
  const T0 = performance.now();
  const q = game.settings?.quality || 'med';
  const O = SIETCH_ORIGIN;
  const YAW = (O.yaw || 0) + CAVE_YAW, cY = Math.cos(YAW), sY = Math.sin(YAW);
  const root = new THREE.Group();
  root.name = 'Sietch';
  root.position.set(O.x, O.y, O.z);
  root.rotation.y = -YAW;
  root.visible = false;
  scene.add(root);
  root.updateMatrixWorld(true);

  const M = makeMaterials();
  const cave = loadCave();
  plan.setGrids(cave.grids);
  const probes = createProbes(cave.probes);
  const globes = planGlobes(cave);
  const wells = planWells();
  const _tw = new THREE.Vector3();
  const toWorld = (x, y, z, out = new THREE.Vector3()) => out.set(x, y, z).applyMatrix4(root.matrixWorld);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toLocal = (v, out = new THREE.Vector3()) => out.copy(v).applyMatrix4(inv);
  const ctx = { game, M, root, origin: O, quality: q, poi: {}, cave, probes, anchors: cave.anchors, niches: [], globes, wells, toWorld, toLocal, curtains: [] };

  const staticMeshes = [];
  cave.chunks.forEach((g, i) => {
    const mesh = new THREE.Mesh(g, M.rock);
    mesh.name = `Rock_${i}`; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    root.add(mesh); staticMeshes.push(mesh);
  });
  // --- Декали трёх слоёв истории (запечены на стены конформно).
  const decalOrder = { carving: 1, carvingB: 1, hands: 2, sigil: 3, mural: 4, chalk: 5, embroidery: 5 };
  for (const d of cave.decals) {
    const mk = M[`decal:${d.tex}`]; if (!mk) continue;
    const mesh = new THREE.Mesh(d.geometry, mk);
    mesh.name = `Decal_${d.tex}`; mesh.renderOrder = 1 + (decalOrder[d.tex] || 1); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    root.add(mesh); staticMeshes.push(mesh);
  }
  // --- Реквизит: свет и AO из запечённых зондов пещеры.
  const B = new Builder();
  buildProps(B, ctx);
  for (const { key, mat: mk, geo } of B.merged()) {
    const g = refine(geo, 1.1);
    probes.bakeGeometry(g);
    g.computeBoundingSphere(); g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, M[mk]);
    mesh.name = `S_${key}`; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    root.add(mesh); staticMeshes.push(mesh);
  }
  // Реквизит как твёрдые тела реестра game.colliders (боксы в мировых координатах).
  for (const b of plan.allBlocks()) {
    const cx = b.r !== undefined ? b.cx : (b.x0 + b.x1) / 2, cz = b.r !== undefined ? b.cz : (b.z0 + b.z1) / 2;
    const hx = b.r !== undefined ? b.r : (b.x1 - b.x0) / 2, hz = b.r !== undefined ? b.r : (b.z1 - b.z0) / 2;
    const fy = plan.heightAtLocal(cx, cz, b.level ? 6 : 0);
    game.colliders?.add({ type: 'box', c: toWorld(cx, fy + 0.6, cz), half: new THREE.Vector3(hx, 0.6, hz), yaw: YAW, owner: 'sietch', tags: new Set(['prop']) });
  }

  // --- Свет: тёплые светошары против холодного рассеянного света шахт.
  const hemi = new THREE.HemisphereLight(new THREE.Color('#9db4d8'), new THREE.Color('#5a3a22'), 0);
  root.add(hemi);
  const HEMI_I = 1.0;
  ctx.hemi = hemi;
  const lighting = createLighting(ctx);
  ctx.lighting = lighting;
  lighting.onDrip = (k, x, z) => game.audio?.event?.('Water.Drip', toWorld(x, -1.2, z));
  const crowd = createCrowd(ctx);
  const doors = createDoors(ctx, crowd);
  const finale = createFinale(ctx, crowd);

  // --- Проёмы в скале (мир): входная расщелина и портал в котловину.
  const mouths = [
    { id: 'cleft', w: toWorld(ENTRY_MOUTH[0], 1.0, ENTRY_MOUTH[1]) },
    { id: 'portal', w: toWorld(194, EXIT.drop + 1.0, -46.2) },
  ];
  try {
    game.world?.addRockHole?.({ x: ENTRY.cleft.x, y: ENTRY.cleft.y + 1.5, z: ENTRY.cleft.z, r: 2.3 });
    game.world?.addRockHole?.({ x: GARDEN.portal.x, y: GARDEN.portal.y + 1.5, z: GARDEN.portal.z, r: 2.8 });
    game.world?.addPassage?.({ points: [{ x: ENTRY.cleft.x, z: ENTRY.cleft.z }, { x: O.x, z: O.z }], width: 2.4 });
    game.world?.addPassage?.({ points: EXIT.nodes.slice(-6).map((n) => ({ x: O.x + n[0] * cY - n[1] * sY, z: O.z + n[0] * sY + n[1] * cY })), width: 2.8 });
  } catch (e) { console.warn('[sietch] rock holes', e); }

  // --- Интерактивные точки (POI).
  const poiList = [
    ['LORE_Carving_Fremen', ctx.poi.carvingEntry], ['LORE_Quizarate_Sigil', ctx.poi.sigil], ['LORE_Revivalist_Mural', ctx.poi.muralAt],
    ['LORE_Cistern_Grate', ctx.poi.grate], ['LORE_Water_Rings', ctx.poi.waterRings], ['LORE_Maker_Hooks', ctx.poi.hooks],
    ['LORE_Shiana_Shrine', ctx.poi.shrine], ['LORE_Worm_Throat', ctx.poi.worm], ['LORE_Thumper_Rack', ctx.poi.thumpers],
  ];
  const poi = [];
  for (const [id, p] of poiList) {
    if (!p) continue;
    const it = {
      id, tag: `Rakis.POI.${id}`, label: LABEL_EXAMINE, radius: id === 'LORE_Worm_Throat' ? 7 : 3.2,
      position: toWorld(p[0], p[1], p[2]),
      get enabled() { return game.space === 'sietch'; },
      onInteract() { game.dialogue?.lore?.(id); game.bus.emit('interact', { tag: `Rakis.POI.${id}` }); },
    };
    poi.push(it); game.interactables.push(it);
  }
  // Скрытая расщелина (бывший «фальшивый камень»): без телепорта — просто отметка для сюжета/звука.
  const falseRock = {
    id: 'FalseRock', tag: 'Rakis.FalseRock', label: { RU: 'Раздвинуть камни', EN: 'Part the stones' }, radius: 2.6,
    position: new THREE.Vector3(ENTRY.cleft.x, ENTRY.cleft.y + 1.2, ENTRY.cleft.z), done: false,
    get enabled() { return game.space === 'desert' && !this.done; },
    onInteract() { this.done = true; game.bus.emit('interact', { tag: 'Rakis.FalseRock' }); },
  };
  game.interactables.push(falseRock);

  // ------------------------------------------------------------------ среда: плавный переход снаружи ↔ внутри ----
  const deepDist = 38;
  let kNow = 0, nearNow = false, worldHidden = false, lightsT = 0;
  const outLights = [];
  const isMine = (o) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  function refreshLights() { outLights.length = 0; scene.traverse((o) => { if (o.isLight && !isMine(o)) outLights.push(o); }); }
  const openDist = (v) => { let m = 1e9; for (const o of mouths) m = Math.min(m, o.w.distanceTo(v)); return m; };

  const prevRender = game.render;
  const savedI = [];
  game.render = function (...args) {
    const k = kNow;
    if (k <= 0.002) return prevRender.apply(this, args);
    // вне пещеры солнце/небо светят пустыню; в глубине — только светошары: гасим мировые источники и подмешиваем туман/экспозицию интерьера
    savedI.length = 0;
    for (const L of outLights) { savedI.push(L.intensity); L.intensity *= (1 - k); }
    const fog = scene.fog, bg = scene.background, ex = game.renderer.toneMappingExposure;
    let fc = null, fd = 0, fn = 0, ff = 0, bgc = null;
    if (fog) { fc = fog.color.clone(); fd = fog.density; fn = fog.near; ff = fog.far; fog.color.lerp(INTERIOR_FOG, k); if (fog.density !== undefined) fog.density = lerp(fd || 0.002, 0.016, k); if (fog.far !== undefined) { fog.near = lerp(fn, 1.5, k); fog.far = lerp(ff, 85, k); } }
    if (bg && bg.isColor) { bgc = bg.clone(); bg.lerp(INTERIOR_FOG, k); } else if (k > 0.6) scene.background = INTERIOR_FOG;
    game.renderer.toneMappingExposure = ex * lerp(1, 1.15, k);
    const r = prevRender.apply(this, args);
    for (let i = 0; i < outLights.length; i++) outLights[i].intensity = savedI[i];
    if (fog) { fog.color.copy(fc); if (fog.density !== undefined) fog.density = fd; if (fog.far !== undefined) { fog.near = fn; fog.far = ff; } }
    if (bgc) bg.copy(bgc); else if (k > 0.6) scene.background = bg;
    game.renderer.toneMappingExposure = ex;
    return r;
  };

  // ------------------------------------------------------------------ ткань: толкатели и «рука отодвигает занавесь» ----
  const reaching = new Map(); // figure → {t}
  const pf = new THREE.Vector3(), pt = new THREE.Vector3(), tmpW = new THREE.Vector3();
  let slot = 0;
  const setCap = (a, b, r) => { if (slot >= MAX_PUSHERS) return; U.uCapA.value[slot].set(a.x, a.y, a.z, r); U.uCapB.value[slot].set(b.x, b.y, b.z, r); slot++; };
  function curtainReach(who, fig, wp, yawWorld, moving) {
    // wp — позиция ступней (мир); yawWorld — направление взгляда по atan2(dz,dx)
    toLocal(wp, pf);
    const dx = Math.cos(yawWorld), dz = Math.sin(yawWorld);
    const fx = dx * cY + dz * sY, fz = -dx * sY + dz * cY; // локальное направление
    let best = null, bw = 0, bt = null;
    for (const c of ctx.curtains) {
      if (c.axis !== 'x') continue;
      const lat = pf.x - c.x; if (Math.abs(lat) > c.w / 2 + 0.1) continue;
      const sdist = (pf.z - c.z) * c.side; if (Math.abs(sdist) > 1.35) continue;
      const toward = -Math.sign(sdist || 1) * fz * c.side;
      if (toward < 0.3 || !moving) continue;
      const w = smoothstep(1.35, 0.5, Math.abs(sdist));
      if (w > bw) { bw = w; best = c; }
    }
    if (best) {
      pt.set(clamp(pf.x + fx * 0.35, best.x - best.w / 2 + 0.2, best.x + best.w / 2 - 0.2), pf.y + 1.2, best.z);
      toWorld(pt.x, pt.y, pt.z, tmpW);
      fig?.reachTo?.(tmpW, 'R', bw);
      reaching.set(fig, true);
      if (bw > 0.25) { slot < MAX_PUSHERS && setCap(pt, pt, 0.13); }
    } else if (reaching.get(fig)) { fig?.reachTo?.(pf.set(0, 0, 0), 'R', 0); reaching.set(fig, false); }
  }
  function updatePushers() {
    slot = 0;
    for (let i = 0; i < MAX_PUSHERS; i++) { U.uCapA.value[i].set(0, -999, 0, 0); U.uCapB.value[i].set(0, -999, 0, 0); }
    const pl = game.player;
    const bodies = [];
    if (pl?.position) bodies.push({ p: pl.position, fig: pl.figure, yaw: pl.yaw, mv: (pl.speed || 0) > 0.15 });
    for (const c of game.companions?.list || []) bodies.push({ p: c.position, fig: c.figure, yaw: c.figure ? Math.PI / 2 - c.figure.group.rotation.y : 0, mv: true });
    for (const b of bodies) {
      if (!b.p) continue;
      const lp = toLocal(b.p, _tw);
      if (Math.abs(lp.x - 100) > 120) { /* далеко по проектной оси — всё равно считаем дёшево */ }
      const a = new THREE.Vector3(lp.x, lp.y + 0.4, lp.z), bb = new THREE.Vector3(lp.x, lp.y + 1.45, lp.z);
      setCap(a, bb, 0.28);
      curtainReach('b', b.fig, b.p, b.yaw, b.mv);
    }
  }

  // ------------------------------------------------------------------ геометрия «внутри» ----
  const localOf = (pos, out) => toLocal(pos, out);
  function inCave(pos) {
    const l = localOf(pos, _tw);
    if (!plan.hasAnyFloor(l.x, l.z)) return false;
    const f0 = plan.heightAtLocal(l.x, l.z, 0), f1 = plan.heightAtLocal(l.x, l.z, 6);
    const ly = l.y;
    return (ly - f0 > -1.6 && ly - f0 < 37) || (ly - f1 > -1.6 && ly - f1 < 37);
  }

  const api = {
    root, ctx, meshes: staticMeshes, cave, probes, crowd, doors, lighting, finale, poi, inside: false, get k() { return kNow; },
    toWorld, toLocal,
    /** true, если точка (мировая) внутри пещер сиетча, включая входную расщелину и выходной туннель. */
    contains(pos) { return inCave(pos); },
    heightAt(x, z, yh) {
      _tw.set(x, (yh ?? (game.player?.position?.y ?? O.y)), z); toLocal(_tw, _tw);
      const lh = plan.heightAtLocal(_tw.x, _tw.z, _tw.y);
      return toWorld(_tw.x, lh, _tw.z, new THREE.Vector3()).y;
    },
    surfaceAt(x, z) { _tw.set(x, O.y, z); toLocal(_tw, _tw); return plan.surfaceAtLocal(_tw.x, _tw.z); },
    collide(pos, r) {
      // Открытый конец выходного туннеля: последние метры до устья сада стены сиетча не держат —
      // дальше коллизию ведёт котловина (game.garden), иначе туннель — тупик.
      const pm = mouths[1].w;
      if (pos.x > pm.x - 1.5 && Math.abs(pos.z - pm.z) < 2.6 && Math.abs(pos.y - (pm.y - 1.0)) < 2.5) return false;
      toLocal(pos, _tw);
      const p = { x: _tw.x, z: _tw.z };
      const moved = plan.collideLocal(p, r, _tw.y);
      if (moved) { const w = toWorld(p.x, _tw.y, p.z, new THREE.Vector3()); pos.x = w.x; pos.z = w.z; }
      return moved;
    },
    zoneAt(pos) { toLocal(pos, _tw); return plan.zoneAtLocal(_tw.x, _tw.z); },
    /** Отладочный телепорт (внутри сиетча без затемнений): point = 'B1'|'B2'|'B3'|'B4'|'B5'|'bowl'|'exit'|'cleft'. */
    enter(point = 'B1') {
      const P = SPAWN[point] || SPAWN.B1;
      if (game.space !== 'sietch') { const from = game.space; game.space = 'sietch'; game.bus.emit('space', { space: 'sietch', from }); }
      const ly = plan.heightAtLocal(P.x, P.z, 0);
      const w = toWorld(P.x, ly, P.z);
      const yaw = P.yaw + YAW;
      if (game.player?.teleport) game.player.teleport(w.x, w.y, w.z, yaw);
      else if (game.player?.position) game.player.position.set(w.x, w.y, w.z);
      game.companions?.teleportBehind?.();
      game.weather?.request?.(point === 'B5' || point === 'bowl' ? 'Hall_Ritual' : 'Sietch_Interior', 0.5);
      return new Promise((res) => requestAnimationFrame(() => res(true)));
    },
    leave() { const c = ENTRY.cleft; game.player?.teleport?.(c.x - 4, game.world?.heightAt?.(c.x - 4, c.z) ?? c.y, c.z, Math.PI); },
    startRitual() { return crowd.startRitual(); },
    /** Финал ~20 с в реальном времени (без камеры-кат-сцены): жрица поёт, девушка танцует, наиб оборачивается к игроку. */
    playFinale(o) { crowd.startRitual(); return finale.play(o); },
    endFinale() { finale.stop(); },
    speakerPos(id) { return crowd.speakerPos(id); },
    update(dt, t) {
      U.uTime.value = t;
      const cam = game.camera.position, pp = game.player?.position || cam;
      const d = openDist(pp);
      const insideNow = inCave(pp);
      api.inside = insideNow;
      const kT = insideNow ? smoothstep(2.5, 16, d) : 0;
      kNow = lerp(kNow, kT, 1 - Math.exp(-dt * 6));
      if (Math.abs(kNow - kT) < 0.004) kNow = kT;
      const near = insideNow || d < 95;
      if (near !== root.visible) root.visible = near;
      // небо/пустыню скрываем только глубоко внутри (экономия)
      const deep = insideNow && d > deepDist;
      if (deep !== worldHidden) { worldHidden = deep; game.world?.setVisible?.(!deep); }
      hemi.intensity = HEMI_I * kNow;
      if ((lightsT -= dt) <= 0) { lightsT = 1.5; refreshLights(); }
      if (!root.visible) return;
      lighting.update(dt, t);
      const pl = toLocal(pp, new THREE.Vector3());
      doors.update(dt, pl);
      crowd.update(dt, t);
      finale.update(dt);
      updatePushers();
    },
  };
  game.bus.on('ritual', () => { api.startRitual(); });
  game.bus.on('zone', (e) => { if (e?.to === 'B5_Hall') api.startRitual(); });
  console.info(`[sietch] build ${(performance.now() - T0).toFixed(0)} ms, static meshes ${staticMeshes.length}, npcs ${crowd.count}`);
  return game.add('sietch', api);
}
