// Сценарий «Червь пожирает харвестер» (классическая катастрофа сбора пряности) — РЕАЛЬНОЕ ВРЕМЯ, управление игроком не отбирается.
//
// Хронология (секунды от старта, числа — в DEVOUR_TUNING):
//   wormsign   далёкий дикий червь слышит громкий харвестер: песчаная волна идёт издалека, дрожь земли нарастает
//   alarm      клаксон и мигающие лучи экипажа, сигнальная ракета наблюдателя, харвестер встаёт
//   carryall   переносчик заходит на посадку, цепляет тросы за крыльевые захваты, тянет (тросы струной, двигатели ревут): харвестер чуть приподнят
//   vortex     песок вокруг оседает воронкой (вращающиеся гребни, тёмный зев), нос тонет, корма уходит вверх (носом вниз, подвес на тросах)
//   erupt      червь выныривает прямо из воронки: колонна головы, гигантская раскрытая пасть с кольцами зубов, фонтаны песка, пряная пыль
//   swallow    тросы рвутся/отцепляются, переносчик с капсулой экипажа уходит; харвестер соскальзывает в пасть, обломки летят
//   retreat    пасть смыкается, голова втягивается в песок; воронка схлопывается
//   aftermath  остаются кратер, обломки и оранжевое пятно пряности
// События шины: 'worm:devour' {phase}. Promise playDevour() выполняется в конце ('aftermath' → 'end').
// Физическая согласованность: тело червя и корпус харвестера пересекаются только на время проглатывания (коллайдеры харвестера выключены).
import * as THREE from 'three';
import { clamp, lerp, smoothstep, rng } from '../core/util.js';
import { colliders } from '../core/colliders.js';
import { RADIUS } from './spine.js';
import { Vortex } from './vortex.js';

/** Все числа сценария: время, геометрия, силы эффектов. */
export const DEVOUR_TUNING = {
  autoAfter: 0,                 // с работы харвестера до автозапуска (0 — выключено; кнопка меню / debug)
  startDist: 760, wormSpeed: 26, depth: 62, arcR: 62,
  tAlarm: 3.5, tFlare: 6.5, hold: 5,
  carryall: { spawnDist: 980, spawnAlt: 150, speed: 58, brake: 210, cable: 60, lift: 7, hookDur: 2.2, liftDur: 7, pod: 4.5, podDur: 3.4 },
  vortexLead: 9, vortexRamp: 10, holeR: 30, rimH: 3.2, vortexR: 112,
  tiltDur: 6.5, tiltMax: 1.32,  // рад (≈76° носом вниз), подвес на тросах за корму
  eruptDelay: 1.6, riseTime: 2.6, baseHeight: 30, flare: 2.0, flareLen: 90, openTime: 2.2,
  hangTime: 6.5, slideTime: 6.5, slideAccel: 11, closeDelay: 3.4, closeTime: 2.6,
  retractTime: 7.5, retractDepth: 46,
  aftermathTime: 12, safeRadius: 165, knockSpeed: 24,
  debrisPerSec: 9, spiceRate: 140, sandRate: 150, rainRate: 90,
};

const T = DEVOUR_TUNING;
const LUG_MID = new THREE.Vector3(-26.5, 34.9, 0);    // середина кормовых захватов (локально)
const NOSE_C = new THREE.Vector3(58, 17.7, 0);        // центр носа (ковш) на осевой линии корпуса (локально)
const easeOut = (x) => 1 - (1 - clamp(x, 0, 1)) ** 2;

export class DevourDirector {
  constructor(api, worm) {
    this.api = api; this.worm = worm;
    this._active = false; this.phase = 'none'; this.t = 0;
    this.promise = null; this.resolve = null;
    this.rand = rng(4711);
    const { game, scene, ground } = api;
    this.vortex = new Vortex(ground, '#c8a672', game.settings?.quality || 'med');
    scene.add(this.vortex.mesh);
    this.log = [];
    this.A = new THREE.Vector3(); this.Lg0 = new THREE.Vector3(); this.f = new THREE.Vector3(1, 0, 0);
    this.w = new THREE.Vector3(1, 0, 0);
    this.cp = new THREE.Vector3(); this.cs = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._q = new THREE.Vector3(); this._o = new THREE.Vector3();
    this.hookPts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.cableVis = 0; this.cableTension = 1; this.cableVib = 0;
    this.pod = { state: 'roof', t: 0, from: new THREE.Vector3(), pos: new THREE.Vector3() };
    this.crater = 0;
    void game;
  }

  get active() { return this._active; }

  setPhase(ph) {
    if (ph === this.phase) return;
    this.phase = ph;
    this.log.push(`${this.api.game.time.toFixed(1)} ${ph}`);
    this.api.bus.emit('worm:devour', { phase: ph });
  }

  // ---------------------------------------------------------------- подготовка
  /** opts: {teleport: безопасная точка наблюдения}. Возвращает Promise<{skipped, devoured}>. */
  play(opts = {}) {
    const { game, K } = this.api;
    if (this._active) return this.promise;
    const hv = game.harvester;
    if (!hv || game.space === 'sietch') return Promise.resolve({ skipped: true, devoured: false, reason: game.space === 'sietch' ? 'sietch' : 'no-harvester' });
    // чистая сцена: уходит отдыхающий приручённый червь, возвращается съеденный харвестер
    if (this.worm.director.active) this.worm.director.dismiss();
    if (hv.isDevoured) hv.restore();
    this.hv = hv;
    this.promise = new Promise((res) => { this.resolve = res; });
    this._active = true; this.t = 0; this.log.length = 0;
    if (hv.state !== 'running') hv.debugSet('running');
    this.hold = false; this.done = {}; this.debrisAcc = 0; this.sandAcc = 0; this.spiceAcc = 0; this.rainAcc = 0; this.breachDone = false; this.knock = 0; this.closeOpen = 0;
    this.u = 0; this.uTop = 0; this.retractAcc = 0; this.crater = 0; this.openLast = -1;

    // исходная геометрия
    const P = hv.position, h = hv.heading;
    this.f.set(Math.cos(h), 0, Math.sin(h));
    this.C0 = P.clone();
    hv.root.updateMatrixWorld(true);
    this.Lg0.copy(LUG_MID); this.Lg0.set(P.x + this.f.x * LUG_MID.x, P.y + LUG_MID.y, P.z + this.f.z * LUG_MID.x);
    // ось пасти: под носом при крайнем наклоне (нос тонет в воронке под кормовым подвесом)
    const th = T.tiltMax;
    const dx0 = NOSE_C.x - LUG_MID.x, dy0 = NOSE_C.y - LUG_MID.y;
    const hx = dx0 * Math.cos(th) + dy0 * Math.sin(th);
    this.A.set(this.Lg0.x + this.f.x * hx, 0, this.Lg0.z + this.f.z * hx);
    this.gE = this.api.ground(this.A.x, this.A.z);
    this.nyEnd = this.gE - 6;

    // игрок: безопасная точка наблюдения (по желанию) и направление червя поперёк линии взгляда
    const pl = game.player?.position;
    if (opts.teleport && game.player?.teleport) {
      const side = new THREE.Vector3(-this.f.z, 0, this.f.x);
      const sp = new THREE.Vector3(this.C0.x, 0, this.C0.z).addScaledVector(side, 240).addScaledVector(this.f, -60);
      game.player.teleport(sp.x, game.heightAt(sp.x, sp.z), sp.z, Math.atan2(this.C0.z - sp.z, this.C0.x - sp.x));
    }
    const pp = game.player?.position || this.C0;
    const los = new THREE.Vector3(this.C0.x - pp.x, 0, this.C0.z - pp.z);
    if (los.length() < 160) los.copy(this.f).multiplyScalar(-1).addScaledVector(new THREE.Vector3(-this.f.z, 0, this.f.x), 0.8);
    los.normalize();
    this.w.set(-los.z, 0, los.x);                       // червь идёт поперёк линии взгляда
    if (this.w.dot(this.f) > 0.6) this.w.negate();
    // отсечь стартовую точку от скалы/сиетча
    const S = new THREE.Vector3().copy(this.A).addScaledVector(this.w, -(T.startDist + T.arcR));
    if (S.x > 520 || S.x < -700) this.w.negate();
    this.buildPath();

    // состояния модулей
    this.worm.sensing = false;
    this.api.clearForced();
    this.api.setTame(false);
    const sp2 = this.worm.spine;
    sp2.sag = 0; sp2.sagHead = 0; sp2.spread = 1; sp2.flare = 1; sp2.headLift = 0;
    this.worm.body.setOpen(0); this.worm.body.headScale = 1;
    const p0 = this.pathAt(0);
    this.api.placeHead(p0.x, p0.z, Math.atan2(this.w.z, this.w.x), T.depth);
    K.pos.set(p0.x, p0.y, p0.z);
    this.worm.spine.reset(K.pos, this.w.x, this.w.z, this.api.ground, T.depth);
    K.scripted = true; K.speed = T.wormSpeed; K.travel = 0;
    this.api.setState('Approach');
    // раскладка времён
    this.planTimes();
    this.carryallInit();
    this.pod.state = 'roof';
    this.setPhase('wormsign');
    game.audio?.event?.('Worm.Pass', p0 ? new THREE.Vector3(p0.x, 0, p0.z) : undefined);
    return this.promise;
  }

  /** Путь головы (ломаная по 1 м): горизонтальный подход на глубине → дуга → вертикальная колонна. */
  buildPath() {
    const { ground } = this.api;
    const pts = [];
    const A = this.A, w = this.w, R = T.arcR, gE = this.gE;
    const nApp = Math.floor(T.startDist);
    for (let i = 0; i < nApp; i++) {
      const l = -(T.startDist - i) - R;
      const x = A.x + w.x * l, z = A.z + w.z * l;
      pts.push([x, ground(x, z) - T.depth, z]);
    }
    const nArc = Math.ceil(R * Math.PI / 2);
    const yApp = pts.length ? pts[pts.length - 1][1] : gE - T.depth;
    for (let i = 0; i <= nArc; i++) {
      const a = (i / nArc) * Math.PI / 2;
      const l = -R + R * Math.sin(a);
      const yArc = gE - R * Math.cos(a);
      const k = 1 - smoothstep(0, 0.35, i / nArc);        // сшивка по высоте с рельефом подхода
      pts.push([A.x + w.x * l, yArc + (yApp - (gE - R)) * k, A.z + w.z * l]);
    }
    for (let i = 1; i <= 170; i++) pts.push([A.x, gE + i, A.z]);
    this.pts = pts;
    this.uVert = nApp + nArc;         // индекс, где голова на уровне земли в оси
    this.Ltot = pts.length - 1;
  }

  pathAt(u, out = this.cs) {
    const i = clamp(Math.floor(u), 0, this.Ltot - 1), t = clamp(u - i, 0, 1);
    const a = this.pts[i], b = this.pts[i + 1];
    return out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  }

  planTimes() {
    const C = T.carryall;
    // время захода переносчика: расстояние до зависания
    this.cDist = C.spawnDist;
    const tc = (C.spawnDist - C.brake) / C.speed, td = 2 * C.brake / C.speed;
    this.tArr = tc + td;
    const tHook = this.tArr + 0.5;
    this.tHook = tHook;
    this.tLift0 = tHook + C.hookDur;
    this.tLift1 = this.tLift0 + C.liftDur;
    this.tPod = this.tLift1 - 1;
    this.tTilt0 = this.tLift1 + 1.2;
    this.tTilt1 = this.tTilt0 + T.tiltDur;
    this.tVortex0 = Math.max(this.tLift0 - 2, this.tTilt0 - T.vortexLead);
    this.tErupt = this.tTilt1 - T.eruptDelay;                // голова доходит до уровня земли
    this.tRise1 = this.tErupt + T.riseTime;
    this.tSnap = this.tRise1 + T.hangTime;
    this.tSlide1 = this.tSnap + T.slideTime;
    this.tClose0 = this.tSnap + T.closeDelay;
    this.tRetract0 = this.tClose0 + T.closeTime;
    this.tRetract1 = this.tRetract0 + T.retractTime;
    this.tAfter = this.tRetract1;
    this.tEnd = this.tAfter + T.aftermathTime;
    // скорость червя так, чтобы голова вышла в ось к tErupt
    this.vWorm = this.uVert / this.tErupt;
  }

  // ---------------------------------------------------------------- переносчик
  carryallInit() {
    const hv = this.hv, cs = hv.carryall.script, C = T.carryall;
    // заходит со стороны, поперёк червя (перпендикуляр к курсу червя, противоположный игроку)
    const side = new THREE.Vector3(-this.w.z, 0, this.w.x);
    const pp = this.api.game.player?.position;
    if (pp && side.dot(new THREE.Vector3(pp.x - this.C0.x, 0, pp.z - this.C0.z)) > 0) side.negate();
    this.cDir = side.clone().add(this.f.clone().multiplyScalar(0.5)).normalize();   // направление от харвестера К точке старта
    this.cStart = new THREE.Vector3(this.Lg0.x, 0, this.Lg0.z).addScaledVector(this.cDir, C.spawnDist);
    cs.on = true; cs.hidden = false; cs.strain = 0; cs.flap = 12;
    cs.pos.set(this.cStart.x, this.api.ground(this.cStart.x, this.cStart.z) + C.spawnAlt, this.cStart.z);
    this.cYawFlight = Math.atan2(-this.cDir.z, -this.cDir.x);
    cs.yaw = this.cYawFlight; cs.pitch = 0; cs.roll = 0;
    this.hv.carryall.group.visible = true;
    this.cEsc = null;
  }

  /** Центр переносчика над серединой кормовых захватов при подвесе (Lg — точка захватов). */
  carryallHoverPos(Lg, out) {
    const C = T.carryall;
    const cx = Lg.x + this.f.x * 2.5, cz = Lg.z + this.f.z * 2.5;
    return out.set(cx, Lg.y + C.cable + 7.8, cz);
  }

  // ---------------------------------------------------------------- цикл
  update(dt) {
    if (!this._active) return;
    const { game, K } = this.api;
    const t = (this.t += dt);
    const hv = this.hv, C = T.carryall;
    const rand = this.rand;

    // ---- тревога экипажа ----
    if (!this.done.alarm && t >= T.tAlarm) { this.done.alarm = true; hv.alarm(true); this.setPhase('alarm'); }
    if (!this.done.flare && t >= T.tFlare) { this.done.flare = true; hv.flare(); }
    if (!this.done.hold && t >= T.tAlarm + 1) { this.done.hold = true; hv.hold(true); }

    // ---- движение головы ----
    this.updateHead(dt, t);

    // ---- переносчик / харвестер ----
    this.updateCarryall(dt, t);
    this.updateHarvester(dt, t);

    // ---- воронка ----
    this.updateVortex(dt, t);

    // ---- эффекты и безопасность ----
    this.updateFx(dt, t);
    this.updateSafety(dt, t);

    this.tickAftermath(dt);
    // ---- конец ----
    if (!this.done.after && t >= this.tAfter) { this.done.after = true; this.aftermath(); }
    if (t >= this.tEnd) this.finish();
    void game; void K; void C; void rand;
  }

  updateHead(dt, t) {
    if (this.done.after) return;                       // червь уже ушёл (hideWorm): голова больше не ведётся
    const { K, game } = this.api;
    const sp = this.worm.spine, body = this.worm.body;
    let u;
    if (t < this.tErupt) u = this.vWorm * t;
    else if (t < this.tRise1) {
      const k = easeOut((t - this.tErupt) / T.riseTime);
      u = this.uVert + (T.baseHeight + 3) * k;
    } else if (t < this.tRetract0) {
      u = this.uVert + T.baseHeight + 3 + 0.8 * Math.sin((t - this.tRise1) * 1.3);        // колонна чуть покачивается
    } else {
      const k = smoothstep(this.tRetract0, this.tRetract1, t);
      u = this.uVert + T.baseHeight + 3 - (T.baseHeight + 3 + T.retractDepth) * k;
    }
    const prev = this.u;
    this.u = u;
    this.pathAt(u, this._o);
    const du = u - prev;
    if (du < -0.01) {                                   // втягивается: тело едет обратно по следу
      this.retractAcc += -du;
      if (this.retractAcc >= 1) { const n = Math.floor(this.retractAcc); sp.retract(n); this.retractAcc -= n; }
    }
    K.pos.copy(this._o);
    K.speed = Math.abs(du) / Math.max(dt, 1e-3);
    K.travel = Math.max(K.travel, u);
    const dir = this.pathAt(Math.min(u + 2, this.Ltot - 1), this._q).sub(this._o);
    if (Math.hypot(dir.x, dir.z) > 0.1) K.yaw = Math.atan2(dir.z, dir.x);
    sp.push(K.pos);
    if (!Number.isFinite(K.pos.x + K.pos.y + K.pos.z)) K.pos.set(this.A.x, this.gE - 60, this.A.z);

    // колонна: раструб шеи и раскрытие пасти
    const rise = smoothstep(this.tErupt - 0.6, this.tRise1 - 0.2, t);
    const closing = smoothstep(this.tClose0, this.tClose0 + T.closeTime, t);
    const open = (smoothstep(this.tErupt - 0.6, this.tErupt - 0.6 + T.openTime, t)) * (1 - 0.92 * closing);
    const flare = 1 + (T.flare - 1) * rise;
    sp.flare = flare; sp.flareLen = T.flareLen;
    body.headScale = lerp(1, T.flare, rise);
    if (Math.abs(open - this.openLast) > 0.015 || (open === 0 && this.openLast !== 0)) { body.setOpen(open); this.openLast = open; }
    this.openNow = open;

    // состояние для модуля (угроза, шум)
    const dPl = game.player ? Math.hypot(game.player.position.x - this.A.x, game.player.position.z - this.A.z) : 999;
    this.worm.threat = clamp(0.35 + 0.6 * (1 - dPl / 600), 0, 1);
    if (!this.breachDone && t >= this.tErupt) {
      this.breachDone = true;
      this.api.onBreach(1.25);
      this.setPhase('erupt');
      game.audio?.event?.('Worm.Roar', new THREE.Vector3(this.A.x, this.gE + 20, this.A.z));
      game.shake = Math.max(game.shake || 0, 0.9 * (1 - smoothstep(60, 520, dPl)));
      this.api.bus.emit('worm:breach', { x: this.A.x, z: this.A.z });
    }
    if (this.phase === 'erupt' && t >= this.tSnap - 1) this.setPhase('swallow');
    if (this.phase === 'swallow' && t >= this.tRetract0 - 1) this.setPhase('retreat');
  }

  updateCarryall(dt, t) {
    const hv = this.hv, car = hv.carryall, cs = car.script, C = T.carryall, ground = this.api.ground;
    const Lg = this._v;
    this.lugNow(t, Lg);
    if (this.cEsc) {                                     // уходит с капсулой
      const e = this.cEsc;
      e.t += dt;
      const sp = Math.min(C.speed * 1.15, 14 + e.t * 22);
      e.vy = Math.min(e.vy + 14 * dt, 24);
      cs.pos.x += e.dir.x * sp * dt; cs.pos.z += e.dir.z * sp * dt; cs.pos.y += e.vy * dt;
      cs.yaw = Math.atan2(e.dir.z, e.dir.x) * 0.0 + this.yawToward(cs.yaw, Math.atan2(e.dir.z, e.dir.x), dt * 1.4);
      cs.pitch = lerp(cs.pitch, -0.14, 1 - Math.exp(-dt)); cs.roll = Math.sin(t * 0.8) * 0.12;
      cs.strain = Math.max(0, cs.strain - dt * 0.5);
      cs.flap = 12 + 4 * cs.strain;
      if (Math.hypot(cs.pos.x - this.C0.x, cs.pos.z - this.C0.z) > 1100) { cs.hidden = true; cs.on = false; }
      return;
    }
    if (t < this.tArr) {                                 // заход на посадку
      const tc = (C.spawnDist - C.brake) / C.speed, td = 2 * C.brake / C.speed;
      let dist;                                          // пройдено
      if (t < tc) dist = C.speed * t; else { const x = t - tc; dist = (C.spawnDist - C.brake) + C.speed * x - 0.5 * (C.speed / td) * x * x; }
      const hov = this.carryallHoverPos(this.Lg0, this.cp);
      const k = clamp(dist / C.spawnDist, 0, 1);
      cs.pos.x = lerp(this.cStart.x, hov.x, k); cs.pos.z = lerp(this.cStart.z, hov.z, k);
      const gy = ground(cs.pos.x, cs.pos.z);
      cs.pos.y = lerp(gy + C.spawnAlt, hov.y, smoothstep(0.3, 1, k));
      const turn = smoothstep(0.7, 1, k);
      cs.yaw = this.lerpAngle(this.cYawFlight, Math.atan2(this.f.z, this.f.x), turn);
      cs.pitch = -0.08 * (1 - turn) + 0.12 * Math.sin(turn * Math.PI) * 0.6;        // сзади «отдаёт газ»: нос чуть вверх при торможении
      cs.roll = 0.05 * Math.sin(t * 0.7);
      cs.strain = 0.05; cs.flap = 12;
      this.cableVis = 0;
      return;
    }
    // зависание над харвестером: позиция над захватами
    const hov = this.carryallHoverPos(Lg, this.cp);
    cs.pos.x = hov.x + 0.6 * Math.sin(t * 0.9); cs.pos.z = hov.z + 0.5 * Math.sin(t * 0.7 + 1);
    cs.pos.y = hov.y + 0.4 * Math.sin(t * 1.3);
    cs.yaw = Math.atan2(this.f.z, this.f.x);
    const lifting = smoothstep(this.tLift0, this.tLift0 + 2, t) * (1 - smoothstep(this.tSnap - 1.5, this.tSnap, t));
    const strain = lifting * (0.35 + 0.65 * smoothstep(this.tLift0, this.tTilt1, t));
    cs.strain = strain;
    cs.pitch = 0.1 * strain + 0.03 * Math.sin(t * 3.1) * strain;
    cs.roll = 0.05 * Math.sin(t * 2.3) * strain;
    cs.flap = 12 + 6 * strain;
    // тросы
    this.cableVis = smoothstep(this.tHook - 0.5, this.tHook + C.hookDur, t);
    this.cableTension = lerp(0.35, 1, smoothstep(this.tHook + C.hookDur - 0.3, this.tLift0 + 2, t));
    this.cableVib = 0.25 + 2.2 * strain * (0.5 + 0.5 * smoothstep(this.tTilt0, this.tSnap - 1, t));
    // обрыв тросов — переносчик освобождается рывком вверх/в сторону
    if (!this.done.snap && t >= this.tSnap) {
      this.done.snap = true;
      this.cableVis = 0;
      const away = new THREE.Vector3(-this.w.z, 0, this.w.x); if (away.dot(this.cDir) < 0) away.negate();
      this.cEsc = { t: 0, vy: 12, dir: away.add(this.cDir.clone().multiplyScalar(0.6)).normalize() };
      this.setPhase('swallow');
      this.api.game.audio?.event?.('Worm.RingSandfall', hv.carryall.group.position.clone());
      this.snapFx();
    }
  }

  yawToward(cur, target, k) { let d = target - cur; d = Math.atan2(Math.sin(d), Math.cos(d)); return cur + d * clamp(k, 0, 1); }
  lerpAngle(a, b, k) { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; }

  /** Точка кормовых захватов (мир) в момент t: подъём → наклон носом вниз → скольжение в пасть. */
  lugNow(t, out) {
    const C = T.carryall;
    const lift = C.lift * smoothstep(this.tLift0, this.tLift1, t);
    const tilt = smoothstep(this.tTilt0, this.tTilt1, t);
    const th = T.tiltMax * tilt;
    // нос должен опуститься к nyEnd: захваты поднимаются по мере наклона
    const nyStart = this.C0.y + lift + NOSE_C.y;
    const ny = lerp(nyStart, this.nyEnd, tilt);
    const ly = ny + (NOSE_C.x - LUG_MID.x) * Math.sin(th) + (LUG_MID.y - NOSE_C.y) * Math.cos(th);
    // скольжение после обрыва
    this.theta = th;
    return out.set(this.Lg0.x, ly, this.Lg0.z);
  }

  updateHarvester(dt, t) {
    const hv = this.hv, car = hv.carryall, C = T.carryall;
    // колайдеры: с начала наклона харвестер «не твёрдый» (поза не совпадает с боксами); игрок в безопасности по радиусу
    if (!this.done.colOff && t >= this.tTilt0 - 0.5) { this.done.colOff = true; hv.setCollidersEnabled(false); }
    if (t < this.tLift0) { hv.setLift(0); return; }
    if (t < this.tTilt0 - 0.2 && !hv.scripted) {
      const lift = C.lift * smoothstep(this.tLift0, this.tLift1, t) + 0.12 * Math.sin(t * 2.2) * smoothstep(this.tLift0, this.tLift0 + 3, t);
      hv.setLift(lift);
      return;
    }
    // сценарная поза: подвес за корму, наклон носом вниз; после обрыва — скольжение вдоль оси в пасть
    const Lg = this._o;
    this.lugNow(Math.min(t, this.tSnap), Lg);
    let th = this.theta;
    const cosT = Math.cos(th), sinT = Math.sin(th);
    // начало координат модели: Lg - R * LUG_MID
    let ox = LUG_MID.x * cosT + LUG_MID.y * sinT, oy = -LUG_MID.x * sinT + LUG_MID.y * cosT;
    const fx = this.f.x, fz = this.f.z;
    let px = Lg.x - ox * fx, py = Lg.y - oy, pz = Lg.z - ox * fz;
    let roll = 0.025 * Math.sin(t * 1.6) * (1 - smoothstep(this.tSnap - 1, this.tSnap, t));
    if (t > this.tSnap) {
      const s = t - this.tSnap;
      // свободное падение вдоль оси + дальнейший наклон к вертикали (нос ведёт)
      th = Math.min(T.tiltMax + 0.3 * smoothstep(0, 2.5, s), 1.45);
      const d = 0.5 * T.slideAccel * s * s;
      const axis = this._q.set(Math.cos(th) * fx, -Math.sin(th), Math.cos(th) * fz);
      // после обрыва положение начала координат — от момента обрыва, затем вдоль оси; осевая точка смещается к оси пасти
      const cs0 = Math.cos(T.tiltMax), sn0 = Math.sin(T.tiltMax);
      const o0x = LUG_MID.x * cs0 + LUG_MID.y * sn0, o0y = -LUG_MID.x * sn0 + LUG_MID.y * cs0;
      const lg = this.lugAtSnap || (this.lugAtSnap = new THREE.Vector3(this.Lg0.x, this.lugNow(this.tSnap, new THREE.Vector3()).y, this.Lg0.z));
      const bx = lg.x - o0x * fx, by = lg.y - o0y, bz = lg.z - o0x * fz;
      px = bx + axis.x * d; py = by + axis.y * d; pz = bz + axis.z * d;
      // подтянуть нос к оси пасти (в плане)
      const nh = NOSE_C.x * Math.cos(th) + NOSE_C.y * Math.sin(th);
      const noseX = px + nh * fx, noseZ = pz + nh * fz;
      const pull = smoothstep(0, 2, s);
      px += (this.A.x - noseX) * pull * 0.6; pz += (this.A.z - noseZ) * pull * 0.6;
      roll *= 0;
    }
    hv.script({ x: px, y: py, z: pz, pitch: th, roll });
    if (t > this.tSnap + 1 && !this.done.sinkChk) {
      // съедено, когда вся модель ниже уровня земли
      // (проверяем верхнюю корму: локально (-55, 35, 0))
    }
    if (!this.done.devoured) {
      const tail = hv.toWorld(-56, 36, 0, this._q);
      if (t > this.tSnap + 1.5 && tail.y < this.gE + 2) {
        this.done.devoured = true;
        hv.setState('devoured');
        hv.setCollidersEnabled(false);
        this.hv.script(null);
      }
    }
  }

  updateVortex(dt, t) {
    const v = this.vortex;
    const k = smoothstep(this.tVortex0, this.tVortex0 + T.vortexRamp, t);
    if (this.phase === 'aftermath' || this.crater > 0) {
      v.update(this.A.x, this.A.z, { k: 1, spin: this.spin || 0, hole: T.holeR * (1 - 0.3 * this.crater), rimH: lerp(T.rimH, 1.6, this.crater), R: T.vortexR * lerp(1, 0.7, this.crater), crater: this.crater });
      return;
    }
    if (k <= 0.005) { v.mesh.visible = false; return; }
    this.spin = (this.spin || 0) + dt * (0.5 + 2.2 * k);
    // зев растёт, когда голова подходит; после раскрытия пасти вихрь затихает под колонной
    const grow = 0.55 + 0.45 * smoothstep(this.tTilt0, this.tErupt, t);
    v.update(this.A.x, this.A.z, { k, spin: this.spin, hole: T.holeR * grow, rimH: T.rimH * k, R: T.vortexR, crater: 0 });
  }

  // ---------------------------------------------------------------- эффекты
  updateFx(dt, t) {
    const { game, ground } = this.api;
    const fx = this.worm.fx, hv = this.hv, rand = this.rand;
    const qf = fx.k;
    const cam = game.camera.position;
    const gE = this.gE, A = this.A;
    const active = t >= this.tErupt - 1;
    // тремор: растёт с приближением волны, по расстоянию до игрока
    const pp = game.player?.position;
    const dPl = pp ? Math.hypot(pp.x - A.x, pp.z - A.z) : 999;
    const headD = pp ? Math.hypot(pp.x - this.pathAt(this.u, this._q).x, pp.z - this._q.z) : 999;
    const near = 1 - smoothstep(60, 600, Math.min(dPl, headD));
    const amp = 0.03 + 0.28 * smoothstep(8, this.tErupt, t) + (t > this.tErupt && t < this.tRetract1 ? 0.35 : 0);
    if (t > 6 && t < this.tRetract1 + 2) game.shake = Math.max(game.shake || 0, clamp(amp * near * near, 0, 1));
    void cam;

    // песчаный фонтан и пряная пыль вокруг колонны
    if (active && t < this.tRetract1) {
      const rad = RADIUS * (1 + (T.flare - 1) * 0.6);
      this.sandAcc += dt * T.sandRate * qf * (t < this.tRise1 + 2 ? 1.6 : 0.8);
      while (this.sandAcc >= 1) {
        this.sandAcc -= 1;
        const a = rand() * 6.2832, r = rad * (0.6 + rand() * 0.9);
        const sp = 8 + rand() * 22, up = 18 + rand() * 50;
        fx.sand.emit(A.x + Math.cos(a) * r, gE + 1, A.z + Math.sin(a) * r, Math.cos(a) * sp, up, Math.sin(a) * sp, game.time + rand() * 0.2, 3 + rand() * 4, 0.4 + rand() * rand() * 1.5, rand(), 2, gE - 2, 0.1, 1.2 + rand() * 2.4);
      }
      this.spiceAcc += dt * T.spiceRate * qf * (this.phase === 'swallow' || this.phase === 'retreat' ? 1.4 : 0.6);
      while (this.spiceAcc >= 1) {
        this.spiceAcc -= 1;
        const a = rand() * 6.2832, r = rad * (0.4 + rand() * 1.1), h = gE + 4 + rand() * 40;
        hv.particles.emit(0, A.x + Math.cos(a) * r, h, A.z + Math.sin(a) * r, Math.cos(a) * (2 + rand() * 6), 3 + rand() * 6, Math.sin(a) * (2 + rand() * 6), 7 + rand() * 6, 10 + rand() * 12, 0.22, 3.6, { wind: 1.2, buoy: 1.6, drag: 0.3 });
      }
      // пыль из пасти (широкие облака)
      if (rand() < dt * 3.5 * qf) fx.puff(A.x + (rand() - 0.5) * 60, gE + 2 + rand() * 12, A.z + (rand() - 0.5) * 60, 0.9, 'wide');
    }
    // песчаный дождь и стена пыли в радиусе 170 м от оси
    if (active && t < this.tRetract1 + 2) {
      this.rainAcc += dt * T.rainRate * qf;
      while (this.rainAcc >= 1) {
        this.rainAcc -= 1;
        const a = rand() * 6.2832, r = Math.sqrt(rand()) * 170;
        const x = A.x + Math.cos(a) * r, z = A.z + Math.sin(a) * r, gy = ground(x, z);
        fx.sand.emit(x, gy + 70 + rand() * 60, z, (rand() - 0.5) * 3, -10 - rand() * 14, (rand() - 0.5) * 3, game.time, 6, 0.5 + rand() * 0.8, rand(), 2, gy - 1, 0.05, 0.4);
      }
    }
    // втягивание песка в воронку: поток частиц по спирали внутрь
    if (t >= this.tVortex0 && t < this.tErupt + 2) {
      this.flowAcc = (this.flowAcc || 0) + dt * 120 * qf * smoothstep(this.tVortex0, this.tVortex0 + 6, t);
      while (this.flowAcc >= 1) {
        this.flowAcc -= 1;
        const a = rand() * 6.2832, r = 35 + rand() * 70, gy = ground(A.x + Math.cos(a) * r, A.z + Math.sin(a) * r);
        const sp = 7 + rand() * 9;
        fx.sand.emit(A.x + Math.cos(a) * r, gy + 0.6, A.z + Math.sin(a) * r, -Math.cos(a) * sp - Math.sin(a) * sp * 0.8, 1.4 + rand() * 2.5, -Math.sin(a) * sp + Math.cos(a) * sp * 0.8, game.time, 2 + rand() * 1.6, 0.35 + rand() * 0.6, rand(), 2, gy - 0.5, 0.5, 1.5);
      }
    }
    // обломки харвестера
    if (t >= this.tTilt0 + 1.5 && t < this.tSlide1 + 1) {
      this.debrisAcc += dt * T.debrisPerSec * (t > this.tErupt ? 2.2 : 0.8) * (0.5 + 0.5 * qf);
      while (this.debrisAcc >= 1) {
        this.debrisAcc -= 1;
        if (!hv.root.visible && !hv.scripted) break;
        const lx = -50 + rand() * 100, ly = 4 + rand() * 30, lz = (rand() - 0.5) * 40;
        const p = hv.toWorld(lx, ly, lz, this._q);
        const a = rand() * 6.2832, sp = 5 + rand() * 16;
        hv.wreck.spawn(p.x, p.y, p.z, Math.cos(a) * sp, 6 + rand() * 20, Math.sin(a) * sp, 0.8 + rand() * 2.8, Math.floor(rand() * 3));
      }
    }
    // пыль и искры на теле харвестера при трении о пасть
    if (t > this.tErupt && t < this.tSlide1 && hv.scripted && rand() < dt * 6 * qf) {
      const p = hv.toWorld(-45 + rand() * 90, 10 + rand() * 25, (rand() - 0.5) * 36, this._q);
      fx.puff(p.x, p.y, p.z, 0.4);
    }
  }

  snapFx() {
    const fx = this.worm.fx, hv = this.hv, rand = this.rand;
    hv.hookPoints();
    for (let i = 0; i < 4; i++) {
      const p = hv.hookPoints()[i];
      fx.puff(p.x, p.y, p.z, 0.6);
      for (let k = 0; k < 10; k++) hv.wreck.spawn(p.x, p.y, p.z, (rand() - 0.5) * 24, 6 + rand() * 14, (rand() - 0.5) * 24, 0.5 + rand(), 0);
    }
  }

  /** Игрок вне опасной зоны; если внутри — удар песка мягко выносит наружу. */
  updateSafety(dt, t) {
    const { game } = this.api;
    const pl = game.player?.position;
    if (!pl || t < this.tErupt - 3 || t > this.tRetract1 + 2) return;
    const dx = pl.x - this.A.x, dz = pl.z - this.A.z, d = Math.hypot(dx, dz);
    if (d < T.safeRadius) {
      const k = 1 - d / T.safeRadius;
      const push = T.knockSpeed * (0.35 + 0.65 * k) * dt;
      const nx = d > 0.5 ? dx / d : 1, nz = d > 0.5 ? dz / d : 0;
      pl.x += nx * push; pl.z += nz * push;
      game.shake = Math.max(game.shake || 0, 0.5 * k);
    }
  }

  lateUpdate() {
    if (!this._active) return;
    const hv = this.hv, car = hv.carryall, t = this.t;
    // тросы и капсула: после того как харвестер и переносчик обновили свои позы
    if (this.cableVis > 0.01 && !this.cEsc) {
      const B = hv.hookPoints(this.hookPts);
      const out = this._o2 || (this._o2 = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
      for (let i = 0; i < 4; i++) out[i].lerpVectors(car.lugWorld[i], B[i], this.cableVis);
      car.setCables(out, this.cableTension, this.cableVib * (this.cableVis > 0.99 ? 1 : 0.3), t);
    } else car.setCables(null);
    this.updatePod(this.api.game.dt || 0.016, t);
  }

  updatePod(dt, t) {
    const hv = this.hv, car = hv.carryall, pod = this.pod, C = T.carryall;
    if (car.script.hidden) { car.setPod(pod.pos, 0, false); return; }
    if (t < this.tPod) { pod.pos.copy(hv.toWorld(26, 37.2, 0, this._v)); car.setPod(pod.pos, Math.atan2(this.f.z, this.f.x), !hv.isDevoured || !!this.cEsc); if (hv.scripted) pod.state = 'off'; return; }
    const belly = this._v2 || (this._v2 = new THREE.Vector3());
    belly.set(car.lugWorld[0].x * 0.25 + car.lugWorld[1].x * 0.25 + car.lugWorld[2].x * 0.25 + car.lugWorld[3].x * 0.25, 0, car.lugWorld[0].z * 0.25 + car.lugWorld[1].z * 0.25 + car.lugWorld[2].z * 0.25 + car.lugWorld[3].z * 0.25);
    belly.y = (car.lugWorld[0].y + car.lugWorld[2].y) * 0.5 - 3.0;
    if (pod.state === 'roof' || pod.state === 'off') {
      if (pod.state === 'off') { return; }
      pod.state = 'fly'; pod.t = 0; pod.from.copy(hv.toWorld(26, 37.2, 0, this._o));
      this.api.game.audio?.event?.('Worm.RingSandfall', pod.from.clone());
    }
    if (pod.state === 'fly') {
      pod.t += dt;
      const k = clamp(pod.t / C.podDur, 0, 1), e = k * k * (3 - 2 * k);
      pod.pos.lerpVectors(pod.from, belly, e);
      pod.pos.x += Math.sin(k * 3.14) * 6; pod.pos.z += Math.cos(k * 3) * 3;
      car.setPod(pod.pos, Math.atan2(this.f.z, this.f.x), true, -0.4 * (1 - k) + 0.1);
      // выхлоп капсулы
      if (this.rand() < 0.9) hv.particles.emit(2, pod.pos.x, pod.pos.y - 1, pod.pos.z, 0, -3, 0, 3 + this.rand() * 2, 1.2 + this.rand(), 0.5, 4, { wind: 1, buoy: 0.2, drag: 0.8 });
      if (k >= 1) { pod.state = 'docked'; this.setPhase('carryall-pod'); }
    } else if (pod.state === 'docked') {
      pod.pos.copy(belly);
      car.setPod(pod.pos, car.script.yaw, true, 0);
    }
  }

  aftermath() {
    this.setPhase('aftermath');
    const { game } = this.api;
    this.worm.body.setOpen(0); this.worm.body.headScale = 1;
    this.worm.spine.flare = 1;
    this.hv.alarm(false);
    this.hv.stain.show(this.A.x, this.A.z, 46, 1);
    game.world?.addFootprint?.(this.A.x, this.A.z, 0, { type: 'crater', size: 46 });
    game.audio?.event?.('Worm.RingSandfall', new THREE.Vector3(this.A.x, this.gE, this.A.z));
    this.crater = 0.001;
    this.hideWorm();
  }

  hideWorm() {
    const { K } = this.api;
    this.worm.spine.flare = 1; this.worm.body.headScale = 1;
    K.scripted = false;
    this.api.hardDormant(true);
  }

  /** Затухание воронки в кратер после ухода червя (вызывается из цикла). */
  tickAftermath(dt) {
    if (this.crater > 0 && this.crater < 1) this.crater = Math.min(1, this.crater + dt / 6);
  }

  finish(skipped = false) {
    if (!this._active) return;
    const { bus, K } = this.api;
    this._active = false;
    this.hv.hold(false);
    this.hv.alarm(false);
    this.hv.setCollidersEnabled(!this.hv.isDevoured);
    this.hv.carryall.setCables(null);
    if (!this.hv.isDevoured) { this.hv.script(null); this.hv.carryall.script.on = false; }
    K.scripted = false;
    this.worm.sensing = true;
    this.crater = Math.max(this.crater, 1);
    this.updateVortex(0, this.t);
    this.setPhase('end');
    bus.emit('worm:devour', { phase: 'done' });
    this.phase = 'none';
    const res = this.resolve; this.resolve = null;
    res?.({ skipped, devoured: this.hv.isDevoured });
  }

  cancel() { if (this._active) { this.hideWorm(); this.finish(true); } }
}
