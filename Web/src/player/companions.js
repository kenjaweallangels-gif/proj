// Спутники: Илва, Райн, позже Оссана. Идут цепочкой по «хлебным крошкам» следов игрока.
// Курс (yaw) = atan2(dz, dx), как у игрока. Фигура: rotation.y = π/2 − yaw.
import * as THREE from 'three';
import { makeFigure } from '../core/figures.js';
import { CFG, stepInterval } from './config.js';
import { clamp, damp, dampAngle } from '../core/util.js';

const V3 = THREE.Vector3;

const SPECS = {
  Ilva: { figure: { preset: 'Ilva' }, glance: [2.5, 4.5], nervous: 0 },
  Rayn: { figure: { preset: 'Rayn' }, glance: [0.8, 1.8], nervous: 1 },
  Ossana: { figure: { preset: 'Ossana' }, glance: [3, 5], nervous: 0, hooks: true },
};

export function create(game) {
  const C = CFG.companions;
  const player = () => game.player;
  const list = [];
  let follow = true;
  const trail = []; // {x, z, s}
  let trailTip = null; // последняя точка (копия позиции игрока)

  const companions = {
    list,
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
      const c = { id, figure, spec, position: new V3(), yaw: 0, speed: 0, nextStep: 0, idleT: 0, glanceT: 1, glanceDir: 0, weight: 0, vel: new V3(), vy: 0, groundY: 0, moving: false, walkDesert: false };
      c.bodyA = new V3(); c.bodyB = new V3(); c.owner = 'companion:' + id;
      c.bodyId = game.colliders?.add({ type: 'capsule', a: c.bodyA, b: c.bodyB, r: CFG.radius, owner: c.owner });
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
    /** Поставить спутников цепочкой позади игрока (и перестроить след). */
    teleportBehind() {
      const pl = player(); if (!pl) return;
      const fx = Math.cos(pl.yaw), fz = Math.sin(pl.yaw);
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
        const d = C.spacing * (i + 1);
        // Смещение вбок (поочерёдно), чтобы не вставать на ось камеры третьего лица.
        const lat = (i % 2 === 0 ? 1 : -1) * 1.3;
        c.position.set(pl.position.x - fx * d - fz * lat, 0, pl.position.z - fz * d + fx * lat);
        game.collide(c.position, CFG.radius, { ignore: c.owner });
        c.position.y = game.heightAt(c.position.x, c.position.z);
        c.yaw = pl.yaw; c.speed = 0; c.vel.set(0, 0, 0);
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
    if (c.bodyA) { c.bodyA.set(c.position.x, c.position.y + CFG.radius, c.position.z); c.bodyB.set(c.position.x, c.position.y + c.figure.height - CFG.radius, c.position.z); }
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
  const tgt = { x: 0, z: 0 };
  const camDir = new V3();
  /** В кадре ли спутник (грубо: впереди камеры и ближе ~60 м). */
  function onScreen(c) {
    const cam = game.camera;
    cam.getWorldDirection(camDir);
    const dx = c.position.x - cam.position.x, dy = c.position.y + 1 - cam.position.y, dz = c.position.z - cam.position.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    return d < 60 && (dx * camDir.x + dy * camDir.y + dz * camDir.z) / d > 0.2;
  }
  const tmp = new V3();

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
  
  companions.update = (dt, t) => {
    const pl = player(); if (!pl) return;
    const now = game.time;
    const cin = game.cinematic.active;
    if (!cin) updateTrail(pl);
    const last = trail[trail.length - 1];
    const total = last ? last.s + Math.hypot(pl.position.x - last.x, pl.position.z - last.z) : 0;

    let idx = 0;
    for (const c of list) {
      const moving = follow && !cin;
      if (moving) {
        const sTarget = Math.max(0, total - C.spacing * (idx + 1));
        if (sampleTrail(sTarget, tgt)) {
          let dx = tgt.x - c.position.x, dz = tgt.z - c.position.z;
          const dist = Math.hypot(dx, dz);
          // Телепорт — только если спутника не видно (за спиной/далеко); иначе догоняет бегом: без «выскакиваний» в кадре.
          if (dist > C.snapDist && (dist > C.snapDist * 3 || !onScreen(c))) { c.position.x = tgt.x; c.position.z = tgt.z; c.vel.x = c.vel.z = 0; dx = dz = 0; c.vy = 0; c.position.y = game.heightAt(tgt.x, tgt.z, pl.position.y); }
          const maxSp = clamp(Math.max(pl.speed * 1.3, 2.5) + Math.max(0, dist - C.spacing * 2) * 0.6, 0, dist > 8 ? C.maxSpeed * 1.6 : C.maxSpeed);
          const sp = dist < 0.15 ? 0 : clamp(dist * 2.5, 0, maxSp);
          const k = dist > 1e-4 ? 1 / dist : 0;
          c.vel.x = damp(c.vel.x, dx * k * sp, 8, dt);
          c.vel.z = damp(c.vel.z, dz * k * sp, 8, dt);
        }
        idx++;
      } else { c.vel.x = damp(c.vel.x, 0, 8, dt); c.vel.z = damp(c.vel.z, 0, 8, dt); }

      const ox = c.position.x, oz = c.position.z;
      if (!cin) {
        c.position.x += c.vel.x * dt; c.position.z += c.vel.z * dt;
        // Мягкое расталкивание: отодвигаем спутника, но не игрока.
        for (let oi = -1; oi < list.length; oi++) {
          const o = oi < 0 ? pl.position : list[oi].position;
          if (o === c.position) continue;
          const ddx = c.position.x - o.x, ddz = c.position.z - o.z, d = Math.hypot(ddx, ddz);
          if (d < C.minSep) {
            const push = (C.minSep - d) * Math.min(1, dt * 6);
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
      c.speed = damp(c.speed, dt > 0 ? Math.hypot(c.position.x - ox, c.position.z - oz) / dt : 0, 15, dt);

      // курс: по движению, в покое — к игроку
      c.moving = c.speed > (c.moving ? 0.2 : 0.4);
      if (c.moving) { if (Math.hypot(c.position.x - ox, c.position.z - oz) > 1e-5) c.yaw = dampAngle(c.yaw, Math.atan2(c.position.z - oz, c.position.x - ox), 9, dt); c.idleT = 0; }
      else {
        c.idleT += dt;
        if (c.idleT > C.idleDelay) c.yaw = dampAngle(c.yaw, Math.atan2(pl.position.z - c.position.z, pl.position.x - c.position.x), 2.5, dt);
      }

      // голова: в покое смотрит на игрока / осматривается
      const idle = c.idleT > C.idleDelay;
      c.weight = damp(c.weight, idle ? 1 : 0.25, 4, dt);
      c.glanceT -= dt;
      if (c.glanceT <= 0) {
        const [a, b] = c.spec.glance;
        c.glanceT = a + Math.random() * (b - a);
        c.glanceDir = Math.random() < 0.45 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8);
      }
      if (idle && c.glanceDir !== 0) {
        const a = c.yaw + c.glanceDir;
        tmp.set(c.position.x + Math.cos(a) * 6, c.position.y + 1.5, c.position.z + Math.sin(a) * 6);
      } else tmp.set(pl.position.x, pl.position.y + 1.5, pl.position.z);
      c.figure.group.updateMatrixWorld();
      c.figure.lookAt(tmp, c.weight);

      sync(c);
      // Режим шага: повторяют игрока; в открытом эрге на малой скорости — тоже походка по песку.
      // гистерезис по скорости: режим шага не «моргает» около порога
      c.walkDesert = game.space === 'desert' && c.speed > 0.2 && c.speed < (c.walkDesert ? 3.0 : 2.5);
      const desert = pl.moveMode === 'desert' || c.walkDesert;
      c.figure.animate(c.speed, dt, desert ? 1 : 0, { desert, allowPause: false, wind: undefined, slope: 0 });
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
