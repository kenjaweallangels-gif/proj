// Сиетч «Табр-ан-Нур»: интерьер, свет, толпа, ритуал и финал. Регистрируется как game.sietch.
// Локальные координаты сиетча смещены на SIETCH_ORIGIN (отдельное пространство, вход — телепортом).
import * as THREE from 'three';
import { SIETCH_ORIGIN, GOLDEN_PATH } from '../core/layout.js';
import { Builder, bakeGlow, refine } from './builder.js';
import { makeMaterials, U } from './mats.js';
import { buildStatic } from './arch.js';
import { buildProps } from './props.js';
import { planGlobes, planWells } from './lightplan.js';
import * as plan from './plan.js';
import { createLighting } from './lighting.js';
import { createCrowd } from './crowd.js';
import { createDoors } from './doors.js';
import { createFinale } from './finale.js';

const LABEL_EXAMINE = { RU: 'Осмотреть', EN: 'Examine' };
// Точки входа (локальные координаты сиетча; yaw — как у player.teleport: atan2(dz, dx)).
const SPAWN = { B1: { x: 2.4, z: 0, yaw: 0 }, B2: { x: 44, z: 0, yaw: 0 }, B3: { x: 104, z: 0, yaw: 0 }, B4: { x: 122, z: 6.2, yaw: Math.PI / 2 }, B5: { x: 153, z: 0, yaw: 0 }, bowl: { x: 167, z: 0, yaw: 0 } };

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
  const globes = planGlobes();
  const wells = planWells();
  const ctx = { globes, wells, niches: [], game, M, root, origin: O, quality: q, poi: {} };

  // --- Источники запечённого света (тёплые омни — светошары; холодные конусы — колодцы; луч зала).
  const AMBER = [1.0, 0.6, 0.26];
  const sources = [];
  for (const g of globes) sources.push({ kind: 'omni', region: g.region, x: g.x, y: g.y, z: g.z, color: AMBER, intensity: 0.6 * g.k, d0: 2.8, radius: 15 });
  for (const w of wells) sources.push({ kind: 'spot', region: w.region, x: w.x, y: w.y0, z: w.z, color: [0.42, 0.6, 0.95], intensity: 1.1, coneR: 1.6, fall: 14, radius: 40 });
  sources.push({ kind: 'spot', region: 'B5', x: plan.HALL.cx, y: 25, z: plan.HALL.cz, color: [1.0, 0.86, 0.62], intensity: 1.5, coneR: 2.6, fall: 30, radius: 60 });
  sources.push({ kind: 'omni', region: 'B1', x: 0.6, y: 1.6, z: -0.8, color: [0.4, 0.58, 0.9], intensity: 1.4, d0: 2.4, radius: 9 });
  // «Невидимые» тёплые источники под сводом зала: подсветка рёбер (отражённый от луча свет).
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.2; sources.push({ kind: 'omni', region: 'B5', x: plan.HALL.cx + Math.cos(a) * 11, y: 15, z: plan.HALL.cz + Math.sin(a) * 9, color: [1.0, 0.7, 0.4], intensity: 1.0, d0: 6, radius: 22 }); }
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; sources.push({ kind: 'omni', region: 'B5', x: plan.HALL.cx + Math.cos(a) * 4, y: 10, z: plan.HALL.cz + Math.sin(a) * 4, color: [1.0, 0.8, 0.55], intensity: 0.7, d0: 5, radius: 14 }); }
  ctx.sources = sources;

  // --- Статическая геометрия.
  const B = new Builder();
  buildStatic(B, M, ctx);
  buildProps(B, ctx);
  const staticMeshes = [];
  for (const { key, mat: mk, region, geo } of B.merged()) {
    const g = refine(geo, 1.7);
    bakeGlow(g, sources, () => region, { ambient: 0.02 });
    g.computeBoundingSphere(); g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, M[mk]);
    mesh.name = `S_${key}`;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    root.add(mesh); staticMeshes.push(mesh);
  }

  // --- Внутренний свет: тёплый полусвет, «дымка пряности».
  const hemi = new THREE.HemisphereLight(new THREE.Color('#ffd9a8'), new THREE.Color('#6a4426'), 1.3);
  root.add(hemi);
  ctx.hemi = hemi;

  const lighting = createLighting(ctx);
  ctx.lighting = lighting;
  lighting.onDrip = (k, x, z) => game.audio?.event?.('Water.Drip', new THREE.Vector3(x, -1.2 + O.y, z));
  const crowd = createCrowd(ctx);
  const doors = createDoors(ctx, crowd);
  const finale = createFinale(ctx, crowd);

  // --- Вход/выход: окружение, туман, чужие источники света.
  const FOG = new THREE.Color('#2b1a0f');
  const saved = { fog: null, bg: null, hidden: [], exposure: 1 };
  const env = { fog: null, bg: null };
  let envT = 0;
  const isMine = (o) => { for (let p = o; p; p = p.parent) if (p === root) return true; return false; };
  function setInside(b) {
    if (b === api.inside) return;
    api.inside = b;
    if (b) {
      saved.fog = scene.fog; saved.bg = scene.background; saved.exposure = game.renderer.toneMappingExposure;
      env.fog = new THREE.FogExp2(FOG.clone(), 0.021); env.bg = FOG.clone(); scene.fog = env.fog; scene.background = env.bg;
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

  // --- Интерактивные точки (POI).
  const poiList = [
    ['LORE_Carving_Fremen', ctx.poi.carvingEntry],
    ['LORE_Quizarate_Sigil', ctx.poi.sigil],
    ['LORE_Revivalist_Mural', ctx.poi.muralAt],
    ['LORE_Cistern_Grate', ctx.poi.grate],
    ['LORE_Water_Rings', ctx.poi.waterRings],
    ['LORE_Maker_Hooks', ctx.poi.hooks],
    ['LORE_Shiana_Shrine', ctx.poi.shrine],
    ['LORE_Worm_Throat', ctx.poi.worm],
    ['LORE_Thumper_Rack', ctx.poi.thumpers],
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

  // --- Публичный API.
  const api = {
    root, ctx, meshes: staticMeshes, crowd, doors, poi, finale, lighting, inside: false,
    heightAt(x, z, yh) { return plan.heightAtLocal(x - O.x, z - O.z, yh ?? ((game.player?.position?.y ?? 0) - O.y)) + O.y; },
    surfaceAt(x, z) { return plan.surfaceAtLocal(x - O.x, z - O.z); },
    collide(pos, r) {
      const p = { x: pos.x - O.x, z: pos.z - O.z };
      const moved = plan.collideLocal(p, r, pos.y - O.y);
      if (moved) { pos.x = p.x + O.x; pos.z = p.z + O.z; }
      return moved;
    },
    zoneAt(pos) { return plan.zoneAtLocal(pos.x - O.x, pos.z - O.z); },
    /** Переход в сиетч (затемнение — снаружи, у UI/сюжета). По умолчанию — B1 лицом вглубь (+X).
     *  point: 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'bowl' (для debug.goto). */
    enter(point = 'B1') {
      setInside(true);
      const P = SPAWN[point] || SPAWN.B1;
      const x = O.x + P.x, z = O.z + P.z, y = O.y;
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
      // другие модули (погода) могут менять туман/фон/свет пустыни — удерживаем интерьер.
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
