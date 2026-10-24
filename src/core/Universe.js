/**
 * Universe (`ctx.universe`): physics truth in ECI (km, double precision, Earth-centred inertial as in Orbit.js),
 * the render frame the scenes are drawn in, bodies placed in it every frame, gravity and propagation helpers.
 *
 * Render frame = (origin in ECI, orientation). Default ('station'): origin = the station, axes = station LVLH —
 * exactly the historic scene frame, so the near scene's station root is the identity. Other frames are requested
 * every frame with setFrame({ originEci, velocityEci?, axes: 'inertial' | 'lvlh' | 'local' | Matrix4, name })
 * (free camera now, the piloted ship later) and dropped with useStationFrame(). The orbit's top-level outputs
 * (sunDir, moonPosFar, earthCenterFar, skyQuat, earthQuat, sunVisible …) are recomputed for the current frame
 * (Orbit.applyFrame); `orbit.local` keeps the station's own values.
 *
 *   eciToRender(vKm, out) / renderToEci(vKm, out)          positions, km (far-scene units, origin-relative)
 *   eciDirToRender(d, out) / renderDirToEci(d, out)         directions
 *   stationToRender(pM, out) / renderToStation(pM, out)     station-frame metres <-> near-scene metres
 *   cameraEci(out), cameraInStation(out)
 *   addBody({ name, radius, getStateEci(t, outPos, outVel?), farObject?, nearObject?, nearRange?, orientEci?, depthTolerance? })
 *   accelerationEci(r, t, out, opts?)                       gravity: Earth mu + J2, Moon, Sun (GravityModel)
 *   propagator(accel?) -> Propagator (rk4 / rk45), kepler(r0, v0, dt, outR, outV, mu?), elements(r, v, out?, mu?)
 *   setEphemeris({ sunPositionEci(t, out), moonPositionEci(t, out) })   swap the Sun / Moon source (e.g. Ephemeris.js)
 *
 * `stationRoot` (near scene) holds the station, its ships, particles and everything else in station coordinates;
 * its transform maps the station frame (LVLH, metres) into the render frame and it is hidden when the camera is far
 * from the station. Depth: in frames other than the default the near / far planes of both cameras adapt to what is
 * close, and when a nearby body would wreck the depth precision of a distant multi-shell body (e.g. the Moon in
 * front of the Earth seen from lunar orbit) the far scene is drawn in two depth slices (`farSplit`, see fx/Post.js).
 */
import * as THREE from 'three';
import { MU_EARTH } from './Orbit.js';
import { OrbitEphemeris, GravityModel, Propagator, kepler, stateToElements, elementsToState, apsides, MU_MOON, R_MOON } from './Astro.js';
import { EARTH_RADIUS_KM } from './constants.js';

/** The station root is hidden beyond this camera distance (the 200 m station is ~1 px at 1080p). */
export const STATION_VISIBLE_KM = 300;
const FAR_NEAR_DEFAULT = 20, FAR_FAR_DEFAULT = 2.5e6;
const NEAR_NEAR_DEFAULT = 0.05, NEAR_FAR_DEFAULT = 6000;
const DEPTH_STEPS = 16777216;          // 24-bit depth (float depth has the same precision near 1)
const EARTH_SHELLS = [EARTH_RADIUS_KM, EARTH_RADIUS_KM + 6, EARTH_RADIUS_KM + 335];   // ground, clouds, aurora proxy
const SPLIT_LAYER = 6;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Zv = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1), X_AXIS = new THREE.Vector3(1, 0, 0);

/** Station LVLH basis (columns X prograde, Y zenith, Z = X x Y) of a state in ECI, into `out` (Matrix4). */
export function lvlhBasis(r, v, out) {
  _Y.copy(r).normalize();
  _X.copy(v).addScaledVector(_Y, -v.dot(_Y));
  if (_X.lengthSq() < 1e-18) _X.crossVectors(Z_AXIS, _Y);
  if (_X.lengthSq() < 1e-18) _X.copy(X_AXIS);
  _X.normalize();
  _Zv.crossVectors(_X, _Y);
  return out.makeBasis(_X, _Y, _Zv);
}

/** Local vertical basis at r (relative to a body centre): Y up, X east (z x up), Z = X x Y (south). */
export function localBasis(r, out) {
  _Y.copy(r).normalize();
  _X.crossVectors(Z_AXIS, _Y);
  if (_X.lengthSq() < 1e-12) _X.set(1, 0, 0);
  _X.normalize();
  _Zv.crossVectors(_X, _Y);
  return out.makeBasis(_X, _Y, _Zv);
}

export class Universe {
  constructor(app) {
    this.app = app;
    this.orbit = app.orbit;
    this.time = app.time;
    this.ephemeris = new OrbitEphemeris(this.orbit.epochMs);
    this.gravity = new GravityModel(this.ephemeris);
    this.MU_EARTH = MU_EARTH; this.MU_MOON = MU_MOON; this.R_EARTH = EARTH_RADIUS_KM; this.R_MOON = R_MOON;

    this.stationRoot = new THREE.Group();
    this.stationRoot.name = 'StationRoot';

    /** Current render frame. renderToEci / eciToRender are rotations (Matrix4); quat = ECI -> render. */
    this.frame = {
      name: 'station', isStation: true, axes: 'lvlh',
      originEci: new THREE.Vector3(), velocityEci: new THREE.Vector3(),
      renderToEci: new THREE.Matrix4(), eciToRender: new THREE.Matrix4(), quat: new THREE.Quaternion(),
    };
    this._request = null;                    // { originEci, velocityEci, axes, matrix, name } or null (station)
    this._reqStore = { originEci: new THREE.Vector3(), velocityEci: new THREE.Vector3(), axes: 'inertial', matrix: new THREE.Matrix4(), name: 'free', center: null };

    this.bodies = [];
    /** Built-in bodies (placed by Earth.js from the orbit outputs; listed here for depth and distances). */
    this.earthBody = { name: 'earth', builtin: true, radius: EARTH_RADIUS_KM, shells: EARTH_SHELLS, depthTolerance: 2, renderKm: new THREE.Vector3(), distanceKm: 0,
      objects: () => { const e = app.ctx?.earth; return e ? [e.earth, e.clouds, e.aurora, e.atmosphere, e.placeholder] : []; } };
    this.moonBody = { name: 'moon', builtin: true, radius: R_MOON, depthTolerance: Infinity, renderKm: new THREE.Vector3(), distanceKm: 0,
      objects: () => { const c = app.ctx; const m = c?.moon?.group || c?.moon?.mesh || c?.earth?.moon; return m ? [m] : []; } };

    // per-frame observer readouts (km, km/s)
    this.station = { renderKm: new THREE.Vector3(), distanceKm: 0, visible: true };
    this.camera = { eci: new THREE.Vector3(), altitudeKm: 0, distanceToStationKm: 0, distanceToMoonKm: 0, moonAltitudeKm: 0 };
    this.farSplit = null;                    // { objects, near, far, nearRest } when the far scene is drawn in two slices
    this.adaptiveDepth = false;
    this._splitObjects = [];
    this._stationSphere = null;
    this._lastAdaptive = false;
    this.update();
  }

  // ------------------------------------------------------------------ frame selection
  get isStationFrame() { return this.frame.isStation; }

  /**
   * Render around another observer this frame and the following ones (until useStationFrame()).
   * axes: 'inertial' (ECI axes), 'lvlh' (needs velocityEci), 'local' (local vertical at the origin, relative to
   * `center` (ECI km, default the Earth's centre)), or a Matrix4 whose columns are the render axes in ECI.
   */
  setFrame({ originEci, velocityEci = null, axes = 'inertial', center = null, name = 'free' }) {
    const r = this._reqStore;
    r.originEci.copy(originEci);
    if (velocityEci) r.velocityEci.copy(velocityEci); else r.velocityEci.set(0, 0, 0);
    if (axes && axes.isMatrix4) { r.matrix.copy(axes); r.axes = 'matrix'; } else r.axes = axes || 'inertial';
    r.center = center; r.name = name;
    this._request = r;     // applied by update() (the App calls it every frame after the camera controllers)
  }

  /** Back to the default frame (origin = station, axes = station LVLH). */
  useStationFrame() { if (this._request) { this._request = null; this.update(); } }

  setEphemeris(eph) {
    const e = eph || new OrbitEphemeris(this.orbit.epochMs);
    this.ephemeris = e; this.gravity.ephemeris = e;
    this.orbit.ephemeris = eph || null;
    this.orbit.update(this.time.sim);
    this.update();
  }

  /** Recompute the frame (after orbit.update(t)); places the station root and the registered bodies. */
  update() {
    const o = this.orbit, f = this.frame, req = this._request;
    if (!req) {
      f.name = 'station'; f.isStation = true; f.axes = 'lvlh';
      f.originEci.copy(o.positionEci); f.velocityEci.copy(o.velocityEci);
      f.renderToEci.copy(o.lvlhToEci);
      f.eciToRender.copy(o.lvlhToEci).transpose();
      f.quat.copy(o.skyQuat);
      const root = this.stationRoot;
      if (!root.position.equals(_v.set(0, 0, 0)) || root.quaternion.w !== 1) { root.position.set(0, 0, 0); root.quaternion.identity(); }
      this.station.renderKm.set(0, 0, 0);
    } else {
      f.name = req.name; f.isStation = false; f.axes = req.axes;
      f.originEci.copy(req.originEci); f.velocityEci.copy(req.velocityEci);
      if (req.axes === 'matrix') f.renderToEci.copy(req.matrix);
      else if (req.axes === 'lvlh') lvlhBasis(f.originEci, f.velocityEci, f.renderToEci);
      else if (req.axes === 'local') localBasis(req.center ? _v.copy(f.originEci).sub(req.center) : f.originEci, f.renderToEci);
      else f.renderToEci.identity();
      f.eciToRender.copy(f.renderToEci).transpose();
      f.quat.setFromRotationMatrix(f.eciToRender);
      o.applyFrame(f.originEci, f.eciToRender, f.quat, f.name);
      // station root: station LVLH (m) -> render frame (m)
      _m.multiplyMatrices(f.eciToRender, o.lvlhToEci);
      this.stationRoot.quaternion.setFromRotationMatrix(_m);
      this.eciToRender(o.positionEci, this.station.renderKm);
      this.stationRoot.position.copy(this.station.renderKm).multiplyScalar(1000);
    }
    this.earthBody.renderKm.copy(o.earthCenterFar);
    this.moonBody.renderKm.copy(o.moonPosFar);
    // registered bodies
    const t = this.time.sim;
    for (const b of this.bodies) {
      b.getStateEci(t, b.positionEci, b.velocityEci);
      this.eciToRender(b.positionEci, b.renderKm);
      if (b.farObject) {
        b.farObject.position.copy(b.renderKm);
        if (b.orientEci) b.farObject.quaternion.copy(f.quat).multiply(b.orientEci);
      }
      if (b.nearObject) {
        const near = b.renderKm.length() < (b.nearRange ?? 50);
        b.nearObject.visible = near;
        if (near) {
          b.nearObject.position.copy(b.renderKm).multiplyScalar(1000);
          if (b.orientEci) b.nearObject.quaternion.copy(f.quat).multiply(b.orientEci);
        }
      }
    }
  }

  // ------------------------------------------------------------------ transforms
  eciToRender(v, out) { return out.copy(v).sub(this.frame.originEci).applyMatrix4(this.frame.eciToRender); }
  renderToEci(v, out) { return out.copy(v).applyMatrix4(this.frame.renderToEci).add(this.frame.originEci); }
  eciDirToRender(d, out) { return out.copy(d).applyMatrix4(this.frame.eciToRender); }
  renderDirToEci(d, out) { return out.copy(d).applyMatrix4(this.frame.renderToEci); }
  /** Station-frame point (m) -> near-scene / render point (m). */
  stationToRender(p, out) { const r = this.stationRoot; return out.copy(p).applyQuaternion(r.quaternion).add(r.position); }
  /** Near-scene / render point (m) -> station frame (m). */
  renderToStation(p, out) { const r = this.stationRoot; _q.copy(r.quaternion).invert(); return out.copy(p).sub(r.position).applyQuaternion(_q); }
  /** Camera position in ECI (km). */
  cameraEci(out, camera = this.app.camera) { camera.getWorldPosition(_v3).multiplyScalar(0.001); return this.renderToEci(_v3, out); }
  /** Camera position in the station frame (m). */
  cameraInStation(out, camera = this.app.camera) { camera.getWorldPosition(_v3); return this.renderToStation(_v3, out); }

  // ------------------------------------------------------------------ bodies / physics
  /**
   * Register a body placed automatically every frame: getStateEci(t, outPos, outVel) in km / km/s; farObject
   * (far scene, km) gets the render position (and orientEci, a Quaternion in ECI, when given); nearObject
   * (near scene, m; add it to ctx.nearScene yourself) is shown within nearRange km. depthTolerance (km): the
   * separation of its nested shells, if any (see farSplit). Returns the body record; remove with removeBody(b).
   */
  addBody(spec) {
    const b = { radius: 1, nearRange: 50, depthTolerance: Infinity, ...spec,
      positionEci: new THREE.Vector3(), velocityEci: new THREE.Vector3(), renderKm: new THREE.Vector3(), distanceKm: 0 };
    if (!b.getStateEci) b.getStateEci = (t, p) => p;
    b.objects = () => [b.farObject].filter(Boolean);
    this.bodies.push(b);
    this.update();
    return b;
  }
  removeBody(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); }
  body(name) { return name === 'earth' ? this.earthBody : name === 'moon' ? this.moonBody : this.bodies.find((b) => b.name === name) || null; }

  /** Gravity (km/s^2) at r (ECI km) and sim time t: Earth mu + J2, Moon and Sun. opts { j2, moon, sun } (booleans). */
  accelerationEci(r, t, out, opts) { return this.gravity.accelerationEci(r, t, out, opts); }
  /** New numerical propagator; accel(r, v, t, out) defaults to the gravity model. */
  propagator(accel) { return new Propagator(accel || ((r, v, t, out) => this.gravity.accelerationEci(r, t, out))); }
  /** Two-body propagation on rails (universal variables), any dt. */
  kepler(r0, v0, dt, outR, outV, mu = MU_EARTH) { return kepler(r0, v0, dt, mu, outR, outV); }
  elements(r, v, out = {}, mu = MU_EARTH, bodyRadius = EARTH_RADIUS_KM) { return stateToElements(r, v, mu, out, bodyRadius); }
  stateFromElements(el, outR, outV, mu = MU_EARTH) { return elementsToState(el, mu, outR, outV); }
  apsides(r, v, out = {}, mu = MU_EARTH) { return apsides(r, v, mu, out); }
  /** Station state (ECI km, km/s) at any sim time (analytic circular orbit with the J2 node drift). */
  stationStateEci(t, outR, outV) { const s = this.orbit.computeState(t, this._st || (this._st = {})); outR.copy(s.r); if (outV) outV.copy(s.v); return outR; }
  moonPositionEci(t, out) { return this.ephemeris.moonPositionEci(t, out); }
  sunPositionEci(t, out) { return this.ephemeris.sunPositionEci(t, out); }

  // ------------------------------------------------------------------ cameras / depth
  /** Bounding sphere of the station in its own frame (m), from the colliders (once). */
  stationSphere() {
    if (this._stationSphere) return this._stationSphere;
    const box = new THREE.Box3(), cs = this.app.station?.colliders || [];
    const grow = (p, r) => { box.expandByPoint(_v.copy(p).addScalar(r)); box.expandByPoint(_v.copy(p).addScalar(-r)); };
    for (const c of cs) {
      if (c.type === 'sphere') grow(c.center, c.radius);
      else if (c.type === 'capsule') { grow(c.a, c.radius); grow(c.b, c.radius); }
      else if (c.type === 'box') grow(c.center, c.halfSize.length());
    }
    const s = new THREE.Sphere();
    if (box.isEmpty()) s.set(new THREE.Vector3(), 160); else box.getBoundingSphere(s);
    this._stationSphere = s;
    return s;
  }

  /**
   * After the cameras are placed (end of the frame): observer readouts, station root visibility, and in
   * non-default frames (or the free camera) the near / far planes and the far-scene depth split.
   */
  updateCameras(camera, farCamera) {
    const app = this.app, f = this.frame, cam = this.camera;
    this.cameraEci(cam.eci, camera);
    const rc = cam.eci.length();
    cam.altitudeKm = rc - EARTH_RADIUS_KM;
    cam.distanceToStationKm = _v.copy(cam.eci).sub(this.orbit.positionEci).length();
    cam.distanceToMoonKm = _v.copy(cam.eci).sub(this.orbit.moonEci).length();
    cam.moonAltitudeKm = cam.distanceToMoonKm - R_MOON;
    const adaptive = this.adaptiveDepth || app.mode === 'free' || !f.isStation;
    const root = this.stationRoot;
    const stationVisible = !adaptive || cam.distanceToStationKm < STATION_VISIBLE_KM;
    if (root.visible !== stationVisible) root.visible = stationVisible;
    this.station.visible = stationVisible;
    this.station.distanceKm = cam.distanceToStationKm;
    if (!adaptive) {
      if (this._lastAdaptive) this._restoreDefaults(camera, farCamera);
      this.farSplit = null;
      return;
    }
    this._lastAdaptive = true;

    // ---- near camera (m): planes around the station / ships when they are drawn
    let near = NEAR_NEAR_DEFAULT, far = NEAR_FAR_DEFAULT;
    if (stationVisible) {
      this.cameraInStation(_v2, camera);
      const sph = this.stationSphere();
      const dS = _v2.distanceTo(sph.center);
      let clear = dS - sph.radius;
      for (const s of app.ships?.ships || []) if (s.group.visible) clear = Math.min(clear, _v2.distanceTo(s.group.position) - (s.boundRadius || 20));
      near = THREE.MathUtils.clamp(0.4 * clear, NEAR_NEAR_DEFAULT, 1e5);
      far = Math.max(NEAR_FAR_DEFAULT, dS + sph.radius + 6000);
    }
    if (Math.abs(camera.near - near) > near * 0.02 || camera.far !== far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }

    // ---- far camera (km): nearest body surface, then an optional second depth slice
    const fp = farCamera.position;
    const list = this._depthList || (this._depthList = []);
    list.length = 0;
    const consider = (b, center, radius, shells) => {
      const d = _v.copy(center).sub(fp).length();
      let surf = radius;
      if (shells) for (const r of shells) if (r < d && r > surf) surf = r;
      b.distanceKm = d;
      b._clear = d - surf; b._d = d; b._r = shells ? shells[shells.length - 1] : radius;
      list.push(b);
    };
    consider(this.earthBody, this.orbit.earthCenterFar, EARTH_RADIUS_KM, EARTH_SHELLS);
    consider(this.moonBody, this.orbit.moonPosFar, R_MOON, null);
    for (const b of this.bodies) if (b.farObject && b.farObject.visible !== false) consider(b, b.renderKm, b.radius, b.shells || null);
    list.sort((a, b) => a._clear - b._clear);
    const nearest = list[0];
    let fnear = THREE.MathUtils.clamp(0.4 * Math.max(nearest._clear, 0), 0.01, 1e6);
    if (f.isStation && rc - EARTH_RADIUS_KM < 2000) fnear = Math.min(fnear, FAR_NEAR_DEFAULT);
    let split = null;
    for (let i = 1; i < list.length; i++) {
      const b = list[i];
      if (!Number.isFinite(b.depthTolerance)) continue;
      const res = (b._d * b._d) / (fnear * DEPTH_STEPS);
      if (res > b.depthTolerance * 0.5 && nearest._d + nearest._r < 0.5 * (b._d - b._r)) {
        let restClear = Infinity;
        for (let j = 1; j < list.length; j++) restClear = Math.min(restClear, list[j]._clear);
        split = this._split(nearest, fnear, nearest._d + nearest._r * 1.2, THREE.MathUtils.clamp(0.4 * restClear, 0.01, 1e6));
        break;
      }
    }
    this.farSplit = split;
    const nearUse = split ? split.nearRest : fnear;
    if (Math.abs(farCamera.near - nearUse) > nearUse * 0.02 || farCamera.far !== FAR_FAR_DEFAULT) { farCamera.near = nearUse; farCamera.far = FAR_FAR_DEFAULT; farCamera.updateProjectionMatrix(); }
  }

  _split(body, near, far, nearRest) {
    const objs = this._splitObjects;
    objs.length = 0;
    for (const o of body.objects()) if (o) objs.push(o);
    if (!objs.length) return null;
    const s = this._splitRec || (this._splitRec = { objects: objs, layer: SPLIT_LAYER, near: 0, far: 0, nearRest: 0, body: null });
    s.near = near; s.far = far; s.nearRest = nearRest; s.body = body.name;
    return s;
  }

  _restoreDefaults(camera, farCamera) {
    this._lastAdaptive = false;
    camera.near = NEAR_NEAR_DEFAULT; camera.far = NEAR_FAR_DEFAULT; camera.updateProjectionMatrix();
    farCamera.near = FAR_NEAR_DEFAULT; farCamera.far = FAR_FAR_DEFAULT; farCamera.updateProjectionMatrix();
    this.stationRoot.visible = true;
  }
}
