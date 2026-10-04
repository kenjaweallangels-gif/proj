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
  const grad = new V3();

  // ---- Фиксированный шаг физики (60 Гц) + интерполяция отрисовки: движение не зависит от FPS и не дрожит ----
  const STEP = CFG.phys.step, MAX_STEPS = CFG.phys.maxSteps;
  const prevPos = new V3().copy(position);
  const renderPos = new V3().copy(position);
  p.renderPos = renderPos;       // позиция для фигуры и камеры (интерполированная); p.position — физическая
  p.grounded = true; p.vy = 0; p.airTime = 0; p.landImpact = 0; p.lastLandAt = -9;
  let acc = 0, coyote = 0, jumpBuf = 0, gradT = 0, groundY = position.y, squash = 0, turning = false;
  const rootScaleY = figure.parts.root.scale.y;
  const intent = { target: 0, mag: 0, slideTarget: 0, sx: 0, sz: 0 };

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
  function placeFigure() {
    figure.group.position.copy(renderPos);
    figure.group.rotation.y = Math.PI / 2 - p.yaw;
  }

  Object.assign(p, {
    head() { return new V3(renderPos.x, renderPos.y + CFG.eye, renderPos.z); },
    setInputLocked(b) { p.inputLocked = !!b; if (b) { velocity.set(0, 0, 0); } },
    setFirstPerson(b) { rig.setFirstPerson(b); },
    toggleCamera() { rig.toggle(); },
    /** Телепорт: ступни в (x, y, z); y=undefined → высота земли. yaw — курс (atan2(dz,dx)). Камера и спутники переезжают следом. */
    teleport(x, y, z, yaw, withCompanions = true) {
      position.set(x, Number.isFinite(y) ? y : game.heightAt(x, z), z);
      if (Number.isFinite(yaw)) p.yaw = yaw;
      velocity.set(0, 0, 0); slide.set(0, 0, 0); p.speed = 0;
      p.vy = 0; p.grounded = true; p.airTime = 0; coyote = CFG.jump.coyote; jumpBuf = 0; groundY = position.y; acc = 0; gradT = 0;
      prevPos.copy(position); renderPos.copy(position);
      rig.snap(p.yaw);
      gaitMod.reset(); figure.gait.reset();
      placeFigure();
      syncBody();
      if (withCompanions) game.companions?.teleportBehind?.();
    },
    update(dt, t) {
      const now = game.time;
      const frozen = blocked();
      rig.look(dt, frozen);
      const inp = game.input;

      let wantJump = false;
      if (!frozen) {
        if (inp.pressed('ToggleCamera')) rig.toggle();
        if (inp.pressed('Mask')) hydro.toggleMask();
        if (inp.pressed('Thumper')) thumpers.deploy();
        pollPad();
        if (inp.pressed('Sprint') && desertToggle) desertToggle = false; // рывок отменяет походку по песку
        // Space/A: в обычном режиме — прыжок, в режиме «походка по песку» — сбой ритма (stutter). ПКМ — всегда stutter.
        const sandNow = desertToggle || altHeld;
        const jp = inp.pressed('Jump');
        if (jp && !sandNow) wantJump = true;
        if (inp.pressed('Stutter') && (sandNow || !jp)) { gaitMod.stutter(now, p.speed > CFG.step.minSpeed); figure.gait.stutter(); }
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

      // --- склон (уклон считаем ~15 раз в секунду: 4 выборки высоты — не бесплатно) ---
      if (p.grounded) { if ((gradT -= dt) <= 0) { gradT = 0.066; groundGradient(position.x, position.z, grad); } }
      else grad.set(0, 0, 0);
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
      intent.target = base * mag * slow;
      intent.mag = mag;
      intent.slideTarget = p.grounded ? smoothstep(CFG.slope.slideDeg, CFG.slope.slideDeg + 12, slopeDeg) * CFG.slope.slideMax : 0;
      intent.sx = gl > 1e-4 ? -grad.x / gl : 0; intent.sz = gl > 1e-4 ? -grad.z / gl : 0;

      if (wantJump) jumpBuf = CFG.jump.buffer;

      // --- физика: фиксированные шаги ---
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < MAX_STEPS) {
        prevPos.copy(position);
        physicsStep(STEP, now);
        acc -= STEP; steps++;
      }
      if (steps === MAX_STEPS) acc = 0; // не догоняем бесконечно при просадке FPS
      renderPos.lerpVectors(prevPos, position, acc / STEP);
      const slideSpeed = Math.hypot(slide.x, slide.z);
      if (slideSpeed > 1.2 && Math.random() < dt * 14) {
        fx.spawn(position.x, position.y + 0.1, position.z, intent.sx * 0.5 + (Math.random() - 0.5) * 0.6, 0.6, intent.sz * 0.5 + (Math.random() - 0.5) * 0.6, 0.3, 0.9);
      }

      // --- курс (по кадрам; гистерезис: не «дребезжит» вокруг порога скорости) ---
      if (rig.fp) p.yaw = rig.yaw;
      else if (wish.lengthSq() > 0 && p.speed > (turning ? 0.25 : 0.45)) { turning = true; p.yaw = dampAngle(p.yaw, Math.atan2(wish.z, wish.x), CFG.turnLambda, dt); }
      else turning = false;

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
      squash = damp(squash, 0, 9, dt);
      figure.parts.root.scale.y = rootScaleY * (1 - 0.1 * squash);
      placeFigure();
      p.moveMode = sandHeld ? 'desert' : 'normal';
      const weather = game.weather;
      setFigureWind(game.space === 'desert' && weather ? weather.windDir : null, weather ? weather.windSpeed : 0);
      // в воздухе ноги «не шагают»: скорость анимации гасим, чтобы не бежать по воздуху
      const animSpeed = p.grounded ? p.speed : p.speed * 0.25;
      figure.animate(animSpeed, dt, sandHeld ? 1 : 0, { slope: slopeAlong, sliding: clamp(slideSpeed / 4, 0, 1), allowPause: true, desert: sandHeld });
      figure.group.visible = rig.blend < 0.55;
      syncBody();
      { const rt = frozen && !p.reachTarget ? null : pickReach(); figure.reachTo(rt, 'R', rt ? 1 : 0, { sweep: 0.2 }); }

      // приземление: вмятина камеры + лёгкое «приседание» фигуры
      if (p.landImpact > 0) {
        const imp = p.landImpact; p.landImpact = 0;
        squash = Math.max(squash, clamp(imp / 10, 0.2, 1));
        rig.dip(imp);
      }
    },
    lateUpdate(dt, t) { rig.apply(dt, t); setFigureView(game.camera.position); },
  });

  /** Один шаг физики: горизонталь (разгон, склон, коллизии, уступы) + вертикаль (земля / гравитация / прыжок). */
  function physicsStep(h, now) {
    const J = CFG.jump;
    const air = !p.grounded;
    // горизонтальная скорость: на земле быстрый разгон, в воздухе — почти инерция (небольшой контроль)
    const lam = air ? J.airLambda : (intent.mag > 0.05 ? CFG.accelLambda : CFG.decelLambda);
    if (!air || intent.mag > 0.05) {
      velocity.x = damp(velocity.x, wish.x * intent.target, lam, h);
      velocity.z = damp(velocity.z, wish.z * intent.target, lam, h);
    }
    // скольжение по очень крутому песку
    slide.x = damp(slide.x, intent.sx * intent.slideTarget, intent.slideTarget > 0 ? CFG.slope.slideLambda : 6, h);
    slide.z = damp(slide.z, intent.sz * intent.slideTarget, intent.slideTarget > 0 ? CFG.slope.slideLambda : 6, h);

    const ox = position.x, oz = position.z;
    position.x += (velocity.x + slide.x) * h;
    position.z += (velocity.z + slide.z) * h;
    if (game.collide(position, CFG.radius, OWN)) {
      velocity.x = (position.x - ox) / h - slide.x; velocity.z = (position.z - oz) / h - slide.z;
    }
    // Земля под новой позицией. Если поверхность выше ступней больше чем на stepUp — это стена/уступ: упираемся (скользим по осям).
    let gy = game.heightAt(position.x, position.z, position.y);
    if (gy - position.y > CFG.stepUp) {
      const nx = position.x, nz = position.z;
      const rX = game.heightAt(nx, oz, position.y) - position.y, rZ = game.heightAt(ox, nz, position.y) - position.y;
      if (rX <= CFG.stepUp) { position.x = nx; position.z = oz; gy = position.y + rX; }
      else if (rZ <= CFG.stepUp) { position.x = ox; position.z = nz; gy = position.y + rZ; }
      else { position.x = ox; position.z = oz; gy = game.heightAt(ox, oz, position.y); }
      velocity.x = (position.x - ox) / h - slide.x; velocity.z = (position.z - oz) / h - slide.z;
    }

    // --- вертикаль ---
    if (p.grounded) {
      coyote = J.coyote;
      const d = gy - position.y;
      if (jumpBuf > 0 && !p.inputLocked) jump();
      else if (d < -J.snapDown) { p.grounded = false; p.vy = 0; p.airTime = 0; } // край уступа/обрыв: дальше свободное падение
      else {
        // Следим за землёй без запаздывания на склонах: скорость = собственный уклон земли + запас на ступеньки.
        const maxMove = (J.stepRate + (Math.abs(gy - groundY) / h) * 1.15) * h;
        position.y += Math.max(-maxMove, Math.min(maxMove, d));
      }
      groundY = gy;
    } else {
      p.airTime += h; coyote -= h;
      if (jumpBuf > 0 && coyote > 0 && p.vy <= 0.5) jump(); // «койот»: прыжок сразу после схода с края
      p.vy = Math.max(-J.maxFall, p.vy - J.gravity * h);
      position.y += p.vy * h;
      // потолок/перекрытие над головой (борт харвестера и т.п.): в прыжке голова не проходит сквозь плиту
      if (p.vy > 0 && game.ceilingAt) { const ce = game.ceilingAt(position.x, position.z, position.y - p.vy * h); if (position.y + CFG.height > ce) { position.y = ce - CFG.height; p.vy = 0; } }
      if (position.y <= gy && p.vy <= 0) {
        const imp = -p.vy;
        position.y = gy; p.vy = 0; p.grounded = true; groundY = gy;
        if (p.airTime > 0.12 && imp > 2.5) onLand(imp, now);
      }
    }
    jumpBuf = Math.max(0, jumpBuf - h);
    p.speed = damp(p.speed, Math.hypot(position.x - ox, position.z - oz) / h, 20, h);
  }
  function jump() {
    p.grounded = false; p.vy = CFG.jump.speed; p.airTime = 0; coyote = 0; jumpBuf = 0;
    game.bus.emit('jump', { x: position.x, z: position.z });
  }
  function onLand(imp, now) {
    p.landImpact = Math.max(p.landImpact, imp); p.lastLandAt = now;
    // жёсткое приземление гасит горизонтальную скорость (перекат)
    const k = 1 - clamp((imp - 6) / 14, 0, 0.55);
    velocity.x *= k; velocity.z *= k;
    const surface = game.surfaceAt(position.x, position.z);
    const mult = CFG.noise.surface[surface] ?? 0;
    game.bus.emit('land', { x: position.x, y: position.y, z: position.z, impact: imp, surface });
    game.bus.emit('footstep', { x: position.x, z: position.z, yaw: p.yaw, surface, actor: 'player' });
    if (mult > 0) {
      const loud = clamp(CFG.noise.land * mult * (0.4 + imp / 10), 0, 1);
      p.noise = Math.max(p.noise, loud);
      game.bus.emit('noise', { x: position.x, z: position.z, loudness: loud, source: 'Landing' });
      if (game.space === 'desert') game.world?.addFootprint?.(position.x, position.z, p.yaw, { type: 'foot' });
    }
    fx.spawn(position.x, position.y + 0.1, position.z, 0, 0.5 + imp * 0.05, 0, 0.35 + imp * 0.02, 0.9);
  }

  game.add('player', p);
  return p;
}
