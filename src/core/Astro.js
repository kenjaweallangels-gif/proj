/**
 * Orbital mechanics helpers for the universe API (km, s, Earth-centred inertial frame as in Orbit.js).
 * Everything works in place on caller-owned vectors / Float64Arrays; nothing allocates per call.
 *
 *   gravity  = new GravityModel(ephemeris)   accelerationEci(r, t, out, opts?)  (Earth mu + J2, Moon, Sun)
 *   prop     = new Propagator(accelFn)        rk4(state, t, h)  /  rk45(state, t, dt, opts)  (state = {r, v})
 *   kepler(r0, v0, dt, mu, outR, outV)        universal-variable two-body propagation (on rails, any dt)
 *   stateToElements(r, v, mu, out)            classical elements + periapsis / apoapsis / period
 *   elementsToState(el, mu, outR, outV)
 *
 * The ephemeris is an object { sunPositionEci(t, out), moonPositionEci(t, out) } (t = sim seconds since the
 * epoch, km); OrbitEphemeris wraps the low-precision formulas of Orbit.js. src/core/Ephemeris.js (planets,
 * better Moon) can replace it through universe.setEphemeris().
 */
import * as THREE from 'three';
import { MU_EARTH, J2, sunDirectionEci, moonPositionEci } from './Orbit.js';
import { DEG } from './constants.js';

export const MU_MOON = 4902.800066;          // km^3/s^2
export const MU_SUN = 1.32712440018e11;      // km^3/s^2
export const R_EARTH_EQ = 6378.137;          // km (J2 reference radius)
export const R_MOON = 1737.4;                // km
export const AU_KM = 149597870.7;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

const _d = new THREE.Vector3();

/** Low-precision Sun / Moon (Orbit.js formulas) with a one-entry cache per body (several calls per step share t). */
export class OrbitEphemeris {
  constructor(epochMs) {
    this.epochMs = epochMs;
    this._tSun = NaN; this._sun = new THREE.Vector3();
    this._tMoon = NaN; this._moon = new THREE.Vector3();
  }
  daysSinceJ2000(t) { return (this.epochMs - J2000_MS) / 86400000 + t / 86400; }
  /** Sun position (km, ECI) at sim time t. */
  sunPositionEci(t, out) {
    if (t !== this._tSun) {
      const n = this.daysSinceJ2000(t);
      const g = (357.528 + 0.9856003 * n) * DEG;
      const dist = AU_KM * (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g));
      sunDirectionEci(n, this._sun).multiplyScalar(dist);
      this._tSun = t;
    }
    return out.copy(this._sun);
  }
  /** Moon position (km, ECI) at sim time t. */
  moonPositionEci(t, out) {
    if (t !== this._tMoon) { moonPositionEci(this.daysSinceJ2000(t), this._moon); this._tMoon = t; }
    return out.copy(this._moon);
  }
  /** Moon velocity (km/s, ECI) by a central difference (60 s). */
  moonVelocityEci(t, out) {
    moonPositionEci(this.daysSinceJ2000(t + 30), out);
    moonPositionEci(this.daysSinceJ2000(t - 30), _d);
    return out.sub(_d).multiplyScalar(1 / 60);
  }
}

const _rs = new THREE.Vector3(), _rel = new THREE.Vector3();

/**
 * Gravity in ECI: Earth point mass + J2 oblateness, Moon and Sun as third bodies (accelerations of the
 * spacecraft minus that of the Earth). opts: { j2 = true, moon = true, sun = true }.
 */
export class GravityModel {
  constructor(ephemeris) { this.ephemeris = ephemeris; this.muEarth = MU_EARTH; this.j2 = J2; }
  accelerationEci(r, t, out, opts) {
    const x = r.x, y = r.y, z = r.z;
    const r2 = x * x + y * y + z * z, rn = Math.sqrt(r2), r3 = r2 * rn;
    const mu = this.muEarth;
    out.set(-mu * x / r3, -mu * y / r3, -mu * z / r3);
    if (!opts || opts.j2 !== false) {
      const k = 1.5 * this.j2 * mu * R_EARTH_EQ * R_EARTH_EQ / (r2 * r2 * rn);   // 3/2 J2 mu Re^2 / r^5
      const zz = 5 * z * z / r2;
      out.x += k * x * (zz - 1); out.y += k * y * (zz - 1); out.z += k * z * (zz - 3);
    }
    const eph = this.ephemeris;
    if (eph && (!opts || opts.moon !== false)) thirdBody(r, eph.moonPositionEci(t, _rs), MU_MOON, out);
    if (eph && (!opts || opts.sun !== false)) thirdBody(r, eph.sunPositionEci(t, _rs), MU_SUN, out);
    return out;
  }
}

/** out += mu3 * ((s - r)/|s - r|^3 - s/|s|^3) */
function thirdBody(r, s, mu3, out) {
  _rel.subVectors(s, r);
  const d = _rel.length(), sn = s.length();
  const kd = mu3 / (d * d * d), ks = mu3 / (sn * sn * sn);
  out.x += kd * _rel.x - ks * s.x; out.y += kd * _rel.y - ks * s.y; out.z += kd * _rel.z - ks * s.z;
}

// ---------------------------------------------------------------------------------------------- integrators
const _ra = new THREE.Vector3(), _aa = new THREE.Vector3();
// Dormand-Prince 5(4) tableau
const DP_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const DP_A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const DP_B = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const DP_E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];   // b5 - b4

/**
 * Numerical propagation of a point mass. `accel(r, v, t, out)` returns the total acceleration (km/s^2) —
 * typically gravity.accelerationEci plus thrust / drag. State = { r: Vector3 (km), v: Vector3 (km/s) }.
 */
export class Propagator {
  constructor(accel) {
    this.accel = accel;
    this._y = new Float64Array(6); this._yt = new Float64Array(6); this._yn = new Float64Array(6);
    this._k = Array.from({ length: 7 }, () => new Float64Array(6));
    this.h = 10;            // last adaptive step (s), reused as the next initial guess
    this.lastError = 0;
    this.steps = 0;
  }

  _deriv(t, y, out) {
    _ra.set(y[0], y[1], y[2]); _aa.set(y[3], y[4], y[5]);
    const a = this.accel(_ra, _aa, t, _d);
    out[0] = y[3]; out[1] = y[4]; out[2] = y[5]; out[3] = a.x; out[4] = a.y; out[5] = a.z;
  }

  /** One classical RK4 step of size h (s), in place. */
  rk4(state, t, h) {
    const y = this._y, yt = this._yt, k = this._k;
    y[0] = state.r.x; y[1] = state.r.y; y[2] = state.r.z; y[3] = state.v.x; y[4] = state.v.y; y[5] = state.v.z;
    this._deriv(t, y, k[0]);
    for (let i = 0; i < 6; i++) yt[i] = y[i] + 0.5 * h * k[0][i];
    this._deriv(t + 0.5 * h, yt, k[1]);
    for (let i = 0; i < 6; i++) yt[i] = y[i] + 0.5 * h * k[1][i];
    this._deriv(t + 0.5 * h, yt, k[2]);
    for (let i = 0; i < 6; i++) yt[i] = y[i] + h * k[2][i];
    this._deriv(t + h, yt, k[3]);
    for (let i = 0; i < 6; i++) y[i] += (h / 6) * (k[0][i] + 2 * k[1][i] + 2 * k[2][i] + k[3][i]);
    state.r.set(y[0], y[1], y[2]); state.v.set(y[3], y[4], y[5]);
    return state;
  }

  /** Fixed-step RK4 over dt with steps of at most hMax. */
  rk4Span(state, t, dt, hMax = 10) {
    const n = Math.max(1, Math.ceil(Math.abs(dt) / hMax)), h = dt / n;
    for (let i = 0; i < n; i++) this.rk4(state, t + i * h, h);
    return state;
  }

  /**
   * Adaptive Dormand-Prince 5(4) over dt (either sign). opts: tol (km, position error per step, default 1e-6
   * i.e. 1 mm), hMin (1e-3 s), hMax (600 s), maxSteps (2000). Returns the number of steps taken; if maxSteps
   * is hit, the state is left at the time reached and `this.incomplete` is the remaining time.
   */
  rk45(state, t, dt, opts = {}) {
    const tol = opts.tol ?? 1e-6, hMin = opts.hMin ?? 1e-3, hMax = opts.hMax ?? 600, maxSteps = opts.maxSteps ?? 2000;
    const y = this._y, yt = this._yt, yn = this._yn, k = this._k;
    y[0] = state.r.x; y[1] = state.r.y; y[2] = state.r.z; y[3] = state.v.x; y[4] = state.v.y; y[5] = state.v.z;
    const dir = dt < 0 ? -1 : 1;
    let left = Math.abs(dt), tc = t, steps = 0;
    let h = Math.min(Math.max(this.h, hMin), hMax, left);
    this._deriv(tc, y, k[0]);
    while (left > 1e-12 && steps < maxSteps) {
      h = Math.min(h, left);
      const hs = h * dir;
      for (let s = 1; s < 7; s++) {
        const a = DP_A[s];
        for (let i = 0; i < 6; i++) { let acc = y[i]; for (let j = 0; j < s; j++) acc += hs * a[j] * k[j][i]; yt[i] = acc; }
        this._deriv(tc + DP_C[s] * hs, yt, k[s]);
      }
      // 5th-order solution and error estimate (position components)
      let err = 0;
      for (let i = 0; i < 6; i++) {
        let acc = y[i], e = 0;
        for (let j = 0; j < 7; j++) { acc += hs * DP_B[j] * k[j][i]; e += hs * DP_E[j] * k[j][i]; }
        yn[i] = acc;
        if (i < 3) err = Math.max(err, Math.abs(e));
      }
      if (err <= tol || h <= hMin) {
        for (let i = 0; i < 6; i++) { y[i] = yn[i]; k[0][i] = k[6][i]; }   // FSAL: k7 is the derivative at the new point
        tc += hs; left -= h; steps++;
        this.lastError = err;
      }
      const f = err > 0 ? 0.9 * Math.pow(tol / err, 0.2) : 5;
      h = Math.min(hMax, Math.max(hMin, h * Math.min(5, Math.max(0.2, f))));
    }
    this.h = h; this.steps = steps;
    this.incomplete = left > 1e-12 ? left * dir : 0;
    state.r.set(y[0], y[1], y[2]); state.v.set(y[3], y[4], y[5]);
    return steps;
  }
}

// ---------------------------------------------------------------------------------------------- two-body
/** Stumpff functions C(z), S(z) (series near 0). */
export function stumpffC(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (1 - Math.cos(s)) / z; }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.cosh(s) - 1) / -z; }
  return 0.5 - z / 24 + (z * z) / 720;
}
export function stumpffS(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

const _r0 = new THREE.Vector3(), _v0 = new THREE.Vector3();

/**
 * Universal-variable Kepler propagation (Curtis, Alg. 3.3/3.4): two-body state after dt (s, any sign) for
 * elliptic, parabolic and hyperbolic orbits. Bound orbits reduce dt modulo the period first, so huge time steps
 * (on rails at ×10⁶) cost the same as small ones. outR / outV may alias r0 / v0. Returns outR.
 */
export function kepler(r0, v0, dt, mu, outR, outV) {
  _r0.copy(r0); _v0.copy(v0);
  const rn = _r0.length(), vn2 = _v0.lengthSq();
  const vr = _r0.dot(_v0) / rn;
  const alpha = 2 / rn - vn2 / mu;              // 1/a
  const smu = Math.sqrt(mu);
  if (alpha > 1e-12) {
    const period = 2 * Math.PI * Math.sqrt(1 / (alpha * alpha * alpha * mu));
    dt = dt % period;
  }
  if (dt === 0) { outR.copy(_r0); outV.copy(_v0); return outR; }
  // initial guess
  let x;
  if (alpha > 1e-12) x = smu * dt * alpha;
  else if (alpha < -1e-12) {
    const a = 1 / alpha;
    const s = Math.sign(dt);
    x = s * Math.sqrt(-a) * Math.log((-2 * mu * alpha * dt) / (_r0.dot(_v0) + s * Math.sqrt(-mu * a) * (1 - rn * alpha)));
    if (!Number.isFinite(x)) x = smu * dt / rn;
  } else x = smu * dt / rn;
  let z = 0, C = 0.5, S = 1 / 6;
  for (let it = 0; it < 60; it++) {
    z = alpha * x * x; C = stumpffC(z); S = stumpffS(z);
    const F = (rn * vr / smu) * x * x * C + (1 - alpha * rn) * x * x * x * S + rn * x - smu * dt;
    const dF = (rn * vr / smu) * x * (1 - z * S) + (1 - alpha * rn) * x * x * C + rn;
    const dx = F / dF;
    x -= dx;
    if (Math.abs(dx) < 1e-10 * Math.max(1, Math.abs(x))) break;
  }
  z = alpha * x * x; C = stumpffC(z); S = stumpffS(z);
  const f = 1 - (x * x / rn) * C;
  const g = dt - (x * x * x / smu) * S;
  outR.copy(_r0).multiplyScalar(f).addScaledVector(_v0, g);
  const r = outR.length();
  const fd = (smu / (r * rn)) * (alpha * x * x * x * S - x);
  const gd = 1 - (x * x / r) * C;
  outV.copy(_r0).multiplyScalar(fd).addScaledVector(_v0, gd);
  return outR;
}

const _h = new THREE.Vector3(), _n = new THREE.Vector3(), _e = new THREE.Vector3();

/**
 * Classical elements from a state vector. out (reused): { a, e, i, raan, argp, nu, M, E, p, energy, h,
 * periapsis, apoapsis (km from the centre; Infinity when unbound), periapsisAlt / apoapsisAlt (above
 * `bodyRadius`, default Earth's mean radius), period (s; Infinity when unbound) }. Angles in radians.
 */
export function stateToElements(r, v, mu, out = {}, bodyRadius = 6371.0) {
  const rn = r.length(), vn2 = v.lengthSq();
  _h.crossVectors(r, v);
  const hn = _h.length();
  _n.set(-_h.y, _h.x, 0);                       // node line: z x h
  const nn = _n.length();
  _e.copy(r).multiplyScalar(vn2 - mu / rn).addScaledVector(v, -r.dot(v)).multiplyScalar(1 / mu);
  const e = _e.length();
  const energy = vn2 / 2 - mu / rn;
  const i = Math.acos(THREE.MathUtils.clamp(_h.z / hn, -1, 1));
  let raan = nn > 1e-9 ? Math.acos(THREE.MathUtils.clamp(_n.x / nn, -1, 1)) : 0;
  if (_n.y < 0) raan = 2 * Math.PI - raan;
  let argp = 0, nu = 0;
  if (e > 1e-9) {
    if (nn > 1e-9) { argp = Math.acos(THREE.MathUtils.clamp(_n.dot(_e) / (nn * e), -1, 1)); if (_e.z < 0) argp = 2 * Math.PI - argp; }
    else { argp = Math.atan2(_e.y, _e.x); if (_h.z < 0) argp = 2 * Math.PI - argp; }   // equatorial: longitude of periapsis
    nu = Math.acos(THREE.MathUtils.clamp(_e.dot(r) / (e * rn), -1, 1));
    if (r.dot(v) < 0) nu = 2 * Math.PI - nu;
  } else {
    // circular: argument of latitude (or true longitude when equatorial) in nu
    if (nn > 1e-9) { nu = Math.acos(THREE.MathUtils.clamp(_n.dot(r) / (nn * rn), -1, 1)); if (r.z < 0) nu = 2 * Math.PI - nu; }
    else { nu = Math.atan2(r.y, r.x); if (_h.z < 0) nu = -nu; if (nu < 0) nu += 2 * Math.PI; }
  }
  const p = (hn * hn) / mu;
  const a = Math.abs(1 - e) < 1e-12 ? Infinity : p / (1 - e * e);
  out.a = a; out.e = e; out.i = i; out.raan = raan; out.argp = argp; out.nu = nu; out.p = p; out.h = hn; out.energy = energy;
  out.periapsis = p / (1 + e);
  out.apoapsis = e < 1 ? p / (1 - e) : Infinity;
  out.periapsisAlt = out.periapsis - bodyRadius;
  out.apoapsisAlt = out.apoapsis - bodyRadius;
  out.period = e < 1 ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Infinity;
  // anomalies
  if (e < 1) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    out.E = E; out.M = ((E - e * Math.sin(E)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  } else if (e > 1) {
    const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    out.E = F; out.M = e * Math.sinh(F) - F;
  } else { out.E = 0; out.M = 0; }
  return out;
}

/**
 * State vector from elements { a or p, e, i, raan, argp, nu } (radians). For e = 1 pass p. Returns outR.
 */
export function elementsToState(el, mu, outR, outV) {
  const e = el.e ?? 0;
  const p = el.p ?? el.a * (1 - e * e);
  const nu = el.nu ?? 0;
  const cn = Math.cos(nu), sn = Math.sin(nu);
  const r = p / (1 + e * cn);
  const k = Math.sqrt(mu / p);
  // perifocal
  const xp = r * cn, yp = r * sn, vxp = -k * sn, vyp = k * (e + cn);
  const cO = Math.cos(el.raan ?? 0), sO = Math.sin(el.raan ?? 0), ci = Math.cos(el.i ?? 0), si = Math.sin(el.i ?? 0), cw = Math.cos(el.argp ?? 0), sw = Math.sin(el.argp ?? 0);
  const m11 = cO * cw - sO * sw * ci, m12 = -cO * sw - sO * cw * ci;
  const m21 = sO * cw + cO * sw * ci, m22 = -sO * sw + cO * cw * ci;
  const m31 = sw * si, m32 = cw * si;
  outR.set(m11 * xp + m12 * yp, m21 * xp + m22 * yp, m31 * xp + m32 * yp);
  outV.set(m11 * vxp + m12 * vyp, m21 * vxp + m22 * vyp, m31 * vxp + m32 * vyp);
  return outR;
}

/** Periapsis / apoapsis radius (km from the centre) and period of a state: { periapsis, apoapsis, period, e, a }. */
export function apsides(r, v, mu, out = {}) {
  const el = stateToElements(r, v, mu, out._el || (out._el = {}));
  out.periapsis = el.periapsis; out.apoapsis = el.apoapsis; out.period = el.period; out.e = el.e; out.a = el.a;
  return out;
}

/** Sphere of influence radius (km) of a body of gravitational parameter mu orbiting at distance a around muCentral. */
export function sphereOfInfluence(a, mu, muCentral) { return a * Math.pow(mu / muCentral, 0.4); }
