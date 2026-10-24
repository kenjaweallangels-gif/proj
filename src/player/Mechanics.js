import * as THREE from 'three';
import { bodyDims, standingCapsule } from './Body.js';
import { closestOnSegment } from './Collision.js';

/**
 * Body mechanics of the astronaut: how the 1.8 m body moves by its own force and meets the environment.
 * Shared by the IVA controller (zero-g modules, the ring hub, the ring decks, ladders, the airlock) and the
 * EVA physics. All motion goes through `ctx.collision` (exact render-geometry collisions, src/core/CollisionWorld.js).
 *
 * Zero-g (`stepZeroG`):
 *   - body model: a rigid head sphere at the eye + a compliant body capsule hanging from the neck; the body trails
 *     behind the head when moving (head-first through hatches), relaxes toward "down" at rest and swings away
 *     from what it touches
 *   - hand-over-hand: with a movement intent (WASD) a free hand reaches for the handrail (or any surface) within
 *     arm's reach ahead, grips it and pulls / pushes the body along (muscle force limited; momentum conserved);
 *     the other hand reaches for the next grip mid-stroke. Off-centre pushes give a small damped body rotation.
 *     Without anything in reach only a weak "swim" acceleration remains.
 *   - auto-brake: approaching a wall / hatch rim the hands (feet when moving feet-first) reach the surface and
 *     absorb the normal speed over the remaining reach (~0.2-0.4 s); the body then rests or glides along it
 *   - move-and-slide in substeps (no tunnelling), swept cast for fast motion, soft contact response relative to
 *     the touched surface (ring spin, ship motion)
 * Gravity (`stepWalk`): upright capsule + floor cast (steps up to stepHeight, stairs, curved deck), traction-limited
 * acceleration, step cadence with planted feet, landings absorbed by the legs (camera dip).
 * Ladders (`ladderTargets`): hands on the rungs, feet on the rungs below, alternating with the climb.
 *
 * Output for animation / audio — on `player.body` (the EvaPhysics instance), station-frame metres:
 *   handTargets.left|right = { position, normal, weight 0..1, phase: 'free'|'reach'|'grip'|'brake'|'ladder'|'rail' }
 *   footTargets.left|right = { position, normal, weight 0..1, phase: 'free'|'swing'|'plant'|'ladder'|'brake' }
 *   bodyAxis (unit, neck -> feet), torsoLean { forward, side } (rad, relative to the view), crouch (m, leg compression)
 *   contact = { touching, grounded, normal, point, speed (impact m/s), surface: 'interior'|'exterior'|'ship'|'door'|'' }
 *   events = [{ type: 'grab'|'release'|'push'|'brake'|'step'|'land'|'bump', strength, position, limb }] (this frame's;
 *            each one is also emitted as ctx.events 'body')
 */

const PARAMS = {
  // grip: muscle acceleration through a gripping hand (m/s^2); vmax / vboost: glide speed with WASD / Shift
  unsuited: { grip: 2.4, surfaceGrip: 1.5, vmax: 1.6, vboost: 3.0, swim: 0.25, stop: 3.5, brake: 7.0, reach: 0.72, stretch: 1.0, shoulderDown: 0.22, shoulderSide: 0.2, reachTime: 0.16, restitution: 0.05, friction: 0.25, wobble: 1.0, walkAcc: 4.5, axisRate: 3.0 },
  suited: { grip: 1.0, surfaceGrip: 0.6, vmax: 1.0, vboost: 1.5, swim: 0.1, stop: 1.6, brake: 3.5, reach: 0.6, stretch: 0.85, shoulderDown: 0.3, shoulderSide: 0.26, reachTime: 0.3, restitution: 0.08, friction: 0.25, wobble: 0.5, walkAcc: 2.5, axisRate: 1.6 },
};
export function mechParams(suited) { return suited ? PARAMS.suited : PARAMS.unsuited; }

const LIMBS = ['left', 'right'];
const MAX_SUBSTEPS = 12;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _back = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _head = new THREE.Vector3();
const _neck = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _vs = new THREE.Vector3();
const _vr = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), t: 0, distance: 0, body: null };
const _cl = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, body: null };
const _opts = { mask: 15, frame: null };

function limbTarget() { return { position: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), weight: 0, phase: 'free' }; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Adds the animation / audio output fields to the body object (player.body). */
export function initBodyState(body) {
  body.handTargets = { left: limbTarget(), right: limbTarget() };
  body.footTargets = { left: limbTarget(), right: limbTarget() };
  body.bodyAxis = new THREE.Vector3(0, -1, 0);
  body.torsoLean = { forward: 0, side: 0 };
  body.crouch = 0;
  body.contact = { touching: false, grounded: false, normal: new THREE.Vector3(0, 1, 0), point: new THREE.Vector3(), speed: 0, surface: '' };
  body.events = [];
  return body;
}

export class BodyMechanics {
  constructor(player, ctx) {
    this.player = player;
    this.ctx = ctx;
    this.body = player.body;
    initBodyState(this.body);
    this.frame = null;               // Object3D whose local frame the internal state uses (null: station / world)
    this.axis = new THREE.Vector3(0, -1, 0);   // body axis (frame coords)
    // per-hand state (frame coords)
    this.hands = LIMBS.map((side, i) => ({ side, sign: i === 0 ? -1 : 1, phase: 'free', t: 0, grip: new THREE.Vector3(), from: new THREE.Vector3(), pos: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), weight: 0, rail: null, surface: false, dv: 0 }));
    this.feet = LIMBS.map((side, i) => ({ side, sign: i === 0 ? -1 : 1, phase: 'free', pos: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), weight: 0 }));
    this.nextHand = 1;
    this.wobble = new THREE.Vector3();          // small body-frame angular velocity from off-centre pushes (rad/s)
    this.braking = false;
    this.brakeLimb = 'hands';
    this.contact = false;
    this.impact = 0;
    this.stepDist = 0; this.stepSide = 0;
    this.crouch = 0; this.crouchV = 0;
    this.grounded = false;
    this.lastMoveAccel = 0;
  }

  get world() { return this.ctx.collision || null; }

  /** Start of a player update: clear this frame's events. */
  begin() { this.body.events.length = 0; }

  emit(type, strength, position, limb = '') {
    const ev = { type, strength: Math.round(strength * 1000) / 1000, position: this._toWorld(position, new THREE.Vector3()), limb };
    this.body.events.push(ev);
    this.ctx.events?.emit?.('body', ev);
  }

  _toWorld(p, out) { out.copy(p); if (this.frame) out.applyMatrix4(this.frame.matrixWorld); return out; }
  _dirToWorld(d, out) { out.copy(d); if (this.frame) out.transformDirection(this.frame.matrixWorld); return out; }

  /** Switch the internal frame (keeps the hand / foot state consistent by releasing everything). */
  setFrame(frame) {
    if (frame === this.frame) return;
    this.frame = frame;
    for (const h of this.hands) { h.phase = 'free'; h.rail = null; }
    for (const f of this.feet) f.phase = 'free';
    this.braking = false;
  }

  /** Reset at a teleport / pose change. */
  reset(up) {
    this.axis.copy(up).negate();
    for (const h of this.hands) { h.phase = 'free'; h.weight = 0; h.rail = null; }
    for (const f of this.feet) { f.phase = 'free'; f.weight = 0; }
    this.wobble.set(0, 0, 0);
    this.braking = false; this.crouch = 0; this.crouchV = 0;
  }

  _queryOpts(mask) { _opts.mask = mask; _opts.frame = this.frame; return _opts; }

  // ============================================================================================ zero-g
  /**
   * One zero-g step. s = { pos (eye), vel, quat (view orientation, frame coords), suited, mask, intent (frame,
   * |intent| <= 1), boost, stop (V: brake with the hands), rails ([{a, b, radius}] frame coords), safer (EVA:
   * propulsion is the backpack, hands only for braking), extAcc (frame, optional), surfaceMotion (bool) }.
   * Moves pos / vel, returns this (contact, impact).
   */
  stepZeroG(h, s) {
    const dims = bodyDims(s.suited), par = mechParams(s.suited);
    const W = this.world;
    const pos = s.pos, vel = s.vel;
    _up.set(0, 1, 0).applyQuaternion(s.quat);
    _back.set(0, 0, 1).applyQuaternion(s.quat);
    _right.set(1, 0, 0).applyQuaternion(s.quat);
    _fwd.copy(_back).negate();
    this.grounded = false;
    if (s.extAcc) vel.addScaledVector(s.extAcc, h);
    // ---- body axis: trails behind the head when moving, hangs "down" at rest
    const speed = vel.length();
    _tgt.copy(_up).negate();
    if (speed > 0.12) _tgt.addScaledVector(vel, -2.5 * smooth(0.12, 0.6, speed) / speed);
    if (_tgt.lengthSq() < 1e-6) _tgt.copy(_up).negate();
    _tgt.normalize();
    this.axis.lerp(_tgt, 1 - Math.exp(-h * par.axisRate)).normalize();
    // ---- propulsion through the hands
    this.lastMoveAccel = 0;
    if (!s.safer) this._handOverHand(h, s, dims, par);
    else this._railHold(h, s, dims, par);
    // ---- auto-brake before a wall / rim
    this._autoBrake(h, s, dims, par);
    // ---- move and slide
    this._moveZeroG(h, s, dims, par);
    // ---- outputs
    this._updateLimbOutputs(h, s, dims, par);
    return this;
  }

  _shoulder(hand, dims, par, eye, out) {
    return out.copy(eye).addScaledVector(_up, -par.shoulderDown).addScaledVector(_right, hand.sign * par.shoulderSide).addScaledVector(_back, dims.axisBack * 0.5);
  }

  /** Best grip point for a hand reaching along dir: a handrail point, else a surface point. */
  _findGrip(hand, s, dims, par, dir, out) {
    const sh = this._shoulder(hand, dims, par, s.pos, _sh);
    // reach = arm + a lean of the body toward the grip (stretch)
    _tgt.copy(sh).addScaledVector(dir, par.reach * 0.75);
    let best = par.stretch + 0.5, rail = null;
    const rails = s.rails;
    if (rails) for (let i = 0, n = rails.length; i < n; i++) {
      const r = rails[i];
      const mx = (r.a.x + r.b.x) * 0.5 - sh.x, my = (r.a.y + r.b.y) * 0.5 - sh.y, mz = (r.a.z + r.b.z) * 0.5 - sh.z;
      const hl = r.a.distanceTo(r.b) * 0.5 + par.stretch + 0.3;
      if (mx * mx + my * my + mz * mz > hl * hl) continue;
      closestOnSegment(r.a, r.b, _tgt, _v);
      const d = _v.distanceTo(sh);
      if (d > par.stretch || d < 0.15) continue;
      const ahead = _v2.subVectors(_v, sh).dot(dir);
      if (ahead < 0.08) continue;
      const score = _v.distanceTo(_tgt);
      if (score < best) { best = score; rail = r; out.copy(_v); }
    }
    if (rail) { hand.normal.subVectors(sh, out).normalize(); return rail; }
    // any surface within reach ahead (palm against the wall: friction-limited)
    const W = this.world;
    if (W && W.closest(_tgt, par.stretch * 0.75, _cl, this._queryOpts(s.mask))) {
      const d = _cl.point.distanceTo(sh);
      if (d <= par.stretch && _v2.subVectors(_cl.point, sh).dot(dir) > -0.05) { out.copy(_cl.point); hand.normal.copy(_cl.normal); return 'surface'; }
    }
    return null;
  }

  _handOverHand(h, s, dims, par) {
    const vel = s.vel;
    const intent = s.intent;
    const il = intent ? intent.length() : 0;
    const dir = _d.set(0, 0, 0);
    if (il > 1e-3) dir.copy(intent).multiplyScalar(1 / il);
    const vmax = (s.boost ? par.vboost : par.vmax) * Math.min(1, il);
    let gripping = false, grip = 0;
    for (const hd of this.hands) {
      hd.t += h;
      const sh = this._shoulder(hd, dims, par, s.pos, _sh);
      if (hd.phase === 'reach') {
        const k = Math.min(1, hd.t / par.reachTime);
        hd.pos.copy(hd.from).lerp(hd.grip, k * k * (3 - 2 * k));
        hd.weight = Math.min(1, hd.weight + h / par.reachTime);
        if (k >= 1) { hd.phase = 'grip'; hd.t = 0; hd.dv = 0; this.emit('grab', 0.25 + 0.3 * vel.length(), hd.grip, hd.side); this.ctx.audio?.play?.('grab', { volume: 0.4 }); }
      } else if (hd.phase === 'grip') {
        hd.pos.copy(hd.grip);
        hd.weight = 1;
        const rel = _v.subVectors(hd.grip, sh);
        const behind = il > 1e-3 ? -rel.dot(dir) : 0;
        if (rel.length() > par.stretch * 1.05 || behind > par.reach * 0.6 || (il < 1e-3 && !s.stop) || hd.t > 2.5) {
          if (hd.dv > 0.05) this.emit('push', hd.dv, hd.grip, hd.side);
          this.emit('release', 0.2, hd.grip, hd.side);
          hd.phase = 'free'; hd.t = 0; hd.rail = null;
        } else { gripping = true; grip = Math.max(grip, hd.surface ? par.surfaceGrip : par.grip); }
      } else {
        hd.weight = Math.max(0, hd.weight - h / 0.2);
        hd.phase = 'free';
      }
    }
    // start a reach: when nothing grips, or mid-stroke of the gripping hand (continuous hand-over-hand)
    if (il > 1e-3 || s.stop) {
      const reachDir = il > 1e-3 ? dir : (vel.lengthSq() > 1e-4 ? _v3.copy(vel).normalize() : _v3.copy(_fwd));
      const other = this.hands[this.nextHand];
      const g = this.hands.find((x) => x.phase === 'grip');
      const mid = g && -_v.subVectors(g.grip, this._shoulder(g, dims, par, s.pos, _sh)).dot(reachDir) > par.reach * 0.1;
      if (other.phase === 'free' && (!g || (mid && g !== other))) {
        const rail = this._findGrip(other, s, dims, par, reachDir, _a);
        if (rail) {
          other.phase = 'reach'; other.t = 0; other.rail = rail === 'surface' ? null : rail; other.surface = rail === 'surface';
          other.grip.copy(_a);
          if (other.weight < 0.05) this._shoulder(other, dims, par, s.pos, other.from).addScaledVector(_up, -0.35).addScaledVector(_fwd, 0.15);
          else other.from.copy(other.pos);
          this.nextHand = 1 - this.nextHand;
        }
      }
    }
    // forces
    if (s.stop) {
      const sp = vel.length();
      const dec = (gripping ? par.stop : par.swim) * h;
      if (sp > 1e-4) vel.multiplyScalar(Math.max(0, sp - dec) / sp);
    } else if (il > 1e-3) {
      const along = vel.dot(dir);
      const acc = gripping ? grip : par.swim;
      if (along < vmax) {
        const dv = Math.min(vmax - along, acc * h);
        vel.addScaledVector(dir, dv);
        this.lastMoveAccel = dv / h;
        for (const hd of this.hands) if (hd.phase === 'grip') {
          hd.dv += dv;
          // off-centre push: small yaw / roll about the body, damped by the astronaut
          this.wobble.y += -hd.sign * dv * 0.08 * par.wobble;
          this.wobble.z += hd.sign * dv * 0.04 * par.wobble;
        }
      }
      if (gripping) {
        // steering: the grip also takes out sideways drift
        _v.copy(vel).addScaledVector(dir, -vel.dot(dir));
        const sl = _v.length();
        if (sl > 1e-4) vel.addScaledVector(_v, -Math.min(sl, acc * 0.6 * h) / sl);
      }
      this.player._exertion = Math.min(1, (this.player._exertion || 0) + (gripping ? 0.08 : 0.03) * h);
    }
    this.wobble.multiplyScalar(Math.exp(-h * 3.5));
  }

  /** EVA: hand targets only (the SAFER flies; explicit rail holding is handled by the Player). */
  _railHold(h) {
    for (const hd of this.hands) { if (hd.phase !== 'brake') { hd.weight = Math.max(0, hd.weight - h / 0.25); hd.phase = hd.weight > 0 ? hd.phase : 'free'; } }
    this.wobble.multiplyScalar(Math.exp(-h * 3.5));
  }

  _autoBrake(h, s, dims, par) {
    const W = this.world, vel = s.vel;
    const speed = vel.length();
    const was = this.braking;
    this.braking = false;
    if (!W || speed < 0.18) { if (was) this._endBrake(); return; }
    _d.copy(vel).multiplyScalar(1 / speed);
    const feetFirst = this.axis.dot(_d) > 0.55;
    // the leading part of the body: the head (hands brake) or the feet
    let r;
    if (feetFirst) { _s.copy(s.pos).addScaledVector(_up, -dims.neck).addScaledVector(this.axis, dims.eyeHeight - dims.neck - dims.radius * 0.5); r = dims.radius * 0.6; }
    else { _s.copy(s.pos).addScaledVector(_back, dims.headBack); r = dims.headRadius; }
    const look = speed * 0.45 + par.reach + 0.1;
    _v.copy(_s).addScaledVector(_d, look);
    if (!W.sphereCast(_s, _v, r, _hit, this._queryOpts(s.mask))) { if (was) this._endBrake(); return; }
    const n = _hit.normal;
    _vs.set(0, 0, 0);
    if (s.surfaceMotion && !this.frame && _hit.body) W.surfaceVelocity(_hit.body, _hit.point, _vs);
    _vr.subVectors(vel, _vs);
    const vn = -_vr.dot(n);
    const dist = _hit.distance;
    if (vn < 0.12 || dist > par.reach + 0.05) { if (was) this._endBrake(); return; }
    // absorb the approach speed over the remaining arm (leg) travel
    const room = Math.max(0.04, dist - 0.03);
    const a = Math.min(par.brake * (feetFirst ? 1.6 : 1), (vn * vn) / (2 * room) * 1.25 + 0.3);
    const dv = Math.min(vn, a * h);
    vel.addScaledVector(n, dv);
    // a little friction while the hands slide along
    _v.copy(_vr).addScaledVector(n, _vr.dot(n));
    vel.addScaledVector(_v, -Math.min(1, 0.6 * h));
    this.braking = true;
    this.brakeLimb = feetFirst ? 'feet' : 'hands';
    const limbs = feetFirst ? this.feet : this.hands;
    for (const L of limbs) {
      L.phase = 'brake';
      _v.copy(_hit.point).addScaledVector(_right, L.sign * (feetFirst ? 0.12 : 0.22));
      // keep the palm on the surface plane
      _v.addScaledVector(n, -_v2.subVectors(_v, _hit.point).dot(n));
      L.pos.copy(_v); L.normal.copy(n);
      L.weight = Math.min(1, L.weight + h / 0.12);
      if (!feetFirst) L.rail = null;
    }
    if (!was) { this.emit('brake', vn, _hit.point, this.brakeLimb); this.ctx.audio?.play?.('grab', { volume: 0.3 }); }
  }

  _endBrake() {
    for (const L of this.hands) if (L.phase === 'brake') { L.phase = 'free'; this.emit('release', 0.1, L.pos, L.side); }
    for (const L of this.feet) if (L.phase === 'brake') L.phase = 'free';
  }

  _moveZeroG(h, s, dims, par) {
    const W = this.world, pos = s.pos, vel = s.vel;
    this.contact = false; this.impact = 0;
    if (!W) { pos.addScaledVector(vel, h); return; }
    const opts = this._queryOpts(s.mask);
    _d.copy(vel).multiplyScalar(h);
    const len = _d.length();
    // very fast: sweep the head first
    if (len > dims.headRadius * 2) {
      _s.copy(pos).addScaledVector(_back, dims.headBack);
      _v.copy(_s).add(_d);
      if (W.sphereCast(_s, _v, dims.headRadius, _hit, opts)) _d.multiplyScalar(Math.max(0, _hit.t - 0.02 / Math.max(len, 1e-6)));
    }
    const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(_d.length() / (dims.headRadius * 0.45))));
    _d.multiplyScalar(1 / n);
    const e = s.restitution ?? par.restitution, f = s.friction ?? par.friction;
    for (let i = 0; i < n; i++) {
      pos.add(_d);
      _head.copy(pos).addScaledVector(_back, dims.headBack);
      if (W.resolveSphere(_head, dims.headRadius, null, opts)) {
        pos.add(W.lastPush);
        this._respond(W, vel, e, f, s.surfaceMotion, 1);
      }
    }
    // compliant body: swings away from what it touches, pushes the head only partly
    _neck.copy(pos).addScaledVector(_up, -dims.neck).addScaledVector(_back, dims.axisBack);
    // neutral body posture at rest (knees and hips bent: ~72 % of the neck-to-soles length), stretched out when gliding
    const L = (dims.eyeHeight - dims.neck) * (0.72 + 0.28 * smooth(0.15, 0.8, vel.length()));
    this.bodyLength = L;
    for (let it = 0; it < 3; it++) {
      _a.copy(_neck).addScaledVector(this.axis, dims.radius * 0.7);
      _b.copy(_neck).addScaledVector(this.axis, L - dims.radius);
      if (!W.resolveCapsule(_a, _b, dims.radius, null, opts)) break;
      const P = W.lastPush;
      // the body swings away from what it touches (the feet end moves the most) ...
      _v.copy(_neck).addScaledVector(this.axis, L).addScaledVector(P, 1.6);
      this.axis.subVectors(_v, _neck).normalize();
      // ... and only when it cannot swing free it shifts the head a little
      if (it === 2 && P.lengthSq() > 4e-4) {
        _v.copy(P).multiplyScalar(0.4);
        pos.add(_v);
        this._respond(W, vel, e, f, s.surfaceMotion, 0.3);
      }
    }
    this.body.bodyAxis.copy(this._dirToWorld(this.axis, _v));
  }

  /** Velocity response to the contacts of the last resolve call (share: how much of the body they stop). */
  _respond(W, vel, e, f, surfaceMotion, share) {
    for (let k = 0; k < W.contactCount; k++) {
      const c = W.contacts[k];
      _vs.set(0, 0, 0);
      if (surfaceMotion && !this.frame && c.body?.motion) W.surfaceVelocity(c.body, c.point, _vs);
      _vr.subVectors(vel, _vs);
      const vn = _vr.dot(c.normal);
      if (vn < 0) {
        _vr.addScaledVector(c.normal, -(1 + e) * vn * share);
        // Coulomb friction: the tangential change is limited by mu times the normal impulse
        _v3.copy(_vr).addScaledVector(c.normal, -_vr.dot(c.normal));
        const vt = _v3.length(), dvt = Math.min(vt, f * (1 + e) * -vn * share * 2);
        if (vt > 1e-6) _vr.addScaledVector(_v3, -dvt / vt);
        vel.addVectors(_vr, _vs);
        if (-vn > this.impact) this.impact = -vn;
      }
      this.contact = true;
      const C = this.body.contact;
      this._dirToWorld(c.normal, C.normal); this._toWorld(c.point, C.point);
      const L = c.body?.layer;
      C.surface = L === 8 ? 'door' : L === 4 ? 'ship' : L === 2 ? 'interior' : L === 1 ? 'exterior' : '';
    }
  }

  // ============================================================================================ gravity
  /**
   * One walking step in a gravity frame (the ring). s = { pos (eye), vel, up (unit, frame), facing (unit,
   * horizontal view direction), suited, mask, g (m/s^2, apparent gravity magnitude), move (desired horizontal
   * velocity, frame), jump (bool), accel (fictitious accelerations, frame) }. Returns this (grounded, contact).
   */
  stepWalk(h, s) {
    const dims = bodyDims(s.suited), par = mechParams(s.suited);
    const W = this.world, pos = s.pos, vel = s.vel, up = s.up;
    const opts = this._queryOpts(s.mask);
    _back.copy(s.facing).negate();
    _right.crossVectors(s.facing, up).normalize();
    _up.copy(up);
    // ---- horizontal drive: traction-limited by the apparent gravity
    const vUp0 = vel.dot(up);
    if (this.grounded) {
      _v2.copy(vel).addScaledVector(up, -vUp0);
      _v3.subVectors(s.move, _v2);
      const dv = _v3.length(), maxDv = Math.min(par.walkAcc, 0.75 * s.g + 0.5) * h;
      if (dv > maxDv) _v3.multiplyScalar(maxDv / dv);
      vel.add(_v3);
      this.lastMoveAccel = Math.min(dv, maxDv) / Math.max(h, 1e-6);
      if (s.jump) { vel.addScaledVector(up, s.jumpSpeed || 1.3); this.grounded = false; this._jumpTimer = 0.25; this.emit('push', 0.5, _v.copy(pos).addScaledVector(up, -dims.eyeHeight), 'feet'); }
    } else if (s.airMove) vel.addScaledVector(s.airMove, h);
    if (s.accel) vel.addScaledVector(s.accel, h);
    // ---- move: walls / ceiling via the upright capsule (its bottom ends stepHeight above the soles)
    this.contact = false; this.impact = 0;
    _d.copy(vel).multiplyScalar(h);
    const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(_d.length() / (dims.radius * 0.45))));
    _d.multiplyScalar(1 / n);
    for (let i = 0; i < n; i++) {
      pos.add(_d);
      if (!W) continue;
      standingCapsule(dims, pos, up, _back, _a, _b);
      if (W.resolveCapsule(_a, _b, dims.radius, null, opts)) { pos.add(W.lastPush); this._respond(W, vel, 0, 0.05, false, 1); }
      _head.copy(pos).addScaledVector(_back, dims.headBack);
      if (W.resolveSphere(_head, dims.headRadius, null, opts)) { pos.add(W.lastPush); this._respond(W, vel, 0, 0.05, false, 1); }
    }
    // ---- floor: sphere cast down from the knees (step up / down, landing)
    const vUp = vel.dot(up);
    this._jumpTimer = (this._jumpTimer || 0) - h;
    const wasGrounded = this.grounded;
    let ground = false;
    if (W && !(this._jumpTimer > 0 && vUp > 0)) {
      const gr = dims.radius * 0.7, stepH = dims.stepHeight;
      _s.copy(pos).addScaledVector(up, -dims.eyeHeight + stepH + gr);
      const extra = wasGrounded ? 0.3 : Math.max(0.03, -vUp * h + 0.03);
      _v.copy(_s).addScaledVector(up, -(stepH + extra));
      if (W.sphereCast(_s, _v, gr, _hit, opts) && _hit.normal.dot(up) > 0.55) {
        const k = stepH - _hit.distance;            // > 0: the floor is above the soles (step up / landing)
        if (wasGrounded || k > -0.03 || vUp <= 0) {
          ground = true;
          // step up smoothly, step down at once (stairs), keep the soles on the floor
          pos.addScaledVector(up, k > 0 ? Math.min(k, Math.max(0.02, 2.5 * h)) : k);
          if (vUp < 0) {
            if (!wasGrounded && vUp < -0.6) {
              this.crouchV += Math.min(1.2, -vUp * 0.6);
              this.emit('land', -vUp, _v.copy(pos).addScaledVector(up, -dims.eyeHeight), 'feet');
              this.ctx.audio?.play?.('step', { volume: Math.min(1, -vUp * 0.5) });
            }
            vel.addScaledVector(up, -vUp);
          }
          this.groundNormal = (this.groundNormal || new THREE.Vector3()).copy(_hit.normal);
        }
      }
    }
    this.grounded = ground;
    // ---- legs: crouch spring (landing absorbed by the legs), step cadence, planted feet
    this.crouchV += (-60 * this.crouch - 11 * this.crouchV) * h;
    this.crouch = Math.min(0.25, Math.max(-0.02, this.crouch + this.crouchV * h));
    this._walkFeet(h, s, dims, ground);
    for (const hd of this.hands) { hd.weight = Math.max(0, hd.weight - h / 0.25); if (hd.weight === 0) hd.phase = 'free'; }
    this._updateLimbOutputs(h, s, dims, par);
    this.body.bodyAxis.copy(this._dirToWorld(_v.copy(up).negate(), _v));
    return this;
  }

  _walkFeet(h, s, dims, ground) {
    const up = s.up, vel = s.vel;
    _v2.copy(vel).addScaledVector(up, -vel.dot(up));
    const sp = _v2.length();
    _s.copy(s.pos).addScaledVector(up, -dims.eyeHeight);      // soles
    if (!ground) {
      for (const f of this.feet) { f.phase = 'swing'; f.pos.copy(_s).addScaledVector(_right, f.sign * 0.12); f.normal.copy(up); f.weight = Math.max(0, f.weight - h / 0.3); }
      return;
    }
    const stride = 0.45 + 0.28 * Math.min(sp, 2.8);
    this.stepDist += sp * h;
    for (const f of this.feet) f.weight = Math.min(1, f.weight + h / 0.2);
    if (sp < 0.15) {
      // standing: both feet planted under the hips
      for (const f of this.feet) { if (f.phase !== 'plant' || f.pos.distanceTo(_s) > 0.45) { f.pos.copy(_s).addScaledVector(_right, f.sign * 0.13); } f.phase = 'plant'; f.normal.copy(up); }
      this.stepDist = Math.min(this.stepDist, stride * 0.5);
      return;
    }
    if (this.stepDist >= stride * 0.5) {
      this.stepDist = 0;
      this.stepSide = 1 - this.stepSide;
      const f = this.feet[this.stepSide], o = this.feet[1 - this.stepSide];
      f.phase = 'plant';
      _v.copy(_v2).multiplyScalar(stride * 0.5 / sp);
      f.pos.copy(_s).add(_v).addScaledVector(_right, f.sign * 0.12);
      f.normal.copy(up);
      o.phase = 'swing';
      this.emit('step', Math.min(1, sp / 2.8), f.pos, f.side);
      this.ctx.audio?.play?.('step');
    }
  }

  // ============================================================================================ ladders
  /**
   * Hands and feet on a ladder: ladder { a, b (frame), up, side }, eye position, rung spacing. phase 0..1 of the
   * climb cycle (each half cycle one hand + the opposite foot move up one rung).
   */
  ladderTargets(h, ladder, eye, suited, rung = 0.33) {
    const dims = bodyDims(suited);
    const up = _up.copy(ladder.up);
    _v.subVectors(ladder.b, ladder.a);
    const L = _v.length(); _v.multiplyScalar(1 / L);                 // a -> b (outward / down)
    _right.crossVectors(ladder.side, up).normalize();
    // nearest rung index below / above a height along the ladder
    const rungAt = (p, k) => { const s = _v2.subVectors(p, ladder.a).dot(_v); const i = Math.round(s / rung) + k; return _v3.copy(ladder.a).addScaledVector(_v, THREE.MathUtils.clamp(i * rung, 0, L)); };
    const cyc = Math.floor((this.ladderTravel || 0) / rung);
    this.hands.forEach((hd, i) => {
      const off = (cyc + i) % 2 ? -1 : 0;
      _s.copy(eye).addScaledVector(up, -0.05);
      const p = rungAt(_s, off);
      const nx = _a.copy(p).addScaledVector(_right, hd.sign * 0.2);
      if (hd.phase !== 'ladder' || hd.pos.distanceTo(nx) > 0.05) {
        if (hd.phase === 'ladder' && hd.weight > 0.5) this.emit('grab', 0.3, nx, hd.side);
        hd.pos.copy(nx);
      }
      hd.phase = 'ladder'; hd.normal.copy(ladder.side); hd.weight = Math.min(1, hd.weight + h / 0.15);
    });
    this.feet.forEach((f, i) => {
      const off = (cyc + i + 1) % 2 ? 0 : 1;
      _s.copy(eye).addScaledVector(up, -dims.eyeHeight + 0.05);
      const p = rungAt(_s, off);
      const nx = _a.copy(p).addScaledVector(_right, f.sign * 0.12);
      if (f.phase === 'ladder' && f.pos.distanceTo(nx) > 0.05 && f.weight > 0.5) this.emit('step', 0.3, nx, f.side);
      f.pos.copy(nx); f.phase = 'ladder'; f.normal.copy(up); f.weight = Math.min(1, f.weight + h / 0.15);
    });
    this.axis.copy(up).negate();
    this.grounded = false;
    this._writeOutputs();
    this.body.bodyAxis.copy(this._dirToWorld(_v.copy(up).negate(), _v));
  }

  /** Explicit rail holding (G): one hand on the rail point, the other following hand-over-hand. */
  holdTargets(h, railPoint, rail, crawl, normal) {
    const main = this.hands[1], other = this.hands[0];
    main.phase = 'rail'; main.pos.copy(railPoint); main.weight = Math.min(1, main.weight + h / 0.12); if (normal) main.normal.copy(normal);
    // the second hand leapfrogs while crawling
    this.crawlTravel = (this.crawlTravel || 0) + Math.abs(crawl) * h;
    if (rail && Math.abs(crawl) > 0) {
      _v.subVectors(rail.b, rail.a); const L = _v.length(); _v.multiplyScalar(1 / Math.max(L, 1e-6));
      const ph = (this.crawlTravel / 0.35) % 2;
      _v2.copy(railPoint).addScaledVector(_v, (ph < 1 ? 0.3 : -0.3) * Math.sign(crawl));
      if (other.phase === 'rail' && other.pos.distanceTo(_v2) > 0.25) this.emit('grab', 0.2, _v2, other.side);
      other.pos.copy(_v2); other.phase = 'rail'; other.weight = Math.min(1, other.weight + h / 0.15);
    } else { other.weight = Math.max(0, other.weight - h / 0.3); if (other.weight === 0) other.phase = 'free'; }
    if (normal) other.normal.copy(normal);
    for (const f of this.feet) { f.weight = Math.max(0, f.weight - h / 0.3); f.phase = 'free'; }
    this._writeOutputs();
  }

  // ============================================================================================ outputs
  _updateLimbOutputs(h, s) {
    // free hands / feet relax to a rest pose near the body
    const pos = s.pos;
    for (const hd of this.hands) if (hd.phase === 'free') {
      hd.pos.copy(pos).addScaledVector(_up, -0.55).addScaledVector(_right, hd.sign * 0.3).addScaledVector(_fwd, 0.1);
      hd.normal.copy(_fwd);
    }
    for (const f of this.feet) if (f.phase === 'free') {
      _v.copy(pos).addScaledVector(_up, -0.2).addScaledVector(this.axis, this.bodyLength || 1.4).addScaledVector(_right, f.sign * 0.12);
      f.pos.copy(_v); f.normal.copy(this.axis).negate();
      f.weight = Math.max(0, f.weight - h / 0.3);
    }
    // torso lean relative to the view: forward with acceleration, sideways with steering
    const T = this.body.torsoLean;
    const fl = THREE.MathUtils.clamp(this.lastMoveAccel * 0.05, -0.3, 0.3);
    T.forward += (fl - T.forward) * (1 - Math.exp(-h * 4));
    T.side *= Math.exp(-h * 4);
    this._writeOutputs();
  }

  _writeOutputs() {
    const B = this.body;
    for (let i = 0; i < 2; i++) {
      const hd = this.hands[i], o = B.handTargets[LIMBS[i]];
      this._toWorld(hd.pos, o.position); this._dirToWorld(hd.normal, o.normal); o.weight = hd.weight; o.phase = hd.phase;
      const f = this.feet[i], of = B.footTargets[LIMBS[i]];
      this._toWorld(f.pos, of.position); this._dirToWorld(f.normal, of.normal); of.weight = f.weight; of.phase = f.phase;
    }
    B.crouch = Math.max(0, this.crouch);
    const C = B.contact;
    C.touching = this.contact || this.braking;
    C.grounded = this.grounded;
    C.speed = this.impact;
    if (!C.touching && !C.grounded) C.surface = '';
  }

  /** Bump event + sound for a hard unbraked contact. */
  bump(position) {
    if (this.impact > 0.25 && !this.braking) {
      this.emit('bump', this.impact, position);
      return true;
    }
    return false;
  }
}

/** World <- frame quaternion helper (frame may be null). */
export function frameQuat(frame, out) { if (frame) frame.getWorldQuaternion(out); else out.identity(); return out; }
void _q;
