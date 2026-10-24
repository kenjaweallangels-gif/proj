/**
 * Orbital mechanics for the station: circular LEO orbit around a rotating Earth,
 * Sun and Moon directions, eclipse state, and the frame transforms the renderer needs.
 *
 * Frames (right-handed):
 *  ECI   – Earth-centred inertial, x -> vernal equinox, z -> celestial north (J2000-ish, km).
 *  ECEF  – Earth-fixed, x -> (lat 0, lon 0), y -> (lat 0, lon 90E), z -> north pole (km).
 *  LVLH  – the scene frame.  Origin at the station.  +X prograde (velocity),
 *          +Y zenith (radially away from Earth), +Z = X x Y (negative orbit normal).
 *          The near scene is this frame in meters; the far scene is this frame in km.
 *
 * Earth mesh convention: build the Earth with THREE.SphereGeometry and an equirectangular
 * texture (left edge = lon -180).  In the mesh's local frame +Y is the north pole,
 * +X is lon 0 and -Z is lon 90E.  Apply `earth.quaternion.copy(orbit.earthQuat)`.
 *
 * Sky convention: star positions are plain ECI unit vectors (cos d cos a, cos d sin a, sin d)
 * placed in a Group whose quaternion is `orbit.skyQuat`.
 *
 * Render frame (see src/core/Universe.js): the top-level outputs (sunDir, moonDir, moonPosFar, earthCenterFar,
 * skyQuat, earthQuat, sunVisible, sunReddening, sunColor, earthLit, earthshine, subLatDeg/subLonDeg,
 * observerAltitudeKm) describe the CURRENT render frame and its observer. update() computes them for the
 * station (default frame: origin = station, axes = station LVLH); the universe then calls applyFrame() when the
 * scene is rendered around another observer. `orbit.local` always holds the station's own values (station LVLH,
 * the station's eclipse state) for modules that work in station coordinates (solar arrays, antennas, floodlights,
 * interiors, ships, the astronaut).
 */
import * as THREE from 'three';
import { DEG, EARTH_RADIUS_KM, STATION_ALTITUDE_KM, STATION_INCLINATION_DEG, EPOCH_UTC_MS } from './constants.js';

export const MU_EARTH = 398600.4418;        // km^3 / s^2
export const EARTH_ROT_RATE = 7.2921159e-5;  // rad / s
export const J2 = 1.08263e-3;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qRx90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const _Z = new THREE.Vector3();
const _moonRel = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _o = new THREE.Vector3();
const _sunPos = new THREE.Vector3();
const SUN_ANGULAR_RADIUS = 0.00465;   // rad
const MOON_RADIUS_KM = 1737.4;

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Sun direction in ECI (unit) for a given days-since-J2000. Low-precision Almanac formula. */
export function sunDirectionEci(n, out = new THREE.Vector3()) {
  const L = (280.460 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  return out.set(Math.cos(lambda), Math.cos(eps) * Math.sin(lambda), Math.sin(eps) * Math.sin(lambda)).normalize();
}

/** Moon position in ECI (km) for a given days-since-J2000. Low-precision (Montenbruck/Pfleger). */
export function moonPositionEci(n, out = new THREE.Vector3()) {
  const T = n / 36525;
  const L0 = (218.31617 + 481267.88088 * T) * DEG;   // mean longitude
  const l = (134.96292 + 477198.86753 * T) * DEG;    // mean anomaly
  const lp = (357.52543 + 35999.04944 * T) * DEG;    // Sun mean anomaly
  const F = (93.27283 + 483202.01873 * T) * DEG;     // argument of latitude
  const D = (297.85027 + 445267.11135 * T) * DEG;    // mean elongation
  const dL = 22640 * Math.sin(l) - 4586 * Math.sin(l - 2 * D) + 2370 * Math.sin(2 * D) + 769 * Math.sin(2 * l)
    - 668 * Math.sin(lp) - 412 * Math.sin(2 * F) - 212 * Math.sin(2 * l - 2 * D) - 206 * Math.sin(l + lp - 2 * D)
    + 192 * Math.sin(l + 2 * D) - 165 * Math.sin(lp - 2 * D) - 125 * Math.sin(D) - 110 * Math.sin(l + lp) + 148 * Math.sin(l - lp) - 55 * Math.sin(2 * F - 2 * D);
  const lambda = L0 + (dL / 3600) * DEG;
  const S = F + ((dL + 412 * Math.sin(2 * F) + 541 * Math.sin(lp)) / 3600) * DEG;
  const h = F - 2 * D;
  const N = -526 * Math.sin(h) + 44 * Math.sin(l + h) - 31 * Math.sin(-l + h) - 23 * Math.sin(lp + h) + 11 * Math.sin(-lp + h) - 25 * Math.sin(-2 * l + F) + 21 * Math.sin(-l + F);
  const beta = ((18520.0 * Math.sin(S) + N) / 3600) * DEG;
  const dist = 385000 - 20905 * Math.cos(l) - 3699 * Math.cos(2 * D - l) - 2956 * Math.cos(2 * D) - 570 * Math.cos(2 * l);
  const eps = 23.4393 * DEG;
  const cb = Math.cos(beta), sb = Math.sin(beta), cl = Math.cos(lambda), sl = Math.sin(lambda);
  // ecliptic -> equatorial
  return out.set(cb * cl, Math.cos(eps) * cb * sl - Math.sin(eps) * sb, Math.sin(eps) * cb * sl + Math.cos(eps) * sb).multiplyScalar(dist);
}

/** Greenwich mean sidereal time (radians) for days-since-J2000. */
export function gmst(n) {
  const deg = 280.46061837 + 360.98564736629 * n;
  return ((deg % 360) + 360) % 360 * DEG;
}

export class Orbit {
  constructor(opts = {}) {
    this.altitudeKm = opts.altitudeKm ?? STATION_ALTITUDE_KM;
    this.inclination = (opts.inclinationDeg ?? STATION_INCLINATION_DEG) * DEG;
    this.raan0 = (opts.raanDeg ?? 62.0) * DEG;
    this.phase0 = (opts.phaseDeg ?? 205.0) * DEG;
    this.epochMs = opts.epochMs ?? EPOCH_UTC_MS;

    this.a = EARTH_RADIUS_KM + this.altitudeKm;
    this.meanMotion = Math.sqrt(MU_EARTH / (this.a ** 3));      // rad/s
    this.periodSec = 2 * Math.PI / this.meanMotion;
    this.speedKms = Math.sqrt(MU_EARTH / this.a);
    this.raanRate = -1.5 * this.meanMotion * J2 * (EARTH_RADIUS_KM / this.a) ** 2 * Math.cos(this.inclination);

    // Outputs (LVLH frame unless noted)
    this.simTime = 0;
    this.positionEci = new THREE.Vector3();
    this.velocityEci = new THREE.Vector3();
    this.sunDirEci = new THREE.Vector3();
    this.sunDir = new THREE.Vector3(0, 1, 0);      // unit, LVLH
    this.moonDir = new THREE.Vector3(0, 0, 1);     // unit, LVLH
    this.moonDistanceKm = 384400;
    this.moonPosFar = new THREE.Vector3();         // far-scene km, LVLH, relative to station
    this.earthCenterFar = new THREE.Vector3(0, -this.a, 0);
    this.lvlhToEci = new THREE.Matrix4();          // columns X,Y,Z of LVLH in ECI
    this.skyQuat = new THREE.Quaternion();         // ECI -> LVLH
    this.earthQuat = new THREE.Quaternion();       // earth mesh local -> LVLH
    this.sunVisible = 1;        // 0 in umbra .. 1 full sun (penumbra in between)
    this.sunReddening = 0;      // 0..1 how much the Sun is seen through the atmosphere limb
    this.sunColor = new THREE.Color(1, 1, 1);
    this.earthLit = 1;          // 0..1 how sunlit the Earth below the station is (for earthshine)
    this.subLatDeg = 0; this.subLonDeg = 0;
    this.earthshine = 1;        // earthshine scale relative to the station's view of the Earth (solid angle)
    this.observerAltitudeKm = this.altitudeKm;   // altitude of the render-frame observer above the mean sphere
    this.frameName = 'station';
    this.gmst = 0;
    this.daysSinceJ2000 = 0;
    this.orbitNumber = 0;
    this.phaseAngle = 0;        // radians along the orbit from the ascending node
    this.moonEci = new THREE.Vector3();            // Moon position, ECI km (geocentric)
    /** Optional ephemeris { sunPositionEci(t, out), moonPositionEci(t, out) } (sim seconds, km); null = built-in formulas. */
    this.ephemeris = null;
    /** The station's own outputs (station LVLH frame), whatever the render frame is. */
    this.local = {
      sunDir: new THREE.Vector3(0, 1, 0), moonDir: new THREE.Vector3(0, 0, 1), moonPosFar: new THREE.Vector3(),
      earthCenterFar: new THREE.Vector3(0, -this.a, 0), skyQuat: new THREE.Quaternion(), earthQuat: new THREE.Quaternion(),
      sunVisible: 1, sunReddening: 0, sunColor: new THREE.Color(1, 1, 1), earthLit: 1, subLatDeg: 0, subLonDeg: 0,
    };
    this.update(0);
  }

  /** Pure state for arbitrary sim time (seconds since epoch); used for predictions. */
  computeState(t, out = {}) {
    const n = (this.epochMs - J2000_MS) / 86400000 + t / 86400;
    const theta = this.phase0 + this.meanMotion * t;
    const raan = this.raan0 + this.raanRate * t;
    const a = this.a;
    const r = out.r ?? (out.r = new THREE.Vector3());
    const v = out.v ?? (out.v = new THREE.Vector3());
    const s = out.s ?? (out.s = new THREE.Vector3());
    // perifocal -> ECI (Rz(raan) * Rx(i))
    const ct = Math.cos(theta), st = Math.sin(theta);
    const ci = Math.cos(this.inclination), si = Math.sin(this.inclination);
    const cO = Math.cos(raan), sO = Math.sin(raan);
    r.set(a * (cO * ct - sO * ci * st), a * (sO * ct + cO * ci * st), a * (si * st));
    const vm = this.speedKms;
    v.set(vm * (-cO * st - sO * ci * ct), vm * (-sO * st + cO * ci * ct), vm * (si * ct));
    if (this.ephemeris) this.ephemeris.sunPositionEci(t, s).normalize(); else sunDirectionEci(n, s);
    out.n = n; out.theta = theta; out.raan = raan;
    // eclipse geometry
    const along = r.dot(s);
    const perp = Math.sqrt(Math.max(0, r.lengthSq() - along * along));
    out.sunVisible = along >= 0 ? 1 : smoothstep(EARTH_RADIUS_KM - 32, EARTH_RADIUS_KM + 32, perp);
    out.sunReddening = along >= 0 ? 0 : 1 - smoothstep(EARTH_RADIUS_KM - 40, EARTH_RADIUS_KM + 220, perp);
    out.earthLit = smoothstep(-0.28, 0.25, r.dot(s) / r.length());
    return out;
  }

  update(simTime) {
    this.simTime = simTime;
    const st = this.computeState(simTime, this._state ?? (this._state = {}));
    this.positionEci.copy(st.r);
    this.velocityEci.copy(st.v);
    this.sunDirEci.copy(st.s);
    this.daysSinceJ2000 = st.n;
    this.phaseAngle = st.theta;
    this.orbitNumber = Math.floor((st.theta - this.phase0) / (2 * Math.PI));
    this.gmst = gmst(st.n);

    // LVLH basis in ECI
    const Y = _v.copy(st.r).normalize();
    const X = _v2.copy(st.v).normalize();
    // orthogonalise X against Y (circular orbit => already orthogonal, but be safe)
    X.addScaledVector(Y, -X.dot(Y)).normalize();
    const Z = _Z.crossVectors(X, Y);
    this.lvlhToEci.makeBasis(X, Y, Z);
    // ECI -> LVLH is the transpose
    _m.copy(this.lvlhToEci).transpose();
    this.skyQuat.setFromRotationMatrix(_m);

    // Sun / Moon in LVLH
    this.sunDir.copy(st.s).applyMatrix4(_m).normalize();
    if (this.ephemeris) this.ephemeris.moonPositionEci(simTime, this.moonEci); else moonPositionEci(st.n, this.moonEci);
    this.moonDistanceKm = this.moonEci.length();
    const moonEci = _moonRel.copy(this.moonEci).sub(st.r);   // relative to station
    this.moonPosFar.copy(moonEci).applyMatrix4(_m);
    this.moonDir.copy(this.moonPosFar).normalize();

    // Earth mesh orientation: local -> ECEF (Rx90) -> ECI (Rz gmst) -> LVLH
    _q.setFromAxisAngle(_zAxis, this.gmst);
    this.earthQuat.copy(this.skyQuat).multiply(_q).multiply(_qRx90);

    // sub-satellite point
    const cg = Math.cos(this.gmst), sg = Math.sin(this.gmst);
    const xe = cg * st.r.x + sg * st.r.y, ye = -sg * st.r.x + cg * st.r.y, ze = st.r.z;
    this.subLatDeg = Math.asin(ze / st.r.length()) / DEG;
    this.subLonDeg = Math.atan2(ye, xe) / DEG;

    this.sunVisible = st.sunVisible;
    this.sunReddening = st.sunReddening;
    this.earthLit = st.earthLit;
    // reddening through the limb: warm orange-red at the deepest point
    this.sunColor.setRGB(1, 1 - 0.55 * this.sunReddening, 1 - 0.85 * this.sunReddening);
    this.earthCenterFar.set(0, -this.a, 0);
    this.earthshine = 1;
    this.observerAltitudeKm = this.altitudeKm;
    this.frameName = 'station';
    // the station's own copy
    const L = this.local;
    L.sunDir.copy(this.sunDir); L.moonDir.copy(this.moonDir); L.moonPosFar.copy(this.moonPosFar); L.earthCenterFar.copy(this.earthCenterFar);
    L.skyQuat.copy(this.skyQuat); L.earthQuat.copy(this.earthQuat);
    L.sunVisible = this.sunVisible; L.sunReddening = this.sunReddening; L.sunColor.copy(this.sunColor); L.earthLit = this.earthLit;
    L.subLatDeg = this.subLatDeg; L.subLonDeg = this.subLonDeg;
  }

  /**
   * Recompute the top-level outputs for a render frame around another observer: `originEci` (km) is the
   * observer / render origin, `eciToRender` (Matrix4, rotation only) and `quat` (the same rotation as a
   * quaternion) map ECI directions into render axes. Called by the universe after update() each frame.
   */
  applyFrame(originEci, eciToRender, quat, name = 'free') {
    this.frameName = name;
    const s = this.sunDirEci;
    this.skyQuat.copy(quat);
    this.earthCenterFar.copy(originEci).negate().applyMatrix4(eciToRender);
    _q.setFromAxisAngle(_zAxis, this.gmst);
    this.earthQuat.copy(quat).multiply(_q).multiply(_qRx90);
    this.sunDir.copy(s).applyMatrix4(eciToRender).normalize();
    this.moonPosFar.copy(this.moonEci).sub(originEci).applyMatrix4(eciToRender);
    this.moonDir.copy(this.moonPosFar).normalize();
    // observer above the Earth
    const rn = originEci.length();
    this.observerAltitudeKm = rn - EARTH_RADIUS_KM;
    const cg = Math.cos(this.gmst), sg = Math.sin(this.gmst);
    const xe = cg * originEci.x + sg * originEci.y, ye = -sg * originEci.x + cg * originEci.y;
    this.subLatDeg = Math.asin(THREE.MathUtils.clamp(originEci.z / Math.max(rn, 1e-9), -1, 1)) / DEG;
    this.subLonDeg = Math.atan2(ye, xe) / DEG;
    // eclipse: Earth umbra / penumbra cones (widths grow with the distance behind the Earth), then the Moon's disc
    const along = originEci.dot(s);
    const perp = Math.sqrt(Math.max(0, rn * rn - along * along));
    let vis = 1, red = 0;
    if (along < 0) {
      const back = -along;
      const umbra = EARTH_RADIUS_KM - Math.max(32, 0.0046 * back), pen = EARTH_RADIUS_KM + Math.max(32, 0.0047 * back);
      vis = smoothstep(umbra, pen, perp);
      red = 1 - smoothstep(EARTH_RADIUS_KM - 40, EARTH_RADIUS_KM + 220 + 0.0047 * back, perp);
      if (umbra <= 0) vis = Math.max(vis, 1 - (EARTH_RADIUS_KM / Math.max(1, 0.0047 * back)) ** 2);   // beyond the umbra tip
    }
    _o.copy(this.moonEci).sub(originEci);
    const dm = _o.length();
    if (dm > MOON_RADIUS_KM) {
      const am = Math.asin(MOON_RADIUS_KM / dm);
      const sep = Math.acos(THREE.MathUtils.clamp(_o.dot(s) / dm, -1, 1));
      if (sep < am + SUN_ANGULAR_RADIUS) {
        const covered = am >= SUN_ANGULAR_RADIUS ? 1 : (am / SUN_ANGULAR_RADIUS) ** 2;
        vis *= 1 - covered * (1 - smoothstep(Math.abs(am - SUN_ANGULAR_RADIUS), am + SUN_ANGULAR_RADIUS, sep));
      }
    }
    this.sunVisible = vis;
    this.sunReddening = red * (1 - smoothstep(20000, 60000, rn));
    this.sunColor.setRGB(1, 1 - 0.55 * this.sunReddening, 1 - 0.85 * this.sunReddening);
    // lit fraction of the visible Earth disc and the earthshine scale (solid angle relative to the station's view)
    const cosPhase = along / Math.max(rn, 1e-9);
    this.earthLit = rn < this.a * 1.5 ? smoothstep(-0.28, 0.25, cosPhase) : 0.5 * (1 + cosPhase);
    const solid = (d) => 1 - Math.sqrt(Math.max(0, 1 - (EARTH_RADIUS_KM / Math.max(d, EARTH_RADIUS_KM)) ** 2));
    this.earthshine = solid(rn) / solid(this.a);
  }

  /** Seconds until the next sunrise/sunset (from the station's point of view). */
  secondsToTerminator(fromTime = this.simTime, step = 10, maxSeconds = 7000) {
    const s0 = this.computeState(fromTime, this._pred ?? (this._pred = {}));
    const wasLit = s0.sunVisible > 0.5;
    for (let t = step; t <= maxSeconds; t += step) {
      const s = this.computeState(fromTime + t, this._pred);
      if ((s.sunVisible > 0.5) !== wasLit) return { seconds: t, event: wasLit ? 'sunset' : 'sunrise' };
    }
    return { seconds: Infinity, event: 'none' };
  }

  /** Civil date of the simulation clock. */
  dateAt(simTime = this.simTime) { return new Date(this.epochMs + simTime * 1000); }
}
