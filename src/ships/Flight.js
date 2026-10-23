import * as THREE from 'three';

/**
 * Flight dynamics helpers for the traffic controller (no per-step allocations):
 *  - Path: sampled curve with arc length (Bezier or rounded polyline)
 *  - Mover: follows a Path with a speed profile and an acceleration limit
 *  - Attitude: rate/acceleration-limited slew of a quaternion toward a target
 *  - Rcs: picks real nozzles that produce the demanded force/torque and emits puffs
 *  - targetQuat: orientation that maps a ship axis to a world direction with a roll reference
 */

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _axisL = new THREE.Vector3(), _upL = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();

export class Path {
  constructor(n) {
    this.pts = new Float32Array(n * 3);
    this.cum = new Float32Array(n);
    this.n = n;
    this.length = 0;
  }
  _finish() {
    this.cum[0] = 0;
    for (let i = 1; i < this.n; i++) {
      const dx = this.pts[i * 3] - this.pts[i * 3 - 3], dy = this.pts[i * 3 + 1] - this.pts[i * 3 - 2], dz = this.pts[i * 3 + 2] - this.pts[i * 3 - 1];
      this.cum[i] = this.cum[i - 1] + Math.hypot(dx, dy, dz);
    }
    this.length = this.cum[this.n - 1];
    return this;
  }
  /** Cubic Bezier through p0..p3 sampled in `n` points. */
  static bezier(p0, p1, p2, p3, n = 96) {
    const p = new Path(n);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), mt = 1 - t;
      const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
      p.pts[i * 3] = a * p0.x + b * p1.x + c * p2.x + d * p3.x;
      p.pts[i * 3 + 1] = a * p0.y + b * p1.y + c * p2.y + d * p3.y;
      p.pts[i * 3 + 2] = a * p0.z + b * p1.z + c * p2.z + d * p3.z;
    }
    return p._finish();
  }
  /** Polyline through waypoints with corners rounded by quadratic blends of radius r. */
  static waypoints(points, r = 6, per = 12) {
    const out = [];
    out.push(points[0].clone());
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i], prev = points[i - 1], next = points[i + 1];
      const d1 = _a.subVectors(p, prev), d2 = _b.subVectors(next, p);
      const rr = Math.min(r, d1.length() * 0.5, d2.length() * 0.5);
      d1.normalize(); d2.normalize();
      const s = p.clone().addScaledVector(d1, -rr), e = p.clone().addScaledVector(d2, rr);
      for (let k = 0; k <= per; k++) {
        const t = k / per, mt = 1 - t;
        out.push(new THREE.Vector3(mt * mt * s.x + 2 * mt * t * p.x + t * t * e.x, mt * mt * s.y + 2 * mt * t * p.y + t * t * e.y, mt * mt * s.z + 2 * mt * t * p.z + t * t * e.z));
      }
    }
    out.push(points[points.length - 1].clone());
    const path = new Path(out.length);
    out.forEach((v, i) => { path.pts[i * 3] = v.x; path.pts[i * 3 + 1] = v.y; path.pts[i * 3 + 2] = v.z; });
    return path._finish();
  }
  /** Position and unit tangent at arc length s (clamped). */
  sample(s, outPos, outTan) {
    const cum = this.cum, n = this.n;
    s = THREE.MathUtils.clamp(s, 0, this.length);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const seg = Math.max(1e-9, cum[hi] - cum[lo]);
    const t = (s - cum[lo]) / seg;
    const p = this.pts;
    outPos.set(p[lo * 3] + (p[hi * 3] - p[lo * 3]) * t, p[lo * 3 + 1] + (p[hi * 3 + 1] - p[lo * 3 + 1]) * t, p[lo * 3 + 2] + (p[hi * 3 + 2] - p[lo * 3 + 2]) * t);
    if (outTan) {
      // smooth the tangent across the two neighbouring segments
      const l2 = Math.max(0, lo - 1), h2 = Math.min(n - 1, hi + 1);
      outTan.set(p[h2 * 3] - p[l2 * 3], p[h2 * 3 + 1] - p[l2 * 3 + 1], p[h2 * 3 + 2] - p[l2 * 3 + 2]);
      if (outTan.lengthSq() < 1e-12) outTan.set(0, 0, 1); else outTan.normalize();
    }
    return outPos;
  }
}

/** Follows a Path with target speed from `profile(s, L)`, limited by `aMax`. */
export class Mover {
  constructor() { this.path = null; this.s = 0; this.speed = 0; this.profile = null; this.aMax = 0.05; this.done = false; this.lastAccel = 0; }
  start(path, profile, aMax, s0 = 0, v0 = 0) { this.path = path; this.profile = profile; this.aMax = aMax; this.s = s0; this.speed = v0; this.done = false; this.lastAccel = 0; return this; }
  step(h, outPos, outTan) {
    const L = this.path.length;
    const vT = this.profile(this.s, L);
    const dv = THREE.MathUtils.clamp(vT - this.speed, -this.aMax * h, this.aMax * h);
    this.lastAccel = dv / Math.max(h, 1e-6);
    this.speed += dv;
    this.s += this.speed * h;
    if (this.s >= L) { this.s = L; this.done = true; }
    this.path.sample(this.s, outPos, outTan);
  }
}

/**
 * Target quaternion that maps ship-local `axisL` to world `dirW`, rolling so that ship-local `upL`
 * is as close as possible to world `upW`.
 */
export function targetQuat(axisL, dirW, upL, upW, out) {
  _axisL.copy(axisL).normalize();
  _upL.copy(upL).addScaledVector(_axisL, -_upL.dot(_axisL)).normalize();
  _w.copy(dirW).normalize();
  _u.copy(upW).addScaledVector(_w, -upW.dot(_w));
  if (_u.lengthSq() < 1e-6) { _u.set(0, 1, 0).addScaledVector(_w, -_w.y); if (_u.lengthSq() < 1e-6) _u.set(1, 0, 0).addScaledVector(_w, -_w.x); }
  _u.normalize();
  _c.crossVectors(_axisL, _upL);
  _m.makeBasis(_axisL, _upL, _c);          // local basis columns
  _d.crossVectors(_w, _u);
  _m2.makeBasis(_w, _u, _d);                // world basis columns
  _m.transpose();                           // inverse of an orthonormal basis
  _m2.multiply(_m);                         // world * local^-1
  return out.setFromRotationMatrix(_m2);
}

/** Rate- and acceleration-limited attitude slew. `omega` is the angular velocity (world, rad/s). */
export class Attitude {
  constructor(omegaMax, alphaMax) {
    this.target = new THREE.Quaternion();
    this.omega = new THREE.Vector3();
    this.omegaMax = omegaMax; this.alphaMax = alphaMax;
    this.error = 0;             // remaining angle (rad)
    this.alpha = new THREE.Vector3();   // last angular acceleration (world)
  }
  /** Rotate `q` toward the target by one step h. Returns the error angle after the step. */
  step(q, h) {
    _q.copy(this.target).multiply(_q2.copy(q).invert());   // world rotation taking q to target
    if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
    const s = Math.sqrt(Math.max(0, 1 - _q.w * _q.w));
    const angle = 2 * Math.acos(THREE.MathUtils.clamp(_q.w, -1, 1));
    if (s > 1e-6) _a.set(_q.x / s, _q.y / s, _q.z / s); else _a.set(0, 1, 0);
    // desired rate: bang-bang deceleration profile toward the target
    const wDes = angle < 0.0015 ? 0 : Math.min(this.omegaMax, Math.sqrt(2 * this.alphaMax * angle * 0.7));
    _b.copy(_a).multiplyScalar(wDes);               // desired omega vector
    _c.subVectors(_b, this.omega);                  // required change
    const maxDw = this.alphaMax * h;
    if (_c.length() > maxDw) _c.setLength(maxDw);
    this.alpha.copy(_c).multiplyScalar(1 / Math.max(h, 1e-6));
    this.omega.add(_c);
    const w = this.omega.length();
    if (w > 1e-9) {
      const step = Math.min(w * h, angle > 0 ? Math.max(angle, 0) : 0);     // never overshoot the target
      _q.setFromAxisAngle(_d.copy(this.omega).multiplyScalar(1 / w), step);
      q.premultiply(_q).normalize();
      if (step < w * h) this.omega.set(0, 0, 0);
    }
    this.error = Math.max(0, angle - w * h);
    return this.error;
  }
  snap(q) { q.copy(this.target); this.omega.set(0, 0, 0); this.alpha.set(0, 0, 0); this.error = 0; }
}

const RCS_COLOR = new THREE.Color(0xd8e4ff);
const PLUME_COLOR = new THREE.Color(0xffb46a);
const PLUME_CORE = new THREE.Color(0xfff2dc);

/**
 * RCS / main-engine particle emitter. Selects the nozzles whose thrust (opposite to the exhaust direction) best
 * matches the demanded acceleration, and those whose torque (r x thrust) matches the demanded angular
 * acceleration, so every puff corresponds to a real velocity / rate change.
 *
 * `k` is the time-scale look factor (1 at real time): particle speeds are divided and lifetimes multiplied by
 * it (same trajectories, traversed k times slower in sim time) and the emission rate divided, so puffs remain
 * visible for several frames at ×60 without flooding the particle pool.
 */
export class Rcs {
  constructor(particles) {
    this.particles = particles;
    this.accT = 0; this.accR = 0; this.accM = 0;
  }

  /**
   * @param ship  object with group (position/quaternion), velocity, nozzles[], mainNozzles[], dyn
   * @param accW  demanded linear acceleration (world, m/s^2)
   * @param alphaW demanded angular acceleration (world, rad/s^2)
   * @param throttle 0..1 main engine throttle (plume)
   * @param h  sub-step length (s)
   * @param k  time-scale look factor (>= 1)
   */
  emit(ship, accW, alphaW, throttle, h, k = 1) {
    const P = this.particles, g = ship.group, dyn = ship.dyn, look = dyn.puff;
    _q.copy(g.quaternion).invert();
    const aMag = accW.length(), alMag = alphaW.length();
    const nozzles = ship.nozzles;
    const ik = 1 / k;
    _e.copy(ship.velocity).multiplyScalar(ik);        // base velocity in "slow particle" time
    // --- translation ---
    if (aMag > dyn.rcs * 0.08 && !(throttle > 0)) {
      _a.copy(accW).applyQuaternion(_q).normalize();          // demanded thrust, local
      this.accT += h * 28 * ik * Math.min(1, aMag / dyn.rcs) * look.scale;
      const n = Math.min(10, Math.floor(this.accT));
      if (n > 0) {
        this.accT -= n;
        for (let i = 0; i < nozzles.length; i++) {
          const nz = nozzles[i];
          if (-nz.direction.dot(_a) > 0.72) this._puff(nz, g, n, look, k);
        }
      }
    } else if (this.accT > 0) this.accT = Math.max(0, this.accT - h * 4);
    // --- rotation ---
    if (alMag > dyn.alpha * 0.12) {
      _b.copy(alphaW).applyQuaternion(_q).normalize();         // demanded torque, local
      this.accR += h * 18 * ik * Math.min(1, alMag / dyn.alpha) * look.scale;
      const n = Math.min(8, Math.floor(this.accR));
      if (n > 0) {
        this.accR -= n;
        for (let i = 0; i < nozzles.length; i++) {
          const nz = nozzles[i];
          _c.copy(nz.direction).negate();                     // thrust
          _d.crossVectors(nz.position, _c);                    // torque
          if (_d.lengthSq() < 1e-4) continue;
          if (_d.normalize().dot(_b) > 0.6) this._puff(nz, g, n, look, k);
        }
      }
    } else if (this.accR > 0) this.accR = Math.max(0, this.accR - h * 4);
    // --- main engine plume ---
    if (throttle > 0.02 && ship.mainNozzles.length) {
      this.accM += h * 45 * ik * throttle;
      const n = Math.min(60, Math.floor(this.accM));
      if (n > 0) {
        this.accM -= n;
        const per = Math.max(1, Math.floor(n / ship.mainNozzles.length));
        for (const nz of ship.mainNozzles) {
          _c.copy(nz.position).applyQuaternion(g.quaternion).add(g.position);
          _d.copy(nz.direction).applyQuaternion(g.quaternion);
          P.emitCone({ position: _c, direction: _d, speed: 85 * look.scale * ik, spread: 0.11, count: per, life: 0.9 * k, size0: 0.3 * look.scale, size1: 2.6 * look.scale, color: PLUME_COLOR, alpha: 0.85, baseVelocity: _e, speedJitter: 0.35, lifeJitter: 0.3 });
          P.emitCone({ position: _c, direction: _d, speed: 30 * look.scale * ik, spread: 0.08, count: Math.max(1, per >> 1), life: 0.28 * k, size0: 0.9 * look.scale, size1: 1.6 * look.scale, color: PLUME_CORE, alpha: 1.0, baseVelocity: _e, speedJitter: 0.3, lifeJitter: 0.3 });
        }
      }
    } else if (this.accM > 0) this.accM = 0;
  }

  _puff(nz, g, count, look, k) {
    _c.copy(nz.position).applyQuaternion(g.quaternion).add(g.position);
    _d.copy(nz.direction).applyQuaternion(g.quaternion);
    this.particles.emitCone({ position: _c, direction: _d, speed: look.speed / k, spread: 0.24, count, life: 0.75 * k, size0: 0.05 * look.scale, size1: look.size, color: RCS_COLOR, alpha: 0.55, baseVelocity: _e, speedJitter: 0.4, lifeJitter: 0.4 });
  }
}
