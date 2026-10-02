// Игрок «Кайр»: контроллер, камера, шум/походка по песку, влага, тампер, взаимодействие.
// Курс (yaw) везде = atan2(dz, dx), как в core/layout.js (0 — на восток, +π/2 — на юг).
// Фигура (makeFigure) смотрит в +Z, поэтому figure.group.rotation.y = π/2 − yaw.
import * as THREE from 'three';
import { makeFigure } from '../core/figures.js';
import { START, GOLDEN_PATH, ELLIPSIS } from '../core/layout.js';
import { clamp, damp, dampAngle, smoothstep } from '../core/util.js';
import { CFG, stepInterval } from './config.js';
import { createPuffs } from './fx.js';
import { createCameraRig } from './camera.js';
import { createNoise } from './noise.js';
import { createHydration } from './hydration.js';
import { createThumpers } from './thumper.js';
import { createInteraction } from './interaction.js';

/** Стартовая точка по settings.at (P1..P7b, MOUTH, FALSE_ROCK, A2, A3, worm); иначе START. Сиетч-точки обрабатывает debug.goto. */
export function resolveStart(at) {
  if (!at) return START;
  const k = String(at).toLowerCase();
  if (k === 'worm') return pathPoint('P4');
  if (k === 'a2') return ELLIPSIS.A2;
  if (k === 'a3') return ELLIPSIS.A3;
  const pt = pathPoint(at);
  return pt || START;
}
function pathPoint(id) {
  const i = GOLDEN_PATH.findIndex((q) => q.id.toLowerCase() === String(id).toLowerCase());
  if (i < 0) return null;
  const a = GOLDEN_PATH[i], b = GOLDEN_PATH[Math.min(i + 1, GOLDEN_PATH.length - 1)];
  const c = b === a ? GOLDEN_PATH[i - 1] : a, d = b === a ? a : b;
  const yaw = b === a ? Math.atan2(a.z - c.z, a.x - c.x) : Math.atan2(d.z - c.z, d.x - c.x);
  return { x: a.x, z: a.z, yaw };
}

export function create(game) {
  const V3 = THREE.Vector3;
  const start = resolveStart(game.settings?.at);
  const position = new V3(start.x, game.heightAt(start.x, start.z), start.z);
  const velocity = new V3();

  const figure = makeFigure({
    name: 'Kair', height: CFG.height, cloth: '#8a6a44', suit: '#4a4038', accent: '#2c3e57', skin: '#6a4a32',
  });
  game.scene.add(figure.group);

  const p = {
    position, velocity, figure,
    yaw: start.yaw, speed: 0, gait: 'idle', slope: 0, firstPerson: false, inputLocked: false,
    stepIntervalNow: 0.5,
  };
  const fx = createPuffs(game);
  const rig = createCameraRig(game, p);
  rig.snap(start.yaw);
  const gaitMod = createNoise(game, p, fx);
  const hydro = createHydration(game, p);
  const thumpers = createThumpers(game, p, fx);
  const interaction = createInteraction(game, p, rig);
  p.cam = rig;

  const slide = new V3();
  const wish = new V3();
  let lastY = position.y;

  const blocked = () => p.inputLocked || game.cinematic.active || !!game.ui?.blocking;

  // Pointer lock по клику, но не на паузе/титуле/в кат-сцене.
  game.renderer.domElement.addEventListener('click', () => {
    if (game.paused || game.cinematic.active || game.ui?.blocking || game.input.device === 'pad') return;
    game.input.requestLock();
  });

  function groundGradient(x, z, out) {
    const e = CFG.slope.probe;
    out.set((game.heightAt(x + e, z) - game.heightAt(x - e, z)) / (2 * e), 0, (game.heightAt(x, z + e) - game.heightAt(x, z - e)) / (2 * e));
    return out;
  }
  const grad = new V3();

  Object.assign(p, {
    head() { return new V3(position.x, position.y + CFG.eye, position.z); },
    setInputLocked(b) { p.inputLocked = !!b; if (b) { velocity.set(0, 0, 0); } },
    setFirstPerson(b) { rig.setFirstPerson(b); },
    toggleCamera() { rig.toggle(); },
    /** Телепорт: ступни в (x, y, z); y=undefined → высота земли. yaw — курс (atan2(dz,dx)). Камера и спутники переезжают следом. */
    teleport(x, y, z, yaw, withCompanions = true) {
      position.set(x, Number.isFinite(y) ? y : game.heightAt(x, z), z);
      if (Number.isFinite(yaw)) p.yaw = yaw;
      velocity.set(0, 0, 0); slide.set(0, 0, 0); p.speed = 0;
      lastY = position.y;
      rig.snap(p.yaw);
      gaitMod.reset();
      figure.group.position.copy(position);
      figure.group.rotation.y = Math.PI / 2 - p.yaw;
      if (withCompanions) game.companions?.teleportBehind?.();
    },
    update(dt, t) {
      const now = game.time;
      const frozen = blocked();
      rig.look(dt, frozen);
      const inp = game.input;

      if (!frozen) {
        if (inp.pressed('ToggleCamera')) rig.toggle();
        if (inp.pressed('Mask')) hydro.toggleMask();
        if (inp.pressed('Thumper')) thumpers.deploy();
        if (inp.pressed('Stutter')) gaitMod.stutter(now, p.speed > CFG.step.minSpeed);
      }

      // --- намерение движения (относительно камеры) ---
      const ax = frozen ? { x: 0, y: 0 } : inp.axis();
      const mag = Math.min(1, Math.hypot(ax.x, ax.y));
      const cyaw = rig.yaw;
      const fxv = Math.cos(cyaw), fzv = Math.sin(cyaw);
      wish.set(fxv * ax.y - Math.sin(cyaw) * ax.x, 0, fzv * ax.y + Math.cos(cyaw) * ax.x);
      if (wish.lengthSq() > 1e-6) wish.normalize();

      const sandHeld = !frozen && inp.held('SandWalk');
      const sprint = !frozen && !sandHeld && inp.held('Sprint') && mag > 0.1;
      let base = sandHeld ? CFG.speed.sandWalk : sprint ? CFG.speed.run : CFG.speed.walk;
      if (sprint && p.moisture < CFG.hydration.lowThreshold) base *= CFG.hydration.lowSprintFactor;
      p.gait = mag < 0.1 ? 'idle' : sandHeld ? 'sandwalk' : sprint ? 'run' : 'walk';

      // --- склон ---
      groundGradient(position.x, position.z, grad);
      const gl = Math.hypot(grad.x, grad.z);
      const slopeDeg = Math.atan(gl) / (Math.PI / 180);
      p.slope = slopeDeg;
      let slow = 1;
      if (gl > 1e-4 && mag > 0.1) {
        const uphill = (wish.x * grad.x + wish.z * grad.z) / gl; // >0 — вверх по склону
        if (uphill > 0) slow = 1 - (1 - CFG.slope.slowFactor) * smoothstep(CFG.slope.slowDeg - 3, CFG.slope.slowDeg + 4, slopeDeg) * uphill;
      }
      const target = base * mag * slow;
      const lam = mag > 0.05 ? CFG.accelLambda : CFG.decelLambda;
      velocity.x = damp(velocity.x, wish.x * target, lam, dt);
      velocity.z = damp(velocity.z, wish.z * target, lam, dt);

      // --- скольжение по очень крутому песку ---
      const slideTarget = smoothstep(CFG.slope.slideDeg, CFG.slope.slideDeg + 12, slopeDeg) * CFG.slope.slideMax;
      const sx = gl > 1e-4 ? -grad.x / gl : 0, sz = gl > 1e-4 ? -grad.z / gl : 0;
      slide.x = damp(slide.x, sx * slideTarget, slideTarget > 0 ? CFG.slope.slideLambda : 6, dt);
      slide.z = damp(slide.z, sz * slideTarget, slideTarget > 0 ? CFG.slope.slideLambda : 6, dt);
      const slideSpeed = Math.hypot(slide.x, slide.z);

      // --- перемещение + столкновения ---
      const ox = position.x, oz = position.z;
      position.x += (velocity.x + slide.x) * dt;
      position.z += (velocity.z + slide.z) * dt;
      if (game.collide(position, CFG.radius) && dt > 0) {
        velocity.x = (position.x - ox) / dt - slide.x; velocity.z = (position.z - oz) / dt - slide.z;
      }
      const gy = game.heightAt(position.x, position.z, position.y);
      position.y = Math.abs(gy - position.y) > 1.2 ? gy : damp(position.y, gy, CFG.groundLambda, dt);
      const rawSpeed = dt > 0 ? Math.hypot(position.x - ox, position.z - oz) / dt : 0;
      p.speed = damp(p.speed, rawSpeed, 20, dt);
      if (slideSpeed > 1.2 && Math.random() < dt * 14) {
        fx.spawn(position.x, position.y + 0.1, position.z, sx * 0.5 + (Math.random() - 0.5) * 0.6, 0.6, sz * 0.5 + (Math.random() - 0.5) * 0.6, 0.3, 0.9);
      }

      // --- курс ---
      if (rig.fp) p.yaw = rig.yaw;
      else if (p.speed > 0.4 && wish.lengthSq() > 0) p.yaw = dampAngle(p.yaw, Math.atan2(wish.z, wish.x), CFG.turnLambda, dt);

      // --- шаги/шум/влага/тампер/взаимодействие ---
      p.stepIntervalNow = stepInterval(p.speed);
      if (!game.cinematic.active) {
        gaitMod.update(dt, now, p.speed, p.gait, sandHeld);
        hydro.update(dt, p.gait === 'run');
      }
      thumpers.update(dt);
      fx.update(dt);
      interaction.update(dt, frozen);

      // --- фигура ---
      figure.group.position.copy(position);
      figure.group.rotation.y = Math.PI / 2 - p.yaw;
      const irregular = (p.sandWalking ? 0.7 : 0) + (p.stutterPulse > 0 ? 1 : 0);
      figure.animate(p.speed, dt, irregular);
      figure.group.visible = rig.blend < 0.55;
      lastY = position.y;
    },
    lateUpdate(dt, t) { rig.apply(dt, t); },
  });

  game.add('player', p);
  return p;
}
