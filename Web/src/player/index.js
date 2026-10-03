// Игрок «Кайр»: контроллер, камера, шум/походка по песку, влага, тампер, взаимодействие.
// Курс (yaw) везде = atan2(dz, dx), как в core/layout.js (0 — на восток, +π/2 — на юг).
// Фигура (makeFigure) смотрит в +Z, поэтому figure.group.rotation.y = π/2 − yaw.
import * as THREE from 'three';
import { makeFigure, setFigureWind, setFigureView, setFigureQuality, PRESETS, PALETTES } from '../core/figures.js';
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

  const figure = makeFigure({ preset: 'Kair', height: CFG.height });
  game.scene.add(figure.group);
  setFigureQuality(game.settings?.quality);
  game.figures = { makeFigure, PRESETS, PALETTES, setFigureWind, setFigureView, THREE };

  const p = {
    position, velocity, figure,
    yaw: start.yaw, speed: 0, gait: 'idle', slope: 0, firstPerson: false, inputLocked: false,
    stepIntervalNow: 0.5, moveMode: 'normal', sandWalking: false,
    /** Vector3|null — мировая точка, к которой тянется правая рука (занавес/полог). Ставится модулем сиетча; также подхватывается автоматически у interactable с reachPoint. */
    reachTarget: null,
  };
  // Твёрдое тело игрока (капсула) в реестре game.colliders — об него упираются червь/харвестер/NPC/спутники.
  const bodyA = new THREE.Vector3(), bodyB = new THREE.Vector3();
  const bodyId = game.colliders?.add({ type: 'capsule', a: bodyA, b: bodyB, r: CFG.radius, owner: 'player' });
  const syncBody = () => { bodyA.set(position.x, position.y + CFG.radius, position.z); bodyB.set(position.x, position.y + CFG.height - CFG.radius, position.z); };
  syncBody();
  // Игрок не упирается в своих спутников (на узких уступах серпантина они оказываются впереди):
  // спутники сами уступают — их коллизия учитывает капсулу игрока и выталкивает их в сторону.
  const OWN = { ignore: new Set(['player', 'companion:Ilva', 'companion:Rayn', 'companion:Ossana']) };
  const reachAuto = new THREE.Vector3();
  function pickReach() {
    if (p.reachTarget) return p.reachTarget;
    for (const it of game.interactables) {
      const rp = it?.reachPoint;
      if (!rp || it.enabled === false) continue;
      const dx = rp.x - position.x, dz = rp.z - position.z, d = Math.hypot(dx, dz);
      if (d < 1.9 && Math.abs(rp.y - position.y) < 2.5 && (d < 0.5 || (dx * Math.cos(p.yaw) + dz * Math.sin(p.yaw)) / d > 0.55)) return reachAuto.copy(rp);
    }
    return null;
  }
  // Режим передвижения: C / LB — переключатель (обычный ⇄ походка по песку), Alt — «пока держишь». Shift (бег) отменяет песок.
  let desertToggle = false, altHeld = false, padLB = false;
  const onKey = (e) => {
    if (e.code === 'KeyC' && e.type === 'keydown' && !e.repeat) { if (!(game.paused || game.cinematic.active || game.ui?.blocking || p.inputLocked)) desertToggle = !desertToggle; }
    if (e.code === 'AltLeft' || e.code === 'AltRight') altHeld = e.type === 'keydown';
  };
  addEventListener('keydown', onKey); addEventListener('keyup', onKey);
  addEventListener('blur', () => { altHeld = false; });
  const pollPad = () => {
    const pad = navigator.getGamepads?.()[0];
    const lb = !!pad?.buttons?.[4]?.pressed;
    if (lb && !padLB && !(game.paused || game.cinematic.active || game.ui?.blocking || p.inputLocked)) desertToggle = !desertToggle;
    padLB = lb;
  };
  const fx = createPuffs(game);
  const rig = createCameraRig(game, p);
  rig.snap(start.yaw);
  const gaitMod = createNoise(game, p, fx);
  figure.onStep = (e) => gaitMod.footPlant(game.time, e);
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
    // Уклон — по поверхности под ногами (с учётом высоты ступней): на уступах у скалы и на двух уровнях сиетча
    // без y брался бы верх скалы/балкона, и склон считался бы отвесным.
    const y = position.y + 0.3;
    const h = (px, pz) => game.heightAt(px, pz, y);
    out.set((h(x + e, z) - h(x - e, z)) / (2 * e), 0, (h(x, z + e) - h(x, z - e)) / (2 * e));
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
      gaitMod.reset(); figure.gait.reset();
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
        if (inp.pressed('Stutter')) { gaitMod.stutter(now, p.speed > CFG.step.minSpeed); figure.gait.stutter(); }
        pollPad();
        if (inp.pressed('Sprint') && desertToggle) desertToggle = false; // рывок отменяет походку по песку
      }

      // --- намерение движения (относительно камеры) ---
      const ax = frozen ? { x: 0, y: 0 } : inp.axis();
      const mag = Math.min(1, Math.hypot(ax.x, ax.y));
      const cyaw = rig.yaw;
      const fxv = Math.cos(cyaw), fzv = Math.sin(cyaw);
      wish.set(fxv * ax.y - Math.sin(cyaw) * ax.x, 0, fzv * ax.y + Math.cos(cyaw) * ax.x);
      if (wish.lengthSq() > 1e-6) wish.normalize();

      const sprint = !frozen && !altHeld && inp.held('Sprint') && mag > 0.1;
      if (sprint) desertToggle = false;
      const sandHeld = !frozen && (desertToggle || altHeld);
      const envNow = sandHeld ? figure.gait.env : 1;
      let base = sandHeld ? CFG.speed.sandWalkBase * envNow : sprint ? CFG.speed.run : CFG.speed.walk;
      if (sprint && p.moisture < CFG.hydration.lowThreshold) base *= CFG.hydration.lowSprintFactor;
      p.gait = mag < 0.1 ? 'idle' : sandHeld ? 'sandwalk' : sprint ? 'run' : 'walk';

      // --- склон ---
      groundGradient(position.x, position.z, grad);
      const gl = Math.hypot(grad.x, grad.z);
      const slopeDeg = Math.atan(gl) / (Math.PI / 180);
      p.slope = slopeDeg;
      let slow = 1;
      let slopeAlong = 0;
      if (gl > 1e-4) slopeAlong = Math.atan((grad.x * Math.cos(p.yaw) + grad.z * Math.sin(p.yaw)));
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
      if (game.collide(position, CFG.radius, OWN) && dt > 0) {
        velocity.x = (position.x - ox) / dt - slide.x; velocity.z = (position.z - oz) / dt - slide.z;
      }
      // уступы: подъём до CFG.stepUp (≈0.5 м) разрешён, выше — упираемся (пробуем скользить по осям)
      {
        const cur = position.y;
        const rise = game.heightAt(position.x, position.z, cur) - cur;
        if (rise > CFG.stepUp && dt > 0) {
          const nx = position.x, nz = position.z;
          const rX = game.heightAt(nx, oz, cur) - cur, rZ = game.heightAt(ox, nz, cur) - cur;
          if (rX <= CFG.stepUp) { position.x = nx; position.z = oz; }
          else if (rZ <= CFG.stepUp) { position.x = ox; position.z = nz; }
          else { position.x = ox; position.z = oz; }
          velocity.x = (position.x - ox) / dt - slide.x; velocity.z = (position.z - oz) / dt - slide.z;
        }
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
      p.moveMode = sandHeld ? 'desert' : 'normal';
      const weather = game.weather;
      setFigureWind(game.space === 'desert' && weather ? weather.windDir : null, weather ? weather.windSpeed : 0);
      figure.animate(p.speed, dt, sandHeld ? 1 : 0, { slope: slopeAlong, sliding: clamp(slideSpeed / 4, 0, 1), allowPause: true, desert: sandHeld });
      figure.group.visible = rig.blend < 0.55;
      syncBody();
      { const rt = frozen && !p.reachTarget ? null : pickReach(); figure.reachTo(rt, 'R', rt ? 1 : 0, { sweep: 0.2 }); }
      lastY = position.y;
    },
    lateUpdate(dt, t) { rig.apply(dt, t); setFigureView(game.camera.position); },
  });

  game.add('player', p);
  return p;
}
