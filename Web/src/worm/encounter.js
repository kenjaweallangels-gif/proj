// Встреча с укрощённым червём (замена кат-сцены «выход-атака»). Червь, ведомый Оссаной и двумя наездниками, приходит из
// глубокой пустыни, ползёт ПО поверхности (наполовину погружён), делает великую дугу вокруг группы, останавливается,
// Оссана спускается по кольцам на канате, идёт к группе, говорит (диалог DLG_A2_RIDER_01), возвращается, поднимается,
// наездники выбивают крючья, червь уползает и ныряет далеко в пустыне.
//
// Фазы (шина 'worm:encounter' {phase}): arrive → stop → dismount → talk → mount → depart → gone.
// Кинокамера — только на прибытии (arrive/stop) и отходе (depart); во время разговора игрок свободен.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp } from '../core/util.js';
import { GOLDEN_PATH } from '../core/layout.js';
import { choosePath } from './path.js';
import { RADIUS, N_PTS } from './spine.js';

export const DIALOGUE_ID = 'DLG_A2_RIDER_01';
const V_CRUISE = 30, A_ACC = 2.2, A_BRAKE = 1.7, V_DEPART = 30, A_DEPART = 1.3;
const OSS_WALK = 2.4, OSS_CLIMB = 2.0, OSS_BACKWALK = 1.8;
const LEASH = 40;                       // м: дальше от места спуска игрока — Оссана ждёт и зовёт
const TALK_FALLBACK = 6;                // с: если диалога нет — пауза
const UP = new THREE.Vector3(0, 1, 0);

export class EncounterDirector {
  constructor(api, worm) {
    this.api = api; this.worm = worm;
    this._active = false; this.phase = 'none';
    this.promise = null; this.resolve = null;
    this.path = null; this.G = new THREE.Vector3();
    this.t = 0; this.pt = 0; this.u = 0; this.v = 0;
    this.cinematic = false; this.saved = null;
    this.oss = { phase: 'none', t: 0, pos: new THREE.Vector3(), land: new THREE.Vector3(), a: 0, aLand: 0, side: 1, sDesc: 60, phaseC: 0, callT: 0, waitT: 0 };
    this.camPos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.goal = new THREE.Vector3(); this.fov = 50; this.shot = 0;
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._n = new THREE.Vector3(); this._p = new THREE.Vector3(); this._q = new THREE.Vector3();
    this.sensingBefore = true;
    this.footAcc = 0; this.surfaced = false; this.stopFired = false; this.crackT = 0; this.crackN = 0; this.departT = 0;
    this.talkDone = false; this.log = [];
  }

  get active() { return this._active; }

  // ---------------------------------------------------------------- старт
  /** Построить маршрут относительно группы и поставить голову в начало (под песком, далеко). */
  prepare() {
    const { game, K, ground } = this.api;
    const pl = game.player?.position;
    const P4 = GOLDEN_PATH.find((p) => p.id === 'P4');
    const G = pl && game.space === 'desert' ? { x: pl.x, z: pl.z } : { x: P4.x, z: P4.z };
    this.G.set(G.x, ground(G.x, G.z), G.z);
    this.path = choosePath(G, -1.35);
    const p0 = this.path.at(0);
    this.u = 0; this.v = 0;
    this.api.placeHead(p0.x, p0.z, p0.yaw, 55);
    K.scripted = true;
    return this.path;
  }

  play() {
    if (this._active) return this.promise;
    const { game, bus, K } = this.api;
    this.promise = new Promise((res) => { this.resolve = res; });
    this.prepare();
    this._active = true;
    this.t = 0; this.pt = 0; this.surfaced = false; this.stopFired = false; this.talkDone = false; this.log.length = 0;
    this.sensingBefore = this.worm.sensing;
    this.worm.sensing = false;
    this.api.clearForced();
    this.api.setRidden(true);
    this.api.setTame(true);
    K.frozen = false;
    const rd = this.worm.riders, gear = this.worm.gear;
    rd.items.forEach((it) => { it.hidden = false; it.free = false; it.sNow = it.s; it.a = 0; it.moving = false; it.root.visible = true; it.fig.setTalking?.(false); });
    gear.resetHooks(); gear.setLadder(null);
    rd.aBase = 0;
    this.oss.phase = 'none';
    this.worm.body.setOpen(0);
    this.installCollider();
    // камера
    const cam = game.camera;
    this.saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, near: cam.near };
    this.beginCinematic();
    this.setPhase('arrive');
    bus.emit('worm:reveal', { phase: 'start' });
    return this.promise;
  }

  beginCinematic() {
    const { game, bus } = this.api;
    if (this.cinematic) return;
    this.cinematic = true;
    game.cinematic.active = true; game.cinematic.owner = 'worm';
    bus.emit('cinematic', { active: true, id: 'WormReveal' });
    game.ui?.letterbox?.(true);
    this.shot = 0;
  }
  endCinematic() {
    const { game, bus } = this.api;
    if (!this.cinematic) return;
    this.cinematic = false;
    game.cinematic.active = false; game.cinematic.owner = null;
    game.ui?.letterbox?.(false);
    const cam = game.camera;
    if (Math.abs(cam.fov - (this.saved?.fov ?? 62)) > 0.01) { cam.fov = this.saved?.fov ?? 62; cam.updateProjectionMatrix(); }
    bus.emit('cinematic', { active: false, id: 'WormReveal' });
  }

  setPhase(ph) {
    this.phase = ph; this.pt = 0;
    this.log.push(`${this.api.game.time.toFixed(1)} ${ph}`);
    this.api.bus.emit('worm:encounter', { phase: ph });
  }

  cancel() { if (this._active) this.finish(true, true); }

  finish(skipped = false, silent = false) {
    if (!this._active) return;
    const { game, bus, K } = this.api;
    this._active = false;
    this.endCinematic();
    this.removeCollider();
    const rd = this.worm.riders;
    rd.items.forEach((it) => { it.free = false; it.hidden = true; it.root.visible = false; it.fig.setTalking?.(false); });
    this.worm.gear.setLadder(null);
    this.oss.phase = 'none';
    K.scripted = false;
    this.api.setTame(false);
    this.worm.sensing = this.sensingBefore;
    this.api.hardDormant(true);
    if (!silent) { bus.emit('worm:reveal', { phase: 'end', skipped }); }
    if (this.phase !== 'gone') { this.phase = 'gone'; bus.emit('worm:encounter', { phase: 'gone' }); }
    const res = this.resolve; this.resolve = null;
    res?.({ skipped });
  }

  // ---------------------------------------------------------------- коллизия тела (игрок не проходит сквозь червя)
  installCollider() {
    const { game } = this.api;
    const w = game.world; if (!w || w._wormWrapped) return;
    const orig = w.collide?.bind(w); if (!orig) return;
    const sp = this.worm.spine, ground = this.api.ground, self = this;
    w._wormWrapped = orig;
    w.collide = (pos, r) => {
      let hit = orig(pos, r);
      if (self._active && self.worm.exposed) {
        const P = sp.P;
        for (let i = 0; i < N_PTS; i++) {
          const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
          const R = RADIUS * sp.RS[i] - 0.5;
          const hrel = y - ground(x, z);
          if (hrel < -R + 0.5) continue;
          const half = hrel > R ? R : Math.sqrt(Math.max(0, R * R - Math.min(hrel, R) * Math.min(hrel, R)));
          const dx = pos.x - x, dz = pos.z - z, d = Math.hypot(dx, dz), need = half + r;
          if (d < need) { const k = d > 1e-3 ? 1 : 0; pos.x = x + (k ? dx / d : 1) * need; pos.z = z + (k ? dz / d : 0) * need; hit = true; }
        }
      }
      return hit;
    };
  }
  removeCollider() {
    const w = this.api.game.world;
    if (w?._wormWrapped) { w.collide = w._wormWrapped; w._wormWrapped = null; }
  }

  // ---------------------------------------------------------------- голова
  baseLift(u) {
    const p = this.path;
    let l = -55 + 52 * smoothstep(40, 250, u);                      // всплытие вдали: волна → бугор → кольца
    l -= 62 * smoothstep(p.uOut + 250, p.uOut + 470, u);            // нырок далеко в пустыне
    return l;
  }

  placeHeadAt(u) {
    const { K, ground } = this.api;
    const p = this.path.at(u, this._pt || (this._pt = {}));
    K.pos.set(p.x, ground(p.x, p.z) + this.baseLift(u), p.z);
    K.yaw = p.yaw; K.pitch = 0;
    this.worm.spine.push(K.pos);
  }

  moveHead(dt, vTarget, acc) {
    const { K } = this.api;
    this.v += clamp(vTarget - this.v, -acc * dt, acc * dt);
    if (this.v < 0) this.v = 0;
    this.u = Math.min(this.u + this.v * dt, this.path.len - 1);
    this.placeHeadAt(this.u);
    K.speed = this.v;
    this.footAcc += this.v * dt;
    if (this.footAcc > 16 && this.surfaced) { this.footAcc = 0; this.api.game.world?.addFootprint?.(K.pos.x, K.pos.z, K.yaw, { type: 'worm', size: 46 }); }
  }

  /** Мгновенно довести голову до u (для пропуска): шаг 2 м, тело сворачивается по истории. */
  advanceTo(uT) {
    while (this.u < uT) { this.u = Math.min(uT, this.u + 2); this.placeHeadAt(this.u); }
    this.v = 0;
  }

  headLiftFor(v) { return lerp(1.2, 8.5, smoothstep(2, 22, v)); }

  // ---------------------------------------------------------------- цикл
  update(dt) {
    if (!this._active) return;
    const { game, K, bus } = this.api;
    const sp = this.worm.spine, path = this.path;
    this.t += dt; this.pt += dt;
    this.tickHold();
    const skip = game.input?.pressed?.('Skip');

    switch (this.phase) {
      case 'arrive': {
        const left = path.uStop - this.u;
        const vUp = Math.sqrt(2 * A_ACC * (this.u + 6));
        const vDown = Math.sqrt(2 * A_BRAKE * Math.max(0, left)) + 0.6;
        this.moveHead(dt, Math.min(V_CRUISE, vUp, vDown), 3);
        if (!this.surfaced && this.u > 150) {
          this.surfaced = true;
          this.api.onBreach(0.55);
          bus.emit('worm:reveal', { phase: 'erupt' });
        }
        sp.headLift = lerp(sp.headLift, this.headLiftFor(this.v), 1 - Math.exp(-1.5 * dt));
        game.shake = Math.max(game.shake || 0, 0.06 + 0.3 * smoothstep(260, 90, this.distToG()) * smoothstep(5, 25, this.v));
        if (this.pt > 1.5 && skip) { this.advanceTo(path.uStop); this.arriveDone(true); break; }
        if (left < 0.4 && this.v < 0.9) { this.advanceTo(path.uStop); this.arriveDone(false); }
        break;
      }
      case 'stop': {
        this.v = Math.max(0, this.v - 2 * dt);
        sp.headLift = lerp(sp.headLift, 1.2, 1 - Math.exp(-0.8 * dt));
        if (this.pt > 5.5 || (skip && this.pt > 1)) { this.endCinematic(); this.startDismount(); }
        break;
      }
      case 'dismount': case 'talk': case 'mount': {
        this.updateOssana(dt);
        break;
      }
      case 'depart': {
        this.departT += dt;
        if (this.crackN < this.worm.gear.hookCount) {
          this.crackT += dt;
          while (this.crackT > 0.26 && this.crackN < this.worm.gear.hookCount) { this.crackT -= 0.26; this.crackHook(this.crackN++); }
        }
        const go = this.crackN >= this.worm.gear.hookCount * 0.7 || this.departT > 5;
        if (go) {
          if (!this._departEmit) { this._departEmit = true; bus.emit('worm:encounter', { phase: 'depart' }); this.log.push(`${game.time.toFixed(1)} depart-go`); this.api.game.audio?.event?.('Worm.Pass', K.pos.clone()); }
          this.moveHead(dt, V_DEPART, A_DEPART);
          sp.headLift = lerp(sp.headLift, this.headLiftFor(Math.max(this.v, 9)), 1 - Math.exp(-1.2 * dt));
          if (!this._dived && this.u > path.uOut + 300) { this._dived = true; bus.emit('worm:reveal', { phase: 'dive' }); }
          game.shake = Math.max(game.shake || 0, 0.15 * smoothstep(300, 60, this.distToG()) * smoothstep(0, 12, this.v));
        } else sp.headLift = lerp(sp.headLift, 5, 1 - Math.exp(-0.9 * dt));
        // ожидание: камера до нырка, затем игроку возвращается управление, тело ещё уползает
        if (this.cinematic && (this.pt > 38 || (this.distToG() > 520 && this._dived) || (skip && this.departT > 1.5))) this.endCinematic();
        if (skip && this.departT > 1.5) { this.finish(true); return; }
        if (this._dived && !this.worm.exposed) { this.goneT = (this.goneT || 0) + dt; if (this.goneT > 1.5) this.goneFinish(); }
        if (this.u >= path.len - 2 && this.pt > 60) this.goneFinish();
        break;
      }
      default: break;
    }
  }

  arriveDone(skipped) {
    const { game, K, bus } = this.api;
    this.v = 0; K.speed = 0;
    this.setPhase('stop');
    this.worm.spine.headLift = 1.2;
    this.api.settleFx();
    game.audio?.event?.('Worm.RingSandfall', K.pos.clone());
    if (skipped) { this.endCinematic(); this.startDismount(); }
  }

  goneFinish() {
    this.setPhase('gone');
    this.finish(false);
  }

  distToG() { const K = this.api.K; return Math.hypot(K.pos.x - this.G.x, K.pos.z - this.G.z); }

  crackHook(i) {
    const g = this.worm.gear;
    g.crack(i);
    const h = g.hooks[i];
    this.api.fx.puff(h.root.matrix.elements[12], h.root.matrix.elements[13], h.root.matrix.elements[14], 0.35);
    if (i % 4 === 0) this.api.game.audio?.event?.('Worm.RingSandfall', this._p.set(h.root.matrix.elements[12], h.root.matrix.elements[13], h.root.matrix.elements[14]).clone());
  }

  // ---------------------------------------------------------------- Оссана
  placeSurface(it, s, a, extra, sideSign, descend) {
    const sp = this.worm.spine, rd = this.worm.riders;
    const P = this._v, N = this._n;
    sp.surfacePoint(s, a, P, N, extra);
    const P2 = this._w;
    sp.surfacePoint(s, a + 0.03 * sideSign, P2, this._q, extra);
    const down = P2.sub(P).normalize();                      // направление «вдоль борта» в сторону роста |a|
    const w = smoothstep(0.62, 0.15, N.y);                   // у вертикальной стены — лицом к стене
    const nh = this._q.set(-N.x, 0, -N.z); if (nh.lengthSq() > 1e-6) nh.normalize(); else nh.set(0, 0, 1);
    const face = new THREE.Vector3().copy(descend ? down : down.clone().negate()).lerp(nh, w);
    // «верх» тела: вертикаль + отклон от стены (откидываемся на канате)
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(N, 0.38 * (1 - N.y));
    rd.placeFree(it, P, up, face);
    return w;
  }

  startDismount() {
    const { game, K, ground } = this.api;
    const sp = this.worm.spine, rd = this.worm.riders, o = this.oss, it = rd.ossana;
    sp.compute(game.time, 1);
    // где ближе всего к группе
    let best = 1e9, sBest = it.s;
    const P = this._v, N = this._n;
    for (let s = 36; s <= 92; s += 2) {
      sp.surfacePoint(s, 0, P, N, 0);
      const d = Math.hypot(P.x - this.G.x, P.z - this.G.z);
      if (d < best) { best = d; sBest = s; }
    }
    o.sDesc = sBest;
    sp.surfacePoint(sBest, 0, P, N, 0);
    const T = sp._b, B = new THREE.Vector3().crossVectors(T, N);
    const toG = new THREE.Vector3(this.G.x - P.x, 0, this.G.z - P.z).normalize();
    o.side = Math.sign(toG.dot(B)) || 1;
    // угол касания песка
    let aLand = o.side * 1.6;
    for (let a = 0; Math.abs(a) < 2.6; a += o.side * 0.02) {
      sp.surfacePoint(sBest, a, P, N, 0.2);
      if (P.y - ground(P.x, P.z) < 0.5) { aLand = a; break; }
    }
    o.aLand = aLand;
    o.a = 0; o.phase = 'walkBack'; o.t = 0; o.climbPhase = 0;
    this.setPhase('dismount');
    // курс колец: наездники смотрят на группу
    it.face = 0;
    rd.items[0].face = 0.9 * o.side; rd.items[2].face = 0.7 * o.side;
    this.api.game.worm.gear.setLadder({ s: sBest, a0: o.side * 0.22, a1: aLand });
  }

  playerPos() { return this.api.game.player?.position || this.G; }

  updateOssana(dt) {
    const { game, ground, bus } = this.api;
    const sp = this.worm.spine, rd = this.worm.riders, o = this.oss, it = rd.ossana, gear = this.worm.gear;
    o.t += dt;
    switch (o.phase) {
      case 'walkBack': {                                          // идёт по спине к месту спуска
        it.moving = true;
        const ds = o.sDesc - it.sNow;
        it.sNow += clamp(ds, -OSS_BACKWALK * dt, OSS_BACKWALK * dt);
        if (Math.abs(ds) < 0.15) { it.moving = false; o.phase = 'rope'; o.t = 0; }
        break;
      }
      case 'rope': {                                              // закрепляет канат
        it.moving = false;
        if (o.t > 1.6) { o.phase = 'down'; o.t = 0; o.a = 0; it.free = true; }
        break;
      }
      case 'down': {
        const r = RADIUS;
        // спуск: на куполе — шаг, у стены — «боком по канату»
        const w = smoothstep(0.62, 0.15, Math.cos(o.a));
        const v = lerp(1.7, OSS_CLIMB, w);
        o.a += o.side * (v / r) * dt;
        o.climbPhase += dt * 4.2 * (0.3 + w);
        const ww = this.placeSurface(it, o.sDesc, o.a, 0.12, o.side, true);
        it.fig.animate(ww < 0.5 ? 1.8 : 0, dt);
        rd.poseClimb(it, o.climbPhase, smoothstep(0.2, 0.7, ww));
        if (Math.abs(o.a) >= Math.abs(o.aLand) - 0.01) {
          sp.surfacePoint(o.sDesc, o.aLand, this._v, this._n, 0.2);
          o.pos.set(this._v.x + this._n.x * 1.2, 0, this._v.z + this._n.z * 1.2); o.pos.y = ground(o.pos.x, o.pos.z);
          o.land.copy(o.pos);
          o.phase = 'walkTo'; o.t = 0; this.api.fx.puff(o.pos.x, o.pos.y, o.pos.z, 0.2);
        }
        break;
      }
      case 'walkTo': {
        const pl = this.playerPos();
        const far = Math.hypot(pl.x - o.land.x, pl.z - o.land.z) > LEASH;
        const dx = pl.x - o.pos.x, dz = pl.z - o.pos.z, d = Math.hypot(dx, dz);
        let speed = 0;
        if (!far && d > 2.9) { speed = OSS_WALK * smoothstep(0, 0.6, o.t); o.pos.x += (dx / d) * speed * dt; o.pos.z += (dz / d) * speed * dt; }
        o.pos.y = ground(o.pos.x, o.pos.z);
        it.fig.animate(speed, dt);
        const fx = speed > 0 || d > 0.1 ? dx / (d || 1) : 0, fz = d > 0.1 ? dz / (d || 1) : 1;
        rd.placeFree(it, o.pos, UP, this._q.set(fx, 0, fz));
        if (far) {                                                  // игрок ушёл слишком далеко: ждёт и зовёт
          o.callT += dt;
          if (o.callT > 9) { o.callT = 0; this.call(); }
        } else o.callT = 6;
        o.waitT += dt;
        if (!far && d <= 2.95) { o.phase = 'talk'; o.t = 0; this.startTalk(); }
        else if (o.waitT > 150) { o.phase = 'talk'; o.t = 0; this.startTalk(true); }
        break;
      }
      case 'talk': {
        const pl = this.playerPos();
        const dx = pl.x - o.pos.x, dz = pl.z - o.pos.z, d = Math.hypot(dx, dz) || 1;
        it.fig.animate(0, dt);
        rd.placeFree(it, o.pos, UP, this._q.set(dx / d, 0, dz / d));
        it.fig.lookAt?.(this._w.set(pl.x, pl.y + 1.5, pl.z));
        if (this.talkDone) { it.fig.setTalking?.(false); it.fig.parts && (it.fig.parts.headPivot.rotation.y = 0); o.phase = 'walkBackTo'; o.t = 0; this.setPhase('mount'); }
        break;
      }
      case 'walkBackTo': {
        const dx = o.land.x - o.pos.x, dz = o.land.z - o.pos.z, d = Math.hypot(dx, dz);
        const sp2 = d > 0.3 ? OSS_WALK * smoothstep(0, 0.5, o.t) : 0;
        if (d > 0.3) { o.pos.x += (dx / d) * sp2 * dt; o.pos.z += (dz / d) * sp2 * dt; }
        o.pos.y = ground(o.pos.x, o.pos.z);
        it.fig.animate(sp2, dt);
        rd.placeFree(it, o.pos, UP, this._q.set(dx / (d || 1), 0, dz / (d || 1)));
        if (d <= 0.3) { o.phase = 'up'; o.t = 0; o.a = o.aLand; o.climbPhase = 0; }
        break;
      }
      case 'up': {
        const w = smoothstep(0.62, 0.15, Math.cos(o.a));
        const v = lerp(1.9, OSS_CLIMB * 0.9, w);
        o.a -= o.side * (v / RADIUS) * dt;
        o.climbPhase += dt * 4.0 * (0.3 + w);
        const ww = this.placeSurface(it, o.sDesc, o.a, 0.12, o.side, false);
        it.fig.animate(ww < 0.5 ? 1.8 : 0, dt);
        rd.poseClimb(it, o.climbPhase, smoothstep(0.2, 0.7, ww));
        if (o.side * o.a <= 0.04) {
          o.a = 0; it.free = false; it.a = 0; it.sNow = o.sDesc; it.moving = false;
          o.phase = 'seat'; o.t = 0; gear.setLadder(null);
        }
        break;
      }
      case 'seat': {                                              // возвращается на своё место на спине
        it.moving = true;
        const ds = it.s - it.sNow;
        it.sNow += clamp(ds, -OSS_BACKWALK * dt, OSS_BACKWALK * dt);
        if (Math.abs(ds) < 0.15) {
          it.moving = false; o.phase = 'done'; o.t = 0; it.face = 0;
          this.startDepart();
        }
        break;
      }
      default: break;
    }
    void game; void bus;
  }

  call() {
    const { game, bus } = this.api;
    const o = this.oss;
    const lines = [
      ['Оссана', 'Рэйн! Сюда. Он не будет ждать вечно.', 'Rayn! Over here. He will not wait forever.'],
      ['Оссана', 'Подойдите ближе — разговор короткий.', 'Come closer. This will be short.'],
    ];
    const l = lines[(this.callN = ((this.callN || 0) + 1)) % lines.length];
    bus.emit('subtitle', { speaker: 'Ossana', name: l[0], text: game.t(l[1], l[2]), duration: 3.2, kind: 'bark', pos: o.pos.clone() });
  }

  startTalk(timeout = false) {
    const { game } = this.api;
    this.setPhase('talk');
    this.talkDone = false; this._holdCb = null; this._talkGuard = game.time + 180;
    const it = this.worm.riders.ossana;
    it.fig.setTalking?.(true);
    const t0 = game.time;
    const fin = () => {
      if (!this._active || this.talkDone) return;
      if (game.time - t0 < 1 && !timeout) { this._holdUntil = game.time + TALK_FALLBACK; this._holdCb = () => { this.talkDone = true; }; }   // диалога нет — пауза
      else this.talkDone = true;
    };
    let p = null;
    try { p = game.dialogue?.play?.(DIALOGUE_ID); } catch (e) { console.warn('[worm] диалог', e); }
    if (p && typeof p.then === 'function') p.then(fin, fin); else fin();
  }

  startDepart() {
    this.setPhase('depart');
    this._departEmit = false; this._dived = false; this.crackN = 0; this.crackT = 0; this.departT = 0; this.goneT = 0;
    this.beginCinematic();
    this.oss.phase = 'done';
    this.worm.riders.items.forEach((it) => { it.face = 0; });
  }

  /** Каждый кадр: завершает «удержание» паузы, если диалога не было (по игровому времени), и страхует зависший диалог. */
  tickHold() {
    const t = this.api.game.time;
    if (this._holdCb && t >= this._holdUntil) { const r = this._holdCb; this._holdCb = null; r(); }
    if (this.phase === 'talk' && !this.talkDone && t > this._talkGuard) this.talkDone = true;
  }

  // ---------------------------------------------------------------- камера
  clearOfBody(pos, minGround = 0.9) {
    const { ground } = this.api;
    const sp = this.worm.spine, P = sp.P;
    for (let i = 0; i < N_PTS; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const R = RADIUS * sp.RS[i] + 2.5;
      if (y + R < ground(x, z)) continue;
      const dx = pos.x - x, dz = pos.z - z, d = Math.hypot(dx, dz);
      const hy = pos.y - y;
      if (d < R && Math.hypot(d, Math.max(hy, 0)) < R) {
        const k = d > 1e-3 ? (R + 0.5) / d : 1;
        pos.x = x + (d > 1e-3 ? dx * k : R + 0.5); pos.z = z + (d > 1e-3 ? dz * k : 0);
      }
    }
    pos.y = Math.max(pos.y, ground(pos.x, pos.z) + minGround);
    return pos;
  }

  spinePt(s, out) { const sp = this.worm.spine; sp.frameAt(s, out, this._q, this._n); return out; }

  lateUpdate(dt) {
    if (!this._active) return;
    this.tickHold();
    if (!this.cinematic) return;
    const { game, K, ground } = this.api;
    const cam = game.camera, path = this.path, G = this.G;
    const gG = ground(G.x, G.z);
    let pos = this._p, goal = this.goal, fov = this.fov, damp_ = 5, shot;
    const head = K.pos;
    const fx_ = path.f, rx_ = path.r;
    const lf = (head.x - G.x) * fx_.x + (head.z - G.z) * fx_.z;
    const lr = (head.x - G.x) * rx_.x + (head.z - G.z) * rx_.z;
    const dG = Math.hypot(lf, lr);

    if (this.phase === 'arrive' || this.phase === 'stop') {
      const u = this.u, ap = path.o.approach;
      const uA = Math.max(200, ap - 280), uB = ap + 110, uC = path.uStop - 95;
      if (this.phase === 'arrive' && u < uA) {
        // 1) широкий план: пустыня, пыльная гряда на горизонте, группа в кадре снизу
        shot = 1;
        path.local(-9, 7 + 0.25 * this.t, pos); pos.y = gG + 1.25;
        goal.set(head.x, Math.max(gG + 6, head.y + 9), head.z);
        fov = lerp(36, 30, smoothstep(0, 12, this.t)); damp_ = 2.2;
      } else if (this.phase === 'arrive' && u < uB) {
        // 2) низкий геройский ракурс: червь проходит мимо, камера у самой земли, взгляд ведёт голову, затем скользит по телу
        shot = 2;
        path.local(28, -(path.o.R0 - 30), pos); pos.y = gG + 1.1;
        const pass = smoothstep(ap - 40, ap + 90, u);
        const sT = lerp(0, 150, smoothstep(ap - 10, ap + 110, u));
        this.spinePt(sT, this._w);
        goal.set(head.x, head.y + lerp(14, 6, smoothstep(ap - 200, ap, u)), head.z).lerp(this._w.setY(this._w.y + 10), pass * 0.85);
        fov = lerp(26, 52, smoothstep(ap - 220, ap + 20, u)); damp_ = 3.5;
      } else if (this.phase === 'arrive' && u < uC) {
        // 3) слежение: камера внутри дуги идёт чуть позади головы, в кадре голова и наездники
        shot = 3;
        const phi = Math.atan2(lf, -lr) - 0.42;
        const Rc = Math.max(16, dG - 36);
        pos.set(G.x + Rc * (-rx_.x * Math.cos(phi) + fx_.x * Math.sin(phi)), 0, G.z + Rc * (-rx_.z * Math.cos(phi) + fx_.z * Math.sin(phi)));
        pos.y = ground(pos.x, pos.z) + 3.2;
        this.spinePt(46, this._w);
        goal.copy(head).lerp(this._w, 0.45).setY(head.y + 12);
        fov = 44; damp_ = 4;
      } else {
        // 4) финал: широко над группой, червь ложится дугой, взгляд скользит от головы вдоль тела
        shot = 4;
        const k = smoothstep(0, 6, this.phase === 'stop' ? this.pt : 0);
        path.local(0, 2.2 + 0.6 * k, pos); pos.y = gG + 2.4;
        this.spinePt(lerp(10, 130, k), this._w);
        goal.copy(head).setY(head.y + 10).lerp(this._w.setY(this._w.y + 8), k * 0.8);
        fov = lerp(52, 66, k); damp_ = 2.6;
      }
    } else {
      // отход
      const dt_ = this.departT;
      if (dt_ < 7) {
        shot = 5;
        path.local(2, 3, pos); pos.y = gG + 1.6;
        this.spinePt(52, this._w);
        goal.copy(this._w).setY(this._w.y + 12);
        fov = lerp(40, 34, smoothstep(0, 7, dt_)); damp_ = 3;
      } else if (this.distToG() < 330 && !this._dived) {
        shot = 6;
        // сбоку и низко: тело скользит мимо, камера тянется за головой
        const hx = Math.cos(K.yaw), hz = Math.sin(K.yaw);
        pos.set(head.x - hx * 70 + hz * 70, 0, head.z - hz * 70 - hx * 70); pos.y = ground(pos.x, pos.z) + 2.2;
        goal.set(head.x, head.y + 8, head.z);
        fov = 38; damp_ = 3.5;
      } else {
        shot = 7;
        path.local(0, 3, pos); pos.y = gG + 2.4;
        goal.set(head.x, Math.max(head.y + 10, gG + 6), head.z);
        fov = lerp(30, 20, smoothstep(250, 560, this.distToG())); damp_ = 2;
      }
    }
    if (!(Number.isFinite(pos.x + pos.y + pos.z + goal.x + goal.y + goal.z))) return;   // защита от NaN в камере
    this.clearOfBody(pos);
    if (shot !== this.shot) { this.shot = shot; this.look.copy(goal); this.fov = fov; this.camPos.copy(pos); this.log.push(`${game.time.toFixed(1)} shot ${shot}`); }
    this.fov = lerp(this.fov, fov, 1 - Math.exp(-2.5 * dt));
    this.look.lerp(goal, 1 - Math.exp(-damp_ * dt));
    this.camPos.lerp(pos, 1 - Math.exp(-(shot === 3 || shot === 6 ? 6 : 14) * dt));
    cam.position.copy(this.camPos);
    const sh = Math.min(1, game.shake || 0) * 0.14;
    const tt = game.time;
    cam.position.x += (Math.sin(tt * 41.3) + Math.sin(tt * 27.7 + 1.3)) * sh * 0.5;
    cam.position.y += (Math.sin(tt * 37.1 + 2.1) + Math.sin(tt * 23.3)) * sh * 0.5;
    cam.position.z += (Math.sin(tt * 33.7 + 0.4) + Math.sin(tt * 29.9 + 3.1)) * sh * 0.5;
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
