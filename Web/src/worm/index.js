// Шай-Хулуд для браузерной версии. Модуль: game.worm.
// Два режима:
//  1) ДИКИЙ червь (слух): Dormant → Listening → Approach → Pass → Dormant. НЕ смертельный: громкий шум в эрге рождает далёкую
//     песчаную волну на горизонте, она приближается (до ~260 м) и отворачивает. Никогда не всплывает рядом с игроком.
//     Состояния/threat сохранены для UI и звука.
//  2) УКРОЩЁННЫЙ червь (сцена «Встреча», encounter.js): состояние 'Ridden'. Червь, ведомый Оссаной и наездниками, ползёт по поверхности,
//     останавливается дугой вокруг группы и уходит. API: playReveal() / playEncounter() → Promise.
// Тело — «поезд» по истории пути головы (spine.js), меш деформируется на GPU (body.js/shaders.js), эффекты — fx.js,
// снаряжение/наездники — gear.js.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, rng } from '../core/util.js';
import { WORM_SPAWN, WORM_REVEAL, SUN_AZIMUTH_DEG } from '../core/layout.js';
import { Spine, RADIUS, N_PTS } from './spine.js';
import { createUniforms, guardPostHaze } from './shaders.js';
import { WormBody, QUALITY_ORDER } from './body.js';
import { Gear, Riders } from './gear.js';
import { WormFX } from './fx.js';
import { EncounterDirector, DIALOGUE_ID } from './encounter.js';

const wrapPi = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };

export const TUNING = {
  hearingRadius: 600,        // м (контракт: 120000 см; в компактной карте масштаб ~0.5)
  listenThreshold: 0.25, approachThreshold: 0.55,
  listenTime: 6, passTime: 14, dormantCooldown: 45,
  approachSpeed: 25, passSpeed: 30, forcedSpeed: 38,
  burrowDepth: 60,           // м, глубина оси тела дикого червя (виден только холм волны)
  wildMinDistance: 260,      // м: ближе дикий червь не подходит — отворачивает (безопасность среза)
  turnRadius: 120,           // м, минимальный радиус поворота под песком
  decayPerSecond: 0.15, thumperWeight: 2.0,
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
  const gear = new Gear(spine);
  const riders = new Riders(game, spine);
  riders.items.forEach((it) => gear.addSaddle(it.s, it.da * 0.6, it.name === 'Ossana' ? 1 : 0));
  const fx = new WormFX(game, quality);
  scene.add(body.group, gear.group, riders.group, fx.group);
  body.group.visible = false;

  // ---- кинематика головы ----
  const K = {
    pos: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 0, mode: 'burrow', steer: null,
    depth: tune.burrowDepth, travel: 0, frozen: false, scripted: false,
  };

  const worm = {
    state: 'Dormant', threat: 0, headPos: K.pos, sensing: true, tuning: tune, look: U, K, spine, body, riders, gear, fx,
    exposed: false, visible: false, noise: 0, suspicion: 0, tamed: false,
    quality, autoQuality: true,
  };

  let stateT = 0, S = 0, quietT = 0, cooldown = 0, passT = 0, senseT = 0;
  let P = 0, playerOnRock = false;
  let impulse = 0;
  let aim = null, aimT = 0, forced = null;
  let ripple = null, rippleT = 20 + rand() * 30;
  const events = [];
  let lastTarget = null;
  const sunDir = new THREE.Vector3();
  const windVec = new THREE.Vector3();
  let tame = false, hdrGuard = false;

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
    return worm.sensing && game.space === 'desert' && !game.cinematic.active && !director.active && game.zone !== 'A4_Crevice';
  }

  // ---- вспомогательное ----
  function placeHead(x, z, yaw, depth = tune.burrowDepth) {
    K.pos.set(x, ground(x, z) - depth, z);
    K.yaw = yaw; K.pitch = 0; K.mode = 'burrow'; K.steer = null; K.speed = 0; K.travel = 0; K.depth = depth;
    spine.reset(K.pos, Math.cos(yaw), Math.sin(yaw), ground, depth);
    spine.headLift = 0;
  }

  function relocateFar(minD = 340, maxD = 460) {
    const pl = game.player?.position;
    if (!pl) return;
    for (let tries = 0; tries < 12; tries++) {
      const a = rand() * Math.PI * 2, d = minD + rand() * (maxD - minD);
      const x = pl.x + Math.cos(a) * d, z = pl.z + Math.sin(a) * d;
      if (x > 560 || x < -260 || z < -380 || z > 520) continue;      // эрг; скала и сиетч справа
      if (Math.hypot(x - 700, z - 270) < 160) continue;
      placeHead(x, z, rand() * 6.28);
      return;
    }
    placeHead(WORM_SPAWN.x, WORM_SPAWN.z, Math.atan2(WORM_REVEAL.z - WORM_SPAWN.z, WORM_REVEAL.x - WORM_SPAWN.x));
  }

  /** Куда идёт дикий червь: на цель, но не ближе wildMinDistance (волна на горизонте, а не у ног). */
  function computeAim(tx, tz) {
    const pl = game.player?.position;
    const dx = tx - K.pos.x, dz = tz - K.pos.z, l = Math.hypot(dx, dz) || 1;
    const side = aim?.side ?? (rand() < 0.5 ? -1 : 1);
    let ax = tx + (-dz / l) * 130 * side, az = tz + (dx / l) * 130 * side;
    if (pl) {
      const d = Math.hypot(ax - pl.x, az - pl.z);
      const R = tune.wildMinDistance + 20;
      if (d < R) { const ux = d > 1 ? (ax - pl.x) / d : 1, uz = d > 1 ? (az - pl.z) / d : 0; ax = pl.x + ux * R; az = pl.z + uz * R; }
    }
    aim = { x: ax, z: az, side };
    return aim;
  }

  function stamp(type, x, z, yaw, size) { game.world?.addFootprint?.(x, z, yaw, { type, size }); }

  function onBreach(power = 0.6) {
    const x = K.pos.x, z = K.pos.z, gy = ground(x, z);
    fx.breach(x, gy, z, K.yaw, power);
    impulse = Math.max(impulse, 0.4 * power);
    bus.emit('worm:breach', { x, z });
    game.audio?.event?.('Worm.Breach', K.pos.clone());
  }

  function stepHead(dt) {
    if (K.frozen || K.scripted) return;
    const v = K.speed * dt;
    if (v <= 0) return;
    // дикий червь всегда под песком: рулит курсом и держит глубину
    if (K.steer) {
      const des = Math.atan2(K.steer.z - K.pos.z, K.steer.x - K.pos.x);
      const maxT = (K.speed / tune.turnRadius) * dt;
      K.yaw += clamp(wrapPi(des - K.yaw), -maxT, maxT);
    }
    const gy = ground(K.pos.x, K.pos.z);
    const err = (gy - K.depth) - K.pos.y;
    const des = clamp(err * 0.03, -1.25, 0.45);
    K.pitch += clamp(des - K.pitch, -(K.speed / 85) * dt, (K.speed / 85) * dt);
    const cp = Math.cos(K.pitch);
    K.pos.x += Math.cos(K.yaw) * cp * v; K.pos.z += Math.sin(K.yaw) * cp * v; K.pos.y += Math.sin(K.pitch) * v;
    K.travel += v;
    if (!(Number.isFinite(K.pos.x + K.pos.y + K.pos.z))) { relocateFar(); return; }   // защита от NaN в кинематике
    spine.push(K.pos);
  }

  // ---- публичное API ----
  worm.setSensing = (b) => {
    worm.sensing = !!b;
    if (!b && (worm.state === 'Listening')) { setState('Dormant'); S = 0; }
    if (!b && worm.state === 'Approach' && !forced) beginPass();
  };

  function beginPass() {
    passT = 0;
    const pl = game.player?.position;
    // отворачивает: курс по касательной от игрока, подальше
    if (pl) {
      const dx = K.pos.x - pl.x, dz = K.pos.z - pl.z, l = Math.hypot(dx, dz) || 1;
      const side = aim?.side ?? 1;
      K.steer = { x: K.pos.x + (dx / l) * 260 + (-dz / l) * 360 * side, z: K.pos.z + (dz / l) * 260 + (dx / l) * 360 * side };
    } else K.steer = null;
    K.speed = tune.passSpeed;
    setState('Pass');
  }

  /**
   * Сценарный вызов (StoryDirector 'ForceWorm'): далёкая песчаная волна идёт к группе (~8 с), подходит не ближе ~260 м и отворачивает,
   * если за это время не вызван playReveal(). Червь НЕ всплывает.
   */
  worm.forceSurface = (x, z) => {
    if (director.active || tame) return;
    x = x ?? WORM_REVEAL.x; z = z ?? WORM_REVEAL.z;
    const pl = game.player?.position;
    relocateFar(380, 460);
    forced = { x, z, armedT: 0 };
    const a = computeAim(pl ? pl.x : x, pl ? pl.z : z);
    K.depth = tune.burrowDepth; K.steer = { x: a.x, z: a.z }; K.speed = tune.forcedSpeed;
    setState('Ridden');          // ведомый червь: не 'Approach' — иначе встанут реплики дикого червя
  };

  /** Сцена «Встреча» с укрощённым червём. Promise<{skipped}> выполняется, когда червь ушёл ('gone'). */
  worm.playReveal = () => director.play();
  worm.playEncounter = worm.playReveal;
  worm.isBusy = () => director.active;
  worm.encounterPhase = () => (director.active ? director.phase : 'none');
  /** Куда приземляется Оссана после спуска. */
  Object.defineProperty(worm, 'ossanaLanding', { get: () => director.oss.land.clone() });
  worm.DIALOGUE_ID = DIALOGUE_ID;

  /** Сколько метров до игрока. */
  worm.distanceToPlayer = () => { const p = game.player?.position; return p ? Math.hypot(p.x - K.pos.x, p.z - K.pos.z) : Infinity; };

  /** Шкала качества 'low'|'med'|'high' (меш тела, детали шейдера, частицы). */
  worm.setQuality = (q) => { const ok = body.setQuality(q); if (ok) worm.quality = q; return ok; };

  // ---- режиссёр ----
  const api = {
    game, K, spine, body, riders, gear, fx, tune, ground, bus, placeHead, setState, getSun,
    getState: () => worm.state,
    clearForced() { forced = null; },
    setRidden(b) { if (b) setState('Ridden'); },
    setTame(b) { tame = !!b; worm.tamed = tame; if (!b) { spine.waveAmp = 0; spine.breath = 0; spine.headLift = 0; } },
    onBreach,
    settleFx() {
      fx.puff(K.pos.x, ground(K.pos.x, K.pos.z) + 1, K.pos.z, 1.2, 'wide');
      impulse = Math.max(impulse, 0.35);
    },
    hardDormant(far = true) {
      forced = null; K.frozen = false; K.scripted = false; cooldown = 30; S = 0; setState('Dormant');
      if (far) relocateFar();
      worm.exposed = false; body.group.visible = false; riders.group.visible = false; gear.group.visible = false;
    },
  };
  const director = new EncounterDirector(api, worm);
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
          computeAim(lastTarget.x, lastTarget.z);
          K.depth = tune.burrowDepth; K.steer = { x: aim.x, z: aim.z }; K.speed = tune.approachSpeed; quietT = 0; aimT = 0;
          setState('Approach');
        } else if (quietT >= tune.listenTime) { setState('Dormant'); }
        break;
      }
      case 'Approach': {
        const dPl = pl ? Math.hypot(pl.x - K.pos.x, pl.z - K.pos.z) : 1e9;
        aimT += dt;
        if (P < tune.listenThreshold) quietT += dt; else quietT = 0;
        if (aimT > 0.5 && lastTarget && game.time - lastTarget.t < 8) { aimT = 0; const a = computeAim(lastTarget.x, lastTarget.z); K.steer = { x: a.x, z: a.z }; }
        worm.threat = 0.4 + 0.45 * clamp(1 - dPl / tune.hearingRadius, 0, 1);
        if (!sensingOn() || quietT >= tune.passTime || dPl <= tune.wildMinDistance) beginPass();
        break;
      }
      case 'Ridden': {
        if (forced && !director.active) {               // далёкая волна идёт к группе, ждёт playReveal(), иначе отворачивает
          const dPl = pl ? Math.hypot(pl.x - K.pos.x, pl.z - K.pos.z) : 1e9;
          forced.armedT += dt;
          K.steer = { x: aim.x, z: aim.z }; K.speed = tune.forcedSpeed;
          worm.threat = 0.25 + 0.3 * clamp(1 - dPl / 600, 0, 1);
          if (dPl <= tune.wildMinDistance + 30 || forced.armedT > 24) { forced = null; beginPass(); }
          break;
        }
        worm.threat = director.phase === 'arrive' || director.phase === 'depart' ? clamp(0.1 + K.speed / 120, 0, 0.35) : 0.05;
        break;
      }
      case 'Pass': {
        passT += dt;
        worm.threat = Math.max(0, 0.7 - passT / 8);
        if (passT >= tune.passTime) { cooldown = tune.dormantCooldown; setState('Dormant'); K.speed = 0; }
        break;
      }
      default: break;
    }
  }

  const _guard = () => {
    if (hdrGuard || !game.post) return;
    hdrGuard = true;
    worm.hdrGuard = guardPostHaze(game.post);
  };

  let fpsLow = 0, fpsHigh = 0;
  function autoQuality(dt) {
    // шкала качества по FPS: если червь на экране и кадр тяжёлый — понижаем сетку/детали (и обратно после паузы)
    if (!worm.autoQuality || !worm.exposed) { fpsLow = 0; return; }
    const fps = game.stats?.fps || 60;
    if (fps < 38) fpsLow += dt; else fpsLow = Math.max(0, fpsLow - dt);
    if (fps > 58) fpsHigh += dt; else fpsHigh = 0;
    const i = QUALITY_ORDER.indexOf(body.quality);
    if (fpsLow > 4 && i > 0) { worm.setQuality(QUALITY_ORDER[i - 1]); fpsLow = 0; }
    else if (fpsHigh > 40 && i < QUALITY_ORDER.indexOf(quality)) { worm.setQuality(QUALITY_ORDER[i + 1]); fpsHigh = 0; }
  }

  function visualUpdate(dt, t) {
    const st = worm.state;
    const active = st === 'Pass' || st === 'Ridden' || worm.exposed || director.active;
    const resting = tame && K.speed < 0.5;
    spine.waveAmp = tame ? (resting ? 0.35 : 0.9) : 0;
    spine.breath = tame ? (resting ? 1 : 0.4) : 0;
    if (active) spine.compute(t, tame ? 1 : 0.4);
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
    if (exposed) { body.update(); U.uTime.value = t; }
    // освещение/окружение
    getSun();
    const wd = game.weather?.windDir, ws = game.weather?.windSpeed ?? 4;
    if (wd) windVec.set(wd.x, 0, wd.z).normalize().multiplyScalar(ws * 0.9); else windVec.set(3, 0, 5);
    fx.setEnv(sunDir, windVec, scene.fog);
    U.uSunV.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    const sc = game.world?.sandColor; if (sc) fx.shared.uSandCol.value.copy(sc);
    if (game.world?.sunColor) fx.shared.uSunCol.value.copy(game.world.sunColor);

    // холм над головой (дикий червь/подход) либо носовая волна (укрощённый на поверхности)
    const gyh = ground(K.pos.x, K.pos.z);
    const hrel = K.pos.y - gyh;
    const depth = gyh - K.pos.y;
    const underground = hrel < -8;
    let mound = null;
    if (tame && director.active && K.speed > 1.5) {
      const sf = smoothstep(1, 14, K.speed);
      if (underground) {
        const dpf = smoothstep(62, 20, depth);
        mound = { on: true, amp: lerp(5, 13, dpf), width: lerp(22, 30, dpf), trail: lerp(55, 85, dpf), intensity: 1, spray: 0.4 + 0.6 * dpf };
      } else mound = { on: true, amp: 2.5 + 3.5 * sf, width: 30, trail: 40, intensity: sf, spray: 0.5 * sf, ahead: 30 };
    } else if (!tame && underground && st !== 'Dormant' && st !== 'Listening' && (st !== 'Pass' || K.speed > 2)) {
      const dpf = smoothstep(62, 20, depth);
      const spawnFade = clamp(K.travel / 40, 0, 1);
      mound = { on: true, amp: lerp(5, 13, dpf), width: lerp(22, 30, dpf), trail: lerp(55, 85, dpf), intensity: spawnFade * (st === 'Pass' ? 0.8 : 1), spray: 0.4 + 0.6 * dpf };
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
    const wildNear = !tame && (st === 'Approach' || st === 'Pass') && underground;
    const rocks = {
      player: pl, head: K.pos,
      playerI: tame ? 0 : (st === 'Listening' ? 0.2 + 0.5 * worm.threat : st === 'Approach' ? 0.3 + 0.5 * worm.threat : st === 'Pass' ? 0.5 * worm.threat : 0),
      rPlayer: tune.rockHopRadius,
      headI: wildNear ? clamp(0.4 + 0.5 * worm.threat, 0, 1) * (st === 'Pass' ? worm.threat : 1) : 0,
      rHead: 55,
    };
    if (st === 'Dormant') { rocks.playerI = 0; rocks.headI = 0; }
    const live = tame ? (resting ? 0.12 : clamp(K.speed / 30, 0.15, 0.8)) : clamp(0.35 + worm.threat * 0.2, 0, 1);
    fx.update(dt, {
      dt, head: K.pos, yaw: K.yaw, speed: K.speed, state: st, mound, ripple: rp, exposed, spine, groundFn: ground,
      riderA: null, sunDir, live, rocks,
      tame: tame && director.active && exposed ? { speed: K.speed, rest: resting ? 1 : 0.25, skirt: 1, skirtWid: resting ? 1 : 1.3 } : null,
    });
    const showGear = tame && director.active && exposed;
    riders.group.visible = showGear;
    gear.group.visible = showGear;
    if (showGear) { gear.update(dt); riders.update(dt, ground, t); }
  }

  function shakeUpdate(dt) {
    const pl = game.player?.position;
    if (!pl) return;
    const dist = Math.hypot(pl.x - K.pos.x, pl.z - K.pos.z);
    const prox = clamp(1.15 - dist / 520, 0, 1);
    const st = worm.state;
    const amp = st === 'Listening' ? 0.05 : st === 'Approach' ? lerp(0.05, 0.22, worm.threat) : st === 'Pass' ? 0.2 * worm.threat : st === 'Ridden' ? 0.35 * clamp(K.speed / 25, 0, 1) : 0;
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
    _guard();
    if (director.active) director.update(dt, t);
    updateMachine(dt);
    stepHead(dt);
    visualUpdate(dt, t);
    shakeUpdate(dt);
    idleRipple(dt);
    autoQuality(dt);
  };
  worm.lateUpdate = (dt, t) => { if (director.active) director.lateUpdate(dt, t); };

  // Отладка/тесты: сразу поставить сцену в нужную стадию ('arrive' по u, 'stop', 'depart') без кинокамеры.
  worm.debugEncounter = ({ stage = 'stop', u } = {}) => {
    const p = director.prepare();
    director._active = true; director.t = 0; director.surfaced = true; director.cinematic = false;
    worm.sensing = false; tame = true; worm.tamed = true; K.scripted = true;
    setState('Ridden');
    riders.items.forEach((it) => { it.hidden = false; it.free = false; it.sNow = it.s; it.a = 0; });
    director.advanceTo(u ?? (stage === 'stop' ? p.uStop : stage === 'depart' ? p.uOut + 120 : p.o.approach - 150));
    spine.headLift = 1.2;
    spine.compute(game.time, 1);
    director.phase = stage === 'stop' ? 'stop' : stage;
  };
  worm.debugUnfreeze = () => { K.frozen = false; };

  // Старт: дикий червь спит далеко (WORM_SPAWN).
  placeHead(WORM_SPAWN.x, WORM_SPAWN.z, Math.atan2(WORM_REVEAL.z - WORM_SPAWN.z, WORM_REVEAL.x - WORM_SPAWN.x));
  return game.add('worm', worm);
}
