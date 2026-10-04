// Спутники: Илва, Райн, позже Оссана. Вид от первого лица: игрок — камера, поэтому спутники держатся позади-сбоку и не лезут в кадр.
//  • Строй: в открытом месте — позади слева/справа от направления ХОДЬБЫ игрока (не от взгляда: повороты головы на месте их не дёргают);
//    в узких местах (тропа по скале, расщелина, проходы сиетча) — гуськом по «хлебным крошкам» следа; переход плавный (ширина проверяется зондами вбок).
//  • Не перекрывают обзор: в «конусе кадра» впереди камеры отталкиваются вбок и притормаживают; в узком проходе на пути игрока становятся «призраками»
//    (камера их не упирает), так что не загораживают ход.
//  • Не телепортируются в кадре: отстающие догоняют бегом (скорость игрока × catchSpeed); перенос — только вне поля зрения и далеко.
//  • Игрок остановился: останавливаются на естественной дистанции (restMin..restMax), потом осматриваются, пьют воду, переговариваются друг с другом.
//  • Реплики (bus 'subtitle'): говорящий жестикулирует и шевелит ртом, остальные смотрят на него (или на игрока, если говорит Каир).
// Курс (yaw) = atan2(dz, dx), как у игрока. Фигура: rotation.y = π/2 − yaw. Все числа — CFG.companions (config.js).
import * as THREE from 'three';
import { makeFigure } from '../core/figures.js';
import { CFG } from './config.js';
import { clamp, damp, dampAngle } from '../core/util.js';

const V3 = THREE.Vector3;
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const SPECS = {
  Ilva: { figure: { preset: 'Ilva' }, glance: [2.5, 4.5], nervous: 0, side: -1 },
  Rayn: { figure: { preset: 'Rayn' }, glance: [0.8, 1.8], nervous: 1, side: 1 },
  Ossana: { figure: { preset: 'Ossana' }, glance: [3, 5], nervous: 0, hooks: true, side: -1 },
};
const rnd = ([a, b]) => a + Math.random() * (b - a);

export function create(game) {
  const C = CFG.companions;
  const player = () => game.player;
  const list = [];
  let follow = true;
  const trail = []; // {x, z, s}
  let trailTip = null; // последняя точка (копия позиции игрока)
  const ignoreSet = new Set(); // владельцы тел спутников (зонды ширины их не учитывают)
  const stats = { warps: 0, warpsVisible: 0, ghosts: 0, drinks: 0, looks: 0, chats: 0, talks: 0 };

  // Состояние игрока (оценка по перемещению: от камеры/позиции, без обращения к внутренностям игрока)
  const P = { x: 0, z: 0, y: 0, vx: 0, vz: 0, speed: 0, head: 0, still: 1, init: false, narrow: false, fileW: 0, probeT: 0, camX: 1, camZ: 0, closing: 0 };
  const camDir = new V3(), tmp = new V3(), probeP = new V3();

  const companions = {
    list, stats,
    get following() { return follow; },
    setFollow(b) { follow = !!b; },
    speakerPos(id) {
      const pl = player();
      if (id === 'Kair') return pl ? pl.head() : null;
      const c = list.find((q) => q.id === id);
      return c ? new V3(c.position.x, c.position.y + c.figure.height * 0.93, c.position.z) : null;
    },
    /** Добавить спутника (идемпотентно). Ossana появляется сбоку от игрока и вливается в цепочку. */
    join(id) {
      if (list.some((q) => q.id === id) || !SPECS[id]) return list.find((q) => q.id === id) || null;
      const spec = SPECS[id];
      const figure = makeFigure(spec.figure);
      figure.onStep = (e) => onStep(c, e);
      game.scene.add(figure.group);
      const c = {
        id, figure, spec, position: new V3(), yaw: 0, speed: 0, nextStep: 0, idleT: 0, glanceT: 1, glanceDir: 0, weight: 0, vel: new V3(), vy: 0, groundY: 0, moving: false, walkDesert: false,
        rest: false, ghost: false, talkUntil: 0, listenTo: null, act: null, actT: rnd(C.idleLook), drinkT: rnd(C.idleDrink), pose: { w: 0, kind: '' }, lookPt: new V3(), lookW: 0, lagT: 0,
      };
      c.bodyA = new V3(); c.bodyB = new V3(); c.owner = 'companion:' + id;
      c.bodyId = game.colliders?.add({ type: 'capsule', a: c.bodyA, b: c.bodyB, r: CFG.radius, owner: c.owner });
      ignoreSet.add(c.owner);
      list.push(c);
      const pl = player();
      if (pl) {
        const side = id === 'Ossana' ? 1 : 0;
        const fx = Math.cos(pl.yaw), fz = Math.sin(pl.yaw), rx = -fz, rz = fx;
        c.position.set(pl.position.x + fx * 2 * side + rx * 7 * side - fx * 3.5 * (1 - side), 0, pl.position.z + fz * 2 * side + rz * 7 * side - fz * 3.5 * (1 - side));
        c.position.y = game.heightAt(c.position.x, c.position.z);
        c.yaw = Math.atan2(pl.position.z - c.position.z, pl.position.x - c.position.x);
      }
      sync(c);
      return c;
    },
    /** Поставить спутников строем позади игрока (и перестроить след). Вызывается при отладочных телепортах, не в кадре. */
    teleportBehind() {
      const pl = player(); if (!pl) return;
      readCamera();
      const fx = P.camX, fz = P.camZ;
      P.x = pl.position.x; P.z = pl.position.z; P.y = pl.position.y;
      P.head = Math.atan2(fz, fx); P.init = false; P.vx = P.vz = P.speed = 0; P.still = 1; P.fileW = 0;
      const n = list.length;
      trail.length = 0;
      const back = C.spacing * (n + 1) + 2;
      let s = 0;
      for (let d = back; d > 0; d -= C.trailStep) {
        trail.push({ x: pl.position.x - fx * d, z: pl.position.z - fz * d, s }); s += C.trailStep;
      }
      trail.push({ x: pl.position.x, z: pl.position.z, s });
      trailTip = { x: pl.position.x, z: pl.position.z };
      list.forEach((c, i) => {
        const o = openSlot(c, i, fx, fz, 0);
        c.position.set(o.x, 0, o.z);
        game.collide(c.position, CFG.radius, { ignore: c.owner });
        c.position.y = game.heightAt(c.position.x, c.position.z);
        c.yaw = Math.atan2(fz, fx); c.speed = 0; c.vel.set(0, 0, 0); c.rest = false; c.ghost = false; c.act = null;
        sync(c);
      });
    },
    /** Не загораживать камеру: фигура ближе ~1 м к камере скрывается. */
    lateUpdate() {
      const cam = game.camera.position;
      for (const c of list) {
        const dx = c.position.x - cam.x, dz = c.position.z - cam.z;
        const dy = c.position.y + 1.2 - cam.y;
        c.figure.group.visible = dx * dx + dz * dz + dy * dy > 1.1 * 1.1;
      }
    },
  };

  function sync(c) {
    c.figure.group.position.copy(c.position);
    c.figure.group.rotation.y = Math.PI / 2 - c.yaw;
    if (c.bodyA) {
      if (c.ghost) { c.bodyA.set(c.position.x, c.position.y - 500, c.position.z); c.bodyB.set(c.position.x, c.position.y - 499, c.position.z); } // «призрак» не упирается в игрока
      else { c.bodyA.set(c.position.x, c.position.y + CFG.radius, c.position.z); c.bodyB.set(c.position.x, c.position.y + c.figure.height - CFG.radius, c.position.z); }
    }
  }

  function sampleTrail(s, out) {
    if (!trail.length) return false;
    if (s <= trail[0].s) { out.x = trail[0].x; out.z = trail[0].z; return true; }
    for (let i = trail.length - 1; i > 0; i--) {
      if (trail[i - 1].s <= s) {
        const a = trail[i - 1], b = trail[i], k = (s - a.s) / Math.max(1e-6, b.s - a.s);
        out.x = a.x + (b.x - a.x) * Math.min(1, k); out.z = a.z + (b.z - a.z) * Math.min(1, k);
        return true;
      }
    }
    return false;
  }

  function updateTrail(pl) {
    const last = trail[trail.length - 1];
    if (!last) { trail.push({ x: pl.position.x, z: pl.position.z, s: 0 }); trailTip = { x: pl.position.x, z: pl.position.z }; return; }
    const d = Math.hypot(pl.position.x - last.x, pl.position.z - last.z);
    if (d >= C.trailStep) {
      trail.push({ x: pl.position.x, z: pl.position.z, s: last.s + d });
      while (trail.length > 3 && trail[trail.length - 1].s - trail[1].s > C.trailKeep) trail.shift();
    }
  }
  const tgt = { x: 0, z: 0 }, slot = { x: 0, z: 0 };

  function readCamera() {
    game.camera.getWorldDirection(camDir);
    const l = Math.hypot(camDir.x, camDir.z) || 1;
    P.camX = camDir.x / l; P.camZ = camDir.z / l;
  }
  /** Оценка скорости/курса ходьбы игрока и состояния «стоит». */
  function trackPlayer(pl, dt) {
    const p = pl.position;
    if (!P.init) { P.x = p.x; P.z = p.z; P.y = p.y; P.init = true; return; }
    const vx = (p.x - P.x) / dt, vz = (p.z - P.z) / dt, sp = Math.hypot(vx, vz);
    if (sp > 14) { P.vx = P.vz = 0; } else { P.vx = damp(P.vx, vx, 9, dt); P.vz = damp(P.vz, vz, 9, dt); }
    P.x = p.x; P.z = p.z; P.y = p.y;
    P.speed = Math.hypot(P.vx, P.vz);
    if (P.speed > 0.6) { P.head = dampAngle(P.head, Math.atan2(P.vz, P.vx), 4.5, dt); P.still = 0; } else P.still += dt;
  }
  const blocked = (x, z) => {
    probeP.set(x, P.y, z);
    if (game.collide(probeP, CFG.radius + 0.12, { ignore: ignoreSet })) return true;
    const gy = game.heightAt(x, z, P.y);
    return gy < P.y - 1.1 || gy > P.y + 0.75;      // обрыв/уступ сбоку — тоже «узко»
  };
  /** Достаточно ли места вбок от игрока: иначе строй схлопывается в «гуськом». */
  function probeWidth(dt) {
    P.probeT -= dt; if (P.probeT > 0) return; P.probeT = C.narrowEvery;
    const hx = Math.cos(P.head), hz = Math.sin(P.head), rx = -hz, rz = hx, w = C.narrowProbe;
    let nar = false;
    for (const back of [0.5, -1.5, -3.2]) for (const side of [-1, 1]) {
      if (blocked(P.x - hx * -back + rx * side * w, P.z - hz * -back + rz * side * w)) { nar = true; }
    }
    P.narrow = nar;
  }
  /** Слот в открытом строю. */
  function openSlot(c, idx, hx, hz, side0) {
    const rx = -hz, rz = hx, side = c.spec.side || (idx % 2 ? 1 : -1);
    const back = C.openBack + Math.floor(idx / 2) * C.openBackStep + (idx % 2) * 0.35;
    slot.x = P.x - hx * back + rx * side * C.openSide; slot.z = P.z - hz * back + rz * side * C.openSide;
    return slot;
  }
  const hiddenFromCam = (c, minD = 0) => {
    const cam = game.camera.position, dx = c.position.x - cam.x, dz = c.position.z - cam.z, d = Math.hypot(dx, dz) || 1;
    return d > minD && (dx * P.camX + dz * P.camZ) / d < C.warpCosHidden;
  };

  // Касание стопой (из анимации): след, звук, шум (компаньоны шумят слабо; в походке по песку — почти нет).
  function onStep(c, e) {
    if (game.cinematic.active || c.speed < 0.4) return;
    const surface = game.surfaceAt(c.position.x, c.position.z);
    game.bus.emit('footstep', { x: c.position.x, z: c.position.z, yaw: c.yaw, surface, actor: c.id });
    const mult = CFG.noise.surface[surface] ?? 0;
    if (mult > 0) {
      const base = e.mode === 'desert' ? CFG.noise.sandWalk : e.mode === 'run' ? CFG.noise.run : CFG.noise.walk;
      const loud = base * mult * (1 + CFG.noise.rhythmPenalty * 0.9) * CFG.noise.companionScale;
      game.bus.emit('noise', { x: c.position.x, z: c.position.z, loudness: loud, source: 'Footstep', actor: c.id });
      if (game.space === 'desert') game.world?.addFootprint?.(c.position.x, c.position.z, c.yaw, { type: 'foot' });
    }
  }

  // ------------------------------------------------------------------ реплики ----
  game.bus.on?.('subtitle', (e) => {
    if (!e || (e.kind !== 'line' && e.kind !== 'bark' && e.kind !== 'lore')) return;
    const sp = e.speaker, c = list.find((q) => q.id === sp), until = game.time + (e.duration || 3);
    if (c) { c.talkUntil = until; stats.talks++; }
    for (const o of list) { if (o === c) continue; o.listenTo = sp ? { id: sp, until } : null; }
  });
  game.bus.on?.('line:end', () => { for (const c of list) c.talkUntil = Math.min(c.talkUntil, game.time + 0.2); });

  // ------------------------------------------------------------------ поза поверх анимации ----
  function applyPose(c, dt, idle) {
    const L = c.figure.parts?.limbs; if (!L) return;
    const talking = game.time < c.talkUntil;
    let kind = '', k = 0;
    if (idle && c.act?.type === 'drink') kind = 'drink';
    else if (idle && talking) kind = 'gesture';
    c.pose.kind = kind || c.pose.kind;
    c.pose.w = damp(c.pose.w, kind ? 1 : 0, kind ? 6 : 4, dt);
    if (c.pose.w < 0.01) return;
    k = c.pose.w;
    const t = game.time + c.id.length * 1.7, lerp = (a, b) => a + (b - a) * k;
    if (c.pose.kind === 'drink') {
      // фляга к губам: правая рука вверх, локоть согнут, голова чуть откинута
      const b = clamp(Math.sin((game.time - (c.act?.t0 ?? 0)) * 1.1) * 1.3 + 0.6, 0, 1);
      L.R.sh.rotation.x = lerp(L.R.sh.rotation.x, -1.0 - b * 1.0); L.R.el.rotation.x = lerp(L.R.el.rotation.x, -1.2 - b * 0.55); L.L.sh.rotation.x = lerp(L.L.sh.rotation.x, -0.5); L.L.el.rotation.x = lerp(L.L.el.rotation.x, -1.2);
      c.figure.parts.headPivot.rotation.x = lerp(c.figure.parts.headPivot.rotation.x, -0.22 * b);
    } else {
      L.L.sh.rotation.x = lerp(L.L.sh.rotation.x, -0.6 + Math.sin(t * 1.9) * 0.4); L.R.sh.rotation.x = lerp(L.R.sh.rotation.x, -0.5 + Math.sin(t * 2.5 + 1) * 0.45);
      L.L.el.rotation.x = lerp(L.L.el.rotation.x, -0.9 - Math.max(0, Math.sin(t * 2.1)) * 0.25); L.R.el.rotation.x = lerp(L.R.el.rotation.x, -0.85);
    }
  }

  companions.update = (dt, t) => {
    const pl = player(); if (!pl) return;
    const now = game.time;
    const cin = game.cinematic.active;
    readCamera();
    trackPlayer(pl, dt);
    if (!cin) { updateTrail(pl); probeWidth(dt); }
    P.fileW = damp(P.fileW, P.narrow ? 1 : 0, C.narrowLambda, dt);
    const last = trail[trail.length - 1];
    const total = last ? last.s + Math.hypot(pl.position.x - last.x, pl.position.z - last.z) : 0;
    const hx = Math.cos(P.head), hz = Math.sin(P.head);

    let idx = 0;
    for (const c of list) {
      const moving = follow && !cin;
      const ox = c.position.x, oz = c.position.z;
      if (moving) {
        // --- цель: смесь «строй» ↔ «гуськом»
        const o = openSlot(c, idx, hx, hz, 0);
        let sx = o.x, sz = o.z;
        if (sampleTrail(Math.max(0, total - C.fileSpacing * (idx + 1)), tgt)) { sx += (tgt.x - sx) * P.fileW; sz += (tgt.z - sz) * P.fileW; }
        else if (P.fileW > 0.5) { sx = P.x; sz = P.z; }
        // слот внутри стены/обрыва → строго по следу
        if (P.fileW < 0.5 && blocked(sx, sz) && sampleTrail(Math.max(0, total - C.fileSpacing * (idx + 1)), tgt)) { sx = tgt.x; sz = tgt.z; }
        let dx = sx - c.position.x, dz = sz - c.position.z;
        const dist = Math.hypot(dx, dz), dPl = Math.hypot(c.position.x - P.x, c.position.z - P.z);
        // --- перенос: только если далеко И не в кадре (иначе догоняет бегом)
        if ((dist > C.warpDist && hiddenFromCam(c, C.warpMinHidden)) || dist > C.snapDist * 3) {
          stats.warps++;
          if (!hiddenFromCam(c)) stats.warpsVisible++;
          c.position.x = sx; c.position.z = sz; c.vel.x = c.vel.z = 0; dx = dz = 0; c.vy = 0; c.position.y = game.heightAt(sx, sz, pl.position.y); c.rest = false;
        }
        // --- покой: игрок стоит — остаются на естественной дистанции, не дёргаются
        const still = P.still > 0.8;
        let want = true;
        const fcx = c.position.x - game.camera.position.x, fcz = c.position.z - game.camera.position.z, fd = Math.hypot(fcx, fcz) || 1, fcos = (fcx * P.camX + fcz * P.camZ) / fd;
        const inFront = fd < C.frontRange && fcos > C.frontCone;
        if (still && P.fileW < 0.5) {
          if (c.rest) { if (dPl > C.restMax + 0.8 || dPl < C.restMin - 0.4 || (inFront && fd < 3.2)) c.rest = false; }
          else if (dPl >= C.restMin && dPl <= C.restMax && !(inFront && fd < 3.2)) c.rest = true;
          if (c.rest) want = false;
        } else c.rest = false;
        // --- скорость к цели
        const plRun = P.speed;
        const maxSp = clamp(Math.max(plRun * C.catchSpeed, 2.4) + Math.max(0, dist - C.spacing) * 0.7 + (dist > 6 ? C.runBoost : 0), 0, dist > 8 ? C.maxSpeed * 1.6 : C.maxSpeed);
        let sp = !want || dist < 0.12 ? 0 : clamp(dist * 2.4, 0, maxSp);
        const k = dist > 1e-4 ? 1 / dist : 0;
        let vxT = dx * k * sp, vzT = dz * k * sp;
        // --- не в кадре: из конуса впереди камеры уходим вбок и придерживаемся
        if (inFront && !c.rest) {
          const lat = -fcx * P.camZ + fcz * P.camX;            // справа (+) / слева (−) от оси камеры
          const s = lat >= 0 ? 1 : -1, w = (1 - fd / C.frontRange) * clamp((fcos - C.frontCone) / 0.25, 0, 1);
          vxT += -P.camZ * s * C.frontPush * w; vzT += P.camX * s * C.frontPush * w;
          vxT *= 1 - 0.5 * w; vzT *= 1 - 0.5 * w;
        }
        // --- «призрак» в узком проходе: на пути игрока не загораживает
        if (P.fileW > 0.5) {
          const closing = dPl < C.ghostRange && ((c.position.x - P.x) * P.vx + (c.position.z - P.z) * P.vz) > 0.3 * dPl * P.speed;
          if (!c.ghost && closing && P.speed > 0.4 && fd < 2.2) { c.ghost = true; stats.ghosts++; }
          else if (c.ghost && (dPl > 2.3 || P.speed < 0.2)) c.ghost = false;
        } else if (c.ghost && dPl > 2.3) c.ghost = false;
        c.vel.x = damp(c.vel.x, vxT, C.accelLambda, dt);
        c.vel.z = damp(c.vel.z, vzT, C.accelLambda, dt);
        idx++;
      } else { c.vel.x = damp(c.vel.x, 0, 8, dt); c.vel.z = damp(c.vel.z, 0, 8, dt); }

      if (!cin) {
        c.position.x += c.vel.x * dt; c.position.z += c.vel.z * dt;
        // Мягкое расталкивание: отодвигаем спутника, но не игрока.
        for (let oi = -1; oi < list.length; oi++) {
          if (oi < 0 && c.ghost) continue;
          const o = oi < 0 ? pl.position : list[oi].position;
          if (o === c.position) continue;
          const ddx = c.position.x - o.x, ddz = c.position.z - o.z, d = Math.hypot(ddx, ddz);
          const minSep = oi < 0 ? 0.95 : C.minSep;
          if (d < minSep) {
            const push = (minSep - d) * Math.min(1, dt * 6);
            const nx = d > 1e-4 ? ddx / d : 1, nz = d > 1e-4 ? ddz / d : 0;
            c.position.x += nx * push; c.position.z += nz * push;
          }
        }
        game.collide(c.position, CFG.radius, { ignore: c.owner });
        // уступы: выше CFG.stepUp не лезем
        let gy = game.heightAt(c.position.x, c.position.z, c.position.y);
        if (gy - c.position.y > CFG.stepUp) { c.position.x = ox; c.position.z = oz; c.vel.x = c.vel.z = 0; gy = game.heightAt(ox, oz, c.position.y); }
        const d = gy - c.position.y;
        if (c.vy !== 0 || d < -0.5) {
          // сошёл с уступа/спрыгнул следом за игроком — падает, а не «телепортируется» вниз
          c.vy = Math.max(-30, c.vy - 19 * dt); c.position.y += c.vy * dt;
          if (c.position.y <= gy) { c.position.y = gy; c.vy = 0; }
        } else {
          const mv = (3 + Math.abs(gy - (c.groundY ?? gy)) / Math.max(dt, 1e-3) * 1.15) * dt;
          c.position.y += Math.max(-mv, Math.min(mv, d));
        }
        c.groundY = gy;
      }
      const dMoved = Math.hypot(c.position.x - ox, c.position.z - oz);
      c.speed = damp(c.speed, dt > 0 ? dMoved / dt : 0, 15, dt);

      // курс: по движению; в покое — идле-поведение
      c.moving = c.speed > (c.moving ? 0.2 : 0.4);
      const idle = !c.moving && (P.still > 0.8 || cin);
      if (c.moving) { if (dMoved > 1e-5) c.yaw = dampAngle(c.yaw, Math.atan2(c.position.z - oz, c.position.x - ox), 9, dt); c.idleT = 0; c.act = null; }
      else c.idleT += dt;
      const talking = now < c.talkUntil;
      if (talking && !c.wasTalking) { const o = list.find((q) => q !== c && Math.hypot(q.position.x - c.position.x, q.position.z - c.position.z) < 7); c.faceOther = o && Math.random() < 0.6 ? o : null; }
      c.wasTalking = talking;
      const speaker = list.find((q) => now < q.talkUntil && q !== c);
      const playerTalking = c.listenTo && now < c.listenTo.until && c.listenTo.id === 'Kair';
      let lookAtPt = null, lookW = c.moving ? 0.25 : 0;
      if (!c.moving) {
        // --- идле: что делает спутник, пока игрок стоит
        if (idle && c.idleT > C.idleDelay) {
          c.actT -= dt; c.drinkT -= dt;
          if (c.act && now > c.act.until) c.act = null;
          if (!c.act && !talking && !speaker) {
            const other = list.find((q) => q !== c && !q.moving && !q.act && q.idleT > 2 && Math.hypot(q.position.x - c.position.x, q.position.z - c.position.z) < 5);
            if (c.drinkT <= 0) { c.act = { type: 'drink', until: now + C.drinkDur, t0: now }; c.drinkT = rnd(C.idleDrink); stats.drinks++; }
            else if (c.actT <= 0) {
              c.actT = rnd(C.idleLook);
              if (other && Math.random() < 0.35) {
                const dur = rnd(C.chatDur), a = { type: 'chat', until: now + dur, with: other, parity: 0, t0: now };
                c.act = a; other.act = { ...a, with: c, parity: 1 }; stats.chats++;
              } else { c.act = { type: 'look', until: now + rnd(C.lookDur), ang: c.yaw + (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 1.1), t0: now }; stats.looks++; }
            }
          }
          if (c.act?.type === 'chat') {
            // лицом друг к другу; говорят по очереди
            const o = c.act.with; if (o) { c.yaw = dampAngle(c.yaw, Math.atan2(o.position.z - c.position.z, o.position.x - c.position.x), 2.2, dt); lookAtPt = tmp.set(o.position.x, o.position.y + o.figure.height * 0.93, o.position.z); lookW = 0.9; }
            if (Math.floor((now - c.act.t0) / 2.2) % 2 === c.act.parity) c.talkUntil = Math.max(c.talkUntil, now + 0.3);
          } else if (c.act?.type === 'look') {
            c.yaw = dampAngle(c.yaw, c.act.ang, 1.6, dt);
            lookAtPt = tmp.set(c.position.x + Math.cos(c.act.ang + Math.sin((now - c.act.t0) * 1.3) * 0.5) * 6, c.position.y + 1.5, c.position.z + Math.sin(c.act.ang + Math.sin((now - c.act.t0) * 1.3) * 0.5) * 6); lookW = 0.85;
          } else if (c.act?.type === 'drink') {
            lookW = 0.2; lookAtPt = tmp.set(pl.position.x, pl.position.y + 1.5, pl.position.z);
          } else {
            // смотрит на игрока (поворот корпуса — с задержкой), иногда в сторону
            const f = talking && c.faceOther ? c.faceOther.position : pl.position;
            c.yaw = dampAngle(c.yaw, Math.atan2(f.z - c.position.z, f.x - c.position.x), 2.2, dt);
            if (talking && c.faceOther) { lookAtPt = tmp.set(f.x, f.y + 1.6, f.z); lookW = 0.9; }
          }
        }
        // реплики: слушатель смотрит на говорящего; говорящий — на игрока/собеседника
        if (speaker && !c.act) { lookAtPt = tmp.set(speaker.position.x, speaker.position.y + speaker.figure.height * 0.93, speaker.position.z); lookW = 0.9; if (idle) c.yaw = dampAngle(c.yaw, Math.atan2(speaker.position.z - c.position.z, speaker.position.x - c.position.x), 1.8, dt); }
        else if (playerTalking && !c.act) { lookAtPt = tmp.set(game.camera.position.x, game.camera.position.y, game.camera.position.z); lookW = 0.9; if (idle) c.yaw = dampAngle(c.yaw, Math.atan2(pl.position.z - c.position.z, pl.position.x - c.position.x), 1.8, dt); }
      }

      // голова: в покое смотрит на игрока / осматривается; на ходу изредка глядит по сторонам
      c.glanceT -= dt;
      if (c.glanceT <= 0) {
        const [a, b] = c.spec.glance;
        c.glanceT = a + Math.random() * (b - a);
        c.glanceDir = Math.random() < 0.45 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8);
      }
      if (!lookAtPt) {
        const idleLook = c.idleT > C.idleDelay;
        lookW = idleLook ? 1 : 0.25;
        if (c.glanceDir !== 0 && (idleLook || c.spec.nervous)) { const a = c.yaw + c.glanceDir; lookAtPt = tmp.set(c.position.x + Math.cos(a) * 6, c.position.y + 1.5, c.position.z + Math.sin(a) * 6); }
        else lookAtPt = tmp.set(pl.position.x, pl.position.y + 1.5, pl.position.z);
      }
      c.weight = damp(c.weight, lookW, 4, dt);
      c.figure.setTalking?.(talking);
      c.figure.group.updateMatrixWorld();
      c.figure.lookAt(lookAtPt, c.weight);

      sync(c);
      // Режим шага: повторяют игрока; в открытом эрге на малой скорости — тоже походка по песку.
      // гистерезис по скорости: режим шага не «моргает» около порога
      c.walkDesert = game.space === 'desert' && c.speed > 0.2 && c.speed < (c.walkDesert ? 3.0 : 2.5);
      const desert = pl.moveMode === 'desert' || c.walkDesert;
      c.figure.animate(c.speed, dt, desert ? 1 : 0, { desert, allowPause: false, wind: undefined, slope: 0 });
      applyPose(c, dt, idle);
    }
  };

  // Оссана больше не присоединяется автоматически: в кат-сцене WormReveal её ставит и уводит модуль червя.
  // companions.join('Ossana') остаётся как API (отладка/сюжет).

  game.add('companions', companions);
  companions.join('Ilva');
  companions.join('Rayn');
  companions.teleportBehind();
  return companions;
}
