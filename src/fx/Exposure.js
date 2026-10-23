import * as THREE from 'three';
import { DEG, EARTH_RADIUS_KM, NEAR_TO_FAR } from '../core/constants.js';

/**
 * Analytical auto-exposure — no GPU readback. Every frame a coarse grid of rays through the camera
 * frustum is tested against the Earth sphere (far scene, km) to measure how much of the view is
 * covered by sunlit Earth and how bright it is; the station adds a crude cover term from the camera
 * distance; the Sun adds a term when it is inside the frustum (fading at the edges) and unoccluded;
 * eclipse (orbit.sunVisible) switches everything off. The resulting "key" brightness drives
 * renderer.toneMappingExposure between `min` (bright Earth + Sun in view) and `max` (eclipse).
 *
 * Adaptation is exponential in log-exposure: fast (tauBrighten) when the scene gets brighter (the
 * exposure comes down), slow (tauDarken) when the scene gets darker (the exposure opens up). A camera
 * cut (teleport / view change) snaps to the target instead of adapting.
 */

const _dir = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camQuat = new THREE.Quaternion();
const _invQuat = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _oc = new THREE.Vector3();
const _n = new THREE.Vector3();
const _toStation = new THREE.Vector3();
const _originKm = new THREE.Vector3();

export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Projects a world-space direction (point at infinity) with a perspective camera.
 * `out` receives NDC x/y (±1 = frame edge; values beyond ±1 are off-screen but still meaningful).
 * Returns false when the direction points behind the camera.
 */
export function projectDirection(dir, camera, out) {
  camera.getWorldQuaternion(_camQuat);
  _invQuat.copy(_camQuat).invert();
  _dir.copy(dir).applyQuaternion(_invQuat);
  if (_dir.z >= -1e-6) { out.set(0, 0); return false; }
  const th = Math.tan(camera.fov * 0.5 * DEG) / (camera.zoom || 1);
  out.set((_dir.x / -_dir.z) / (th * camera.aspect), (_dir.y / -_dir.z) / th);
  return true;
}

export class AutoExposure {
  constructor(opts = {}) {
    /** Exposure limits (renderer.toneMappingExposure). */
    this.min = opts.min ?? 0.55;
    this.max = opts.max ?? 2.2;
    /** Key: exposure = key / (brightness + key / max). Higher = brighter image overall. */
    this.key = opts.key ?? 0.55;
    /** Adaptation time constants (seconds). */
    this.tauBrighten = opts.tauBrighten ?? 0.7;   // scene gets brighter -> exposure comes down quickly
    this.tauDarken = opts.tauDarken ?? 2.0;       // scene gets darker -> exposure opens slowly
    /** Camera motion per frame beyond which the adaptation snaps (a cut). */
    this.cutDistance = 25;      // meters
    this.cutAngleDot = 0.8;     // quaternion dot (cos(theta/2)) -> ~74 degrees

    /** Scene radiance guesses (HDR units before exposure; a white Lambert surface in full sun is ~1.0-1.45). */
    this.earthRadiance = 0.85;      // average sunlit Earth (ocean + land + clouds)
    this.earthNightRadiance = 0.02; // night side (city lights, airglow)
    this.stationRadiance = 0.35;    // average sunlit station (white hull, MLI, shadowed parts)
    this.stationNightRadiance = 0.03;
    this.sunWeight = 1.5;           // extra brightness when the Sun disc is in the frame
    this.airlockBrightness = 0.5;   // interior lighting (keeps the exposure <= ~0.8 inside)

    this.samplesX = 9;
    this.samplesY = 5;

    // state
    this.value = 1.0;
    this.target = 1.0;
    this.logValue = 0;
    this.skyExposure = 1.0;
    // diagnostics (read-only)
    this.earthFrac = 0;        // fraction of the frame covered by the Earth
    this.earthLum = 0;         // weighted Earth radiance over the frame
    this.stationCover = 0;
    this.sunAhead = false;     // Sun direction in front of the camera
    this.sunNdc = new THREE.Vector2();
    this.sunInView = 0;        // 0..1 inside the frustum (fades at the edges), includes orbit.sunVisible
    this.sunUnoccluded = 1;    // from the lens-flare ray test
    this.glare = 0;            // 0..1 Sun near the view centre and unoccluded
    this.brightness = 0;
    this.cut = false;
    this._first = true;
    this._lastPos = new THREE.Vector3();
    this._lastQuat = new THREE.Quaternion();
  }

  /** Measures the view and advances the adaptation. `sunUnoccluded` is the fraction of the Sun not hidden by the station (0..1). */
  update(dt, ctx, sunUnoccluded = 1) {
    const camera = ctx.camera, o = ctx.orbit;
    if (!camera || !o) return this.value;
    camera.getWorldPosition(_camPos);
    camera.getWorldQuaternion(_camQuat);
    const sv = o.sunVisible ?? 1;
    this.sunUnoccluded = sunUnoccluded;

    // ---- camera cut detection ----
    const moved = this._lastPos.distanceTo(_camPos);
    const turned = Math.abs(this._lastQuat.dot(_camQuat));
    this.cut = this._first || moved > this.cutDistance || turned < this.cutAngleDot;
    this._lastPos.copy(_camPos);
    this._lastQuat.copy(_camQuat);

    // ---- Earth coverage: ray grid vs the Earth sphere (km) ----
    const th = Math.tan(camera.fov * 0.5 * DEG) / (camera.zoom || 1);
    const aspect = camera.aspect || 1;
    const C = o.earthCenterFar;
    const R = EARTH_RADIUS_KM + 14;     // clouds / low atmosphere
    _originKm.copy(_camPos).multiplyScalar(NEAR_TO_FAR);
    _oc.copy(_originKm).sub(C);
    const cc = _oc.lengthSq() - R * R;
    let sum = 0, wsum = 0, hits = 0, total = 0;
    const nx = this.samplesX, ny = this.samplesY;
    for (let j = 0; j < ny; j++) {
      const y = ((j + 0.5) / ny) * 2 - 1;
      for (let i = 0; i < nx; i++) {
        const x = ((i + 0.5) / nx) * 2 - 1;
        const w = 1 - 0.4 * (x * x + y * y) * 0.5;          // centre-weighted metering
        _dir.set(x * th * aspect, y * th, -1).normalize().applyQuaternion(_camQuat);
        const b = _oc.dot(_dir);
        const disc = b * b - cc;
        let lum = 0;
        total++;
        if (disc > 0) {
          const t = -b - Math.sqrt(disc);
          if (t > 0) {
            hits++;
            _n.copy(_originKm).addScaledVector(_dir, t).sub(C).normalize();
            const lit = smoothstep(-0.12, 0.3, _n.dot(o.sunDir));
            lum = this.earthNightRadiance + (this.earthRadiance - this.earthNightRadiance) * lit;
          }
        }
        sum += w * lum; wsum += w;
      }
    }
    this.earthLum = wsum > 0 ? sum / wsum : 0;
    this.earthFrac = total > 0 ? hits / total : 0;

    // ---- station cover (crude: distance to the station origin and whether we look at it) ----
    const d = _camPos.length();
    _fwd.set(0, 0, -1).applyQuaternion(_camQuat);
    _toStation.copy(_camPos).negate().normalize();
    const facing = d < 40 ? 1 : smoothstep(-0.1, 0.5, _fwd.dot(_toStation));
    this.stationCover = Math.min(1, 45 / Math.max(d, 5)) * facing;
    const stationLum = this.stationCover * (this.stationRadiance * sv + this.stationNightRadiance);

    // ---- Sun in the frustum ----
    this.sunAhead = projectDirection(o.sunDir, camera, this.sunNdc);
    let inView = 0, centre = 0;
    if (this.sunAhead) {
      const e = Math.max(Math.abs(this.sunNdc.x), Math.abs(this.sunNdc.y));
      inView = 1 - smoothstep(0.85, 1.15, e);
      centre = 1 - smoothstep(0.12, 0.55, this.sunNdc.length());
    }
    this.sunInView = inView * sv;
    const sunLum = this.sunInView * this.sunWeight * (0.4 + 0.6 * sunUnoccluded);
    this.glare = this.sunInView * centre * sunUnoccluded;

    // ---- combine ----
    let B = this.earthLum + stationLum + sunLum;
    if (ctx.player?.state?.mode === 'airlock') B = Math.max(B, this.airlockBrightness);
    this.brightness = B;
    let target = this.key / (B + this.key / this.max);
    target = Math.min(this.max, Math.max(this.min, target));
    // staring into the Sun: stop down a little further than the clamp allows
    target = Math.max(this.min * 0.75, target * (1 - 0.3 * this.glare));
    this.target = target;

    // ---- adaptation (log space) ----
    const logT = Math.log(target);
    if (this.cut) {
      this.logValue = logT;
    } else {
      const tau = target < this.value ? this.tauBrighten : this.tauDarken;
      const k = 1 - Math.exp(-Math.max(dt, 0) / tau);
      this.logValue += (logT - this.logValue) * k;
    }
    this.value = Math.exp(this.logValue);
    this._first = false;

    // Sky (stars / Milky Way) exposure: nearly invisible when the camera is stopped down for daylight, full at night.
    const nightness = Math.min(1, Math.max(0, (this.value - this.min) / (this.max - this.min)));
    this.skyExposure = 0.08 + 0.92 * Math.pow(nightness, 1.6);
    return this.value;
  }
}
