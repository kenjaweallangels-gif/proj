// Спутники: Илва, Райн, позже Оссана. Идут цепочкой по «хлебным крошкам» следов игрока.
// Курс (yaw) = atan2(dz, dx), как у игрока. Фигура: rotation.y = π/2 − yaw.
import * as THREE from 'three';
import { makeFigure } from '../core/figures.js';
import { CFG, stepInterval } from './config.js';
import { clamp, damp, dampAngle } from '../core/util.js';

const V3 = THREE.Vector3;

const SPECS = {
  Ilva: { figure: { name: 'Ilva', height: 1.68, cloth: '#b8ae9c', suit: '#3e3630', accent: '#4f5496', skin: '#b08a68', eyesIbad: false, bulk: 0.9 }, glance: [2.5, 4.5], nervous: 0 },
  Rayn: { figure: { name: 'Rayn', height: 1.6, cloth: '#a9803f', suit: '#3e3630', accent: '#7a2e24', skin: '#a9805e', pack: true, bulk: 0.95 }, glance: [0.8, 1.8], nervous: 1 },
  Ossana: { figure: { name: 'Ossana', height: 1.72, cloth: '#4a3b2c', suit: '#3b302a', accent: '#2c3e57', skin: '#5a3e28', bulk: 1.05 }, glance: [3, 5], nervous: 0, hooks: true },
};

function addHooks(fig) {
  const metal = new THREE.MeshStandardMaterial({ color: '#2a2724', roughness: 0.55, metalness: 0.7 });
  const ribbon = new THREE.MeshStandardMaterial({ color: '#2c3e57', roughness: 0.9 });
  const shaft = new THREE.CylinderGeometry(0.018, 0.022, 2.4, 6);
  const tip = new THREE.TorusGeometry(0.12, 0.016, 6, 10, Math.PI * 1.1);
  const wrap = new THREE.CylinderGeometry(0.026, 0.026, 0.12, 6);
  for (const s of [-1, 1]) {
    const h = new THREE.Group();
    h.add(new THREE.Mesh(shaft, metal));
    const t = new THREE.Mesh(tip, metal); t.position.set(0.1, 1.2, 0); t.rotation.z = Math.PI * 0.6; h.add(t);
    const r = new THREE.Mesh(wrap, ribbon); r.position.y = 0.4; h.add(r);
    h.position.set(0, 0.25, -0.22); h.rotation.z = s * 0.62; h.rotation.x = 0.08;
    fig.parts.spine.add(h);
  }
}

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
      if (spec.hooks) addHooks(figure);
      game.scene.add(figure.group);
      const c = { id, figure, spec, position: new V3(), yaw: 0, speed: 0, nextStep: 0, idleT: 0, glanceT: 1, glanceDir: 0, weight: 0, vel: new V3() };
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
        c.position.set(pl.position.x - fx * d, 0, pl.position.z - fz * d);
        game.collide(c.position, CFG.radius);
        c.position.y = game.heightAt(c.position.x, c.position.z);
        c.yaw = pl.yaw; c.speed = 0; c.vel.set(0, 0, 0);
        sync(c);
      });
    },
  };

  function sync(c) {
    c.figure.group.position.copy(c.position);
    c.figure.group.rotation.y = Math.PI / 2 - c.yaw;
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
  const tmp = new V3();

  function step(c, now, pl) {
    if (c.speed < 0.5) return;
    if (now < c.nextStep) return;
    c.nextStep = now + stepInterval(c.speed) * (1 + (Math.random() - 0.5) * 0.1);
    const surface = game.surfaceAt(c.position.x, c.position.z);
    game.bus.emit('footstep', { x: c.position.x, z: c.position.z, yaw: c.yaw, surface, actor: c.id });
    const mult = CFG.noise.surface[surface] ?? 0;
    if (mult > 0) {
      const loud = CFG.noise.walk * mult * (1 + CFG.noise.rhythmPenalty * 0.9) * CFG.noise.companionScale;
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
          if (dist > C.snapDist) { c.position.x = tgt.x; c.position.z = tgt.z; dx = dz = 0; }
          const maxSp = clamp(Math.max(pl.speed * 1.3, 2.5), 0, C.maxSpeed);
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
        const others = [pl.position, ...list.filter((q) => q !== c).map((q) => q.position)];
        for (const o of others) {
          const ddx = c.position.x - o.x, ddz = c.position.z - o.z, d = Math.hypot(ddx, ddz);
          if (d < C.minSep) {
            const push = (C.minSep - d) * Math.min(1, dt * 6);
            const nx = d > 1e-4 ? ddx / d : 1, nz = d > 1e-4 ? ddz / d : 0;
            c.position.x += nx * push; c.position.z += nz * push;
          }
        }
        game.collide(c.position, CFG.radius);
        const gy = game.heightAt(c.position.x, c.position.z);
        c.position.y = Math.abs(gy - c.position.y) > 1.2 ? gy : damp(c.position.y, gy, 16, dt);
      }
      c.speed = damp(c.speed, dt > 0 ? Math.hypot(c.position.x - ox, c.position.z - oz) / dt : 0, 15, dt);

      // курс: по движению, в покое — к игроку
      if (c.speed > 0.35) { c.yaw = dampAngle(c.yaw, Math.atan2(c.position.z - oz, c.position.x - ox), 9, dt); c.idleT = 0; }
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

      if (!cin) step(c, now, pl);
      sync(c);
      c.figure.animate(c.speed, dt, pl.sandWalking ? 0.6 : 0);
      if (c.spec.nervous && idle) c.figure.parts.spine.rotation.x = 0.03 + Math.sin(now * 17 + 1) * 0.012; // дрожь Райна
    }
  };

  // Оссана присоединяется после раскрытия червя.
  game.bus.on('cinematic', (e) => { if (e && !e.active && e.id === 'WormReveal') companions.join('Ossana'); });

  game.add('companions', companions);
  companions.join('Ilva');
  companions.join('Rayn');
  // Старт «после раскрытия» (отладка): Оссана уже в цепочке.
  const at = String(game.settings?.at || '').toLowerCase();
  if (['a3', 'p5', 'p6', 'p7', 'p7b', 'mouth', 'false_rock'].includes(at)) companions.join('Ossana');
  companions.teleportBehind();
  return companions;
}
