import * as THREE from 'three';
import { twoBoneIK, aimQuat, setWorldQuat, basisQuat } from './Rig.js';
import { curlHand, rot } from './Body.js';

/**
 * Drives one astronaut rig from the player: places the body under the camera (eyes at the camera, head
 * turned within neck / helmet limits, torso following with a lag), solves two-bone IK for both arms and
 * legs toward hand / foot targets, curls the fingers (rail grip, hand controller, relaxed), adds idle
 * micro-motion (breathing, drift) and a procedural gait when walking in spin gravity.
 *
 * Targets come from `player.body` when the movement code provides them (see readTargets): station-frame
 * world positions + surface normals with a weight 0..1. Without them the animator falls back to the
 * player's state: the handrail being reached for / held, the hand controller while thrusting, the zero-g
 * neutral body posture or a standing pose in the ring.
 */

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _m = new THREE.Matrix4();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);   // camera (-Z fwd) -> body (+Z fwd)
const D = THREE.MathUtils.degToRad;

/** Limits of the head relative to the torso (radians): suited the helmet turns with the torso. */
const LIMITS = {
  suit: { pitchDown: D(38), pitchUp: D(12), yaw: D(18), recenter: 1.4 },
  crew: { pitchDown: D(70), pitchUp: D(55), yaw: D(70), recenter: 2.5 },
};

export class Animator {
  constructor(body, kind) {
    this.body = body;
    this.rig = body.rig;
    this.kind = kind;                       // 'suit' | 'crew'
    this.lim = LIMITS[kind];
    this.torsoQ = new THREE.Quaternion();   // world, body convention (+Z forward)
    this.inited = false;
    this.time = Math.random() * 10;
    this.hand = {
      L: { pos: new THREE.Vector3(), nrm: new THREE.Vector3(), w: 0, curl: 0.3, init: false },
      R: { pos: new THREE.Vector3(), nrm: new THREE.Vector3(), w: 0, curl: 0.3, init: false },
    };
    this.gait = 0;
    this.walkW = 0;
    this.legLift = { L: 0, R: 0 };
    this.prevPos = new THREE.Vector3();
    this.lookDown = 0;
  }

  reset() { this.inited = false; this.hand.L.init = this.hand.R.init = false; }

  /**
   * s: { camera, dt, gravityUp (Vector3|null), gravity (g), speed, velocity, thrusting, boost, rotThrust,
   *      reach (Vector3|null), grabbing, targets (readTargets result), suited, fp }
   */
  update(s) {
    const rig = this.rig, dt = Math.min(s.dt, 0.1);
    this.time += dt;
    const t = this.time;
    const cam = s.camera;
    cam.updateMatrixWorld();
    cam.getWorldQuaternion(_q);
    const headQ = _q.multiply(FLIP);                         // head orientation, body convention
    const headQc = new THREE.Quaternion().copy(headQ);
    // ---------------------------------------------------------------- torso orientation
    if (!this.inited) { this._torsoTarget(headQc, s, this.torsoQ); this.inited = true; }
    const target = this._torsoTarget(headQc, s, _q2);
    const tau = s.gravityUp ? 0.25 : this.lim.recenter;
    this.torsoQ.slerp(target, 1 - Math.exp(-dt / tau));
    // clamp the head relative to the torso (neck / helmet range), move the torso if exceeded
    const rel = _q3.copy(this.torsoQ).invert().multiply(headQc);
    _e.setFromQuaternion(rel, 'YXZ');
    const L = this.lim;
    const cy = THREE.MathUtils.clamp(_e.y, -L.yaw, L.yaw), cx = THREE.MathUtils.clamp(_e.x, -L.pitchUp, L.pitchDown), cz = THREE.MathUtils.clamp(_e.z, -0.35, 0.35);
    if (cy !== _e.y || cx !== _e.x || cz !== _e.z) {
      _e.set(cx, cy, cz, 'YXZ');
      rel.setFromEuler(_e);
      this.torsoQ.copy(headQc).multiply(_q.copy(rel).invert());
    }
    this.lookDown = Math.max(0, cx) / L.pitchDown;
    // ---------------------------------------------------------------- pose: spine / neck / head
    rig.resetPose();
    const root = rig.group;
    root.quaternion.copy(this.torsoQ);
    const breath = Math.sin(t * 1.6) * 0.5 + 0.5;
    rot(rig, 'chest', -0.8 * breath, 0, 0);
    // relative head rotation split between the neck and the head (suit: the helmet is the chest; the head moves inside)
    _e.set(cx, cy, cz, 'YXZ');
    rel.setFromEuler(_e);
    const neck = rig.bone('neck'), head = rig.bone('head');
    neck.quaternion.identity().slerp(rel, 0.45);
    head.quaternion.copy(neck.quaternion).invert().multiply(rel);
    // ---------------------------------------------------------------- place: eye at the camera
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    _v.copy(rig.eyeLocal).applyMatrix4(head.matrixWorld);
    cam.getWorldPosition(_v2);
    root.position.add(_v2.sub(_v));
    // thruster vibration
    if (s.thrusting) root.position.addScaledVector(_v3.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), s.boost ? 0.002 : 0.001);
    root.updateMatrixWorld(true);
    // ---------------------------------------------------------------- legs
    this._legs(s, dt);
    // ---------------------------------------------------------------- arms
    this._arms(s, dt);
  }

  /** Torso orientation the body relaxes to: upright in spin gravity, head-flexed neutral posture in zero g. */
  _torsoTarget(headQ, s, out) {
    if (s.gravityUp) {
      // yaw follows the gaze projected on the deck plane
      _up.copy(s.gravityUp);
      _v.set(0, 0, 1).applyQuaternion(headQ);
      _v.addScaledVector(_up, -_v.dot(_up));
      if (_v.lengthSq() < 1e-6) _v.set(0, 1, 0).applyQuaternion(headQ).negate().addScaledVector(_up, -_v.dot(_up));
      _v.normalize();
      _v2.crossVectors(_up, _v);       // body +X (left) = up x forward
      return basisQuat(_v2, _up, _v, out);
    }
    // zero g: the head is ~16 deg flexed relative to the torso (neutral body posture); suited 6 deg
    _q3.setFromAxisAngle(_v3.set(1, 0, 0), -D(this.kind === 'suit' ? 6 : 16));
    return out.copy(headQ).multiply(_q3);
  }

  // ---------------------------------------------------------------------------------------- legs
  _legs(s, dt) {
    const rig = this.rig, tg = s.targets;
    const ground = !!s.gravityUp && s.gravity > 0.05;
    // gait phase from the distance walked
    const v = ground ? s.speed : 0;
    this.walkW += ((v > 0.15 ? 1 : 0) - this.walkW) * (1 - Math.exp(-dt / 0.2));
    this.gait += dt * (1.6 + 2.2 * Math.min(v, 1.6)) * Math.PI;
    for (const [S, sx] of [['L', 1], ['R', -1]]) {
      const ft = tg?.feet?.[S];
      if (ft && ft.w > 0.01) {
        // IK to the provided foot target (ankle above the contact point by the ankle height)
        _v.copy(ft.position);
        if (ft.normal) _v.addScaledVector(ft.normal, this.kind === 'suit' ? 0.115 : 0.085);
        const pole = _v2.set(0, 0, 1).applyQuaternion(rig.group.quaternion).addScaledVector(_v3.set(sx, 0, 0).applyQuaternion(rig.group.quaternion), 0.15);
        twoBoneIK(rig.bone(`thigh${S}`), rig.bone(`shin${S}`), rig.bone(`foot${S}`), _v, pole, rig.len.thigh, rig.len.shin, -1);
        if (ft.normal) this._footFlat(S, ft.normal);
        continue;
      }
      if (ground) {
        // standing / walking (procedural): hip flexion swing, knee flexion in swing, ankle roll
        const ph = this.gait + (sx > 0 ? 0 : Math.PI);
        const w = this.walkW;
        const swing = Math.sin(ph), lift = Math.max(0, Math.cos(ph));
        rot(rig, `thigh${S}`, -(22 * swing) * w - 2, 0, sx * 2);
        rot(rig, `shin${S}`, (8 + 45 * lift * lift) * w + 3, 0, 0);
        rot(rig, `foot${S}`, (-10 * swing * w), 0, 0);
      } else {
        // zero g: neutral body posture (hips and knees flexed), slow drift
        const d = Math.sin(this.time * 0.35 + (sx > 0 ? 0 : 1.7));
        const suit = this.kind === 'suit';
        rot(rig, `thigh${S}`, (suit ? -16 : -44) + 4 * d, sx * 2, sx * (suit ? 4 : 9));
        rot(rig, `shin${S}`, (suit ? 22 : 50) + 5 * d, 0, 0);
        rot(rig, `foot${S}`, suit ? 4 : 14, 0, 0);
      }
    }
    rig.group.updateMatrixWorld(true);
  }

  _footFlat(S, normal) {
    const foot = this.rig.bone(`foot${S}`);
    foot.updateMatrixWorld(true);
    // keep the foot's forward, align its up with the surface normal
    _v.set(0, 0, 1).applyQuaternion(foot.getWorldQuaternion(_q));
    _v.addScaledVector(normal, -_v.dot(normal)).normalize();
    _v2.crossVectors(normal, _v);
    setWorldQuat(foot, basisQuat(_v2, normal, _v, _q2));
  }

  // ---------------------------------------------------------------------------------------- arms
  _arms(s, dt) {
    const rig = this.rig, tg = s.targets;
    const k = 1 - Math.exp(-dt / 0.12);
    const chest = rig.bone('chest');
    chest.updateMatrixWorld(true);
    const R = rig.group.quaternion;
    const suit = this.kind === 'suit';
    // which arm reaches for the legacy handrail point: the one on its side
    let reachSide = null;
    if (s.reach) { _v.copy(s.reach); rig.group.worldToLocal(_v); reachSide = _v.x >= 0 ? 'L' : 'R'; }
    for (const [S, sx] of [['L', 1], ['R', -1]]) {
      const H = this.hand[S];
      const ht = tg?.hands?.[S];
      let curl = 0.3, palm = null, wTarget = 0;
      const want = _v;
      if (ht && ht.w > 0.01) {
        want.copy(ht.position); palm = ht.normal ? _v2.copy(ht.normal).negate() : null;
        curl = ht.grip ?? 0.95; wTarget = ht.w;
      } else if (reachSide === S) {
        want.copy(s.reach);
        curl = s.grabbing ? 0.95 : 0.45; wTarget = 1;
        // palm toward the rail: from the shoulder to the point
        palm = _v2.copy(s.reach).sub(rig.bone(`upperArm${S}`).getWorldPosition(_v3)).normalize();
      } else if (S === 'R' && suit && (s.thrusting || s.rotThrust > 0.25)) {
        // right hand on the hand controller (chest)
        want.set(-0.17, 1.27, 0.25).applyMatrix4(rig.group.matrixWorld);
        palm = _v2.set(0, -0.3, -1).applyQuaternion(R).normalize();
        curl = 0.85; wTarget = 1;
      } else {
        // idle: hands in front of the body (relative to the torso), slight sway
        const t = this.time + (sx > 0 ? 0 : 2.1);
        const ground = !!s.gravityUp && s.gravity > 0.05;
        if (ground) want.set(sx * 0.24, 0.86 + 0.01 * Math.sin(t * 1.1) - 0.04 * this.walkW, 0.06 - 0.12 * this.walkW * Math.sin(this.gait + (sx > 0 ? Math.PI : 0)));
        else if (suit) want.set(sx * 0.3, 1.1 + 0.01 * Math.sin(t * 0.7), 0.3 + 0.01 * Math.sin(t * 0.9));
        else want.set(sx * 0.27, 1.14 + 0.012 * Math.sin(t * 0.6), 0.27 + 0.01 * Math.sin(t * 0.8));
        // the free hand hangs back a little under acceleration
        if (s.thrusting && s.thrustLocal) want.addScaledVector(_v3.copy(s.thrustLocal).multiply(_scale.set(-1, 1, -1)), -0.04);
        want.applyMatrix4(rig.group.matrixWorld);
        palm = _v2.set(-sx * 0.8, -0.2, 0.4).applyQuaternion(R).normalize();
        curl = ground ? 0.25 : 0.35;
        wTarget = 0;
      }
      if (!H.init) { H.pos.copy(want); H.nrm.copy(palm || _v3.set(-sx, 0, 0).applyQuaternion(R)); H.init = true; }
      H.pos.lerp(want, k);
      if (palm) H.nrm.lerp(palm, k).normalize();
      H.curl += (curl - H.curl) * (1 - Math.exp(-dt / 0.1));
      H.w += (wTarget - H.w) * k;
      // first person: keep the hands out of the helmet / face (in front of the eyes)
      if (s.fp) this._keepInView(H.pos);
      // wrist position: the grip point sits ~9 cm along the fingers and 3 cm off the palm
      const fingerDir = this._fingerDir(S, H.nrm, _v3);
      const wrist = _wrist.copy(H.pos).addScaledVector(fingerDir, -0.085 * H.w - 0.02).addScaledVector(H.nrm, -0.03 * H.w);
      const pole = _pole.set(sx * 0.9, -0.5, -0.65).applyQuaternion(R).normalize();
      twoBoneIK(rig.bone(`upperArm${S}`), rig.bone(`forearm${S}`), rig.bone(`hand${S}`), wrist, pole, rig.len.upperArm, rig.len.forearm, 1);
      // hand orientation: palm normal + finger direction
      const hand = rig.bone(`hand${S}`);
      const xw = _x.copy(H.nrm).multiplyScalar(-sx);            // local +X maps to -side * palm
      const yw = _y.copy(fingerDir).negate();                    // local -Y = fingers
      yw.addScaledVector(xw, -yw.dot(xw)).normalize();
      const zw = _z.crossVectors(xw, yw);
      setWorldQuat(hand, basisQuat(xw, yw, zw, _q));
      curlHand(rig, S, H.curl, 0.12, Math.min(1, H.curl + 0.1));
    }
    rig.group.updateMatrixWorld(true);
  }

  /** Finger direction: continue the forearm, orthogonal to the palm normal. */
  _fingerDir(S, palmN, out) {
    const fore = this.rig.bone(`forearm${S}`), hand = this.rig.bone(`hand${S}`);
    fore.getWorldPosition(_a); hand.getWorldPosition(_b);
    out.subVectors(_b, _a);
    if (out.lengthSq() < 1e-8) out.set(0, -1, 0);
    out.normalize().addScaledVector(palmN, -out.dot(palmN));
    if (out.lengthSq() < 1e-6) out.set(0, -1, 0);
    return out.normalize();
  }

  _keepInView(p) {
    // in head space: at least 0.24 m in front of the eye and below eye level near the face
    const head = this.rig.bone('head');
    _m.copy(head.matrixWorld).invert();
    _c.copy(p).applyMatrix4(_m).sub(this.rig.eyeLocal);
    if (_c.z < 0.24) _c.z = 0.24;
    _c.add(this.rig.eyeLocal).applyMatrix4(head.matrixWorld);
    p.copy(_c);
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _wrist = new THREE.Vector3(), _pole = new THREE.Vector3(), _scale = new THREE.Vector3();
void aimQuat;

/**
 * Read hand / foot targets from the movement code (player.body or player.bodyTargets), tolerating missing
 * fields: { hands: { L, R }, feet: { L, R } } with { position, normal, w, grip } or null.
 */
export function readTargets(player) {
  const src = player?.bodyTargets || (player?.body && player.body.handTargets ? player.body : null);
  if (!src) return null;
  const one = (t) => (t && t.position ? { position: t.position, normal: t.normal || null, w: t.weight ?? 1, grip: t.grip } : null);
  return {
    hands: { L: one(src.handTargets?.left), R: one(src.handTargets?.right) },
    feet: { L: one(src.footTargets?.left), R: one(src.footTargets?.right) },
    torsoLean: src.torsoLean ?? 0,
  };
}
