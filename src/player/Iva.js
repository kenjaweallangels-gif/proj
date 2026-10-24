import * as THREE from 'three';
import { containSphere } from '../station/interior/Volumes.js';
import { colliderDistance, closestOnSegment } from './Collision.js';

/**
 * Intravehicular movement (player modes 'iva' and 'airlock'): the astronaut inside the pressurised volume.
 *
 * Station frame (core modules, nodes, airlock, tunnels, static parts of the ring hub): zero-g. WASD / Space /
 * Ctrl glide (pushing off with the hands, ~0.9 m/s^2, no SAFER propellant), soft collisions with the cabin
 * volume and equipment, handrail grabbing (G) and push-off (Space), optional auto-levelling to the module's
 * "overhead" (X).
 *
 * Ring frame (habitat ring, spokes and the hub's rotating collar): the body moves in the ring's rotating frame
 * with the centrifugal (omega^2 r) and Coriolis (-2 omega x v) accelerations, so the deck is "down" and walking
 * spinward makes you heavier, anti-spinward lighter, climbing pushes you sideways. Walking on the deck,
 * ladders in the spokes (auto) and in the sector halls (E), weak gravity in the hub.
 * Frame changes convert position, velocity and orientation exactly (v_rot = R^-1 v - omega x r).
 */

const GLIDE_ACC = 0.9, GLIDE_MAX = 1.6, GLIDE_BOOST = 2.0;
const WALK_SPEED = 1.5, RUN_SPEED = 2.8, WALK_ACC = 9.0, JUMP = 1.3;
const CLIMB_SPEED = 0.85;
const MOUSE = 0.0022, ROLL_RATE = 1.0;
const PUSH_OFF = 1.1;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _n = new THREE.Vector3();
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

export class IvaController {
  constructor(player, ctx) {
    this.player = player;
    this.ctx = ctx;
    this.frame = 'station';
    this.zone = null;
    // ring-frame state (ring-local)
    this.pL = new THREE.Vector3();
    this.vL = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;          // relative to the local deck frame (spinward / up)
    this.grounded = false; this._groundTimer = 0;
    this.ladder = null; this.ladderS = 0; this.ladderSway = 0; this.ladderSwayV = 0;
    this.contact = false;
    this.lastPhi = 0;
    this.accel = new THREE.Vector3();      // apparent gravity (ring-local), for the HUD
    this.coriolis = 0;
    this.stepTimer = 0;
  }

  get interior() { return this.ctx.station?.interior || null; }

  /** Body radius: unsuited 0.3 m, in the suit 0.42 m. */
  radius() { return this.player.state.suited ? 0.42 : 0.3; }

  // ------------------------------------------------------------------------------------------ placement
  /** Place in the station frame at world position pos looking along dir (zero-g pose). */
  placeStation(pos, dir) {
    const p = this.player;
    this.frame = 'station';
    this.ladder = null;
    const q = p.lookAlong(pos, dir);
    p.body.reset(pos, q);
    this.zone = this.interior?.locate(pos, null, 0.3) || null;
  }

  /** Place in the ring frame: ring-local (x, rho, phi), view yaw/pitch relative to the deck frame. */
  placeRing(x, rho, phi, yaw = 0, pitch = 0, ladder = false) {
    const I = this.interior;
    this.frame = 'ring';
    this.pL.set(x, rho * Math.cos(phi), rho * Math.sin(phi));
    this.vL.set(0, 0, 0);
    this.yaw = yaw; this.pitch = pitch;
    this.lastPhi = phi;
    this.ladder = null;
    if (I) {
      I._ringUpdate();
      this.zone = this._locateRing();
      if (ladder) this._attachNearestLadder(true);
    }
    this._writeWorld(0);
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

  // ------------------------------------------------------------------------------------------ zero-g (station frame)
  _updateZeroG(h, inp, mdx, mdy, roll, allowMouse) {
    const p = this.player, st = p.state, body = p.body, I = this.interior;
    const rad = this.radius();
    // look: direct yaw / pitch about the body axes, Q/E roll; auto-level toward the module's overhead
    if (allowMouse && (mdx || mdy)) {
      _q.setFromAxisAngle(_v.set(0, 1, 0), -mdx * MOUSE); body.quaternion.multiply(_q);
      _q.setFromAxisAngle(_v.set(1, 0, 0), -mdy * MOUSE); body.quaternion.multiply(_q);
    }
    if (roll) { _q.setFromAxisAngle(_v.set(0, 0, 1), -roll * ROLL_RATE * h); body.quaternion.multiply(_q); }
    else if (st.autoLevel && this.zone) this._autoLevel(this.zone.up, h);
    body.quaternion.normalize();
    body.omega.set(0, 0, 0);
    // holding a handrail
    if (st.holding) {
      p._findHandrailIn(I.handrails);
      this._hold(h, inp);
    } else {
      // glide
      _v.set(inp.axis('KeyA', 'KeyD'), (inp.isDown('Space') ? 1 : 0) - (inp.isDown('ControlLeft') || inp.isDown('ControlRight') ? 1 : 0), -inp.axis('KeyS', 'KeyW'));
      const boost = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
      const vmax = boost ? GLIDE_MAX * GLIDE_BOOST : GLIDE_MAX;
      if (_v.lengthSq() > 0) {
        _v.normalize().applyQuaternion(body.quaternion);
        const along = body.velocity.dot(_v);
        if (along < vmax) body.velocity.addScaledVector(_v, Math.min(vmax - along, GLIDE_ACC * (boost ? 1.8 : 1) * h));
        p._exertion = Math.min(1, p._exertion + 0.05 * h);
      } else body.velocity.multiplyScalar(Math.exp(-h * (inp.isDown('KeyV') ? 3.0 : 0.12)));
      body.thrusting = false;
      p._findHandrailIn(I.handrails);
      if (inp.wasPressed('KeyG') && st.nearHandrail) p._grab(st.nearHandrail);
      // push off a wall: Space while touching
      if (inp.wasPressed('Space') && this.contact) { _v.set(0, 0, -1).applyQuaternion(body.quaternion); body.velocity.addScaledVector(_v, PUSH_OFF * 0.6); this.ctx.audio?.play?.('release'); }
      body.position.addScaledVector(body.velocity, h);
    }
    // collisions: stay inside the compartments, bounce softly off equipment
    const vols = I.volumesFor(this.zone, 'station');
    const pushed = containSphere(body.position, body.velocity, rad, vols, 0.15, 0.25, _push);
    let solidHit = false;
    for (const c of I.solidsFor(this.zone, 'station')) {
      const d = colliderDistance(c, body.position, _n);
      if (d < rad) {
        body.position.addScaledVector(_n, rad - d);
        const vn = body.velocity.dot(_n);
        if (vn < 0) body.velocity.addScaledVector(_n, -1.15 * vn);
        solidHit = true;
      }
    }
    const hitSpeed = pushed > 0 ? Math.abs(body.velocity.dot(_push)) : 0;
    this.contact = pushed > 0 || solidHit;
    if (this.contact && body.velocity.lengthSq() > 0.36 && !this._bumped) { this.ctx.audio?.play?.('impact', { strength: Math.min(0.4, body.velocity.length() * 0.2) }); this._bumped = true; }
    if (!this.contact) this._bumped = false;
    void hitSpeed;
    p.state.gravity = 0;
    this.accel.set(0, 0, 0);
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
      p.holdT = THREE.MathUtils.clamp(p.holdT + (along * sign * 0.8 * h) / len, 0, 1);
    }
    p.handrailPoint.copy(rail.a).lerp(rail.b, p.holdT);
    body.position.copy(p.handrailPoint).add(p.holdOffset);
    body.velocity.set(0, 0, 0);
    if (inp.wasPressed('Space')) { _v.set(0, 0, -1).applyQuaternion(body.quaternion); p._release(_v, PUSH_OFF); }
    else if (inp.wasPressed('KeyG')) p._release();
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
    const p = this.player, st = p.state, I = this.interior;
    const w = I.omega, rad = this.radius();
    const rho = this._deckBasis();
    if (allowMouse) { this.yaw += mdx * MOUSE; this.pitch = THREE.MathUtils.clamp(this.pitch - mdy * MOUSE, -1.5, 1.5); }
    this._viewBasis();
    // apparent gravity at this radius (centrifugal), for the HUD and the physics
    const g = w * w * rho;
    st.gravity = g / 9.81;
    if (this.ladder) this._updateLadder(h, inp, w);
    else {
      // fictitious accelerations (rotating frame): centrifugal + Coriolis
      const ax = 0, ay = w * w * this.pL.y + 2 * w * this.vL.z, az = w * w * this.pL.z - 2 * w * this.vL.y;
      this.accel.set(ax, ay, az);
      this.coriolis = 2 * w * Math.hypot(this.vL.y, this.vL.z) * Math.abs(_f0.dot(_v.copy(this.vL).normalize()) || 0);
      const boost = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
      const mx = inp.axis('KeyA', 'KeyD'), mz = inp.axis('KeyS', 'KeyW');
      const lowG = g < 1.2;
      if (this.grounded && !lowG) {
        // walk: horizontal velocity tracks the input in the deck plane
        _v.copy(_fwd).addScaledVector(_up, -_fwd.dot(_up)).normalize().multiplyScalar(mz);
        _v.addScaledVector(_right, mx);
        if (_v.lengthSq() > 1) _v.normalize();
        _v.multiplyScalar(boost ? RUN_SPEED : WALK_SPEED);
        const vUp = this.vL.dot(_up);
        _v2.copy(this.vL).addScaledVector(_up, -vUp);              // current horizontal velocity
        _v3.subVectors(_v, _v2);
        const dv = _v3.length(), maxDv = WALK_ACC * h;
        if (dv > maxDv) _v3.multiplyScalar(maxDv / dv);
        this.vL.add(_v3);
        if (inp.wasPressed('Space')) { this.vL.addScaledVector(_up, JUMP); this.grounded = false; this._groundTimer = 0.2; }
        // footsteps
        if (_v2.length() > 0.4) { this.stepTimer -= h * _v2.length() / 1.4; if (this.stepTimer <= 0) { this.stepTimer = 0.5; this.ctx.audio?.play?.('step'); } }
      } else {
        // airborne / weak gravity near the hub: glide with the hands
        _v.set(mx, (inp.isDown('Space') ? 1 : 0) - (inp.isDown('ControlLeft') || inp.isDown('ControlRight') ? 1 : 0), -mz);
        if (_v.lengthSq() > 0) {
          _v2.copy(_right).multiplyScalar(_v.x).addScaledVector(_camUp, _v.y).addScaledVector(_fwd, -_v.z).normalize();
          const acc = lowG ? GLIDE_ACC : 0.35;
          this.vL.addScaledVector(_v2, acc * h);
        }
        if (lowG && !_v.lengthSq()) this.vL.multiplyScalar(Math.exp(-h * 0.1));
      }
      this.vL.x += ax * h; this.vL.y += ay * h; this.vL.z += az * h;
      this.pL.addScaledVector(this.vL, h);
      // collisions in the ring frame (containment + equipment)
      const vols = I.volumesFor(this.zone, 'ring');
      const pushed = containSphere(this.pL, this.vL, rad, vols, 0.0, 0.0, _push);
      let ground = pushed > 0 && _push.dot(_up) > 0.6;
      for (const c of I.solidsFor(this.zone, 'ring')) {
        const d = colliderDistance(c, this.pL, _n);
        if (d < rad) {
          this.pL.addScaledVector(_n, rad - d);
          const vn = this.vL.dot(_n);
          if (vn < 0) this.vL.addScaledVector(_n, -vn);
          if (_n.dot(_up) > 0.6) ground = true;
        }
      }
      this._groundTimer -= h;
      if (ground) { this.grounded = true; this._groundTimer = 0.12; }
      else if (this._groundTimer <= 0) this.grounded = false;
      if (this.grounded && !lowG && !(mx || mz)) {
        // standing still: deck friction
        const vUp = this.vL.dot(_up);
        this.vL.multiplyScalar(Math.exp(-h * 10)).addScaledVector(_up, vUp * (1 - Math.exp(-h * 10)));
      }
      // ladder in a sector hall: E to step on (prompt); spokes: automatic
      this._ladderNear = this._nearestLadder(1.0);
      if (this.zone && /^spoke/.test(this.zone.id)) this._attachNearestLadder(false);
      else if (this._ladderNear && inp.wasPressed('KeyE')) this._attachNearestLadder(false);
    }
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
    this.ladder = n.ladder;
    this.ladderS = n.t * n.ladder.a.distanceTo(n.ladder.b);
    this.ladderSway = 0; this.ladderSwayV = 0;
    this.vL.set(0, 0, 0);
    this.grounded = false;
    this.ctx.audio?.play?.('grab');
  }

  _updateLadder(h, inp, w) {
    const l = this.ladder, L = l.a.distanceTo(l.b);
    // climb direction: W moves toward where you look along the ladder (up unless looking down)
    const lookDown = _fwd.dot(l.up) < -0.35;
    const along = inp.axis('KeyS', 'KeyW') * (lookDown ? -1 : 1);       // +1 = up (toward the hub)
    const speed = (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight') ? 1.6 : 1) * CLIMB_SPEED;
    const vr = -along * speed;                                           // along the ladder a -> b (outward)
    const prevS = this.ladderS;
    this.ladderS = THREE.MathUtils.clamp(this.ladderS + vr * h, 0, L);
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
    if (ds !== 0) { this.stepTimer -= Math.abs(ds) / 0.33; if (this.stepTimer <= 0) { this.stepTimer = 1; this.ctx.audio?.play?.('rung'); } }
    // leave the ladder: at the bottom (deck) going down, at the top (hub) going up, or G / Space
    const atBottom = this.ladderS >= L - 0.02 && along < 0;
    const atTop = this.ladderS <= 0.02 && along > 0;
    if (atBottom) { this.ladder = null; this.pL.addScaledVector(l.side, 0.35).addScaledVector(l.up, -0.2); this.vL.set(0, 0, 0); this.grounded = false; }
    else if (atTop || inp.wasPressed('KeyG') || (inp.wasPressed('Space') && rho < 8)) { this.ladder = null; this.vL.addScaledVector(l.up, 0.4); }
  }

  /** Write the world pose (position, quaternion, velocity) from the ring-local state. */
  _writeWorld() {
    const I = this.interior, p = this.player, body = p.body;
    this._deckBasis(); this._viewBasis();
    I.toWorldFromRing(this.pL, body.position);
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
  }

  _toStation() {
    this._writeWorld();
    this.frame = 'station';
    this.ladder = null;
    this.player.body.omega.set(0, 0, 0);
  }

  /** Prompt hint for the HUD (IVA-specific parts). */
  prompt() {
    if (this.ladder) return 'W/S — вверх / вниз по лестнице · G — отпустить';
    if (this.frame === 'ring' && this._ladderNear && !(this.zone && /^spoke/.test(this.zone.id))) return 'E — встать на лестницу';
    return '';
  }
}
