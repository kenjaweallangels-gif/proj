// Сценарий «Червь пожирает харвестер» (постановка в духе фильма Вильнёва) — РЕАЛЬНОЕ ВРЕМЯ, управление игроком не отбирается, камера не отбирается
// (для наблюдения доступна свободная камера game.freecam, клавиша F; сцена регистрируется в ней как 'devour').
//
// Хронология (секунды от старта, числа — в DEVOUR_TUNING):
//   wormsign   далёкая песчаная волна идёт к харвестеру; ритмичная дрожь: песок «пляшет» на корпусе и вокруг, корпус вибрирует
//   alarm      клаксон и мигающие лучи экипажа, сигнальная ракета, харвестер встаёт
//   carryall   переносчик снижается, экипаж эвакуируется в капсуле; тросы цепляются, переносчик пробует поднять машину (тросы струной)
//   vortex     песок вокруг харвестера превращается в ТОНУЩУЮ ВОРОНКУ (вращающиеся гребни, тёмный зев); тросы рвутся, переносчик уходит с капсулой;
//              харвестер кренится носом вниз и сползает в воронку
//   erupt      пасть червя поднимается ИЗ-ПОД песка кольцом вокруг харвестера: сначала край кольца губ (песок стекает с обода), затем губы расходятся
//              диафрагмой, открывая кольца крючковатых клыков; в рельефе открывается «окно» в глотку (hole.js)
//   swallow    харвестер, сползая, уходит в круглую пасть сквозь ряды клыков (обломки, пряная пыль, песчаные каскады с зубов)
//   retreat    пасть смыкается куполом, колонна втягивается под песок; воронка схлопывается
//   aftermath  кратер, обломки, пятно пряности, долго висящая пыль
// События шины: 'worm:devour' {phase}. Promise playDevour() выполняется в конце ('aftermath' → 'end').
// Физическая согласованность: тело червя и корпус харвестера пересекаются только на время проглатывания (коллайдеры харвестера выключены).
import * as THREE from 'three';
import { clamp, lerp, smoothstep, rng } from '../core/util.js';
import { colliders } from '../core/colliders.js';
import { RADIUS } from './spine.js';
import { Vortex } from './vortex.js';
import { installTerrainHole } from './hole.js';
import { HEAD_LEN } from './maw.js';

/** Все числа сценария: время, геометрия, силы эффектов. */
export const DEVOUR_TUNING = {
  autoAfter: 0,                 // с работы харвестера до автозапуска (0 — выключено; кнопка меню / debug)
  startDist: 760, wormSpeed: 26, depth: 62, arcR: 62,
  tAlarm: 3.5, tFlare: 6.5, hold: 4.5,
  carryall: { spawnDist: 900, spawnAlt: 120, speed: 62, brake: 190, cable: 50, lift: 3.2, hookDur: 2.2, liftTry: 6.5, pod: 4.5, podDur: 3.4 },
  vortexLead: 0.5, vortexRamp: 11, holeR: 30, rimH: 3.2, vortexR: 135,
  tiltDur: 8, tiltMax: 1.36,    // рад (≈78° носом вниз): харвестер сползает в воронку и встаёт почти вертикально
  noseAdvance: 8,               // м: ось пасти впереди носа харвестера
  eruptDelay: 1.4, riseTime: 4.6, headRise: 12, flare: 2.3, flareLen: 150, bodyScale: 1.5,   // bodyScale: радиус тела ×1.5 (Ø 60 м) — тело за пастью (Ø 92 м) того же гигантского масштаба, а не тонкая шея
   openDelay: 0.9, openTime: 3.4,
  slideDelay: 2.4, slideTime: 7.5, slideAccel: 7, closeDelay: 8.5, closeTime: 2.8,
  retractTime: 11, retractDepth: 40,
  aftermathTime: 24, safeRadius: 120, knockSpeed: 22,
  debrisPerSec: 9, spiceRate: 60, sandRate: 110, rainRate: 70, rimSandRate: 260,
};

const T = DEVOUR_TUNING;
const LUG_MID = new THREE.Vector3(-26.5, 34.9, 0);    // середина кормовых захватов (локально)
const NOSE_C = new THREE.Vector3(58, 17.7, 0);        // центр носа (ковш) на осевой линии корпуса (локально)
const easeOut = (x) => 1 - (1 - clamp(x, 0, 1)) ** 2;
const RIM_Z = HEAD_LEN * 0.52;                        // высота гребня губ над основанием головы (м при масштабе 1)

export class DevourDirector {
  constructor(api, worm) {
    this.api = api; this.worm = worm;
    this._active = false; this.phase = 'none'; this.t = 0;
    this.promise = null; this.resolve = null;
    this.rand = rng(4711);
    const { game, scene, ground } = api;
    this.vortex = new Vortex(ground, '#c8a672', game.settings?.quality || 'med');
    scene.add(this.vortex.mesh);
    this.terrainHole = installTerrainHole(scene);
    this.log = [];
    this.A = new THREE.Vector3(); this.Lg0 = new THREE.Vector3(); this.f = new THREE.Vector3(1, 0, 0);
    this.w = new THREE.Vector3(1, 0, 0);
    this.cp = new THREE.Vector3(); this.cs = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._q = new THREE.Vector3(); this._o = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this.hookPts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this._cab = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.cableVis = 0; this.cableTension = 1; this.cableVib = 0;
    this.pod = { state: 'roof', t: 0, from: new THREE.Vector3(), pos: new THREE.Vector3() };
    this.crater = 0; this.vAcc = 0;
    this.holeR = 0;
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
    game.freecam?.setScene('devour', true);              // раньше dismiss(): камера, уже летящая в сцене «Встреча», не должна возвращаться сама
    if (this.worm.director.active) this.worm.director.dismiss();
    if (hv.isDevoured) hv.restore();
    this.hv = hv;
    this.promise = new Promise((res) => { this.resolve = res; });
    this._active = true; this.t = 0; this.log.length = 0;
    if (hv.state !== 'running') hv.debugSet('running');
    this.done = {}; this.debrisAcc = 0; this.sandAcc = 0; this.spiceAcc = 0; this.rainAcc = 0; this.breachDone = false; this.closeOpen = 0;
    this.u = 0; this.retractAcc = 0; this.crater = 0; this.openLast = -1; this.holeR = 0; this.pulseAcc = 0; this.rimAcc = 0; this.dustAcc = 0;
    this.vAcc = 0; this.spin = 0; this.flowAcc = 0; this.craterDrawn = false; this.forceVortex = false;
    this.terrainHole.clear();

    // исходная геометрия
    const P = hv.position, h = hv.heading;
    this.f.set(Math.cos(h), 0, Math.sin(h));
    this.C0 = P.clone();
    hv.root.updateMatrixWorld(true);
    this.Lg0.set(P.x + this.f.x * LUG_MID.x, P.y + LUG_MID.y, P.z + this.f.z * LUG_MID.x);
    // ось пасти: чуть впереди носа харвестера (там он и уйдёт вниз)
    const reach = NOSE_C.x + T.noseAdvance;
    this.A.set(P.x + this.f.x * reach, 0, P.z + this.f.z * reach);
    this.gE = this.api.ground(this.A.x, this.A.z);
    this.nyEnd = this.gE - 8;

    // игрок: безопасная точка наблюдения (по желанию) и направление червя поперёк линии взгляда
    if (opts.teleport && game.player?.teleport) {
      const side = new THREE.Vector3(-this.f.z, 0, this.f.x);
      const sp = new THREE.Vector3(this.C0.x, 0, this.C0.z).addScaledVector(side, 240).addScaledVector(this.f, -60);
      game.player.teleport(sp.x, game.heightAt(sp.x, sp.z), sp.z, Math.atan2(this.C0.z - sp.z, this.C0.x - sp.x));
    }
    const pp = game.player?.position || this.C0;
    const los = new THREE.Vector3(this.C0.x - pp.x, 0, this.C0.z - pp.z);
    const far = los.length() >= 160;
    if (!far) los.copy(this.f).multiplyScalar(-1).addScaledVector(new THREE.Vector3(-this.f.z, 0, this.f.x), 0.8);
    los.normalize();
    // волна приходит из-за харвестера под ~40° к линии взгляда игрока (видна на горизонте и идёт через кадр к машине); сторону выбираем так, чтобы старт был в эрге
    const perp = new THREE.Vector3(-los.z, 0, los.x);
    let best = null;
    for (const sgn of [1, -1]) {
      const back = los.clone().multiplyScalar(Math.cos(0.7)).addScaledVector(perp, Math.sin(0.7) * sgn);   // от харвестера к старту червя
      const S = new THREE.Vector3().copy(this.A).addScaledVector(back, T.startDist + T.arcR);
      const ok = S.x < 520 && S.x > -700 && Math.hypot(S.x - 700, S.z - 270) > 260;
      if (!best || (ok && !best.ok)) best = { back, ok };
    }
    this.w.copy(best.back).negate();                      // курс червя: от старта к харвестеру
    this.buildPath();

    // состояния модулей
    this.worm.sensing = false;
    this.api.clearForced();
    this.api.setTame(false);
    const sp2 = this.worm.spine;
    sp2.sag = 0; sp2.sagHead = 0; sp2.spread = T.bodyScale; sp2.flare = 1; sp2.headLift = 0;
    this.worm.body.setOpen(0); this.worm.body.headScale = T.bodyScale;
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
    this.uVert = nApp + nArc;         // индекс, где основание головы на уровне земли в оси
    this.Ltot = pts.length - 1;
  }

  pathAt(u, out = this.cs) {
    const i = clamp(Math.floor(u), 0, this.Ltot - 1), t = clamp(u - i, 0, 1);
    const a = this.pts[i], b = this.pts[i + 1];
    return out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  }

  planTimes() {
    const C = T.carryall;
    const tc = (C.spawnDist - C.brake) / C.speed, td = 2 * C.brake / C.speed;
    this.tArr = tc + td;                                     // переносчик завис над харвестером
    this.tHook = this.tArr + 0.4;
    this.tPod = this.tHook + 0.3;                            // экипаж эвакуируется в капсулу
    this.tLift0 = this.tHook + C.hookDur;                    // тросы натянуты, переносчик пробует поднять машину
    this.tLift1 = this.tLift0 + 4;
    this.tVortex0 = this.tLift0 + T.vortexLead;
    this.tRel = this.tLift0 + C.liftTry;                     // тросы рвутся/сброшены, переносчик уходит
    this.tTilt0 = this.tRel; this.tTilt1 = this.tTilt0 + T.tiltDur;
    this.tErupt = this.tTilt1 - T.eruptDelay;                // кольцо губ доходит до уровня земли
    this.tRise1 = this.tErupt + T.riseTime;
    this.tSnap = this.tErupt + T.slideDelay;                 // харвестер начинает падать в пасть (имя сохранено для тестов)
    this.tSlide1 = this.tSnap + T.slideTime;
    this.tClose0 = this.tSnap + T.closeDelay;
    this.tRetract0 = this.tClose0 + T.closeTime;
    this.tRetract1 = this.tRetract0 + T.retractTime;
    this.tAfter = this.tRetract1;
    this.tEnd = this.tAfter + T.aftermathTime;
    // скорость червя: основание головы доходит до (уровень земли − RIM_Z·раструб) к tErupt, т. е. гребень кольца — на уровне земли
    this.vWorm = (this.uVert - this.rimBelow()) / this.tErupt;
  }

  /** На сколько метров ниже земли основание головы, когда гребень кольца ещё на уровне земли. */
  rimBelow() { return RIM_Z * T.flare; }

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
    const t = (this.t += dt);
    const hv = this.hv;

    // ---- тревога экипажа ----
    if (!this.done.alarm && t >= T.tAlarm) { this.done.alarm = true; hv.alarm(true); this.setPhase('alarm'); }
    if (!this.done.flare && t >= T.tFlare) { this.done.flare = true; hv.flare(); }
    if (!this.done.hold && t >= T.tAlarm + 1) { this.done.hold = true; hv.hold(true); }

    if (!this.done.vortex && t >= this.tVortex0) { this.done.vortex = true; this.setPhase('vortex'); }
    this.updateHead(dt, t);
    this.updateCarryall(dt, t);
    this.updateHarvester(dt, t);
    this.updateVortex(dt, t);
    this.updateFx(dt, t);
    this.updateSafety(dt, t);

    this.tickAftermath(dt);
    if (!this.done.after && t >= this.tAfter) { this.done.after = true; this.aftermath(); }
    if (t >= this.tEnd) this.finish();
  }

  /** Положение основания головы по пути: подход → дуга → колонна; кольцо губ над ним на RIM_Z·масштаб. */
  headU(t) {
    const rb = this.rimBelow();
    const top = this.uVert + T.headRise;
    if (t < this.tErupt) return this.vWorm * t;
    if (t < this.tRise1) {
      const k = easeOut((t - this.tErupt) / T.riseTime);
      return this.uVert - rb + (top - (this.uVert - rb)) * k;
    }
    if (t < this.tRetract0) return top + 0.7 * Math.sin((t - this.tRise1) * 1.2) * smoothstep(this.tRise1, this.tRise1 + 2, t);   // колонна чуть покачивается
    const k = smoothstep(this.tRetract0, this.tRetract1, t);
    return top - (T.headRise + T.retractDepth + rb) * k;
  }

  updateHead(dt, t) {
    if (this.done.after) return;                       // червь уже ушёл (hideWorm): голова больше не ведётся
    const { K, game } = this.api;
    const sp = this.worm.spine, body = this.worm.body;
    const u = this.headU(t);
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

    // колонна: раструб шеи, раскрытие пасти (диафрагма губ)
    const rise = smoothstep(this.tErupt - 1.5, this.tRise1 - 0.2, t);
    const closing = smoothstep(this.tClose0, this.tClose0 + T.closeTime, t);
    const open = smoothstep(this.tErupt + T.openDelay, this.tErupt + T.openDelay + T.openTime, t) * (1 - 0.97 * closing);
    const flare = 1 + (T.flare / T.bodyScale - 1) * rise;     // шея раздаётся от радиуса тела (×bodyScale) до радиуса пасти (×flare)
    sp.flare = flare; sp.flareLen = T.flareLen; sp.spread = T.bodyScale;
    body.headScale = lerp(T.bodyScale, T.flare, rise);
    if (Math.abs(open - this.openLast) > 0.012 || (open === 0 && this.openLast !== 0)) { body.setOpen(open); this.openLast = open; }
    this.openNow = open;

    // состояние для модуля (угроза, шум): гул растёт только вблизи
    const dPl = game.player ? Math.hypot(game.player.position.x - this.A.x, game.player.position.z - this.A.z) : 999;
    this.worm.threat = clamp((0.15 + 0.45 * smoothstep(0, this.tErupt, t)) * (1 - smoothstep(160, 560, dPl)), 0, 1);
    if (!this.breachDone && t >= this.tErupt) {
      this.breachDone = true;
      this.api.onBreach(1.25);
      this.setPhase('erupt');
      game.audio?.event?.('Worm.Roar', new THREE.Vector3(this.A.x, this.gE + 20, this.A.z));
      game.shake = Math.max(game.shake || 0, 0.9 * (1 - smoothstep(60, 420, dPl)));
      this.api.bus.emit('worm:breach', { x: this.A.x, z: this.A.z });
    }
    if (this.phase === 'erupt' && t >= this.tSnap - 0.5) this.setPhase('swallow');
    if (this.phase === 'swallow' && t >= this.tRetract0 - 1) this.setPhase('retreat');

    // окно в рельефе: внутри ствола головы (на уровне земли радиус внутренней стенки воронки)
    this.updateHole(t);
  }

  updateHole(t) {
    const body = this.worm.body, K = this.api.K;
    const hs = body.headScale;
    let r = 0;
    if (t >= this.tErupt - 1 && t < this.tRetract0 + 2) {
      const zl = (this.gE - K.pos.y) / Math.max(hs, 1e-3);          // уровень земли в локальных координатах головы
      if (body.open > 0.04 && zl < RIM_Z + 4) r = Math.max(0, body.maw.holeRadius(Math.min(zl, 0.4)) * hs - 1.5) * smoothstep(0.04, 0.2, body.open);
    }
    this.holeR = Number.isFinite(r) ? r : 0;
    this.terrainHole.set(this.A.x, this.A.z, this.holeR);
  }

  /** Точка кормовых захватов (мир): подъём на тросах до обрыва. */
  lugNow(t, out) {
    const C = T.carryall;
    const lift = C.lift * smoothstep(this.tLift0, this.tLift1, Math.min(t, this.tRel));
    return out.set(this.Lg0.x, this.Lg0.y + lift, this.Lg0.z);
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
      cs.yaw = this.yawToward(cs.yaw, Math.atan2(e.dir.z, e.dir.x), dt * 1.4);
      cs.pitch = lerp(cs.pitch, -0.14, 1 - Math.exp(-dt)); cs.roll = Math.sin(t * 0.8) * 0.12;
      cs.strain = Math.max(0, cs.strain - dt * 0.5);
      cs.flap = 12 + 4 * cs.strain;
      if (Math.hypot(cs.pos.x - this.C0.x, cs.pos.z - this.C0.z) > 1100) { cs.hidden = true; cs.on = false; }
      return;
    }
    if (t < this.tArr) {                                 // заход на посадку: снижается к харвестеру
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
      cs.pitch = -0.08 * (1 - turn) + 0.12 * Math.sin(turn * Math.PI) * 0.6;
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
    const lifting = smoothstep(this.tLift0, this.tLift0 + 1.5, t);
    const strain = lifting * (0.4 + 0.6 * smoothstep(this.tLift0, this.tRel, t));
    cs.strain = strain;
    cs.pitch = 0.1 * strain + 0.03 * Math.sin(t * 3.1) * strain;
    cs.roll = 0.05 * Math.sin(t * 2.3) * strain;
    cs.flap = 12 + 6 * strain;
    // тросы
    this.cableVis = smoothstep(this.tHook - 0.5, this.tHook + C.hookDur, t);
    this.cableTension = lerp(0.35, 1, smoothstep(this.tHook + C.hookDur - 0.3, this.tLift0 + 2, t));
    this.cableVib = 0.25 + 2.2 * strain;
    // обрыв тросов — переносчик освобождается рывком вверх/в сторону
    if (!this.done.snap && t >= this.tRel) {
      this.done.snap = true;
      this.cableVis = 0;
      const away = new THREE.Vector3(-this.w.z, 0, this.w.x); if (away.dot(this.cDir) < 0) away.negate();
      this.cEsc = { t: 0, vy: 12, dir: away.add(this.cDir.clone().multiplyScalar(0.6)).normalize() };
      this.api.game.audio?.event?.('Worm.RingSandfall', hv.carryall.group.position.clone());
      this.snapFx();
    }
  }

  yawToward(cur, target, k) { let d = target - cur; d = Math.atan2(Math.sin(d), Math.cos(d)); return cur + d * clamp(k, 0, 1); }
  lerpAngle(a, b, k) { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * k; }

  /** Поза харвестера по носу: нос в точке N (мир), тангаж th (>0 — носом вниз). Начало координат модели — смещение от носа. */
  poseFromNose(nx, ny, nz, th, roll) {
    const c = Math.cos(th), s = Math.sin(th);
    const ox = NOSE_C.x * c + NOSE_C.y * s, oy = -NOSE_C.x * s + NOSE_C.y * c;
    this._pose.x = nx - ox * this.f.x; this._pose.y = ny - oy; this._pose.z = nz - ox * this.f.z; this._pose.pitch = th; this._pose.roll = roll;
    this.hv.script(this._pose);
  }

  updateHarvester(dt, t) {
    const hv = this.hv, C = T.carryall;
    this._pose = this._pose || { x: 0, y: 0, z: 0, pitch: 0, roll: 0 };
    // коллайдеры: перед началом наклона харвестер «не твёрдый» (поза не совпадает с боксами); игрок в безопасности по радиусу
    if (!this.done.colOff && t >= this.tRel - 0.5) { this.done.colOff = true; hv.setCollidersEnabled(false); }
    // ритмичная вибрация от приближающегося червя: корпус «пляшет» на песке
    const ramp = smoothstep(1.5, this.tRel, t);
    const pulse = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.6)), 4);
    const shiver = (0.03 + 0.22 * ramp) * (0.35 + 0.65 * pulse) * Math.abs(Math.sin(t * 23));
    if (t < this.tRel) {
      const lift = C.lift * smoothstep(this.tLift0, this.tLift1, t);
      hv.setLift(lift + shiver);
      return;
    }
    // сценарная поза: сползание носом вниз в воронку (нос идёт к оси пасти и тонет), затем свободное падение в пасть
    if (!this.done.scripted) { this.done.scripted = true; hv.setLift(0); this.liftEnd = C.lift * smoothstep(this.tLift0, this.tLift1, this.tRel); }
    const nose0x = this.C0.x + this.f.x * NOSE_C.x, nose0z = this.C0.z + this.f.z * NOSE_C.x, nose0y = this.C0.y + this.liftEnd + NOSE_C.y;
    const k = clamp((t - this.tTilt0) / T.tiltDur, 0, 1);
    const eT = smoothstep(0, 1, k);
    const th0 = T.tiltMax * eT * (0.55 + 0.45 * eT);
    const eXZ = smoothstep(0, 1, Math.min(1, k * 1.15));
    const eY = Math.pow(smoothstep(0.1, 1, k), 1.6);
    let nx = lerp(nose0x, this.A.x, eXZ), nz = lerp(nose0z, this.A.z, eXZ), ny = lerp(nose0y, this.nyEnd, eY);
    let th = th0;
    let roll = (0.03 * Math.sin(t * 1.6) + 0.02 * Math.sin(t * 7.3)) * (1 - smoothstep(this.tSnap - 1, this.tSnap, t));
    if (t > this.tSnap) {
      const s = t - this.tSnap;
      th = Math.min(T.tiltMax + (1.5 - T.tiltMax) * smoothstep(0, 4, s), 1.5);
      const d = 1.2 * s + 0.5 * T.slideAccel * s * s;
      nx = this.A.x; nz = this.A.z; ny = this.nyEnd - d;
      roll = 0.02 * Math.sin(t * 3) * (1 - smoothstep(0, 3, s));
    }
    this.poseFromNose(nx, ny, nz, th, roll);
    if (!this.done.devoured && t > this.tSnap + 1.5) {
      const tail = hv.toWorld(-56, 36, 0, this._q);
      // съедено, когда корма ушла глубоко в глотку (ниже уровня земли; «окно» в рельефе открыто)
      if (tail.y < this.gE - 6 || t > this.tClose0 - 0.3) {
        this.done.devoured = true;
        hv.setState('devoured');
        hv.setCollidersEnabled(false);
        hv.script(null);
      }
    }
  }

  updateVortex(dt, t) {
    const v = this.vortex;
    this.spin += dt * (0.5 + 2.2 * smoothstep(this.tVortex0, this.tVortex0 + T.vortexRamp, t));
    this.vAcc += dt;
    if (this.craterDrawn) return;                                // кратер дорисован: больше ничего не пересчитываем
    if (this.vAcc < 0.045 && !this.forceVortex) return;          // воронка обновляется ~22 Гц: сетка тяжёлая, а вращение плавное
    this.vAcc = 0;
    const cut = this.holeR > 0 ? this.holeR + 3 : 0;
    const k = smoothstep(this.tVortex0, this.tVortex0 + T.vortexRamp, t);
    if (this.phase === 'aftermath' || this.crater > 0) {
      // радиус сетки постоянный (кэш высот рельефа), «усадка» кратера — масштабом меша вокруг центра
      v.update(this.A.x, this.A.z, { k: 1, spin: this.spin, hole: T.holeR * (1 - 0.3 * this.crater), rimH: lerp(T.rimH, 1.6, this.crater), R: T.vortexR, crater: this.crater, cut: 0 });
      const sc = lerp(1, 0.7, this.crater);
      v.mesh.scale.set(sc, 1, sc); v.mesh.position.set(this.A.x * (1 - sc), 0, this.A.z * (1 - sc));
      if (this.crater >= 1) this.craterDrawn = true;
      return;
    }
    v.mesh.scale.set(1, 1, 1); v.mesh.position.set(0, 0, 0);
    if (k <= 0.005) { v.mesh.visible = false; return; }
    // зев растёт, когда голова подходит; после раскрытия пасти вихрь затихает под колонной
    const grow = 0.55 + 0.45 * smoothstep(this.tTilt0, this.tErupt, t);
    v.update(this.A.x, this.A.z, { k, spin: this.spin, hole: T.holeR * grow, rimH: T.rimH * k, R: T.vortexR, crater: 0, cut });
  }

  // ---------------------------------------------------------------- эффекты
  updateFx(dt, t) {
    const { game, ground } = this.api;
    const fx = this.worm.fx, hv = this.hv, rand = this.rand;
    const qf = fx.k;
    const gE = this.gE, A = this.A, K = this.api.K;
    const body = this.worm.body, hs = body.headScale;
    // дрожь земли: растёт с приближением волны и только вблизи игрока
    const pp = game.player?.position;
    const dPl = pp ? Math.hypot(pp.x - A.x, pp.z - A.z) : 999;
    const headD = pp ? Math.hypot(pp.x - this.pathAt(this.u, this._q).x, pp.z - this._q.z) : 999;
    const near = 1 - smoothstep(60, 420, Math.min(dPl, headD));
    const amp = 0.02 + 0.2 * smoothstep(8, this.tErupt, t) + (t > this.tErupt && t < this.tRetract0 ? 0.3 : 0);
    if (t > 6 && t < this.tRetract1 + 2) game.shake = Math.max(game.shake || 0, clamp(amp * near * near, 0, 1));

    // --- «песок пляшет»: ритмичные всплески на корпусе харвестера и вокруг него до появления червя ---
    if (t < this.tErupt && t > 1) {
      const ramp = smoothstep(1.5, this.tRel, t);
      const pulse = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.6)), 4);
      this.pulseAcc += dt * (10 + 70 * ramp * pulse) * qf;
      while (this.pulseAcc >= 1) {
        this.pulseAcc -= 1;
        if (hv.root.visible && !hv.isDevoured) {
          const p = hv.toWorld(-50 + rand() * 96, 31 + rand() * 6, (rand() - 0.5) * 24, this._q);
          hv.particles.emit(1, p.x, p.y, p.z, (rand() - 0.5) * 2, 1.5 + rand() * 2.5, (rand() - 0.5) * 2, 1.4 + rand(), 0.6 + rand() * 0.6, 0.45, 1.2, { wind: 0.6, buoy: 0.2, drag: 1.2 });
        }
        const a = rand() * 6.2832, r = 18 + rand() * 60, x = this.C0.x + Math.cos(a) * r, z = this.C0.z + Math.sin(a) * r, gy = ground(x, z);
        fx.sand.emit(x, gy + 0.2, z, (rand() - 0.5) * 2, 3 + rand() * 6 * (0.4 + ramp), (rand() - 0.5) * 2, game.time, 0.9 + rand() * 0.9, 0.3 + rand() * 0.45, rand(), 2, gy - 0.5, 0.2, 1.5);
      }
    }

    // --- песчаный каскад с обода кольца губ (из-под песка поднимается кольцо, песок стекает наружу и в пасть) ---
    const rimY = K.pos.y + RIM_Z * hs, rimR = 19 * hs;
    if (t >= this.tErupt - 1.2 && t < this.tRetract0 + 3 && rimY > gE - 2) {
      const above = clamp((rimY - gE + 2) / 6, 0, 1);
      this.rimAcc += dt * T.rimSandRate * qf * above * (t < this.tRise1 + 1 ? 1.4 : 0.55);
      while (this.rimAcc >= 1) {
        this.rimAcc -= 1;
        const a = rand() * 6.2832, c = Math.cos(a), s = Math.sin(a), out = rand() < 0.62;
        const r = out ? rimR * (0.98 + rand() * 0.06) : rimR * (0.58 + rand() * 0.18);
        const v = out ? 2.5 + rand() * 5 : -(1.5 + rand() * 4);
        fx.sand.emit(A.x + c * r, rimY + (rand() - 0.2) * 1.5, A.z + s * r, c * v, -1 - rand() * 4, s * v, game.time, 2.5 + rand() * 2.8, 0.5 + rand() * rand() * 1.6, rand(), 2, out ? gE - 1.5 : rimY - 70, 0.08, 1.2 + rand() * 2.4);
      }
    }
    // песчаный фонтан и пряная пыль вокруг колонны
    const active = t >= this.tErupt - 1;
    if (active && t < this.tRetract0 + 2) {
      const rad = RADIUS * (1 + (T.flare - 1) * 0.7);
      this.sandAcc += dt * T.sandRate * qf * (t < this.tRise1 + 2 ? 1.5 : 0.7);
      while (this.sandAcc >= 1) {
        this.sandAcc -= 1;
        const a = rand() * 6.2832, r = rad * (0.9 + rand() * 0.7);
        const sp = 6 + rand() * 16, up = 10 + rand() * 32;
        fx.sand.emit(A.x + Math.cos(a) * r, gE + 1, A.z + Math.sin(a) * r, Math.cos(a) * sp, up, Math.sin(a) * sp, game.time + rand() * 0.2, 3 + rand() * 3.5, 0.4 + rand() * rand() * 1.5, rand(), 2, gE - 2, 0.1, 1.2 + rand() * 2.4);
      }
      this.spiceAcc += dt * T.spiceRate * qf * (this.phase === 'swallow' || this.phase === 'retreat' ? 1.4 : 0.6);
      while (this.spiceAcc >= 1) {
        this.spiceAcc -= 1;
        const a = rand() * 6.2832, r = rad * (0.9 + rand() * 0.8), h = gE + 2 + rand() * 30;
        hv.particles.emit(0, A.x + Math.cos(a) * r, h, A.z + Math.sin(a) * r, Math.cos(a) * (3 + rand() * 6), 3 + rand() * 6, Math.sin(a) * (3 + rand() * 6), 4 + rand() * 4, 7 + rand() * 7, 0.13, 3.0, { wind: 1.2, buoy: 1.3, drag: 0.35 });
      }
      // широкие облака пыли у основания колонны
      this.dustAcc += dt * 1.6 * qf;
      while (this.dustAcc >= 1) { this.dustAcc -= 1; fx.puff(A.x + (rand() - 0.5) * 90, gE + 2 + rand() * 12, A.z + (rand() - 0.5) * 90, 0.6, 'wide'); }
    }
    // песчаный дождь в радиусе ~170 м от оси
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
    if (t >= this.tVortex0 && t < this.tErupt + 1) {
      this.flowAcc += dt * 110 * qf * smoothstep(this.tVortex0, this.tVortex0 + 5, t);
      while (this.flowAcc >= 1) {
        this.flowAcc -= 1;
        const a = rand() * 6.2832, r = 35 + rand() * 80, gy = ground(A.x + Math.cos(a) * r, A.z + Math.sin(a) * r);
        const sp = 7 + rand() * 9;
        fx.sand.emit(A.x + Math.cos(a) * r, gy + 0.6, A.z + Math.sin(a) * r, -Math.cos(a) * sp - Math.sin(a) * sp * 0.8, 1.4 + rand() * 2.5, -Math.sin(a) * sp + Math.cos(a) * sp * 0.8, game.time, 2 + rand() * 1.6, 0.35 + rand() * 0.6, rand(), 2, gy - 0.5, 0.5, 1.5);
      }
    }
    // обломки харвестера
    if (t >= this.tRel && t < this.tSlide1 + 1) {
      this.debrisAcc += dt * T.debrisPerSec * (t > this.tSnap ? 2.4 : 0.8) * (0.5 + 0.5 * qf);
      while (this.debrisAcc >= 1) {
        this.debrisAcc -= 1;
        if (!hv.root.visible && !hv.scripted) break;
        const lx = -50 + rand() * 100, ly = 4 + rand() * 30, lz = (rand() - 0.5) * 40;
        const p = hv.toWorld(lx, ly, lz, this._q);
        const a = rand() * 6.2832, sp = 5 + rand() * 16;
        hv.wreck.spawn(p.x, p.y, p.z, Math.cos(a) * sp, 6 + rand() * 20, Math.sin(a) * sp, 0.8 + rand() * 2.8, Math.floor(rand() * 3));
      }
    }
    // пыль на теле харвестера при трении о клыки
    if (t > this.tSnap && t < this.tSlide1 && hv.scripted && rand() < dt * 8 * qf) {
      const p = hv.toWorld(-45 + rand() * 90, 10 + rand() * 25, (rand() - 0.5) * 36, this._q);
      fx.puff(p.x, p.y, p.z, 0.4);
    }
  }

  snapFx() {
    const fx = this.worm.fx, hv = this.hv, rand = this.rand;
    const hp = hv.hookPoints(this.hookPts);
    for (let i = 0; i < 4; i++) {
      const p = hp[i];
      fx.puff(p.x, p.y, p.z, 0.6);
      for (let k = 0; k < 10; k++) hv.wreck.spawn(p.x, p.y, p.z, (rand() - 0.5) * 24, 6 + rand() * 14, (rand() - 0.5) * 24, 0.5 + rand(), 0);
    }
  }

  /** Игрок вне опасной зоны; если внутри — удар песка мягко выносит наружу (камеру и ввод не трогаем). */
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
      const out = this._cab;
      for (let i = 0; i < 4; i++) out[i].lerpVectors(car.lugWorld[i], B[i], this.cableVis);
      car.setCables(out, this.cableTension, this.cableVib * (this.cableVis > 0.99 ? 1 : 0.3), t);
    } else car.setCables(null);
    this.updatePod(this.api.game.dt || 0.016, t);
  }

  updatePod(dt, t) {
    const hv = this.hv, car = hv.carryall, pod = this.pod, C = T.carryall;
    if (car.script.hidden) { car.setPod(pod.pos, 0, false); return; }
    if (t < this.tPod) { pod.pos.copy(hv.toWorld(26, 37.2, 0, this._v)); car.setPod(pod.pos, Math.atan2(this.f.z, this.f.x), !hv.isDevoured || !!this.cEsc); if (hv.scripted) pod.state = 'off'; return; }
    const belly = this._v2;
    belly.set(car.lugWorld[0].x * 0.25 + car.lugWorld[1].x * 0.25 + car.lugWorld[2].x * 0.25 + car.lugWorld[3].x * 0.25, 0, car.lugWorld[0].z * 0.25 + car.lugWorld[1].z * 0.25 + car.lugWorld[2].z * 0.25 + car.lugWorld[3].z * 0.25);
    belly.y = (car.lugWorld[0].y + car.lugWorld[2].y) * 0.5 - 3.0;
    if (pod.state === 'roof' || pod.state === 'off') {
      if (pod.state === 'off') { return; }
      pod.state = 'fly'; pod.t = 0; pod.from.copy(hv.toWorld(26, 37.2, 0, this._o));
      this.api.game.audio?.event?.('Worm.RingSandfall', pod.from.clone());
      this.setPhase('carryall-pod');
    }
    if (pod.state === 'fly') {
      pod.t += dt;
      const k = clamp(pod.t / C.podDur, 0, 1), e = k * k * (3 - 2 * k);
      pod.pos.lerpVectors(pod.from, belly, e);
      pod.pos.x += Math.sin(k * 3.14) * 6; pod.pos.z += Math.cos(k * 3) * 3;
      car.setPod(pod.pos, Math.atan2(this.f.z, this.f.x), true, -0.4 * (1 - k) + 0.1);
      // выхлоп капсулы
      if (this.rand() < 0.9) hv.particles.emit(2, pod.pos.x, pod.pos.y - 1, pod.pos.z, 0, -3, 0, 3 + this.rand() * 2, 1.2 + this.rand(), 0.5, 4, { wind: 1, buoy: 0.2, drag: 0.8 });
      if (k >= 1) pod.state = 'docked';
    } else if (pod.state === 'docked') {
      pod.pos.copy(belly);
      car.setPod(pod.pos, car.script.yaw, true, 0);
    }
  }

  aftermath() {
    this.setPhase('aftermath');
    const { game } = this.api;
    this.worm.body.setOpen(0); this.worm.body.headScale = 1; this.worm.spine.spread = 1;
    this.worm.spine.flare = 1;
    this.terrainHole.clear(); this.holeR = 0;
    this.hv.alarm(false);
    this.hv.stain.show(this.A.x, this.A.z, 46, 1);
    game.world?.addFootprint?.(this.A.x, this.A.z, 0, { type: 'crater', size: 46 });
    game.audio?.event?.('Worm.RingSandfall', new THREE.Vector3(this.A.x, this.gE, this.A.z));
    this.crater = 0.001;
    this.hideWorm();
  }

  hideWorm() {
    const { K } = this.api;
    this.worm.spine.flare = 1; this.worm.body.headScale = 1; this.worm.spine.spread = 1;
    K.scripted = false;
    this.api.hardDormant(true);
  }

  /** Затухание воронки в кратер после ухода червя + долго висящая пыль и пряность. */
  tickAftermath(dt) {
    if (this.crater > 0 && this.crater < 1) this.crater = Math.min(1, this.crater + dt / 6);
    if (this.done.after && this.t < this.tEnd) {
      const { ground } = this.api, fx = this.worm.fx, hv = this.hv, rand = this.rand, qf = fx.k;
      const k = 1 - (this.t - this.tAfter) / T.aftermathTime;
      this.spiceAcc += dt * 55 * qf * Math.max(0, k);
      while (this.spiceAcc >= 1) {
        this.spiceAcc -= 1;
        const a = rand() * 6.2832, r = Math.sqrt(rand()) * 45;
        hv.particles.emit(0, this.A.x + Math.cos(a) * r, this.gE + 1 + rand() * 6, this.A.z + Math.sin(a) * r, (rand() - 0.5) * 3, 1 + rand() * 3, (rand() - 0.5) * 3, 6 + rand() * 6, 9 + rand() * 9, 0.18, 2.6, { wind: 1.4, buoy: 0.9, drag: 0.4 });
      }
      this.dustAcc += dt * 1.2 * qf * Math.max(0, k);
      while (this.dustAcc >= 1) { this.dustAcc -= 1; fx.puff(this.A.x + (rand() - 0.5) * 70, ground(this.A.x, this.A.z) + 2, this.A.z + (rand() - 0.5) * 70, 0.5, 'wide'); }
    }
  }

  finish(skipped = false) {
    if (!this._active) return;
    const { bus, K, game } = this.api;
    this._active = false;
    this.hv.hold(false);
    this.hv.alarm(false);
    this.hv.setCollidersEnabled(!this.hv.isDevoured);
    this.hv.carryall.setCables(null);
    if (!this.hv.isDevoured) { this.hv.script(null); this.hv.carryall.script.on = false; }
    K.scripted = false;
    this.terrainHole.clear(); this.holeR = 0;
    this.worm.sensing = true;
    this.crater = Math.max(this.crater, 1);
    this.forceVortex = true; this.updateVortex(0, this.t); this.forceVortex = false;
    game.freecam?.setScene('devour', false);
    this.setPhase('end');
    bus.emit('worm:devour', { phase: 'done' });
    this.phase = 'none';
    const res = this.resolve; this.resolve = null;
    res?.({ skipped, devoured: this.hv.isDevoured });
  }

  cancel() { if (this._active) { this.hideWorm(); this.finish(true); } }
}
