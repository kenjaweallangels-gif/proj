// Шай-Хулуд для браузерной версии. Модуль: game.worm.
// Состояния: Dormant → Listening → Approach → Surface → Pass (→ Dormant), сценарное Ridden (кат-сцена выхода).
// Тело — «поезд» по истории пути головы (spine.js), меш деформируется на GPU (body.js/shaders.js), эффекты — fx.js,
// кат-сцена — reveal.js. Параметры — как DA_WormTuning (docs/06_demo_contract.md §2.6), но в метрах и под компактную карту.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, rng } from '../core/util.js';
import { WORM_SPAWN, WORM_REVEAL, SUN_AZIMUTH_DEG } from '../core/layout.js';
import { Spine, RADIUS, N_PTS } from './spine.js';
import { createUniforms } from './shaders.js';
import { WormBody, Riders } from './body.js';
import { WormFX } from './fx.js';
import { surfaceArc, revealArc } from './path.js';
import { RevealDirector } from './reveal.js';

const wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

export const TUNING = {
  hearingRadius: 600,        // м (контракт: 120000 см; в компактной карте масштаб ~0.5)
  listenThreshold: 0.25, approachThreshold: 0.55,
  listenTime: 6, passTime: 14, dormantCooldown: 45,
  approachSpeed: 25, surfaceSpeed: 48, passSpeed: 30, forcedSpeed: 38,
  burrowDepth: 60,           // м, глубина оси тела при подходе
  surfaceHeight: 75,         // м, высота центра головы над песком в вершине дуги
  breachLead: 80,            // м от цели до точки выхода
  minSurfaceDistance: 65,    // м до игрока (безопасность среза)
  lateralOffset: 75,         // м, на сколько дуга проходит мимо цели
  decayPerSecond: 0.15, thumperWeight: 2.0,
  turnRadius: 120,           // м, минимальный радиус поворота под песком
  senseInterval: 0.5,
  rockHopRadius: 30,
  idleRipple: [55, 95],      // с между «предвестиями» в A2
};

export function create(game) {
  const { scene, camera, bus } = game;
  const quality = game.settings?.quality || 'med';
  const rand = rng(90210);
  const tune = { ...TUNING };

  const ground = (x, z) => game.world?.heightAt?.(x, z) ?? 0;
  const spine = new Spine();
  const U = createUniforms(spine.tex);
  const body = new WormBody(game, U, spine, quality);
  const riders = new Riders(game, spine);
  const fx = new WormFX(game, quality);
  scene.add(body.group, riders.group, fx.group);
  body.group.visible = false;

  // ---- кинематика головы ----
  const K = {
    pos: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 0, mode: 'burrow', arc: null, sigma: 0, yaw0: 0,
    steer: null, depth: tune.burrowDepth, travel: 0, frozen: false,
  };
  const arcNormal = surfaceArc(tune.surfaceHeight, -tune.burrowDepth, 1.1, 100);
  const arcReveal = revealArc();

  const worm = {
    state: 'Dormant', threat: 0, headPos: K.pos, sensing: true, tuning: tune, look: U, K, spine, body, riders, fx,
    arcs: { normal: arcNormal, reveal: arcReveal },
    exposed: false, visible: false, noise: 0, suspicion: 0,
  };

  let stateT = 0, S = 0, quietT = 0, rockT = 0, cooldown = 0, passT = 0, senseT = 0;
  let P = 0, playerOnRock = false;
  let breached = false, wasAbove = false, impulse = 0, footAcc = 0;
  let aim = null, aimT = 0, forced = null;
  let ripple = null, rippleT = 20 + rand() * 30;
  const events = [];
  let lastTarget = null;
  const sunDir = new THREE.Vector3();
  const windVec = new THREE.Vector3();

  function setState(to) {
    if (to === worm.state) return;
    const from = worm.state;
    worm.state = to; stateT = 0;
    bus.emit('worm:state', { from, to });
  }

  // ---- окружение ----
  function getSun() {
    const w = game.world?.sunDir;
    if (w && w.isVector3 && w.lengthSq() > 0.1) { sunDir.copy(w).normalize(); if (sunDir.y < 0) sunDir.negate(); }
    else {
      const az = SUN_AZIMUTH_DEG * Math.PI / 180, el = 28 * Math.PI / 180;
      sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    }
    return sunDir;
  }

  // ---- слух ----
  bus.on('noise', (e) => { if (e) { events.push({ x: e.x, z: e.z, l: e.loudness ?? 0.3, t: game.time, src: e.source || 'Player' }); if (events.length > 40) events.shift(); } });
  bus.on('thumper', (e) => { if (e) { events.push({ x: e.x, z: e.z, l: 1.0, t: game.time, src: 'Thumper' }); if (events.length > 40) events.shift(); } });

  function sense() {
    const pl = game.player?.position;
    playerOnRock = !!pl && game.space === 'desert' && game.surfaceAt(pl.x, pl.z) === 'rock';
    const R = tune.hearingRadius;
    let max = 0, sum = 0, best = null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      const age = game.time - e.t;
      const af = 1 - age * tune.decayPerSecond;
      if (af <= 0) { events.splice(i, 1); continue; }
      const thump = e.src === 'Thumper' || e.src === 'thumper';
      if (playerOnRock && !thump) continue;
      const d = Math.hypot(e.x - K.pos.x, e.z - K.pos.z);
      const gain = d < 0.3 * R ? 1 : clamp(1 - (d - 0.3 * R) / (0.7 * R), 0, 1);
      const w = e.l * gain * af * (thump ? tune.thumperWeight : 1);
      sum += w;
      if (w > max) { max = w; best = e; }
    }
    P = clamp(max + 0.3 * (sum - max), 0, 1);
    worm.noise = P;
    return best;
  }

  function sensingOn() {
    return worm.sensing && game.space === 'desert' && !game.cinematic.active && game.zone !== 'A4_Crevice';
  }

  // ---- вспомогательное ----
  function placeHead(x, z, yaw, depth = tune.burrowDepth) {
    K.pos.set(x, ground(x, z) - depth, z);
    K.yaw = yaw; K.pitch = 0; K.mode = 'burrow'; K.arc = null; K.sigma = 0; K.depth = depth; K.steer = null; K.speed = 0; K.travel = 0;
    spine.reset(K.pos, Math.cos(yaw), Math.sin(yaw), ground, depth);
    breached = false; wasAbove = false;
  }

  function relocateFar() {
    const pl = game.player?.position;
    if (!pl) return;
    for (let tries = 0; tries < 12; tries++) {
      const a = rand() * Math.PI * 2, d = 340 + rand() * 120;
      const x = pl.x + Math.cos(a) * d, z = pl.z + Math.sin(a) * d;
      if (x > 560 || x < -260 || z < -380 || z > 520) continue;      // эрг; скала и сиетч справа
      if (Math.hypot(x - 700, z - 270) < 160) continue;
      placeHead(x, z, rand() * 6.28);
      return;
    }
    placeHead(WORM_SPAWN.x, WORM_SPAWN.z, Math.atan2(WORM_REVEAL.z - WORM_SPAWN.z, WORM_REVEAL.x - WORM_SPAWN.x));
  }

  function computeAim(tx, tz, thump) {
    const pl = game.player?.position;
    let ax = tx, az = tz;
    if (!thump) {
      // дуга проходит мимо цели с боку (игрок получает волну, но не удар)
      const dx = tx - K.pos.x, dz = tz - K.pos.z, l = Math.hypot(dx, dz) || 1;
      const side = aim?.side ?? (rand() < 0.5 ? -1 : 1);
      ax = tx + (-dz / l) * tune.lateralOffset * side; az = tz + (dx / l) * tune.lateralOffset * side;
      aim = { x: ax, z: az, side };
    } else aim = { x: ax, z: az, side: 0 };
    if (pl) {
      const d = Math.hypot(aim.x - pl.x, aim.z - pl.z);
      if (d < tune.minSurfaceDistance) {
        const dx = d > 1 ? (aim.x - pl.x) / d : 1, dz = d > 1 ? (aim.z - pl.z) / d : 0;
        aim.x = pl.x + dx * tune.minSurfaceDistance; aim.z = pl.z + dz * tune.minSurfaceDistance;
      }
    }
    return aim;
  }

  function startArc(profile, speed) {
    K.mode = 'arc'; K.arc = profile; K.sigma = 0; K.yaw0 = K.yaw; K.steer = null; K.speed = speed;
    breached = false; wasAbove = false;
  }

  function stamp(type, x, z, yaw, size) { game.world?.addFootprint?.(x, z, yaw, { type, size }); }

  function onBreach() {
    breached = true; wasAbove = true;
    const x = K.pos.x, z = K.pos.z, gy = ground(x, z);
    fx.breach(x, gy, z, K.yaw, 1);
    stamp('crater', x, z, K.yaw, 60);
    impulse = 1;
    bus.emit('worm:breach', { x, z });
    game.audio?.event?.('Worm.Breach', K.pos.clone());
  }

  function onReenter() {
    wasAbove = false;
    const x = K.pos.x, z = K.pos.z, gy = ground(x, z);
    fx.splash(x, gy, z, 0.8);
    stamp('crater', x, z, K.yaw, 45);
    impulse = Math.max(impulse, 0.6);
  }

  function onArcEnd() {
    if (worm.state === 'Surface' || worm.state === 'Ridden') { passT = 0; setState('Pass'); }
    K.depth = tune.burrowDepth; K.speed = tune.passSpeed; K.steer = null;
  }

  function stepHead(dt) {
    if (K.frozen) return;
    const v = K.speed * dt;
    if (v <= 0) return;
    if (K.mode === 'burrow') {
      if (K.steer) {
        const des = Math.atan2(K.steer.z - K.pos.z, K.steer.x - K.pos.x);
        const maxT = (K.speed / tune.turnRadius) * dt;
        K.yaw += clamp(wrapPi(des - K.yaw), -maxT, maxT);
      }
      const gy = ground(K.pos.x, K.pos.z);
      const err = (gy - K.depth) - K.pos.y;
      const des = clamp(err * 0.03, -1.25, 0.45);
      K.pitch += clamp(des - K.pitch, -(K.speed / 85) * dt, (K.speed / 85) * dt);
    } else {
      K.sigma += v;
      const arc = K.arc;
      K.pitch = arc.pitch(K.sigma);
      K.yaw = K.yaw0 + arc.yaw(K.sigma);
      if (K.sigma >= arc.sigmaEnd) { K.mode = 'burrow'; K.arc = null; onArcEnd(); }
    }
    const cp = Math.cos(K.pitch);
    K.pos.x += Math.cos(K.yaw) * cp * v; K.pos.z += Math.sin(K.yaw) * cp * v; K.pos.y += Math.sin(K.pitch) * v;
    K.travel += v;
    // борозда
    footAcc += v;
    if (footAcc > 18 && (worm.state === 'Approach' || worm.state === 'Pass' || worm.state === 'Surface')) {
      footAcc = 0; stamp('worm', K.pos.x, K.pos.z, K.yaw, 40);
    }
    spine.push(K.pos);
  }

  /** Быстрая симуляция дуги до σ (для тестов/позирования). */
  function simulateArc(profile, sigmaTarget, yaw0) {
    K.mode = 'arc'; K.arc = profile; K.sigma = 0; K.yaw0 = yaw0; K.yaw = yaw0;
    const keep = K.frozen; K.frozen = false;
    const st = worm.state;
    const gy = ground(K.pos.x, K.pos.z);
    K.pos.y = gy - tune.burrowDepth;
    while (K.sigma < sigmaTarget) { K.speed = 20; stepHead(0.05); }
    K.speed = 0; K.frozen = keep; worm.state = st;
  }

  // ---- публичное API ----
  worm.setSensing = (b) => {
    worm.sensing = !!b;
    if (!b && (worm.state === 'Listening')) { setState('Dormant'); S = 0; }
    if (!b && worm.state === 'Approach' && !forced) { passT = 0; K.steer = null; K.speed = tune.passSpeed; setState('Pass'); }
  };

  /** Сценарный выход (StoryDirector 'ForceWorm'): червь идёт к (x,z) ≈ 8 с. Для точки у WORM_REVEAL — ждёт под песком playReveal(). */
  worm.forceSurface = (x, z) => {
    x = x ?? WORM_REVEAL.x; z = z ?? WORM_REVEAL.z;
    const isReveal = Math.hypot(x - WORM_REVEAL.x, z - WORM_REVEAL.z) < 70;
    if (isReveal) {
      const g = director.prepare(true);
      forced = { reveal: true, x: g.B0.x, z: g.B0.z, armed: false, armedT: 0 };
    } else {
      const d0 = Math.hypot(x - K.pos.x, z - K.pos.z);
      if (d0 > 360 || d0 < 150) { const a = Math.atan2(K.pos.z - z, K.pos.x - x); placeHead(x + Math.cos(a + 0.4) * 300, z + Math.sin(a + 0.4) * 300, a + Math.PI - 0.4); }
      const ax = computeAim(x, z, true);
      forced = { reveal: false, x: ax.x, z: ax.z, armed: false, armedT: 0 };
    }
    K.depth = tune.burrowDepth; K.steer = { x: forced.x, z: forced.z }; K.speed = tune.forcedSpeed;
    if (worm.state !== 'Ridden') setState('Approach');
  };

  worm.playReveal = () => director.play();

  worm.isBusy = () => director.active;
  /** Куда приземляется Оссана после спуска (для спавна настоящей NPC после кат-сцены). */
  Object.defineProperty(worm, 'ossanaLanding', { get: () => director.oss.land.clone() });

  /** Сколько метров до игрока. */
  worm.distanceToPlayer = () => { const p = game.player?.position; return p ? Math.hypot(p.x - K.pos.x, p.z - K.pos.z) : Infinity; };

  // ---- режиссёр кат-сцены ----
  const api = {
    game, K, spine, body, riders, fx, tune, ground, bus, arcReveal, startArc, placeHead, setState, getSun,
    getState: () => worm.state,
    setForced: (f) => { forced = f; },
    getForced: () => forced,
    onBreach, simulateArc,
    clearForced() { forced = null; },
    setRidden(b) { if (b) setState('Ridden'); },
    endRidden() { passT = 0; if (worm.state === 'Ridden') setState('Pass'); K.depth = tune.burrowDepth; K.steer = null; },
    hardDormant(far = true) {
      forced = null; K.frozen = false; cooldown = 30; S = 0; setState('Dormant');
      if (far) relocateFar();
      worm.exposed = false; body.group.visible = false; riders.group.visible = false;
    },
    impulse(v) { impulse = Math.max(impulse, v); },
    markSensing: () => worm.sensing,
    stepHead,
  };
  const director = new RevealDirector(api, worm);
  worm.director = director;

  // ---- основной цикл ----
  function updateMachine(dt) {
    stateT += dt;
    const pl = game.player?.position;
    cooldown = Math.max(0, cooldown - dt);
    senseT += dt;
    let best = null;
    if (senseT >= tune.senseInterval) { senseT = 0; best = sense(); if (best) lastTarget = best; }
    const on = sensingOn() && !forced && worm.state !== 'Ridden';
    if (!on && !forced) P = Math.min(P, 0);

    switch (worm.state) {
      case 'Dormant': {
        worm.threat = 0; K.speed = 0;
        if (!director.active && !forced) {
          if (pl && (Math.hypot(pl.x - K.pos.x, pl.z - K.pos.z) > 520 || stateT < 0.05) && sensingOn() && stateT > 0.5) { relocateFar(); stateT = 0.1; }
          if (on && cooldown <= 0 && P >= tune.listenThreshold) { S = 0; quietT = 0; setState('Listening'); }
        }
        break;
      }
      case 'Listening': {
        K.speed = 0;
        if (!on) { setState('Dormant'); break; }
        if (P >= tune.approachThreshold) S += dt * (lastTarget && /thump/i.test(lastTarget.src) ? 2 : 1); else S = Math.max(0, S - dt * 0.5);
        if (P < tune.listenThreshold) quietT += dt; else quietT = 0;
        worm.threat = 0.15 + 0.25 * clamp(S / tune.listenTime, 0, 1);
        if (S >= tune.listenTime && lastTarget) {
          computeAim(lastTarget.x, lastTarget.z, /thump/i.test(lastTarget.src));
          K.depth = tune.burrowDepth; K.steer = { x: aim.x, z: aim.z }; K.speed = tune.approachSpeed; quietT = 0; rockT = 0; aimT = 0;
          setState('Approach');
        } else if (quietT >= tune.listenTime) { setState('Dormant'); }
        break;
      }
      case 'Approach': {
        if (forced) { approachForced(dt); break; }
        aimT += dt;
        if (P < tune.listenThreshold) quietT += dt; else quietT = 0;
        rockT = playerOnRock ? rockT + dt : 0;
        if (aimT > 0.5 && lastTarget && game.time - lastTarget.t < 8) {
          aimT = 0;
          const thump = /thump/i.test(lastTarget.src);
          const a = computeAim(lastTarget.x, lastTarget.z, thump); K.steer = { x: a.x, z: a.z };
        }
        const d = Math.hypot(aim.x - K.pos.x, aim.z - K.pos.z);
        worm.threat = 0.4 + 0.6 * clamp(1 - (pl ? Math.hypot(pl.x - K.pos.x, pl.z - K.pos.z) : d) / tune.hearingRadius, 0, 1);
        if (!sensingOn() || rockT > 1.5 || quietT >= tune.passTime) { passT = 0; K.steer = null; K.speed = tune.passSpeed; setState('Pass'); break; }
        if (d <= tune.breachLead + arcNormal.dBreach) { startArc(arcNormal, tune.surfaceSpeed); setState('Surface'); }
        break;
      }
      case 'Surface': {
        worm.threat = 1;
        break;
      }
      case 'Ridden': { worm.threat = 1; break; }
      case 'Pass': {
        passT += dt;
        worm.threat = Math.max(0, 1 - passT / 6) * (worm.exposed ? 1 : 0.8);
        if (passT >= tune.passTime && !worm.exposed) { cooldown = tune.dormantCooldown; setState('Dormant'); K.speed = 0; }
        break;
      }
    }
  }

  function approachForced(dt) {
    const f = forced;
    const d = Math.hypot(f.x - K.pos.x, f.z - K.pos.z);
    worm.threat = 0.5 + 0.5 * clamp(1 - d / 350, 0, 1);
    if (director.active) return;        // скорость и курс ведёт режиссёр
    if (f.reveal) {
      if (d < 4) {                       // прибыли: ждём playReveal()
        K.speed = 0; f.armed = true; f.armedT += dt;
        if (!director.active && f.armedT > 16) { forced = null; startArc(arcNormal, tune.surfaceSpeed); setState('Surface'); }
      } else { K.speed = Math.min(tune.forcedSpeed, Math.max(6, d / 0.12)); K.steer = { x: f.x, z: f.z }; }
    } else {
      K.steer = { x: f.x, z: f.z };
      if (d <= tune.breachLead + arcNormal.dBreach) { forced = null; startArc(arcNormal, tune.surfaceSpeed); setState('Surface'); }
    }
  }

  function visualUpdate(dt, t) {
    const st = worm.state;
    const active = st === 'Surface' || st === 'Ridden' || st === 'Pass' || worm.exposed || director.active;
    if (active) spine.compute(t, worm.exposed ? 1 : 0.4);
    spine.waveAmp = st === 'Ridden' ? 1.2 : st === 'Surface' ? 3 : 1.5;
    // видимость тела: есть ли над песком что-то
    let exposed = false;
    if (active) {
      const Pp = spine.P;
      for (let i = 0; i < N_PTS; i += 1) {
        const gy = ground(Pp[i * 3], Pp[i * 3 + 2]);
        if (Pp[i * 3 + 1] + RADIUS * 0.85 > gy - 0.5) { exposed = true; break; }
      }
    }
    worm.exposed = exposed;
    body.group.visible = exposed;
    // выход/повторный вход в песок (по центру головы)
    const gyh = ground(K.pos.x, K.pos.z);
    const hrel = K.pos.y - gyh;
    if (K.mode === 'arc' || st === 'Pass' || st === 'Ridden') {
      if (!breached && hrel > -RADIUS + 2 && (st === 'Surface' || st === 'Ridden')) onBreach();
      else if (breached && wasAbove && hrel < -RADIUS - 2) onReenter();
    }
    if (exposed) {
      body.update();
      U.uTime.value = t;
    }
    // освещение/окружение
    getSun();
    const wd = game.weather?.windDir, ws = game.weather?.windSpeed ?? 4;
    if (wd) windVec.set(wd.x, 0, wd.z).normalize().multiplyScalar(ws * 0.9); else windVec.set(3, 0, 5);
    fx.setEnv(sunDir, windVec, scene.fog);
    U.uSunV.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    const sc = game.world?.sandColor; if (sc) fx.shared.uSandCol.value.copy(sc);
    if (game.world?.sunColor) fx.shared.uSunCol.value.copy(game.world.sunColor);
    // песок на теле накапливается после выхода
    U.uSandAmt.value = THREE.MathUtils.damp(U.uSandAmt.value, st === 'Surface' || st === 'Ridden' ? 0.0 : 0.25, 0.5, dt);

    // холм над головой
    const depth = gyh - K.pos.y;
    const underground = hrel < -8;
    let mound = null;
    if (underground && st !== 'Dormant' && st !== 'Listening' && (st !== 'Pass' || K.speed > 2)) {
      const dpf = smoothstep(62, 20, depth);
      const amp = lerp(5, 13, dpf) * (forced?.reveal || director.active ? 1.25 : 1);
      const spawnFade = clamp(K.travel / 40, 0, 1);
      mound = { on: true, amp, width: lerp(22, 30, dpf), trail: lerp(55, 85, dpf), intensity: spawnFade * (st === 'Pass' ? 0.8 : 1), spray: 0.4 + 0.6 * dpf };
      if (forced?.armed && !director.active) mound.spray = 1;
    }
    // рябь-предвестие
    let rp = null;
    if (ripple) {
      ripple.t += dt;
      const u = ripple.t / ripple.dur;
      if (u >= 1) ripple = null;
      else {
        ripple.x += Math.cos(ripple.yaw) * ripple.speed * dt; ripple.z += Math.sin(ripple.yaw) * ripple.speed * dt;
        rp = { on: true, x: ripple.x, z: ripple.z, yaw: ripple.yaw, amp: 5, width: 22, trail: 110, intensity: Math.sin(Math.PI * u) };
      }
    }
    const pl = game.player?.position;
    const rocks = {
      player: pl, head: K.pos,
      playerI: (st === 'Listening' ? 0.25 + worm.threat : st === 'Approach' ? 0.4 + 0.6 * worm.threat : st === 'Surface' || st === 'Ridden' ? 1 : st === 'Pass' ? worm.threat : 0),
      rPlayer: director.active ? 14 : tune.rockHopRadius,
      headI: (st === 'Approach' || st === 'Surface' || st === 'Pass') && underground ? clamp(0.5 + 0.5 * worm.threat, 0, 1) * (st === 'Pass' ? worm.threat : 1) : (st === 'Ridden' ? 0.4 : 0),
      rHead: 55,
    };
    if (st === 'Dormant') { rocks.playerI = 0; rocks.headI = 0; }
    const hw = Math.cos(K.yaw);
    fx.update(dt, {
      dt, head: K.pos, yaw: K.yaw, speed: K.speed, state: st, mound, ripple: rp, exposed, spine, groundFn: ground,
      riderA: (st === 'Ridden' || riders.keep) ? riders.aBase : null, sunDir, live: clamp(0.35 + (st === 'Surface' || st === 'Ridden' ? 0.65 : 0) + (worm.threat * 0.2), 0, 1), rocks,
    });
    riders.group.visible = (st === 'Ridden' || (riders.keep && st === 'Pass')) && exposed;
    if (!exposed || st === 'Dormant') riders.keep = false;
    if (riders.group.visible) riders.update(dt, ground, t);
    void hw;
  }

  function shakeUpdate(dt) {
    const pl = game.player?.position;
    if (!pl) return;
    const dist = Math.hypot(pl.x - K.pos.x, pl.z - K.pos.z);
    const prox = clamp(1.15 - dist / 520, 0, 1);
    const st = worm.state;
    const amp = st === 'Listening' ? 0.1 : st === 'Approach' ? lerp(0.12, 0.45, worm.threat) : st === 'Surface' || st === 'Ridden' ? 0.9 : st === 'Pass' ? 0.5 * worm.threat : 0;
    impulse = Math.max(0, impulse - dt / 0.9);
    const f = Math.max(amp * prox * prox, impulse * prox);
    if (f > 0.005) game.shake = Math.max(game.shake || 0, clamp(f, 0, 1));
  }

  function startRipple() {
    const pl = game.player?.position; if (!pl) return false;
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const a = Math.atan2(fwd.z, fwd.x) + (rand() - 0.5) * 1.5, d = 330 + rand() * 120;   // в сторону взгляда игрока
    const cx = pl.x + Math.cos(a) * d, cz = pl.z + Math.sin(a) * d;
    const yaw = a + Math.PI / 2 * (rand() < 0.5 ? 1 : -1);
    const dur = 12, speed = 26;
    ripple = { x: cx - Math.cos(yaw) * speed * dur / 2, z: cz - Math.sin(yaw) * speed * dur / 2, yaw, t: 0, dur, speed };
    return true;
  }
  function idleRipple(dt) {
    if (worm.state !== 'Dormant' || ripple || director.active || !worm.sensing) return;
    if (game.zone !== 'A2_Erg' || game.space !== 'desert') return;
    rippleT -= dt;
    if (rippleT > 0) return;
    rippleT = tune.idleRipple[0] + rand() * (tune.idleRipple[1] - tune.idleRipple[0]);
    startRipple();
  }
  worm.foreshadow = () => (ripple ? false : startRipple());

  worm.update = (dt, t) => {
    if (director.active) director.update(dt, t);
    updateMachine(dt);
    stepHead(dt);
    visualUpdate(dt, t);
    shakeUpdate(dt);
    idleRipple(dt);
  };
  worm.lateUpdate = (dt, t) => { if (director.active) director.lateUpdate(dt, t); };

  // Отладка/тесты: поставить червя в позу «колонна» и заморозить.
  worm.debugPose = ({ x, z, yaw, sigma = 175, open = 0, ridden = true, profile = 'reveal' } = {}) => {
    director.cancel();
    forced = null;
    placeHead(x, z, yaw);
    const prof = profile === 'reveal' ? arcReveal : arcNormal;
    // стартовая точка так, чтобы пересечение песка было в (x,z)
    const hx = x - Math.cos(yaw) * prof.dZero, hz = z - Math.sin(yaw) * prof.dZero;
    placeHead(hx, hz, yaw);
    simulateArc(prof, sigma, yaw);
    K.frozen = true; K.speed = 0;
    body.setOpen(open);
    worm.state = ridden ? 'Ridden' : 'Surface';
    spine.compute(game.time, 1);
    body.update();
    breached = true; wasAbove = true;
  };
  worm.debugUnfreeze = () => { K.frozen = false; };

  // Старт: червь спит далеко (WORM_SPAWN), курс на золотой путь.
  placeHead(WORM_SPAWN.x, WORM_SPAWN.z, Math.atan2(WORM_REVEAL.z - WORM_SPAWN.z, WORM_REVEAL.x - WORM_SPAWN.x));
  return game.add('worm', worm);
}
