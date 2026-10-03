// Сиетч «Табр-ан-Нур»: пещерное поселение, вырезанное в живой скале (SDF → запечённый меш), свет, толпа, ритуал и финал.
// Регистрируется как game.sietch. Локальные координаты сиетча смещены на SIETCH_ORIGIN (отдельное пространство, вход — телепортом).
import * as THREE from 'three';
import { SIETCH_ORIGIN, GOLDEN_PATH } from '../core/layout.js';
import { makeMaterials, U } from './mats.js';
import * as plan from './plan.js';
import { loadCave } from './cave/runtime.js';
import { createProbes } from './probes.js';
import { Builder, refine } from './builder.js';
import { buildProps } from './props.js';
import { planGlobes, planWells } from './lightplan.js';
import { createLighting } from './lighting.js';
import { createCrowd } from './crowd.js';
import { createDoors } from './doors.js';
import { createFinale } from './finale.js';

const LABEL_EXAMINE = { RU: 'Осмотреть', EN: 'Examine' };
// Точки входа (локальные координаты сиетча; yaw — как у player.teleport: atan2(dz, dx)).
const SPAWN = { B1: { x: 2.4, z: 0, yaw: 0 }, B2: { x: 44, z: 0, yaw: 0 }, B3: { x: 104, z: 0.5, yaw: 0 }, B4: { x: 122, z: 6.2, yaw: Math.PI / 2 }, B5: { x: 153, z: 0, yaw: 0 }, bowl: { x: 167, z: 0, yaw: 0 } };

export function create(game) {
  const { scene } = game;
  const T0 = performance.now();
  const q = game.settings?.quality || 'med';
  const O = SIETCH_ORIGIN;
  const root = new THREE.Group();
  root.name = 'Sietch';
  root.position.set(O.x, O.y, O.z);
  root.visible = false;
  scene.add(root);

  const M = makeMaterials();
  const cave = loadCave();
  plan.setGrids(cave.grids);
  const probes = createProbes(cave.probes);
  const globes = planGlobes(cave);
  const wells = planWells();
  const ctx = { game, M, root, origin: O, quality: q, poi: {}, cave, probes, anchors: cave.anchors, niches: [], globes, wells };

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

  // --- Реквизит: сборка по материалам, свет и AO — из запечённых зондов пещеры.
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

  // --- Внутренний свет: холодный серо-синий «рассеянный» от шахт против тёплых светошаров.
  const hemi = new THREE.HemisphereLight(new THREE.Color('#9db4d8'), new THREE.Color('#5a3a22'), 1.0);
  root.add(hemi);
  ctx.hemi = hemi;

  // --- Вход/выход: окружение, туман, чужие источники света.
  const FOG = new THREE.Color('#1c130e');
  const saved = { fog: null, bg: null, hidden: [], exposure: 1 };
  const env = { fog: null, bg: null };
  let envT = 0;
  const isMine = (o) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  function setInside(b) {
    if (b === api.inside) return;
    api.inside = b;
    if (b) {
      saved.fog = scene.fog; saved.bg = scene.background; saved.exposure = game.renderer.toneMappingExposure;
      env.fog = new THREE.FogExp2(FOG.clone(), 0.016); env.bg = FOG.clone(); scene.fog = env.fog; scene.background = env.bg;
      game.world?.setVisible?.(false);
      saved.hidden = [];
      scene.traverse((o) => { if (o.isLight && o.visible && !isMine(o)) { saved.hidden.push(o); o.visible = false; } });
      root.visible = true;
      game.space = 'sietch';
      game.bus.emit('space', { space: 'sietch' });
    } else {
      root.visible = false;
      scene.fog = saved.fog; scene.background = saved.bg;
      for (const o of saved.hidden) o.visible = true;
      saved.hidden = [];
      game.world?.setVisible?.(true);
      game.space = 'desert';
      game.bus.emit('space', { space: 'desert' });
    }
  }

  const lighting = createLighting(ctx);
  ctx.lighting = lighting;
  lighting.onDrip = (k, x, z) => game.audio?.event?.('Water.Drip', new THREE.Vector3(x, -1.2 + O.y, z));
  const crowd = createCrowd(ctx);
  const doors = createDoors(ctx, crowd);
  const finale = createFinale(ctx, crowd);

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
      position: new THREE.Vector3(p[0] + O.x, p[1] + O.y, p[2] + O.z),
      get enabled() { return game.space === 'sietch'; },
      onInteract() { game.dialogue?.lore?.(id); game.bus.emit('interact', { tag: `Rakis.POI.${id}` }); },
    };
    poi.push(it); game.interactables.push(it);
  }

  // Фальшивый камень (пустынная сторона): затемнение → enter → проявление.
  const fr = GOLDEN_PATH.find((p) => p.id === 'FALSE_ROCK');
  let entering = false;
  const falseRock = {
    id: 'FalseRock', tag: 'Rakis.FalseRock', label: { RU: 'Отодвинуть камень', EN: 'Push the stone' }, radius: 3.2,
    position: new THREE.Vector3(fr.x, (game.world?.heightAt?.(fr.x, fr.z) ?? 0) + 1.2, fr.z),
    get enabled() { return game.space === 'desert' && !entering; },
    async onInteract() {
      if (entering) return;
      entering = true;
      game.bus.emit('interact', { tag: 'Rakis.FalseRock' });
      try {
        await game.ui?.fade?.(true, 0.8);
        await api.enter();
        await game.ui?.fade?.(false, 1.2);
      } finally { entering = false; }
    },
  };
  game.interactables.push(falseRock);

  const api = {
    root, ctx, meshes: staticMeshes, cave, probes, crowd, doors, lighting, finale, poi, inside: false,
    heightAt(x, z, yh) { return plan.heightAtLocal(x - O.x, z - O.z, yh ?? ((game.player?.position?.y ?? 0) - O.y)) + O.y; },
    surfaceAt(x, z) { return plan.surfaceAtLocal(x - O.x, z - O.z); },
    collide(pos, r) {
      const p = { x: pos.x - O.x, z: pos.z - O.z };
      const moved = plan.collideLocal(p, r, pos.y - O.y);
      if (moved) { pos.x = p.x + O.x; pos.z = p.z + O.z; }
      return moved;
    },
    zoneAt(pos) { return plan.zoneAtLocal(pos.x - O.x, pos.z - O.z); },
    enter(point = 'B1') {
      setInside(true);
      const P = SPAWN[point] || SPAWN.B1;
      const x = O.x + P.x, z = O.z + P.z, y = O.y + plan.heightAtLocal(P.x, P.z, 0);
      if (game.player?.teleport) game.player.teleport(x, y, z, P.yaw);
      else if (game.player?.position) game.player.position.set(x, y, z);
      game.companions?.teleportBehind?.();
      game.weather?.request?.(point === 'B5' || point === 'bowl' ? 'Hall_Ritual' : 'Sietch_Interior', 0.5);
      const zn = plan.zoneAtLocal(P.x, P.z);
      if (game.zone !== zn) { const from = game.zone; game.zone = zn; game.bus.emit('zone', { from, to: zn }); }
      return new Promise((res) => requestAnimationFrame(() => res(true)));
    },
    leave() { setInside(false); },
    startRitual() { return crowd.startRitual(); },
    /** Финал ~20 с. opts.hold=true — не снимать cinematic по окончании (камера остаётся на лице Хармата). */
    playFinale(o) { crowd.startRitual(); return finale.play(o); },
    endFinale() { finale.stop(); },
    speakerPos(id) { return crowd.speakerPos(id); },
    update(dt, t) {
      U.uTime.value = t;
      if (!api.inside) return;
      if (scene.fog !== env.fog) scene.fog = env.fog;
      if (scene.background !== env.bg) scene.background = env.bg;
      if ((envT -= dt) <= 0) { envT = 0.5; for (const o of saved.hidden) if (o.visible) o.visible = false; }
      lighting.update(dt, t);
      const pw = game.player?.position;
      const pl = pw ? { x: pw.x - O.x, y: pw.y - O.y, z: pw.z - O.z } : { x: game.camera.position.x - O.x, y: 0, z: game.camera.position.z - O.z };
      doors.update(dt, pl);
      crowd.update(dt, t);
      finale.update(dt);
    },
  };
  game.bus.on('ritual', () => { api.startRitual(); });
  game.bus.on('zone', (e) => { if (e?.to === 'B5_Hall') api.startRitual(); });
  console.info(`[sietch] build ${(performance.now() - T0).toFixed(0)} ms, static meshes ${staticMeshes.length}, npcs ${crowd.count}`);
  return game.add('sietch', api);
}
