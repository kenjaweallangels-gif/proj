// Кат-сцена «Выход червя» (LS_WormReveal, ~28 с): волна песка → колонна против солнца → раскрытие пасти → наездники →
// спуск Оссаны по кольцам → червь уходит дугой → тишина. Камеру ведём напрямую (game.camera).
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/util.js';
import { GOLDEN_PATH, WORM_REVEAL, WORM_SPAWN } from '../core/layout.js';

const T_GO = 4.8;          // с: начало подъёма
const T_OPEN = 5.6;        // относительно T_GO: начало раскрытия пасти
const T_ROAR = 8.9;
const T_SLIDE = 7.4;       // начало спуска Оссаны
const T_DIVE = 11.8;       // голова начинает уходить вниз
const T_S3 = 5.4, T_S4 = 10.6, T_S5 = 15.6, T_SILENCE = 19.8, T_END = 23.6;

export class RevealDirector {
  constructor(api, worm) {
    this.api = api; this.worm = worm;
    this.active = false; this.c = 0; this.go = false; this.promise = null; this.resolve = null;
    this.geo = null; this.saved = null;
    this.camPos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.lookGoal = new THREE.Vector3();
    this.shot = 0; this.fov = 55;
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._n = new THREE.Vector3();
    this.oss = { phase: 'none', pos: new THREE.Vector3(), p0: new THREE.Vector3(), land: new THREE.Vector3(), t: 0, yaw: 0 };
    this.sensingBefore = true;
  }

  /** Геометрия сцены: якорь (группа), точка выхода, курс. Размещает червя на подходе, если ещё не там. */
  prepare(place = true) {
    const { game, K, ground } = this.api;
    const P4 = GOLDEN_PATH.find((p) => p.id === 'P4');
    const pl = game.player?.position;
    let ax = P4.x, az = P4.z;
    let rx = WORM_REVEAL.x, rz = WORM_REVEAL.z;
    if (pl && Math.hypot(pl.x - P4.x, pl.z - P4.z) > 45) {
      ax = pl.x; az = pl.z;
      const az0 = Math.atan2(WORM_REVEAL.z - P4.z, WORM_REVEAL.x - P4.x);
      rx = ax + Math.cos(az0) * 80; rz = az + Math.sin(az0) * 80;
    }
    const F = new THREE.Vector3(rx - ax, 0, rz - az).normalize();
    const R = new THREE.Vector3(-F.z, 0, F.x);
    const h0 = new THREE.Vector3().copy(R).addScaledVector(F, -0.15).normalize();
    const yaw0 = Math.atan2(h0.z, h0.x);
    const arc = this.api.arcReveal;
    const B0 = new THREE.Vector3(rx - h0.x * arc.dZero, 0, rz - h0.z * arc.dZero);
    this.geo = { A: new THREE.Vector3(ax, 0, az), reveal: new THREE.Vector3(rx, 0, rz), F, R, h0, yaw0, B0, arc };
    if (place) {
      const f = this.api.getForced();
      if (!(f && f.reveal && Math.hypot(K.pos.x - B0.x, K.pos.z - B0.z) < 360)) {
        const dist = 230;
        this.api.placeHead(B0.x - h0.x * dist, B0.z - h0.z * dist, yaw0);
      }
    }
    return this.geo;
  }

  play() {
    if (this.active) return this.promise;
    const { game, bus, K } = this.api;
    this.promise = new Promise((res) => { this.resolve = res; });
    const g = this.prepare(true);
    this.active = true; this.c = 0; this.go = false; this.shot = 0;
    this.sensingBefore = this.worm.sensing;
    this.worm.sensing = false;
    this.api.setForced({ reveal: true, x: g.B0.x, z: g.B0.z, armed: false, armedT: 0 });
    K.frozen = false; K.depth = this.api.tune.burrowDepth; K.steer = { x: g.B0.x, z: g.B0.z };
    this.api.setState('Approach');
    this.worm.body.setOpen(0);
    const r = this.worm.riders;
    r.items.forEach((it) => { it.hidden = false; it.free = false; it.sNow = it.s; it.a = 0; it.moving = false; it.root.visible = true; it.root.scale.setScalar(1); });
    this.oss.phase = 'none';
    // камера
    const cam = game.camera;
    this.saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, near: cam.near };
    game.cinematic.active = true; game.cinematic.owner = 'worm';
    bus.emit('cinematic', { active: true, id: 'WormReveal' });
    game.weather?.request?.('Worm_Reveal', 3);
    game.ui?.letterbox?.(true);
    const gA = this.api.ground(g.A.x, g.A.z);
    this.camPos.set(g.A.x - g.F.x * 5 - g.R.x * 2, gA + 0.7, g.A.z - g.F.z * 5 - g.R.z * 2);
    this.look.set(g.A.x + g.F.x * 10, gA + 0.2, g.A.z + g.F.z * 10);
    cam.position.copy(this.camPos); cam.lookAt(this.look);
    bus.emit('worm:reveal', { phase: 'start' });
    return this.promise;
  }

  cancel() {
    if (!this.active) return;
    this.finish(true, true);
  }

  finish(skipped, silent = false) {
    if (!this.active) return;
    const { game, bus, K } = this.api;
    this.active = false;
    const cam = game.camera;
    if (this.saved) { cam.position.copy(this.saved.pos); cam.quaternion.copy(this.saved.quat); cam.fov = this.saved.fov; cam.near = this.saved.near; cam.updateProjectionMatrix(); }
    const it = this.worm.riders.items[1];
    it.free = false; it.hidden = true; it.root.visible = false; this.oss.phase = 'none';
    this.worm.riders.keep = !skipped;
    game.cinematic.active = false; game.cinematic.owner = null;
    if (!silent) {
      game.ui?.letterbox?.(false);
      bus.emit('cinematic', { active: false, id: 'WormReveal' });
      bus.emit('worm:reveal', { phase: 'end', skipped });
    }
    this.worm.sensing = this.sensingBefore;
    if (skipped) this.api.hardDormant(true);
    else { this.api.endRidden(); }
    K.frozen = false;
    const res = this.resolve; this.resolve = null;
    res?.({ skipped });
  }

  // ---------------------------------------------------------------- логика червя
  update(dt) {
    const { game, K, tune, bus, spine } = this.api;
    const g = this.geo;
    this.c += dt;
    const c = this.c;
    if (c > 0.8 && game.input?.pressed?.('Skip')) { this.finish(true); return; }
    game.cinematic.active = true;

    if (!this.go) {
      // волна: рассчитываем скорость так, чтобы голова пришла в B0 ровно к T_GO
      const d = Math.hypot(g.B0.x - K.pos.x, g.B0.z - K.pos.z);
      const left = T_GO - c;
      K.steer = { x: g.B0.x, z: g.B0.z };
      K.speed = d < 1.5 || left <= 0.02 ? 0 : Math.min(70, d / left);
      game.shake = Math.max(game.shake, 0.12 + 0.5 * smoothstep(0, T_GO, c));
      if (c >= T_GO) this.start();
      return;
    }
    // подъём/стойка/спуск
    const sS = this.api.arcReveal.standSigma;
    const cc = c - T_GO;
    let v;
    if (cc < T_DIVE) v = K.sigma < sS ? lerp(46, 4.0, smoothstep(sS - 75, sS, K.sigma)) : 4.0;
    else v = lerp(4, 34, smoothstep(0, 3.2, cc - T_DIVE));
    K.speed = v;
    if (cc > 0 && cc < 2) this.worm.fx.shared.uScatter.value = 2.2;
    // пасть
    const open = smoothstep(0, 1, (cc - T_OPEN) / 2.8) * (1 - smoothstep(0, 1, (cc - T_DIVE - 0.4) / 2.8));
    this.worm.body.setOpen(open);
    if (!this._roared && cc > T_ROAR) {
      this._roared = true;
      game.audio?.event?.('Worm.Roar', K.pos.clone());
      bus.emit('worm:reveal', { phase: 'roar' });
      this.api.impulse(0.55);
    }
    if (!this._silence && cc > T_SILENCE) { this._silence = true; bus.emit('worm:reveal', { phase: 'silence' }); }
    if (!this._opened && cc > T_OPEN) { this._opened = true; bus.emit('worm:reveal', { phase: 'open' }); }
    if (!this._dived && cc > T_DIVE) { this._dived = true; bus.emit('worm:reveal', { phase: 'dive' }); }
    this.updateOssana(dt, cc);
    // дрожь земли держим, пока червь высоко
    const hrel = K.pos.y - this.api.ground(K.pos.x, K.pos.z);
    if (hrel > 5) game.shake = Math.max(game.shake, cc < 7 ? 0.5 : 0.22);
    if (cc >= T_END) this.finish(false);
  }

  start() {
    const { K, bus, game } = this.api;
    this.go = true; this._roared = false; this._silence = false; this._opened = false; this._dived = false;
    this.api.clearForced();
    K.pos.x = this.geo.B0.x; K.pos.z = this.geo.B0.z;
    K.yaw = this.geo.yaw0;
    this.api.setRidden(true);
    this.api.startArc(this.api.arcReveal, 46);
    // сторона наездников: к камере
    const hd = new THREE.Vector3(Math.cos(this.geo.yaw0 + 0.5), 0, Math.sin(this.geo.yaw0 + 0.5));
    const N = hd.clone().negate();
    const B = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), N);
    const C = this.geo.F.clone().negate();
    this.worm.riders.aBase = Math.atan2(B.dot(C), N.dot(C));
    this.worm.riders.group.visible = true;
    bus.emit('worm:reveal', { phase: 'erupt' });
    game.audio?.event?.('Worm.RingSandfall', K.pos.clone());
  }

  updateOssana(dt, cc) {
    const { spine, ground, game } = this.api;
    const it = this.worm.riders.items[1];
    const o = this.oss;
    const A = this.geo.A;
    if (o.phase === 'none' && cc >= T_SLIDE) o.phase = 'slide';
    if (o.phase === 'slide') {
      // найти s, где поверхность на высоте ~6 м над песком
      let sg = it.sNow;
      const P = spine.P;
      for (let i = Math.floor(it.sNow / 4); i < 90; i++) {
        const h = P[i * 3 + 1] - ground(P[i * 3], P[i * 3 + 2]);
        if (h < 20 + 6) { sg = i * 4; break; }
        sg = i * 4;
      }
      it.moving = true;
      const v = lerp(2, 10, smoothstep(0, 1.5, cc - T_SLIDE));
      it.sNow = Math.min(it.sNow + v * dt, sg);
      it.a = Math.sin((cc - T_SLIDE) * 0.9) * 0.05 + smoothstep(0, 5, cc - T_SLIDE) * 0.1;
      if (it.sNow >= sg - 0.6 && cc > T_SLIDE + 1.5) {
        // прыжок на песок
        o.phase = 'jump'; o.t = 0;
        spine.surfacePoint(it.sNow, this.worm.riders.aBase + it.da + it.a, o.p0, this._n, 0.1);
        const out = this._n.clone(); out.y = 0; out.normalize();
        o.land.copy(o.p0).addScaledVector(out, 7); o.land.y = ground(o.land.x, o.land.z);
        o.yaw = Math.atan2(A.x - o.land.x, A.z - o.land.z);
        it.free = true; it.moving = true;
        this.api.fx.splash(o.land.x, o.land.y, o.land.z, 0.35);
      }
    } else if (o.phase === 'jump') {
      o.t += dt;
      const u = clamp(o.t / 1.1, 0, 1);
      o.pos.lerpVectors(o.p0, o.land, u);
      o.pos.y = lerp(o.p0.y, o.land.y, u * u) + Math.sin(Math.PI * u) * 2.5;
      this.placeFigure(it, o.pos, o.yaw, u > 0.9 ? 0.75 : 1);
      if (u >= 1) { o.phase = 'walk'; o.t = 0; }
    } else if (o.phase === 'walk') {
      o.t += dt;
      const dx = A.x - o.pos.x, dz = A.z - o.pos.z, l = Math.hypot(dx, dz) || 1;
      const sp = 2.4;
      if (o.t > 0.5) { o.pos.x += (dx / l) * sp * dt; o.pos.z += (dz / l) * sp * dt; }
      o.pos.y = ground(o.pos.x, o.pos.z);
      it.fig.animate(o.t > 0.5 ? sp : 0, dt);
      this.placeFigure(it, o.pos, Math.atan2(dx, dz), o.t < 0.5 ? lerp(0.75, 1, o.t / 0.5) : 1);
    }
  }

  placeFigure(it, pos, yaw, sy = 1) {
    const r = it.root;
    r.matrixAutoUpdate = false;
    r.matrix.compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, sy, 1));
    r.matrixWorldNeedsUpdate = true;
    r.visible = true;
  }

  // ---------------------------------------------------------------- камера
  lateUpdate(dt) {
    if (!this.active) return;
    const { game, K, ground } = this.api;
    const cam = game.camera, g = this.geo, c = this.c, cc = c - T_GO;
    const gA = ground(g.A.x, g.A.z);
    const base = this._v.set(g.A.x - g.F.x * 5 - g.R.x * 2, 0, g.A.z - g.F.z * 5 - g.R.z * 2);
    const bx = base.x, bz = base.z;
    const head = K.pos;
    const revealBase = this._w.set(g.reveal.x, ground(g.reveal.x, g.reveal.z) + 9, g.reveal.z);
    let shot, pos = this.camPos, goal = this.lookGoal, fov = this.fov, damp = 6;
    const oss = this.worm.riders.items[1];
    const ossPos = this.oss.phase === 'slide' || this.oss.phase === 'none'
      ? this.worm.riders._P.clone() : this.oss.pos.clone();
    if (this.oss.phase === 'slide') this.worm.spine.surfacePoint(oss.sNow, this.worm.riders.aBase + oss.da + oss.a, ossPos, this._n, 0.1);

    if (!this.go || cc < 0.6) {
      shot = 1;
      const e = c;
      pos.set(bx + g.F.x * 0.35 * e, gA + lerp(0.7, 1.55, smoothstep(0.5, 3.2, e)), bz + g.F.z * 0.35 * e);
      // сначала камешки у ног и взгляд влево, потом камера ведёт волну к точке выхода
      const low = this._n.set(g.A.x + (g.F.x * 0.45 - g.R.x * 0.9) * 12, gA + 0.15, g.A.z + (g.F.z * 0.45 - g.R.z * 0.9) * 12);
      const hx = head.x, hz = head.z;
      const track = this._tmp3 || (this._tmp3 = new THREE.Vector3());
      track.set(hx, ground(hx, hz) + lerp(3, 9, smoothstep(T_GO - 1.5, T_GO, c)), hz);
      goal.lerpVectors(low, track, smoothstep(0.9, 2.2, e));
      fov = lerp(56, 52, smoothstep(0, T_GO, c));
      damp = 4;
    } else if (cc < T_S3) {
      shot = 2;
      pos.set(bx + g.F.x * 1.7, gA + 1.55, bz + g.F.z * 1.7);
      const k = smoothstep(0.2, 3.8, cc);
      goal.copy(revealBase).lerp(head, 0.15 + 0.62 * k);
      fov = lerp(52, 72, smoothstep(0, 4.2, cc));
      damp = 3.2;
    } else if (cc < T_S4) {
      shot = 3;
      const t = cc - T_S3;
      // камера «перед пастью»: на земле, в ~115 м по курсу головы, чуть сбоку
      const hxn = Math.cos(K.yaw), hzn = Math.sin(K.yaw);
      const d = 118 - 1.2 * t;
      const px = head.x + hxn * d - hzn * 26, pz = head.z + hzn * d + hxn * 26;
      pos.set(px, ground(px, pz) + 2.2, pz);
      this.worm.body.mouthWorld(goal, this._n);
      fov = lerp(30, 21, smoothstep(0, 5.2, t));
      damp = 5;
    } else if (cc < T_S5) {
      shot = 4;
      const t = cc - T_S4;
      pos.set(bx + g.R.x * 9 - g.F.x * 8, gA + 0.9, bz + g.R.z * 9 - g.F.z * 8);
      const cen = this._n.set(0, 0, 0);
      const r = this.worm.riders;
      let n = 0;
      for (const it of r.items) { const p = this._tmp || (this._tmp = new THREE.Vector3()); this.worm.spine.surfacePoint(it.sNow, r.aBase + it.da + it.a, p, new THREE.Vector3(), 0.1); cen.add(p); n++; }
      cen.multiplyScalar(1 / n);
      goal.copy(cen).lerp(ossPos, smoothstep(1.2, 3.0, t));
      fov = lerp(48, 15, smoothstep(1.4, 3.8, t));
      damp = 4;
    } else {
      shot = 5;
      const t = cc - T_S5;
      pos.set(bx - g.F.x * 8 + g.R.x * 5 - g.F.x * 0.4 * t, gA + 1.3, bz - g.F.z * 8 + g.R.z * 5 - g.F.z * 0.4 * t);
      goal.copy(ossPos); goal.y += lerp(30, 22, smoothstep(0, 5, t));
      if (this.oss.phase === 'slide' || this.oss.phase === 'none') goal.copy(head).setY(head.y * 0.55 + 10);
      fov = lerp(52, 46, smoothstep(0, 6, t));
      damp = 3;
    }
    if (shot !== this.shot) { this.shot = shot; this.look.copy(goal); this._cut = true; this.fov = fov; }
    this.fov = lerp(this.fov, fov, 1 - Math.exp(-3 * dt));
    this.look.lerp(goal, 1 - Math.exp(-damp * dt));
    cam.position.copy(pos);
    // тряска камеры
    const sh = Math.min(1, game.shake || 0) * 0.22;
    const tt = game.time;
    cam.position.x += (Math.sin(tt * 41.3) + Math.sin(tt * 27.7 + 1.3)) * sh * 0.5;
    cam.position.y += (Math.sin(tt * 37.1 + 2.1) + Math.sin(tt * 23.3)) * sh * 0.5;
    cam.position.z += (Math.sin(tt * 33.7 + 0.4) + Math.sin(tt * 29.9 + 3.1)) * sh * 0.5;
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
