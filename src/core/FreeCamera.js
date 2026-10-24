/**
 * Free camera («свободная камера», App mode 'free'): 6-DOF flight anywhere, from the station's hull out to the
 * Moon, with a logarithmic speed setting (0.1 m/s … 30 000 km/s).
 *
 * The camera is anchored to a reference body and moves relative to it:
 *   'station' — offset in metres in the station's LVLH frame (co-moving and co-rotating: the station stays put,
 *               like the observer camera); within 20 km the render frame is the default station frame (no change
 *               at all for the station modules), farther out the origin follows the camera. Left beyond 2000 km.
 *   'earth'   — offset in km from the Earth's centre, ECI axes (at rest relative to the Earth's centre);
 *   'moon'    — offset in km from the Moon's centre (moves with the Moon), entered within 60 000 km.
 * For 'earth' / 'moon' the render frame follows the camera (floating origin: the camera sits at the render
 * origin) with inertial axes, or the local vertical of the camera position (`axesMode` 'local': the view turns
 * with the horizon as you fly around a body). The orientation is stored relative to the anchor axes and carried
 * over (unchanged in ECI) when the anchor changes.
 *
 * Controls (real time, independent of the time rate): mouse look (pointer lock, or drag without it), Q/E roll,
 * W/S A/D Space/Ctrl move, Shift ×10, wheel or +/- speed, B back to the station, O orientation mode, C / F exit.
 */
import * as THREE from 'three';
import { localBasis } from './Universe.js';
import { EARTH_RADIUS_KM } from './constants.js';

const STATION_LEAVE_KM = 2000, STATION_ENTER_KM = 1500;
/** Within this distance (m) of the station the free camera uses the default render frame. */
const STATION_FRAME_M = 20000;
const MOON_ENTER_KM = 60000, MOON_LEAVE_KM = 66000;
const R_MOON = 1737.4;
export const SPEED_MIN_EXP = -1, SPEED_MAX_EXP = 7.5;   // log10(m/s)
const MOUSE = 0.0022;          // rad per pixel
const ROLL_RATE = 1.1;         // rad/s
const SMOOTH = 0.18;           // s, velocity response

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export class FreeCamera {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.anchor = 'station';
    this.offset = new THREE.Vector3();          // station: m (LVLH); earth / moon: km (ECI axes)
    this.q = new THREE.Quaternion();            // orientation relative to the anchor axes
    this.axesMode = 'inertial';                 // 'inertial' | 'local' (earth / moon anchors)
    this.speedExp = 1.3;                        // log10 of the cruise speed in m/s
    this.vel = new THREE.Vector3();             // smoothed velocity, camera-local (m/s)
    this.speed = 0;                             // m/s
    this.eci = new THREE.Vector3();             // camera position, ECI km
    this.axes = new THREE.Matrix4();            // anchor axes in ECI (columns)
    this.prevMode = 'play';
  }

  get cruiseSpeed() { return Math.pow(10, this.speedExp); }

  // ------------------------------------------------------------------ anchors
  _anchorCenter(anchor, out) {
    const o = this.app.orbit;
    if (anchor === 'station') return out.copy(o.positionEci);
    if (anchor === 'moon') return out.copy(o.moonEci);
    return out.set(0, 0, 0);
  }
  _anchorAxes(anchor, offset, out) {
    if (anchor === 'station') return out.copy(this.app.orbit.lvlhToEci);
    if (this.axesMode === 'local') return localBasis(offset, out);
    return out.identity();
  }
  /** ECI position (km) of an anchor + offset. */
  _toEci(anchor, offset, out) {
    this._anchorCenter(anchor, out);
    if (anchor === 'station') return out.add(_c.copy(offset).multiplyScalar(0.001).applyMatrix4(this.app.orbit.lvlhToEci));
    return out.add(offset);
  }
  /** Re-anchor without moving: same ECI position and orientation. */
  setAnchor(anchor) {
    if (anchor === this.anchor) return;
    this._toEci(this.anchor, this.offset, this.eci);
    this._anchorAxes(this.anchor, this.offset, _m);
    _qa.setFromRotationMatrix(_m).multiply(this.q);                 // orientation in ECI
    this._anchorCenter(anchor, _c);
    if (anchor === 'station') this.offset.copy(this.eci).sub(_c).applyMatrix4(_m2.copy(this.app.orbit.lvlhToEci).transpose()).multiplyScalar(1000);
    else this.offset.copy(this.eci).sub(_c);
    this.anchor = anchor;
    this._anchorAxes(anchor, this.offset, _m);
    this.q.setFromRotationMatrix(_m).invert().multiply(_qa).normalize();
    this.app.events?.emit?.('freecam:anchor', anchor);
  }
  setAxesMode(mode) {
    if (mode === this.axesMode) return;
    if (this.anchor === 'station') { this.axesMode = mode; return; }
    this._anchorAxes(this.anchor, this.offset, _m);
    _qa.setFromRotationMatrix(_m).multiply(this.q);
    this.axesMode = mode;
    this._anchorAxes(this.anchor, this.offset, _m);
    this.q.setFromRotationMatrix(_m).invert().multiply(_qa).normalize();
  }

  // ------------------------------------------------------------------ enter / exit
  /** Start from the current camera pose (station frame). */
  enter(prevMode) {
    const cam = this.app.camera;
    this.prevMode = prevMode || 'play';
    cam.updateMatrixWorld();
    this.app.universe.useStationFrame();
    this.anchor = 'station';
    cam.getWorldPosition(this.offset);
    cam.getWorldQuaternion(this.q);
    this.vel.set(0, 0, 0);
    this.active = true;
    this._apply();
  }
  exit() {
    this.active = false;
    this.vel.set(0, 0, 0);
    this.app.universe.useStationFrame();
  }

  /** Jump to a named place: 'station' (overview pose), 'earth' (dayside, 30 000 km), 'moon' (lit side, 12 000 km),
   *  'moon-orbit' (100 km above the Moon, the Earth on the horizon), 'station-high' (3 km above the station),
   *  'earth-low' (2000 km above the Earth, looking along the station's track). */
  jumpTo(where) {
    const o = this.app.orbit;
    this.vel.set(0, 0, 0);
    if (where === 'station') {
      this.anchor = 'station';
      this.offset.set(150, 70, 185);
      this._lookAt(_v.set(-10, 0, 0), Y);
      if (this.speedExp > 1.6) this.speedExp = 1.3;
    } else if (where === 'earth') {
      this.anchor = 'earth';
      this.offset.copy(o.sunDirEci).addScaledVector(Z, 0.35).normalize().multiplyScalar(30000);
      this._lookAt(_v.set(0, 0, 0), Z);
      this.speedExp = Math.max(this.speedExp, 5.5);
    } else if (where === 'moon') {
      this.anchor = 'moon';
      // between the Sun and the Earth as seen from the Moon: the near side, lit, with the Earth off to one side
      _v.copy(o.moonEci).negate().normalize();
      this.offset.copy(o.sunDirEci).multiplyScalar(1.0).addScaledVector(_v, 0.8).addScaledVector(Z, 0.15).normalize().multiplyScalar(12000);
      this._lookAt(_v.set(0, 0, 0), Z);
      this.speedExp = Math.max(this.speedExp, 5);
    } else if (where === 'station-high') {
      this.anchor = 'station';
      this.offset.set(400, 2600, 900);
      this._lookAt(_v.set(0, 0, 0), _v2.set(1, 0, 0));
      this.speedExp = 2.5;
    } else if (where === 'earth-low') {
      // 2000 km above the sub-station point, looking down at the horizon ahead
      this.anchor = 'earth';
      this.offset.copy(o.positionEci).setLength(EARTH_RADIUS_KM + 2000);
      _v.copy(o.velocityEci).normalize().multiplyScalar(3000).add(_v2.copy(this.offset).setLength(EARTH_RADIUS_KM));
      this._lookAt(_v, _v2.copy(this.offset).normalize());
      this.speedExp = 4;
    } else if (where === 'moon-orbit') {
      // 100 km above the Moon, the Earth on the lunar horizon ("Earthrise"), the ground below sunlit when possible
      this.anchor = 'moon';
      const e = _v2.copy(o.moonEci).negate().normalize();                 // Moon -> Earth
      const up = _c.copy(o.sunDirEci).addScaledVector(e, -o.sunDirEci.dot(e));
      if (up.lengthSq() < 1e-6) up.crossVectors(e, Z);
      up.normalize();
      this.offset.copy(up).multiplyScalar(R_MOON + 100);
      this._anchorAxes(this.anchor, this.offset, _m);
      _m2.copy(_m).transpose();
      const fwd = _v.copy(e).addScaledVector(up, -0.12).normalize().applyMatrix4(_m2);
      _m.lookAt(_v3.set(0, 0, 0), fwd, up.applyMatrix4(_m2));
      this.q.setFromRotationMatrix(_m);
      this.speedExp = Math.min(Math.max(this.speedExp, 3), 4);
    }
    // a cut: the exposure and the lens flare snap instead of adapting
    const post = this.app.renderer?.post;
    if (post?.exposure) post.exposure._first = true;
    if (post?.flarePass) post.flarePass._first = true;
    this._apply();
  }

  /** Turn to look at a point given in anchor coordinates (station: m; else km relative to the anchor centre). */
  _lookAt(target, up) {
    this._anchorAxes(this.anchor, this.offset, _m);
    _m2.copy(_m).transpose();
    // up and target into anchor-axes coordinates (station targets are already there)
    _v2.copy(up);
    if (this.anchor !== 'station') _v2.applyMatrix4(_m2);
    _c.copy(target);
    if (this.anchor !== 'station') _c.applyMatrix4(_m2);
    _v.copy(this.offset);
    if (this.anchor !== 'station') _v.applyMatrix4(_m2);
    _m.lookAt(_v, _c, _v2);
    this.q.setFromRotationMatrix(_m);
  }

  /** Look at the station / the Earth / the Moon without moving. */
  lookAtBody(name) {
    this._toEci(this.anchor, this.offset, this.eci);
    const o = this.app.orbit;
    const target = name === 'moon' ? _v.copy(o.moonEci) : name === 'station' ? _v.copy(o.positionEci) : _v.set(0, 0, 0);
    this._anchorAxes(this.anchor, this.offset, _m);
    _m2.copy(_m).transpose();
    _c.copy(target).sub(this.eci).applyMatrix4(_m2).normalize();      // direction in anchor axes
    const up = _v2.copy(this.anchor === 'station' ? Y : Z);
    if (this.anchor !== 'station') up.applyMatrix4(_m2);
    _m.lookAt(_v.set(0, 0, 0), _c, Math.abs(_c.dot(up)) > 0.98 ? X : up);
    this.q.setFromRotationMatrix(_m);
    this._apply();
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    if (!this.active) return;
    const app = this.app, inp = app.input;
    dt = Math.min(Math.max(dt, 0), 0.1);
    if (inp.enabled !== false) {
      // ----- keys
      if (inp.wasPressed('KeyB') || inp.wasPressed('Home')) this.jumpTo('station');
      if (inp.wasPressed('KeyO')) this.setAxesMode(this.axesMode === 'local' ? 'inertial' : 'local');
      if (inp.wasPressed('Equal') || inp.wasPressed('NumpadAdd')) this.speedExp += 0.25;
      if (inp.wasPressed('Minus') || inp.wasPressed('NumpadSubtract')) this.speedExp -= 0.25;
      if (inp.mouse.wheel) this.speedExp -= 0.2 * inp.mouse.wheel;
      this.speedExp = THREE.MathUtils.clamp(this.speedExp, SPEED_MIN_EXP, SPEED_MAX_EXP);
      // ----- look: yaw / pitch about the camera axes, Q/E roll
      const look = inp.pointerLocked || !inp.wantPointerLock || (inp.mouse.buttons & 5);
      if (look && (inp.mouse.dx || inp.mouse.dy)) {
        this.q.multiply(_q.setFromAxisAngle(Y, -inp.mouse.dx * MOUSE));
        this.q.multiply(_q.setFromAxisAngle(X, -inp.mouse.dy * MOUSE));
      }
      const roll = (inp.isDown('KeyQ') ? 1 : 0) - (inp.isDown('KeyE') ? 1 : 0);
      if (roll) this.q.multiply(_q.setFromAxisAngle(Z, roll * ROLL_RATE * dt));
      this.q.normalize();
      // ----- translation
      _v.set(inp.axis('KeyA', 'KeyD'), (inp.isDown('Space') ? 1 : 0) - (inp.isDown('ControlLeft') || inp.isDown('ControlRight') ? 1 : 0), -inp.axis('KeyS', 'KeyW'));
      if (_v.lengthSq() > 1) _v.normalize();
      const boost = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight') ? 10 : 1;
      _v.multiplyScalar(this.cruiseSpeed * boost);
      this.vel.lerp(_v, 1 - Math.exp(-dt / SMOOTH));
    } else this.vel.multiplyScalar(Math.exp(-dt / SMOOTH));
    if (this.vel.lengthSq() < 1e-8) this.vel.set(0, 0, 0);
    this.speed = this.vel.length();
    if (this.speed > 0) {
      // camera-local metres -> anchor axes (in 'local' mode the axes turn as the position changes: the view follows)
      _v.copy(this.vel).multiplyScalar(dt).applyQuaternion(this.q);
      if (this.anchor === 'station') this.offset.add(_v);
      else {
        this._anchorAxes(this.anchor, this.offset, _m);
        this.offset.addScaledVector(_v.applyMatrix4(_m), 0.001);
      }
    }
    this._keepOutside();
    this._reanchor();
    this._apply();
  }

  /** Never inside the Earth (1 km above the mean sphere) or the Moon (200 m). */
  _keepOutside() {
    this._toEci(this.anchor, this.offset, this.eci);
    const re = this.eci.length(), minE = EARTH_RADIUS_KM + 1;
    if (re < minE) this._shift(_v.copy(this.eci).multiplyScalar((minE - re) / Math.max(re, 1e-6)));
    _v2.copy(this.eci).sub(this.app.orbit.moonEci);
    const rm = _v2.length(), minM = R_MOON + 0.2;
    if (rm < minM) this._shift(_v2.multiplyScalar((minM - rm) / Math.max(rm, 1e-6)));
  }
  /** Move by an ECI displacement (km). */
  _shift(dEci) {
    if (this.anchor === 'station') this.offset.add(_c.copy(dEci).applyMatrix4(_m2.copy(this.app.orbit.lvlhToEci).transpose()).multiplyScalar(1000));
    else this.offset.add(dEci);
    this._toEci(this.anchor, this.offset, this.eci);
  }

  _reanchor() {
    const o = this.app.orbit;
    this._toEci(this.anchor, this.offset, this.eci);
    const dStation = _v.copy(this.eci).sub(o.positionEci).length();
    const dMoon = _v.copy(this.eci).sub(o.moonEci).length();
    if (this.anchor === 'station') {
      if (dStation > STATION_LEAVE_KM) this.setAnchor(dMoon < MOON_ENTER_KM ? 'moon' : 'earth');
    } else if (dStation < STATION_ENTER_KM) this.setAnchor('station');
    else if (this.anchor === 'earth' && dMoon < MOON_ENTER_KM) this.setAnchor('moon');
    else if (this.anchor === 'moon' && dMoon > MOON_LEAVE_KM) this.setAnchor('earth');
  }

  /** Render frame + camera pose for the current state. */
  _apply() {
    const app = this.app, u = app.universe, cam = app.camera;
    this._toEci(this.anchor, this.offset, this.eci);
    if (this.anchor === 'station' && this.offset.lengthSq() < STATION_FRAME_M * STATION_FRAME_M) {
      // near the station: the default frame itself (station modules see exactly what they always see)
      u.useStationFrame();
      cam.position.copy(this.offset);
    } else if (this.anchor === 'station') {
      // farther out: floating origin at the camera, station LVLH axes (the station root carries the offset)
      u.setFrame({ originEci: this.eci, axes: this.app.orbit.lvlhToEci, name: 'free-station' });
      cam.position.set(0, 0, 0);
    } else {
      this._anchorAxes(this.anchor, this.offset, this.axes);
      u.setFrame({ originEci: this.eci, axes: this.axesMode === 'local' ? this.axes : 'inertial', name: `free-${this.anchor}` });
      cam.position.set(0, 0, 0);
    }
    cam.quaternion.copy(this.q);
    if (cam.fov !== 70) { cam.fov = 70; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  /** Readouts for the HUD. */
  info(out = {}) {
    const u = this.app.universe, o = this.app.orbit;
    this._toEci(this.anchor, this.offset, this.eci);
    out.anchor = this.anchor; out.axesMode = this.axesMode;
    out.altitudeKm = this.eci.length() - EARTH_RADIUS_KM;
    out.distanceToStationKm = _v.copy(this.eci).sub(o.positionEci).length();
    out.distanceToMoonKm = _v.copy(this.eci).sub(o.moonEci).length();
    out.moonAltitudeKm = out.distanceToMoonKm - R_MOON;
    out.speed = this.speed; out.cruise = this.cruiseSpeed;
    out.frame = u.frame.name;
    return out;
  }
}
