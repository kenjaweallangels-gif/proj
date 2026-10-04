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
import { CAVE_YAW, EXIT, ENTRY_MOUTH, ENTRY_CUT, CELLAR } from './cave/layout.js';
import { createField } from './cave/field.js';
import { createProbes } from './probes.js';
import { Builder, refine } from './builder.js';
import { buildProps } from './props.js';
import { planGlobes, planWells } from './lightplan.js';
import { createLighting } from './lighting.js';
import { createCrowd } from './crowd.js';
import { createDoors } from './doors.js';
import { createFinale } from './finale.js';
import { createLife } from './life.js';
import { clamp, smoothstep, lerp } from '../core/util.js';

const LABEL_EXAMINE = { RU: 'Осмотреть', EN: 'Examine' };
// POI погреба: если у story ещё нет отдельных реплик (LORE_Water_Debts / LORE_Cellar_Pool / LORE_Water_Measure), читаются близкие по смыслу существующие.
const LORE_FB = { LORE_Water_Debts: 'LORE_Water_Rings', LORE_Cellar_Pool: 'LORE_Cistern_Grate', LORE_Water_Measure: 'LORE_Water_Rings' };
// Точки входа для отладки (локальные координаты; yaw — локальный, как atan2(dz, dx) в проектной системе).
const _en = EXIT.nodes;
const SPAWN = {
  B1: { x: 2.4, z: 0, yaw: 0 }, B2: { x: 44, z: 0, yaw: 0 }, B3: { x: 104, z: 0.5, yaw: 0 }, B4: { x: 121.4, z: 7.0, yaw: Math.PI / 2 }, B5: { x: 153, z: 0, yaw: 0 }, bowl: { x: 167, z: 0, yaw: 0 },
  exit: { x: _en[_en.length - 12][0], z: _en[_en.length - 12][1], yaw: Math.atan2(EXIT.dir[1], EXIT.dir[0]) }, exitStart: { x: 184, z: -12, yaw: -Math.PI / 2 },
  cleft: { x: -2.2, z: 7.2, yaw: Math.PI / 2 },
  B6: { x: 101.3, z: 11.5, yaw: Math.PI / 2 }, cellar: { x: 114, z: 31.4, yaw: 0 }, pool: { x: 127, z: 32.2, yaw: Math.PI / 2 }, station: { x: 141, z: 37, yaw: 0 },
  room: { x: 126, z: -3.2, yaw: -Math.PI / 2 }, room2: { x: 142, z: 4.0, yaw: Math.PI / 2 }, bay: { x: 62, z: 6.5, yaw: Math.PI / 2 },
};
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
  const _tw = new THREE.Vector3(), _p2 = { x: 0, z: 0 };
  const toWorld = (x, y, z, out = new THREE.Vector3()) => out.set(x, y, z).applyMatrix4(root.matrixWorld);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const toLocal = (v, out = new THREE.Vector3()) => out.copy(v).applyMatrix4(inv);
  // Скалярные преобразования (root — только поворот вокруг Y и сдвиг): без аллокаций, вызываются игроком/зонами по нескольку раз за кадр.
  const lxOf = (x, z) => (x - O.x) * cY + (z - O.z) * sY, lzOf = (x, z) => -(x - O.x) * sY + (z - O.z) * cY;
  const ctx = { game, M, root, origin: O, quality: q, poi: {}, cave, probes, anchors: cave.anchors, niches: [], globes, wells, toWorld, toLocal, curtains: [] };

  const staticMeshes = [];
  // Меши, подчинённые PVS-отсечению: {mesh, chunk} (chunk = индекс чанка пещеры, чья видимость определяет видимость меша; −1 — всегда)
  const pvsMeshes = [];
  /** Чанки 16 м, покрытые габаритом меша: меш виден, если виден любой из них (пустой список — виден всегда). */
  const chunksOfBox = (bb) => {
    const CH = cave.CHUNK, ids = [];
    for (let i = Math.floor(bb.min.x / CH); i <= Math.floor(bb.max.x / CH); i++) for (let j = Math.floor(bb.min.y / CH); j <= Math.floor(bb.max.y / CH); j++) for (let k = Math.floor(bb.min.z / CH); k <= Math.floor(bb.max.z / CH); k++) { const id = cave.chunkIndexByKey.get(`${i},${j},${k}`); if (id !== undefined) ids.push(id); }
    return ids;
  };
  const chunkMeshes = new Array(cave.chunks.length).fill(null);
  cave.chunks.forEach((g, i) => {
    const mesh = new THREE.Mesh(g, M.rock);
    mesh.name = `Rock_${i}`; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    root.add(mesh); staticMeshes.push(mesh); chunkMeshes[i] = mesh; pvsMeshes.push({ mesh, chunks: [i] });
  });
  // --- Декали трёх слоёв истории (запечены на стены конформно), разбиты по ячейкам 16 м.
  const decalOrder = { carving: 1, carvingB: 1, hands: 2, sigil: 3, mural: 4, chalk: 5, embroidery: 5, tally: 3 };
  for (const d of cave.decals) {
    const mk = M[`decal:${d.tex}`]; if (!mk) continue;
    for (const pc of d.pieces) {
      const mesh = new THREE.Mesh(pc.geometry, mk);
      mesh.name = `Decal_${d.tex}`; mesh.renderOrder = 1 + (decalOrder[d.tex] || 1); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      root.add(mesh); staticMeshes.push(mesh); pvsMeshes.push({ mesh, chunks: chunksOfBox(pc.bbox) });
    }
  }
  // --- Реквизит: свет и AO из запечённых зондов пещеры.
  const B = new Builder();
  buildProps(B, ctx);
  for (const { key, mat: mk, geo, cell } of B.merged()) {
    const g = refine(geo, 1.1);
    probes.bakeGeometry(g);
    g.computeBoundingSphere(); g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, M[mk]);
    mesh.name = `S_${key}`; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    root.add(mesh); staticMeshes.push(mesh);
    pvsMeshes.push({ mesh, chunks: chunksOfBox(g.boundingBox) });
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
  lighting.onDrip = (k, x, z, y = -1.2) => game.audio?.event?.('Water.Drip', toWorld(x, y, z));
  const crowd = createCrowd(ctx);
  const doors = createDoors(ctx, crowd);
  const finale = createFinale(ctx, crowd);
  const life = createLife(ctx, crowd);
  const plV = new THREE.Vector3();

  // --- Проёмы в скале (мир): входная расщелина и устье выходного туннеля (портал в котловину).
  const portalW = toWorld(EXIT.mouth[0], EXIT.drop + 1.0, EXIT.mouth[1]);
  const mouths = [
    { id: 'cleft', w: toWorld(ENTRY_MOUTH[0], 1.0, ENTRY_MOUTH[1]) },
    { id: 'portal', w: portalW },
  ];
  try {
    game.world?.addRockHole?.({ x: ENTRY.cleft.x, y: ENTRY.cleft.y + 1.5, z: ENTRY.cleft.z, r: 2.3 });
    game.world?.addRockHole?.({ x: GARDEN.portal.x - 1.4, y: GARDEN.portal.y + 1.1, z: GARDEN.portal.z, r: 1.25 });   // низкий лаз ≈ 2.0 × 2.25 м в грани
    game.world?.addPassage?.({ points: [{ x: ENTRY.cleft.x, y: ENTRY.cleft.y, z: ENTRY.cleft.z }, { x: O.x, y: O.y, z: O.z }], r: 2.4 });
    game.world?.addPassage?.({ points: EXIT.nodes.map((n, i) => ({ n, i })).filter(({ i }) => EXIT.cum[i] > EXIT.length - EXIT.tail - 18 && EXIT.cum[i] <= EXIT.length - EXIT.tail + 1).map(({ n, i }) => { const w = toWorld(n[0], EXIT.ys[i], n[1]); return { x: w.x, y: w.y, z: w.z }; }), r: 2.6 });
  } catch (e) { console.warn('[sietch] rock holes', e); }

  // --- Интерактивные точки (POI).
  const poiList = [
    ['LORE_Carving_Fremen', ctx.poi.carvingEntry], ['LORE_Quizarate_Sigil', ctx.poi.sigil], ['LORE_Revivalist_Mural', ctx.poi.muralAt],
    ['LORE_Cistern_Grate', ctx.poi.grate], ['LORE_Water_Rings', ctx.poi.waterRings], ['LORE_Maker_Hooks', ctx.poi.hooks],
    ['LORE_Shiana_Shrine', ctx.poi.shrine], ['LORE_Worm_Throat', ctx.poi.worm], ['LORE_Thumper_Rack', ctx.poi.thumpers],
    ['LORE_Water_Debts', ctx.poi.cellarLedger], ['LORE_Cellar_Pool', ctx.poi.cellarPool], ['LORE_Water_Measure', ctx.poi.cellarStation],
  ];
  const poi = [];
  for (const [id, p] of poiList) {
    if (!p) continue;
    const it = {
      id, tag: `Rakis.POI.${id}`, label: LABEL_EXAMINE, radius: id === 'LORE_Worm_Throat' ? 7 : 3.2,
      position: toWorld(p[0], p[1], p[2]),
      get enabled() { return game.space === 'sietch'; },
      onInteract() { game.dialogue?.lore?.((!game.data?.Dialogue?.[id] && LORE_FB[id]) || id); game.bus.emit('interact', { tag: `Rakis.POI.${id}` }); },
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
  // Свет/туман/экспозиция смешиваются по расстоянию до ближайшего проёма: за последние ~22 м туннеля к саду дневной свет нарастает плавно.
  const deepDist = 40;
  let kNow = 0, worldHidden = false, lightsT = 0, sceneN = -1;
  const outLights = [];
  const isMine = (o) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  function refreshLights() { outLights.length = 0; scene.traverse((o) => { if (o.isLight && !isMine(o)) outLights.push(o); }); }
  const openDist = (v) => { let m = 1e9; for (const o of mouths) m = Math.min(m, o.w.distanceTo(v)); return m; };

  const prevRender = game.render;
  const savedI = [];
  const _fc = new THREE.Color(), _bgc = new THREE.Color();
  game.render = function (...args) {
    const k = kNow;
    if (k <= 0.002) return prevRender.apply(this, args);
    // вне пещеры солнце/небо светят пустыню; в глубине — только светошары: гасим мировые источники и подмешиваем туман/экспозицию интерьера
    savedI.length = 0;
    for (const L of outLights) { savedI.push(L.intensity); L.intensity *= (1 - k); }
    const fog = scene.fog, bg = scene.background, ex = game.renderer.toneMappingExposure;
    let fd = 0, fn = 0, ff = 0, hasBg = false;
    if (fog) { _fc.copy(fog.color); fd = fog.density; fn = fog.near; ff = fog.far; fog.color.lerp(INTERIOR_FOG, k); if (fog.density !== undefined) fog.density = lerp(fd || 0.002, 0.016, k); if (fog.far !== undefined) { fog.near = lerp(fn, 1.5, k); fog.far = lerp(ff, 85, k); } }
    if (bg && bg.isColor) { hasBg = true; _bgc.copy(bg); bg.lerp(INTERIOR_FOG, k); } else if (k > 0.6) scene.background = INTERIOR_FOG;
    game.renderer.toneMappingExposure = ex * lerp(1, 1.15, k);
    const r = prevRender.apply(this, args);
    for (let i = 0; i < outLights.length; i++) outLights[i].intensity = savedI[i];
    if (fog) { fog.color.copy(_fc); if (fog.density !== undefined) fog.density = fd; if (fog.far !== undefined) { fog.near = fn; fog.far = ff; } }
    if (hasBg) bg.copy(_bgc); else if (k > 0.6) scene.background = bg;
    game.renderer.toneMappingExposure = ex;
    return r;
  };

  // ------------------------------------------------------------------ ткань: толкатели и «рука отодвигает занавесь» ----
  // Занавеси подвязаны и без коллизии; шейдер раздвигает ткань вокруг персонажей (капсулы), а «рука» — лишь тонкий необязательный жест
  // (game.settings.curtainHand === false отключает).
  const reaching = new Map(); // figure → bool
  const pf = new THREE.Vector3(), pt = new THREE.Vector3(), tmpW = new THREE.Vector3(), capA = new THREE.Vector3(), capB = new THREE.Vector3();
  let slot = 0;
  const setCap = (a, b, r) => { if (slot >= MAX_PUSHERS) return; U.uCapA.value[slot].set(a.x, a.y, a.z, r); U.uCapB.value[slot].set(b.x, b.y, b.z, r); slot++; };
  function curtainReach(fig, wp, yawWorld, moving) {
    if (game.settings?.curtainHand === false || !fig?.reachTo) return;
    toLocal(wp, pf);
    const dx = Math.cos(yawWorld), dz = Math.sin(yawWorld);
    const fx = dx * cY + dz * sY, fz = -dx * sY + dz * cY; // локальное направление
    let best = null, bw = 0;
    for (const c of ctx.curtains) {
      if (c.axis !== 'x') continue;
      const lat = pf.x - c.x; if (Math.abs(lat) > c.w / 2 + 0.1) continue;
      const sdist = (pf.z - c.z) * c.side; if (Math.abs(sdist) > 1.0) continue;
      const toward = -Math.sign(sdist || 1) * fz * c.side;
      if (toward < 0.3 || !moving) continue;
      const w = smoothstep(1.0, 0.45, Math.abs(sdist));
      if (w > bw) { bw = w; best = c; }
    }
    if (best) {
      pt.set(clamp(pf.x + fx * 0.35, best.x - best.w / 2 + 0.2, best.x + best.w / 2 - 0.2), pf.y + 1.2, best.z);
      toWorld(pt.x, pt.y, pt.z, tmpW);
      fig.reachTo(tmpW, 'R', bw * 0.35);
      reaching.set(fig, true);
    } else if (reaching.get(fig)) { fig.reachTo(pf.set(0, 0, 0), 'R', 0); reaching.set(fig, false); }
  }
  function updatePushers() {
    slot = 0;
    for (let i = 0; i < MAX_PUSHERS; i++) { U.uCapA.value[i].set(0, -999, 0, 0); U.uCapB.value[i].set(0, -999, 0, 0); }
    const pl = game.player;
    const push = (p, fig, yaw, mv) => {
      if (!p) return;
      const lp = toLocal(p, _tw);
      capA.set(lp.x, lp.y + 0.4, lp.z); capB.set(lp.x, lp.y + 1.45, lp.z);
      setCap(capA, capB, 0.28);
      curtainReach(fig, p, yaw, mv);
    };
    if (pl?.position) push(pl.position, pl.figure, pl.yaw, (pl.speed || 0) > 0.15);
    for (const c of game.companions?.list || []) push(c.position, c.figure, c.figure ? Math.PI / 2 - c.figure.group.rotation.y : 0, true);
    // горожане рядом тоже раздвигают занавеси (у комнат): ближайшие ходячие фигуры
    for (const n of crowd.npcs) { if (slot >= MAX_PUSHERS) break; if (n.lod !== 'full' || n.mode !== 'walk') continue; capA.set(n.x, n.y + 0.4, n.z); capB.set(n.x, n.y + 1.4, n.z); setCap(capA, capB, 0.26); }
  }

  // ------------------------------------------------------------------ геометрия «внутри» ----
  const localOf = (pos, out) => toLocal(pos, out);
  const exM = EXIT.mouth, exD = EXIT.dir;
  let airField = null; const _ad = new THREE.Vector3();
  function inCave(pos) {
    const lx = lxOf(pos.x, pos.z), lz = lzOf(pos.x, pos.z);
    if (!plan.hasAnyFloor(lx, lz)) return false;
    // за плоскостью устья (в котловине) пещера кончается: «хвост» туннеля существует лишь в поле для сеток, мира сада он не принадлежит
    if (lz < -40 && lx > 185 && (lx - exM[0]) * exD[0] + (lz - exM[1]) * exD[1] > EXIT.cutT) return false;
    // за плоскостью входа (на западе) — ниша тропы (модуль level): её меш/коллизия, сиетч уже не владеет землёй
    if (lz > 0.5 && lx < 2 && lz < 30 && (lx - ENTRY_CUT.p[0]) * ENTRY_CUT.n[0] + (lz - ENTRY_CUT.p[1]) * ENTRY_CUT.n[1] > ENTRY_CUT.cutT) return false;
    const f0 = plan.heightAtLocal(lx, lz, 0), f1 = plan.heightAtLocal(lx, lz, 6);
    const ly = pos.y - O.y;
    return (ly - f0 > -1.6 && ly - f0 < 37) || (ly - f1 > -1.6 && ly - f1 < 37);
  }

  // ------------------------------------------------------------------ PVS: видимость чанков из ячейки камеры ----
  const pv = cave.pvs;
  const rowAtLocal = (x, y, z) => {
    const i = Math.floor((x - pv.ox) / pv.cs), j = Math.floor((y - pv.oy) / pv.cs), k = Math.floor((z - pv.oz) / pv.cs);
    if (i < 0 || j < 0 || k < 0 || i >= pv.nx || j >= pv.ny || k >= pv.nz) return -1;
    return pv.idx[(k * pv.ny + j) * pv.nx + i];
  };
  const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const mouthRows = mouths.map((m) => { const l = toLocal(m.w, new THREE.Vector3()); return rowAtLocal(l.x - (m.id === 'portal' ? exD[0] * 3 : 0), l.y, l.z - (m.id === 'portal' ? exD[1] * 3 : 0)); });
  let pvsKey = -9;
  const pvsStats = { visible: 0, total: pvsMeshes.length };
  function applyRow(row) {
    if (row < 0) { for (const e of pvsMeshes) e.mesh.visible = true; pvsStats.visible = pvsMeshes.length; return; }
    const o = row * pv.nb;
    let n = 0;
    for (const e of pvsMeshes) {
      let v = e.chunks.length === 0;
      for (let c = 0; c < e.chunks.length && !v; c++) { const ci = e.chunks[c]; v = (pv.bits[o + (ci >> 3)] & (1 << (ci & 7))) !== 0; }
      e.mesh.visible = v; if (v) n++;
    }
    pvsStats.visible = n;
  }
  const _cl = new THREE.Vector3();
  function updatePVS(insideNow) {
    toLocal(game.camera.position, _cl);
    let row = rowAtLocal(_cl.x, _cl.y, _cl.z);
    if (row < 0) {
      for (const [a, b, c] of NB6) { row = rowAtLocal(_cl.x + a * pv.cs, _cl.y + b * pv.cs, _cl.z + c * pv.cs); if (row >= 0) break; }
    }
    if (row < 0 && !insideNow) { // снаружи — как из ближайшего проёма
      let bd = 1e9, bi = -1; mouths.forEach((m, i) => { const d = m.w.distanceTo(game.camera.position); if (d < bd) { bd = d; bi = i; } });
      row = mouthRows[bi] ?? -1;
    }
    if (row !== pvsKey) { pvsKey = row; applyRow(row); }
  }

  const api = {
    root, ctx, meshes: staticMeshes, cave, probes, crowd, doors, lighting, finale, life, poi, inside: false, get k() { return kNow; }, pvsStats,
    /** Скользящее среднее стоимости update() по подсистемам, мс/кадр (JS-часть, без GPU). */
    prof: { pvs: 0, lighting: 0, crowd: 0, life: 0, total: 0 },
    toWorld, toLocal, plan,
    /** true, если точка (мировая) внутри пещер сиетча, включая входную расщелину и выходной туннель (до плоскости устья). */
    contains(pos) { return inCave(pos); },
    /**
     * Знаковое расстояние от мировой точки до камня пещеры (SDF, тот же, из которого запечён меш): < 0 — воздух (глубина внутри), > 0 — камень/вне пещеры.
     * Для камеры от первого лица: сфера радиуса r свободна, если airDist(pos) < -r. Поле строится лениво (≈8 мс), запрос ≈ 40 мкс.
     */
    airDist(pos) {
      airField ??= createField();
      toLocal(pos, _ad);
      return airField.air(_ad.x, _ad.y, _ad.z);
    },
    heightAt(x, z, yh) {
      const lx = lxOf(x, z), lz = lzOf(x, z);
      return O.y + plan.heightAtLocal(lx, lz, (yh ?? (game.player?.position?.y ?? O.y)) - O.y);
    },
    surfaceAt(x, z) { return plan.surfaceAtLocal(lxOf(x, z), lzOf(x, z)); },
    collide(pos, r) {
      _p2.x = lxOf(pos.x, pos.z); _p2.z = lzOf(pos.x, pos.z);
      const moved = plan.collideLocal(_p2, r, pos.y - O.y);
      if (moved) { pos.x = O.x + _p2.x * cY - _p2.z * sY; pos.z = O.z + _p2.x * sY + _p2.z * cY; }
      return moved;
    },
    zoneAt(pos) { return plan.zoneAtLocal(lxOf(pos.x, pos.z), lzOf(pos.x, pos.z), pos.y - O.y); },
    /** Отладочный телепорт (внутри сиетча без затемнений): point = 'B1'..'B6'|'bowl'|'exit'|'exitStart'|'cleft'|'cellar'|'pool'|'station'|'room'|'room2'|'bay'. */
    enter(point = 'B1') {
      const P = SPAWN[point] || SPAWN.B1;
      if (game.space !== 'sietch') { const from = game.space; game.space = 'sietch'; game.bus.emit('space', { space: 'sietch', from }); }
      const ly = plan.heightAtLocal(P.x, P.z, point === 'bay' ? 6.5 : 0);
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
      const kT = insideNow ? smoothstep(1.0, 22, d) : 0;
      kNow = lerp(kNow, kT, 1 - Math.exp(-dt * 6));
      if (Math.abs(kNow - kT) < 0.004) kNow = kT;
      const near = insideNow || d < 95;
      if (near !== root.visible) root.visible = near;
      // небо/пустыню скрываем только глубоко внутри (экономия)
      const deep = insideNow && d > deepDist;
      if (deep !== worldHidden) { worldHidden = deep; game.world?.setVisible?.(!deep); }
      hemi.intensity = HEMI_I * kNow;
      if ((lightsT -= dt) <= 0 || scene.children.length !== sceneN) { lightsT = 8; sceneN = scene.children.length; refreshLights(); }
      if (!root.visible) return;
      const p0 = performance.now();
      updatePVS(insideNow);
      const p1 = performance.now();
      lighting.update(dt, t);
      const p2 = performance.now();
      toLocal(pp, plV);
      doors.update(dt, plV);
      crowd.update(dt, t);
      const p3 = performance.now();
      life.update(dt, t);
      finale.update(dt);
      updatePushers();
      const p4 = performance.now(), e = 0.05, P = api.prof;
      P.pvs += (p1 - p0 - P.pvs) * e; P.lighting += (p2 - p1 - P.lighting) * e; P.crowd += (p3 - p2 - P.crowd) * e; P.life += (p4 - p3 - P.life) * e; P.total += (p4 - p0 - P.total) * e;
    },
  };
  game.bus.on('ritual', () => { api.startRitual(); });
  game.bus.on('zone', (e) => { if (e?.to === 'B5_Hall') api.startRitual(); });
  console.info(`[sietch] build ${(performance.now() - T0).toFixed(0)} ms, static meshes ${staticMeshes.length}, npcs ${crowd.count}`);
  // Путь выходного туннеля в мировых координатах (для ботов/навигации): от зала до плоскости устья (включительно).
  api.exitPath = EXIT.nodes.map((n, i) => ({ n, i })).filter(({ i }) => EXIT.cum[i] <= EXIT.length - EXIT.tail + 0.5).map(({ n, i }) => toWorld(n[0], EXIT.ys[i], n[1]));
  api.mouths = { cleft: mouths[0].w, portal: mouths[1].w };
  return game.add('sietch', api);
}
