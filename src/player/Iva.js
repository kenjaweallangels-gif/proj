import * as THREE from 'three';
import { containSphere } from '../station/interior/Volumes.js';
import { closestOnSegment } from './Collision.js';
import { bodyDims } from './Body.js';
import { COLLIDE } from '../core/CollisionWorld.js';

/**
 * Intravehicular movement (player modes 'iva' and 'airlock'): the astronaut inside the pressurised volume.
 * The body is 1.8 m tall (src/player/Body.js); `player.position` is the eye. Collisions use the real interior
 * geometry (ctx.collision, layers INTERIOR | DOORS); the compartment volumes stay as a coarse safety net for the eye.
 * The body mechanics (src/player/Mechanics.js, `player.mech`) move the body and drive the hand / foot targets.
 *
 * Station frame (core modules, nodes, airlock, tunnels, static parts of the ring hub): zero-g. WASD / Space /
 * Ctrl give the movement intent: the hands grip the handrails (or the walls) within reach and pull the body
 * along hand over hand; approaching a wall the hands brake. G grabs a rail explicitly, Space pushes off,
 * V stops with the hands, X toggles auto-levelling to the module's "overhead".
 *
 * Ring frame (habitat ring, spokes and the hub's rotating collar): the body moves in the ring's rotating frame
 * with the centrifugal (omega^2 r) and Coriolis (-2 omega x v) accelerations, so the deck is "down" and walking
 * spinward makes you heavier, anti-spinward lighter, climbing pushes you sideways. Walking on the deck with the
 * eye 1.68 m above it, ladders in the spokes (auto) and in the sector halls (E), weak gravity in the hub.
 * Frame changes convert position, velocity and orientation exactly (v_rot = R^-1 v - omega x r).
 */

const WALK_SPEED = 1.4, RUN_SPEED = 2.6, JUMP = 1.3;
const CLIMB_SPEED = 0.85;
const MOUSE = 0.0022, ROLL_RATE = 1.0;
const PUSH_OFF = 1.1;
const MASK = COLLIDE.INTERIOR | COLLIDE.DOORS;
const EYE_SLACK = 0.25;    // the eye may leave the compartment volumes by this much before the safety net acts

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3();
const _f0 = new THREE.Vector3();
const _r0 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _wquat = new THREE.Quaternion();
const _push = new THREE.Vector3();
const _intent = new THREE.Vector3();
const _move = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), t: 0, distance: 0 };
const _zg = { pos: null, vel: null, quat: new THREE.Quaternion(), suited: false, mask: MASK, intent: _intent, boost: false, stop: false, rails: null, extAcc: null };
const _wk = { pos: null, vel: null, up: _up, facing: _flat, suited: false, mask: MASK, g: 0, move: _move, jump: false, accel: _acc, jumpSpeed: JUMP };

export class IvaController {
  constructor(player, ctx) {
    this.player = player;
    this.ctx = ctx;
    this.frame = 'station';
    this.zone = null;
    // ring-frame state (ring-local; pL is the eye)
    this.pL = new THREE.Vector3();
    this.vL = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;          // relative to the local deck frame (spinward / up)
    this.grounded = false;
    this.ladder = null; this.ladderS = 0; this.ladderSway = 0; this.ladderSwayV = 0;
    this.contact = false;
    this.lastPhi = 0;
    this.accel = new THREE.Vector3();      // apparent gravity (ring-local), for the HUD
    this.coriolis = 0;
    this.stepTimer = 0;
  }

  get interior() { return this.ctx.station?.interior || null; }
  get mech() { return this.player.mech; }
  get dims() { return bodyDims(this.player.state.suited); }

  /** Body (capsule) radius: unsuited 0.3 m, in the suit 0.42 m. */
  radius() { return this.dims.radius; }

  // ------------------------------------------------------------------------------------------ placement
  /** Place in the station frame with the eye at world position pos looking along dir (zero-g pose). */
  placeStation(pos, dir) {
    const p = this.player;
    this.frame = 'station';
    this.ladder = null;
    const q = p.lookAlong(pos, dir);
    p.body.reset(pos, q);
    this.mech?.setFrame(null);
    this.mech?.reset(_v.set(0, 1, 0).applyQuaternion(q));
    this.zone = this.interior?.locate(pos, null, 0.3) || null;
  }

  /** Place in the ring frame: ring-local (x, rho, phi) of the eye (snapped to the deck below), yaw / pitch. */
  placeRing(x, rho, phi, yaw = 0, pitch = 0, ladder = false) {
    const I = this.interior;
    this.frame = 'ring';
    this.pL.set(x, rho * Math.cos(phi), rho * Math.sin(phi));
    this.vL.set(0, 0, 0);
    this.yaw = yaw; this.pitch = pitch;
    this.lastPhi = phi;
    this.ladder = null;
    this.grounded = false;
    if (I) {
      I._ringUpdate();
      this.mech?.setFrame(this.ctx.station.ring.group);
      this._deckBasis();
      this.mech?.reset(_up);
      this.zone = this._locateRing();
      if (ladder) this._attachNearestLadder(true);
      else this._snapToDeck();
    }
    this._writeWorld(0);
  }

  /** Put the soles on the deck below the eye (placement). */
  _snapToDeck() {
    const W = this.ctx.collision;
    if (!W?.ready) return;
    this._deckBasis();
    _v.copy(_up).negate();
    if (W.raycast(this.pL, _v, 3.0, _hit, { mask: MASK, frame: this.ctx.station.ring.group }) && _hit.normal.dot(_up) > 0.5) {
      this.pL.copy(_hit.point).addScaledVector(_up, this.dims.eyeHeight);
      this.grounded = true;
      if (this.mech) this.mech.grounded = true;
    }
  }

  // ------------------------------------------------------------------------------------------ main
  update(h, inp, mdx, mdy, roll, allowMouse) {
    const I = this.interior;
    const p = this.player, st = p.state;
    if (!I || !I.ready) { p.body.integrate(h); return; }
    I._ringUpdate();
    // which compartment / frame are we in?
    if (this.frame === 'station') {
      this.zone = I.locate(p.position, this.zone, 0.6) || this.zone;
      if (I.frameFor(this.zone, p.position) === 'ring') this._toRing();
    } else {
      I.toWorldFromRing(this.pL, _v);
      const z = this._locateRing() || I.locate(_v, this.zone, 0.6) || this.zone;
      this.zone = z;
      if (z && I.frameFor(z, _v) === 'station') this._toStation();
    }
    if (this.frame === 'station') this._updateZeroG(h, inp, mdx, mdy, roll, allowMouse);
    else this._updateRing(h, inp, mdx, mdy, roll, allowMouse);
    st.compartment = this.zone ? this._compartmentName() : '';
    st.frame = this.frame;
    st.onLadder = !!this.ladder;
  }

  _compartmentName() {
    const z = this.zone;
    if (z.commonRange && this.frame === 'ring') {
      let phi = Math.atan2(this.pL.z, this.pL.y); if (phi < 0) phi += Math.PI * 2;
      let a = z.commonRange.a % (Math.PI * 2), b = z.commonRange.b % (Math.PI * 2);
      if (b < a) b += Math.PI * 2; if (phi < a) phi += Math.PI * 2;
      if (phi > a && phi < b) return `${z.commonName} · ${z.name.replace('Коридор кольца · ', '')}`;
    }
    return z.name;
  }

  _locateRing() {
    const I = this.interior;
    // ring-local point test against ring zones and the hub (station zone, symmetric)
    I.toWorldFromRing(this.pL, _v3);
    return I.locate(_v3, this.zone, 0.6);
  }

  /** Movement intent from WASD / Space / Ctrl in the view frame (components -1..1). */
  _intentLocal(inp, out) {
    return out.set(inp.axis('KeyA', 'KeyD'), (inp.isDown('Space') ? 1 : 0) - (inp.isDown('ControlLeft') || inp.isDown('ControlRight') ? 1 : 0), -inp.axis('KeyS', 'KeyW'));
  }

  // ------------------------------------------------------------------------------------------ zero-g (station frame)
  _updateZeroG(h, inp, mdx, mdy, roll, allowMouse) {
    const p = this.player, st = p.state, body = p.body, I = this.interior, mech = this.mech;
    mech.setFrame(null);
    // look: direct yaw / pitch about the body axes, Q/E roll; auto-level toward the module's overhead
    if (allowMouse && (mdx || mdy)) {
      _q.setFromAxisAngle(_v.set(0, 1, 0), -mdx * MOUSE); body.quaternion.multiply(_q);
      _q.setFromAxisAngle(_v.set(1, 0, 0), -mdy * MOUSE); body.quaternion.multiply(_q);
    }
    if (roll) { _q.setFromAxisAngle(_v.set(0, 0, 1), -roll * ROLL_RATE * h); body.quaternion.multiply(_q); }
    else if (st.autoLevel && this.zone) this._autoLevel(this.zone.up, h);
    // small body rotation from off-centre pushes (damped by the astronaut)
    const wb = mech.wobble;
    if (wb.lengthSq() > 1e-8) { const w = wb.length(); _q.setFromAxisAngle(_v.copy(wb).multiplyScalar(1 / w), w * h); body.quaternion.multiply(_q); }
    body.quaternion.normalize();
    body.omega.set(0, 0, 0);
    body.thrusting = false;
    if (st.holding) {
      // holding a handrail (G): crawl along it, push off with Space
      p._findHandrailIn(I.handrails);
      this._hold(h, inp);
      mech.holdTargets(h, p.handrailPoint, st.holding, inp.axis('KeyA', 'KeyD') + inp.axis('KeyS', 'KeyW'), null);
      this._contain(body.position, body.velocity, 'station');
      this.contact = true;
      p.state.gravity = 0; this.accel.set(0, 0, 0);
      return;
    }
    // movement intent -> the hands (hand over hand on rails / walls, auto-brake), move and slide
    this._intentLocal(inp, _intent);
    if (_intent.lengthSq() > 1) _intent.normalize();
    _intent.applyQuaternion(body.quaternion);
    _zg.pos = body.position; _zg.vel = body.velocity; _zg.quat.copy(body.quaternion);
    _zg.suited = st.suited; _zg.boost = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
    _zg.stop = inp.isDown('KeyV'); _zg.rails = I.handrails; _zg.extAcc = null; _zg.mask = MASK; _zg.safer = false;
    if (!_zg.stop && _intent.lengthSq() === 0) body.velocity.multiplyScalar(Math.exp(-h * 0.02));   // air drag
    mech.stepZeroG(h, _zg);
    p._findHandrailIn(I.handrails);
    if (inp.wasPressed('KeyG') && st.nearHandrail) p._grab(st.nearHandrail);
    // push off a wall: Space while touching
    if (inp.wasPressed('Space') && (mech.contact || mech.braking)) { _v.set(0, 0, -1).applyQuaternion(body.quaternion); body.velocity.addScaledVector(_v, PUSH_OFF * (st.suited ? 0.4 : 0.6)); mech.emit('push', PUSH_OFF * 0.6, body.position, 'hands'); this.ctx.audio?.play?.('release'); }
    this._contain(body.position, body.velocity, 'station');
    this.contact = mech.contact || mech.braking;
    if (mech.bump(body.position)) this.ctx.audio?.play?.('impact', { strength: Math.min(0.4, mech.impact * 0.25) });
    p.state.gravity = 0;
    this.accel.set(0, 0, 0);
  }

  /** Safety net: keep the eye within the compartment volumes (+ slack); no collision world: the old sphere containment. */
  _contain(pos, vel, frame) {
    const vols = this.interior.volumesFor(this.zone, frame);
    if (!vols.length) return;
    if (this.ctx.collision?.ready) containSphere(pos, vel, -EYE_SLACK, vols, 0, 0, _push);
    else containSphere(pos, vel, this.radius(), vols, 0.15, 0.25, _push);
  }

  /** Roll the body about its view axis so its up vector leans toward `up` (world). */
  _autoLevel(up, h) {
    const q = this.player.body.quaternion;
    _fwd.set(0, 0, -1).applyQuaternion(q);
    _camUp.set(0, 1, 0).applyQuaternion(q);
    // desired up: zone up projected onto the plane perpendicular to the view
    _v.copy(up).addScaledVector(_fwd, -up.dot(_fwd));
    if (_v.lengthSq() < 0.05) return;
    _v.normalize();
    const ang = Math.atan2(_v2.crossVectors(_camUp, _v).dot(_fwd), _camUp.dot(_v));
    const step = THREE.MathUtils.clamp(ang, -0.7 * h, 0.7 * h);
    _q.setFromAxisAngle(_v3.set(0, 0, 1), step);
    q.multiply(_q);
  }

  _hold(h, inp) {
    const p = this.player, st = p.state, rail = st.holding, body = p.body;
    const along = inp.axis('KeyA', 'KeyD') + inp.axis('KeyS', 'KeyW');
    const len = rail.a.distanceTo(rail.b);
    if (along !== 0 && len > 1e-4) {
      _v.subVectors(rail.b, rail.a).multiplyScalar(1 / len);
      _v2.set(1, 0, 0).applyQuaternion(body.quaternion);
      const sign = _v.dot(_v2) >= 0 ? 1 : -1;
      p.holdT = THREE.MathUtils.clamp(p.holdT + (along * sign * (st.suited ? 0.5 : 0.8) * h) / len, 0, 1);
    }
    p.handrailPoint.copy(rail.a).lerp(rail.b, p.holdT);
    body.position.copy(p.handrailPoint).add(p.holdOffset);
    body.velocity.set(0, 0, 0);
    // the held body still may not overlap the geometry
    const W = this.ctx.collision, d = this.dims;
    if (W?.ready) {
      _v.set(0, 0, 1).applyQuaternion(body.quaternion);
      _v3.copy(body.position).addScaledVector(_v, d.headBack);
      if (W.resolveSphere(_v3, d.headRadius, null, { mask: MASK })) { body.position.add(W.lastPush); p.holdOffset.subVectors(body.position, p.handrailPoint); }
    }
    if (inp.wasPressed('Space')) { _v.set(0, 0, -1).applyQuaternion(body.quaternion); p._release(_v, PUSH_OFF); this.mech.emit('push', PUSH_OFF, p.handrailPoint, 'right'); }
    else if (inp.wasPressed('KeyG')) { p._release(); this.mech.emit('release', 0.2, p.handrailPoint, 'right'); }
  }

  // ------------------------------------------------------------------------------------------ ring frame
  /** Local deck basis at the current position: up (toward the axis), f0 (spinward), r0 (right when facing f0). */
  _deckBasis() {
    const y = this.pL.y, z = this.pL.z, rho = Math.hypot(y, z);
    let phi = this.lastPhi;
    if (rho > 0.4) { phi = Math.atan2(z, y); this.lastPhi = phi; }
    const c = Math.cos(phi), s = Math.sin(phi);
    _up.set(0, -c, -s);
    _f0.set(0, -s, c);
    _r0.set(1, 0, 0);
    return rho;
  }

  _viewBasis() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    _fwd.copy(_f0).multiplyScalar(cy * cp).addScaledVector(_r0, sy * cp).addScaledVector(_up, sp);
    _right.copy(_r0).multiplyScalar(cy).addScaledVector(_f0, -sy);
    _camUp.crossVectors(_right, _fwd);
  }

  _updateRing(h, inp, mdx, mdy, roll, allowMouse) {
    const p = this.player, st = p.state, I = this.interior, mech = this.mech;
    const w = I.omega;
    mech.setFrame(this.ctx.station.ring.group);
    const rho = this._deckBasis();
    if (allowMouse) { this.yaw += mdx * MOUSE; this.pitch = THREE.MathUtils.clamp(this.pitch - mdy * MOUSE, -1.5, 1.5); }
    this._viewBasis();
    // apparent gravity at this radius (centrifugal), for the HUD and the physics
    const g = w * w * rho;
    st.gravity = g / 9.81;
    if (this.ladder) { this._updateLadder(h, inp, w); this._writeWorld(h); return; }
    // fictitious accelerations (rotating frame): centrifugal + Coriolis
    _acc.set(0, w * w * this.pL.y + 2 * w * this.vL.z, w * w * this.pL.z - 2 * w * this.vL.y);
    this.accel.copy(_acc);
    this.coriolis = 2 * w * Math.hypot(this.vL.y, this.vL.z) * Math.abs(_f0.dot(_v.copy(this.vL).normalize()) || 0);
    const boost = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
    const mx = inp.axis('KeyA', 'KeyD'), mz = inp.axis('KeyS', 'KeyW');
    const lowG = g < 1.2;
    if (!lowG) {
      // walk: desired horizontal velocity from the input in the deck plane
      _flat.copy(_fwd).addScaledVector(_up, -_fwd.dot(_up));
      if (_flat.lengthSq() < 1e-6) _flat.copy(_f0).multiplyScalar(Math.cos(this.yaw)).addScaledVector(_r0, Math.sin(this.yaw));
      _flat.normalize();
      _move.copy(_flat).multiplyScalar(mz);
      _v.crossVectors(_flat, _up).normalize();               // right in the deck plane
      _move.addScaledVector(_v, mx);
      if (_move.lengthSq() > 1) _move.normalize();
      _move.multiplyScalar((boost ? RUN_SPEED : WALK_SPEED) * (st.suited ? 0.6 : 1));
      _wk.pos = this.pL; _wk.vel = this.vL; _wk.suited = st.suited; _wk.g = g; _wk.mask = MASK;
      _wk.jump = mech.grounded && inp.wasPressed('Space');
      _wk.airMove = null;
      mech.grounded = this.grounded;
      mech.stepWalk(h, _wk);
      this.grounded = mech.grounded;
      if (this.grounded && !(mx || mz)) {
        // standing still: deck friction
        const vUp = this.vL.dot(_up);
        this.vL.multiplyScalar(Math.exp(-h * 10)).addScaledVector(_up, vUp * (1 - Math.exp(-h * 10)));
      }
    } else {
      // weak gravity near the hub: zero-g mechanics in the rotating frame (hands on the collar rails)
      this._intentLocal(inp, _intent);
      if (_intent.lengthSq() > 1) _intent.normalize();
      _v.copy(_right).multiplyScalar(_intent.x).addScaledVector(_camUp, _intent.y).addScaledVector(_fwd, -_intent.z);
      _intent.copy(_v);
      _m.makeBasis(_right, _camUp, _v.copy(_fwd).negate());
      _zg.quat.setFromRotationMatrix(_m);
      _zg.pos = this.pL; _zg.vel = this.vL; _zg.suited = st.suited; _zg.boost = boost; _zg.stop = inp.isDown('KeyV');
      _zg.rails = I.ringRails; _zg.extAcc = _acc; _zg.mask = MASK; _zg.safer = false;
      mech.stepZeroG(h, _zg);
      this.grounded = false;
    }
    this._contain(this.pL, this.vL, 'ring');
    this.contact = mech.contact || mech.grounded;
    if (mech.bump(this.pL)) this.ctx.audio?.play?.('impact', { strength: Math.min(0.4, mech.impact * 0.25) });
    // ladder in a sector hall: E to step on (prompt); spokes: automatic
    this._ladderNear = this._nearestLadder(1.0);
    if (this.zone && /^spoke/.test(this.zone.id)) this._attachNearestLadder(false);
    else if (this._ladderNear && inp.wasPressed('KeyE')) this._attachNearestLadder(false);
    this._writeWorld(h);
  }

  _nearestLadder(maxDist) {
    const I = this.interior;
    let best = null, bd = maxDist;
    for (const l of I.ladders) {
      const t = closestOnSegment(l.a, l.b, this.pL, _v);
      const d = _v.distanceTo(this.pL);
      if (d < bd) { bd = d; best = { ladder: l, t }; }
    }
    return best;
  }

  _attachNearestLadder(force) {
    const n = this._nearestLadder(force ? 3 : 1.4);
    if (!n) return;
    const L = n.ladder.a.distanceTo(n.ladder.b);
    this.ladder = n.ladder;
    this.ladderS = Math.min(n.t * L, L - this.dims.eyeHeight);
    this.ladderSway = 0; this.ladderSwayV = 0;
    this.vL.set(0, 0, 0);
    this.grounded = false;
    this.ctx.audio?.play?.('grab');
    this.mech?.emit('grab', 0.4, this.pL, 'hands');
  }

  _updateLadder(h, inp, w) {
    const l = this.ladder, L = l.a.distanceTo(l.b), mech = this.mech;
    const sMax = L - this.dims.eyeHeight;                                // soles on the floor at the bottom
    // climb direction: W moves toward where you look along the ladder (up unless looking down)
    const lookDown = _fwd.dot(l.up) < -0.35;
    const along = inp.axis('KeyS', 'KeyW') * (lookDown ? -1 : 1);       // +1 = up (toward the hub)
    const speed = (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight') ? 1.6 : 1) * CLIMB_SPEED * (this.player.state.suited ? 0.6 : 1);
    const vr = -along * speed;                                           // along the ladder a -> b (outward)
    const prevS = this.ladderS;
    this.ladderS = THREE.MathUtils.clamp(this.ladderS + vr * h, 0, sMax);
    const ds = this.ladderS - prevS;
    // Coriolis: radial motion v_r gives 2 omega v_r sideways (anti-spinward going down); the grip is a spring
    const vRad = h > 0 ? ds / h : 0;
    const aSide = -2 * w * vRad;                                         // along the spinward side vector
    this.coriolis = Math.abs(aSide);
    this.ladderSwayV += (aSide - 30 * this.ladderSway - 9 * this.ladderSwayV) * h;
    this.ladderSway += this.ladderSwayV * h;
    _v.copy(l.a).lerp(l.b, this.ladderS / L);
    this.pL.copy(_v).addScaledVector(l.side, 0.42 + this.ladderSway);
    this.vL.copy(l.b).sub(l.a).multiplyScalar(vRad / L);
    const rho = Math.hypot(this.pL.y, this.pL.z);
    this.accel.set(0, w * w * this.pL.y, w * w * this.pL.z);
    mech.ladderTravel = (mech.ladderTravel || 0) + Math.abs(ds);
    mech.ladderTargets(h, l, this.pL, this.player.state.suited);
    if (ds !== 0) { this.stepTimer -= Math.abs(ds) / 0.33; if (this.stepTimer <= 0) { this.stepTimer = 1; this.ctx.audio?.play?.('rung'); } }
    // leave the ladder: at the bottom (deck) going down, at the top (hub) going up, or G / Space
    const atBottom = this.ladderS >= sMax - 0.02 && along < 0;
    const atTop = this.ladderS <= 0.02 && along > 0;
    if (atBottom) { this.ladder = null; this.pL.addScaledVector(l.side, 0.3); this.vL.set(0, 0, 0); this.grounded = true; mech.grounded = true; mech.emit('release', 0.2, this.pL, 'hands'); }
    else if (atTop || inp.wasPressed('KeyG') || (inp.wasPressed('Space') && rho < 8)) { this.ladder = null; this.vL.addScaledVector(l.up, 0.4); mech.emit('push', 0.4, this.pL, 'hands'); }
  }

  /** Write the world pose (position, quaternion, velocity) from the ring-local state. */
  _writeWorld() {
    const I = this.interior, p = this.player, body = p.body;
    this._deckBasis(); this._viewBasis();
    // the camera follows the legs: landing compression (crouch)
    const crouch = this.ladder ? 0 : (this.mech?.crouch || 0);
    _v.copy(this.pL).addScaledVector(_up, -Math.max(0, crouch));
    I.toWorldFromRing(_v, body.position);
    // camera basis in ring-local -> quaternion, then the ring rotation
    _m.makeBasis(_right, _camUp, _v.copy(_fwd).negate());
    _q.setFromRotationMatrix(_m);
    this.ctx.station.ring.group.getWorldQuaternion(_wquat);
    body.quaternion.copy(_wquat).multiply(_q);
    // inertial velocity: R (v + omega x r)
    const w = I.omega;
    _v.set(this.vL.x, this.vL.y - w * this.pL.z, this.vL.z + w * this.pL.y).applyQuaternion(_wquat);
    body.velocity.copy(_v);
    body.omega.set(0, 0, 0);
  }

  // ------------------------------------------------------------------------------------------ frame changes
  _toRing() {
    const I = this.interior, body = this.player.body, w = I.omega;
    this.frame = 'ring';
    I.toRing(body.position, this.pL);
    this.ctx.station.ring.group.getWorldQuaternion(_wquat);
    _q2.copy(_wquat).invert();
    _v.copy(body.velocity).applyQuaternion(_q2);
    this.vL.set(_v.x, _v.y + w * this.pL.z, _v.z - w * this.pL.y);
    // orientation -> yaw / pitch in the local deck frame
    this._deckBasis();
    _v.set(0, 0, -1).applyQuaternion(body.quaternion).applyQuaternion(_q2);
    this.pitch = Math.asin(THREE.MathUtils.clamp(_v.dot(_up), -1, 1));
    this.yaw = Math.atan2(_v.dot(_r0), _v.dot(_f0));
    this.grounded = false;
    this.ladder = null;
    this.mech?.setFrame(this.ctx.station.ring.group);
  }

  _toStation() {
    this._writeWorld();
    this.frame = 'station';
    this.ladder = null;
    this.player.body.omega.set(0, 0, 0);
    this.mech?.setFrame(null);
  }

  /** Prompt hint for the HUD (IVA-specific parts). */
  prompt() {
    if (this.ladder) return 'W/S — вверх / вниз по лестнице · G — отпустить';
    if (this.frame === 'ring' && this._ladderNear && !(this.zone && /^spoke/.test(this.zone.id))) return 'E — встать на лестницу';
    return '';
  }
}
