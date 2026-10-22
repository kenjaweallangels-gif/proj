import * as THREE from 'three';

/**
 * Zero-g rigid body of the astronaut + SAFER propulsion model.
 *  - translation: momentum conserved, thrusters give 0.25 m/s^2 (x3 with boost)
 *  - rotation: angular velocity kept in the BODY frame (rad/s); two control laws:
 *      'aah'  (automatic attitude hold): mouse rate is tracked with a first-order lag and
 *             angular velocity is damped to zero when the mouse rests
 *      'free' mouse deltas are pure impulses, no damping
 *  - kill burn (V): decelerates both velocity and angular velocity
 *  - tether: stiff spring beyond the reel length
 * Propellant is 0..1 and lasts ~90 s of continuous normal thrust.
 */

export const BODY_RADIUS = 0.45;
export const BODY_MASS = 180;
export const THRUST_ACC = 0.25;
export const BOOST_FACTOR = 3;
export const PROP_RATE = 1 / 90;          // per second at normal thrust
export const ROT_PROP_RATE = PROP_RATE * 0.12;
export const KILL_LIN_DECEL = 0.5;        // m/s^2
export const KILL_ANG_DECEL = 1.6;        // rad/s^2
export const TETHER_K = 400;              // N/m
export const TETHER_DAMP = 140;           // N s/m
export const MOUSE_SENS_AAH = 0.0022;     // rad per pixel (integrated)
export const MOUSE_SENS_FREE = 0.0009;    // rad/s per pixel (impulse)
export const ROLL_RATE_AAH = 0.6;         // rad/s commanded by Q/E
export const ROLL_ACC_FREE = 0.9;         // rad/s^2 from Q/E

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const PUFF_COLOR = new THREE.Color(0xcfe3ff);

/** Local positions of the four SAFER nozzle towers (camera/body frame, meters). Backpack is behind the head (+Z). */
export const NOZZLES = [
  new THREE.Vector3(-0.30, -0.42, 0.44), new THREE.Vector3(0.30, -0.42, 0.44),
  new THREE.Vector3(-0.30, 0.06, 0.44), new THREE.Vector3(0.30, 0.06, 0.44),
];

export class EvaPhysics {
  constructor() {
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.omega = new THREE.Vector3();        // body-frame angular velocity (rad/s)
    this.propellant = 1;
    this.rotationMode = 'aah';
    // per-frame telemetry read by the Player (filled by step functions)
    this.thrustLocal = new THREE.Vector3();  // commanded unit-ish thrust direction in body frame
    this.thrusting = false;
    this.rotThrust = 0;                      // 0..1 magnitude of rotational thruster activity this frame
    this.boost = false;
    this.killing = false;
    this.tetherTaut = false;
    this.tetherForce = 0;
    this._puffTimer = 0;
    this._omegaTarget = new THREE.Vector3();
  }

  reset(position, quaternion) {
    this.position.copy(position);
    this.quaternion.copy(quaternion);
    this.velocity.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.thrusting = false; this.killing = false; this.rotThrust = 0; this.tetherTaut = false;
  }

  /**
   * Translation thrusters. `local` = desired direction in body frame (components -1..1), may be zero.
   * Returns true if thrust was applied.
   */
  thrust(local, boost, dt, particles) {
    this.thrustLocal.copy(local);
    this.boost = boost;
    this.thrusting = false;
    if (local.lengthSq() < 1e-6 || this.propellant <= 0) return false;
    const acc = THRUST_ACC * (boost ? BOOST_FACTOR : 1);
    _v.copy(local).normalize();
    this.propellant = Math.max(0, this.propellant - PROP_RATE * (boost ? BOOST_FACTOR : 1) * dt);
    _v2.copy(_v).applyQuaternion(this.quaternion);
    this.velocity.addScaledVector(_v2, acc * dt);
    this.thrusting = true;
    this.emitPuffs(_v, boost ? 1.6 : 1.0, dt, particles);
    return true;
  }

  /** RCS puffs from the nozzles that face away from `localDir` (unit, body frame), exhaust opposite to thrust. */
  emitPuffs(localDir, strength, dt, particles) {
    if (!particles) return;
    this._puffTimer -= dt;
    if (this._puffTimer > 0) return;
    this._puffTimer = 0.045;
    for (let i = 0; i < NOZZLES.length; i++) {
      // nozzle emission point: tower offset against the thrust direction
      _v2.copy(NOZZLES[i]).addScaledVector(localDir, -0.14).applyQuaternion(this.quaternion).add(this.position);
      _axis.copy(localDir).multiplyScalar(-1).applyQuaternion(this.quaternion);
      particles.emitCone({
        position: _v2, direction: _axis, speed: 9 * strength, spread: 0.22, count: 2, life: 0.35,
        size0: 0.03, size1: 0.28 * strength, color: PUFF_COLOR, alpha: 0.55, baseVelocity: this.velocity, speedJitter: 0.3,
      });
    }
  }

  /**
   * Attitude control. mouseDx/mouseDy in pixels this frame, roll = -1..1 from Q/E.
   * Mouse look: yaw about body Y, pitch about body X, roll about body Z.
   */
  rotate(mouseDx, mouseDy, roll, dt, allowMouse) {
    const om = this.omega;
    this.rotThrust = 0;
    if (dt <= 0) return;
    if (this.rotationMode === 'aah') {
      // target rate from the mouse (first-order lag; integral of the output equals the mouse travel)
      const tgt = this._omegaTarget;
      if (allowMouse) tgt.set(-mouseDy * MOUSE_SENS_AAH / dt, -mouseDx * MOUSE_SENS_AAH / dt, -roll * ROLL_RATE_AAH);
      else tgt.set(0, 0, -roll * ROLL_RATE_AAH);
      const k = 1 - Math.exp(-dt / 0.045);
      _v.copy(tgt).sub(om);
      const change = _v.length();
      om.addScaledVector(_v, k);
      // thrusters work for every commanded change (also for damping to rest)
      this.rotThrust = Math.min(1, change * 0.8);
      if (change > 0.02 && this.propellant > 0) this.propellant = Math.max(0, this.propellant - ROT_PROP_RATE * Math.min(1, change) * dt);
    } else {
      if (allowMouse) { om.x += -mouseDy * MOUSE_SENS_FREE; om.y += -mouseDx * MOUSE_SENS_FREE; }
      if (roll !== 0 && this.propellant > 0) {
        om.z += -roll * ROLL_ACC_FREE * dt;
        this.propellant = Math.max(0, this.propellant - ROT_PROP_RATE * dt);
        this.rotThrust = 0.6;
      }
      if (allowMouse && (mouseDx !== 0 || mouseDy !== 0)) this.rotThrust = Math.max(this.rotThrust, Math.min(1, (Math.abs(mouseDx) + Math.abs(mouseDy)) * 0.02));
    }
    // safety clamp against runaway spin
    const w = om.length();
    if (w > 6) om.multiplyScalar(6 / w);
  }

  /** Kill-rotation-and-translation burn. Returns true while still burning. */
  kill(dt, particles) {
    this.killing = false;
    if (this.propellant <= 0) return false;
    const v = this.velocity.length(), w = this.omega.length();
    if (v < 0.01 && w < 0.01) { this.velocity.set(0, 0, 0); this.omega.set(0, 0, 0); return false; }
    this.killing = true;
    if (v > 0) {
      const dv = Math.min(v, KILL_LIN_DECEL * dt);
      // puff opposite to the decel direction (exhaust points along the velocity)
      _v.copy(this.velocity).multiplyScalar(-1 / v);              // world decel dir
      this.velocity.addScaledVector(_v, dv);
      _v2.copy(_v).applyQuaternion(_q.copy(this.quaternion).invert());
      this.thrustLocal.copy(_v2);
      this.emitPuffs(_v2, 1.4, dt, particles);
      this.thrusting = true;
      this.propellant = Math.max(0, this.propellant - PROP_RATE * 2 * dt);
    }
    if (w > 0) {
      const dw = Math.min(w, KILL_ANG_DECEL * dt);
      this.omega.addScaledVector(_v.copy(this.omega).multiplyScalar(-1 / w), dw);
      this.rotThrust = Math.max(this.rotThrust, 0.8);
      this.propellant = Math.max(0, this.propellant - ROT_PROP_RATE * 3 * dt);
    }
    return true;
  }

  /**
   * Tether spring. anchor: world point; length: reel length (m); hipOffset: body-frame attach point.
   * Returns the current tether distance. Sets tetherTaut / tetherForce.
   */
  tether(anchor, length, hipOffset, dt) {
    _v.copy(hipOffset).applyQuaternion(this.quaternion).add(this.position);  // hip world
    _v2.subVectors(anchor, _v);
    const d = _v2.length();
    this.tetherTaut = false; this.tetherForce = 0;
    if (d > length && d > 1e-6) {
      _v2.multiplyScalar(1 / d);                       // unit toward the anchor
      const stretch = d - length;
      const vr = -this.velocity.dot(_v2);              // speed away from the anchor
      let f = TETHER_K * stretch + (vr > 0 ? TETHER_DAMP * vr : 0);
      f = Math.min(f, 2500);                           // cable limit
      const dv = (f / BODY_MASS) * dt;
      this.velocity.addScaledVector(_v2, dv);
      // never let the spring over-shoot into pulling the body through the anchor
      const vAfter = -this.velocity.dot(_v2);
      if (vAfter < -3) this.velocity.addScaledVector(_v2, -3 - vAfter);
      // the hip is off-centre: a taut tether also yanks the body around (small angular kick)
      _axis.copy(hipOffset).cross(_v2.applyQuaternion(_q.copy(this.quaternion).invert()));
      this.omega.addScaledVector(_axis, (f / BODY_MASS) * dt * 0.35);
      this.tetherTaut = stretch > 0.05;
      this.tetherForce = f;
    }
    return d;
  }

  /** Integrate position and orientation. */
  integrate(dt) {
    const p = this.position, v = this.velocity, om = this.omega;
    p.addScaledVector(v, dt);
    const w = om.length();
    if (w > 1e-9) {
      _axis.copy(om).multiplyScalar(1 / w);
      _q.setFromAxisAngle(_axis, w * dt);
      this.quaternion.multiply(_q).normalize();
    }
    // NaN guards
    if (p.x !== p.x || p.y !== p.y || p.z !== p.z) p.set(0, 0, 20);
    if (v.x !== v.x || v.y !== v.y || v.z !== v.z) v.set(0, 0, 0);
    if (om.x !== om.x || om.y !== om.y || om.z !== om.z) om.set(0, 0, 0);
    if (this.quaternion.x !== this.quaternion.x) this.quaternion.identity();
  }
}
