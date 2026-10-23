import * as THREE from 'three';
import { Path, Mover, Attitude, Rcs, targetQuat } from './Flight.js';

/**
 * Docking traffic controller.
 *
 * Every port gets a straight approach corridor along its outward axis: dock plane -> `back` (50 m out) ->
 * `hold` (150 m out).  Arrivals fly a Bezier from ~4.5 km, brake tail-first with the main engine, coast,
 * turn nose-to-port, stop at `hold`, then creep along the corridor (0.8 -> 0.3 -> 0.05 m/s) with the nose
 * aligned to soft capture; the soft-capture petals close and retract over 3 s and the ship is docked.
 * Departures open the latches / extend the petals, push off at 0.1 m/s, back out along the corridor, turn at
 * `hold`, burn and leave on a curve to ~5 km where the ship is recycled.
 *
 * Kinematics are integrated in sub-steps (<= 0.25 s) so x60..x300 time scales stay stable; RCS puffs are
 * derived from the actual velocity / attitude changes of each step.
 */

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _v = new THREE.Vector3(), _acc = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qRollY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), _qRoll = new THREE.Quaternion();
const _n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const STATION_CENTER = new THREE.Vector3(0, -8, 0);
const D_BACK = 50, D_HOLD = 150;

/** Deterministic PRNG (mulberry32) so screenshots are reproducible. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Signed distance from a world point to a collider surface (negative inside). */
const _lp = new THREE.Vector3(), _ab = new THREE.Vector3(), _qi = new THREE.Quaternion(), _tp = new THREE.Vector3();
function pointColliderDistance(c, p) {
  if (c.type === 'sphere') return p.distanceTo(c.center) - c.radius;
  if (c.type === 'capsule') {
    _ab.subVectors(c.b, c.a); const l2 = _ab.lengthSq();
    const t = l2 > 1e-12 ? THREE.MathUtils.clamp(_lp.subVectors(p, c.a).dot(_ab) / l2, 0, 1) : 0;
    return _lp.copy(c.a).addScaledVector(_ab, t).distanceTo(p) - c.radius;
  }
  if (c.type === 'box') {
    _lp.subVectors(p, c.center).applyQuaternion(_qi.copy(c.quaternion).invert());
    const dx = Math.abs(_lp.x) - c.halfSize.x, dy = Math.abs(_lp.y) - c.halfSize.y, dz = Math.abs(_lp.z) - c.halfSize.z;
    const out = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
    return out > 0 ? out : Math.max(dx, dy, dz);
  }
  return Infinity;
}

export class Traffic {
  constructor(ctx, shipsModule, rng) {
    this.ctx = ctx;
    this.mod = shipsModule;
    this.rng = rng;
    this.station = ctx.station;
    this.ports = (this.station && this.station.dockingPorts) || [];
    this.corridors = new Map();
    this.flying = [];          // ships in motion (incl. drones)
    this.t = 0;                // controller time (s since start)
    this.nextUndock = 65 + rng() * 25;   // first departure shortly after the 60 s minimum stay
    this.nextArrival = 1e9;
    this.targetDocked = Math.max(1, Math.round(this.ports.length * 0.6));
    this.rcs = new Rcs(ctx.particles);
  }

  // ------------------------------------------------------------------ geometry helpers
  /** Corridor waypoints for a port (nose positions). */
  corridor(port) {
    let c = this.corridors.get(port);
    if (c) return c;
    const axis = port.approachAxis;
    const dock = port.position.clone();
    const back = dock.clone().addScaledVector(axis, D_BACK);
    const holdDir = axis.clone();
    const hold = dock.clone().addScaledVector(axis, D_HOLD);
    c = { dock, back, hold, holdDir, dBack: D_BACK, length: D_HOLD };
    this.corridors.set(port, c);
    return c;
  }

  /** Docked orientation: port frame rotated PI about Y (nose toward the port) plus a roll about the nose axis. */
  dockQuat(port, roll, out) {
    _qRoll.setFromAxisAngle(Z, roll);
    return out.copy(port.quaternion).multiply(_qRollY).multiply(_qRoll);
  }

  /** Departure / arrival direction: prograde or retrograde with an outward component, never through the station. */
  farDirection(corr) {
    const sign = Math.abs(corr.holdDir.x) > 0.3 ? Math.sign(corr.holdDir.x) : (this.rng() < 0.5 ? -1 : 1);
    return new THREE.Vector3().copy(X).multiplyScalar(sign).addScaledVector(corr.holdDir, 0.55).normalize();
  }

  /**
   * True if the ship, docked at `port` with `roll`, stays clear (margin) of the station and other docked ships.
   * The first 3.5 m behind the nose are skipped (always next to the port by construction), as is the port's own collider.
   */
  fits(ship, port, roll, margin = 0.0) {
    const pos = _p.copy(port.position).addScaledVector(port.approachAxis, ship.noseOffset);
    const q = this.dockQuat(port, roll, _q);
    const others = [];
    for (const s of this.mod.ships) if (s !== ship && s.state !== 'loiter' && s.state !== 'idle' && s.state !== 'depart' && s.state !== 'arrive') others.push(...s.colliders);
    const portName = `port:${port.id}`;
    const statics = ((this.station && this.station.colliders) || []).filter((c) => c.name !== portName);
    const test = (lp, r) => {
      if (lp.z > -3.5) return true;
      r *= 0.9;   // station colliders are padded; avoid false clashes
      _tp.copy(lp).applyQuaternion(q).add(pos);
      for (let i = 0; i < statics.length; i++) if (pointColliderDistance(statics[i], _tp) - r < margin) { this.lastFitFail = `${ship.name}@${port.id} roll ${roll.toFixed(2)}: station ${statics[i].name} vs local ${lp.x.toFixed(1)},${lp.y.toFixed(1)},${lp.z.toFixed(1)} r${r.toFixed(2)} d=${(pointColliderDistance(statics[i], _tp) - r).toFixed(2)}`; return false; }
      for (let i = 0; i < others.length; i++) if (pointColliderDistance(others[i], _tp) - r < margin) { this.lastFitFail = `${ship.name}@${port.id} roll ${roll.toFixed(2)}: ship ${others[i].name} vs local ${lp.x.toFixed(1)},${lp.y.toFixed(1)},${lp.z.toFixed(1)}`; return false; }
      return true;
    };
    const tmp = new THREE.Vector3();
    for (const c of ship.localColliders) {
      if (c.type === 'sphere') { if (!test(c.center, c.radius)) return false; }
      else if (c.type === 'capsule') { for (let k = 0; k <= 4; k++) if (!test(tmp.copy(c.a).lerp(c.b, k / 4), c.radius)) return false; }
      else if (c.type === 'box') {
        const h = c.halfSize, nx = h.x > 2 ? 5 : h.x > 0.5 ? 3 : 1, ny = h.y > 2 ? 5 : h.y > 0.5 ? 3 : 1, nz = h.z > 2 ? 5 : h.z > 0.5 ? 3 : 1;
        const rr = 0.25 * Math.min(h.x, h.y, h.z);
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
          tmp.set(nx > 1 ? (i / (nx - 1) * 2 - 1) * h.x * 0.85 : 0, ny > 1 ? (j / (ny - 1) * 2 - 1) * h.y * 0.85 : 0, nz > 1 ? (k / (nz - 1) * 2 - 1) * h.z * 0.85 : 0);
          tmp.applyQuaternion(c.quaternion).add(c.center);
          if (!test(tmp, rr)) return false;
        }
      }
    }
    return true;
  }

  /** First roll (0, PI, +-PI/2) at which the ship fits the port, or null. */
  chooseRoll(ship, port) {
    for (const roll of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) if (this.fits(ship, port, roll)) return roll;
    return null;
  }

  freePortFor(ship) {
    const cands = this.ports.filter((p) => !p.occupant && !p.reserved && (ship.size === 'small' ? true : p.size === 'large'));
    // small ships prefer small ports
    cands.sort((a, b) => (a.size === ship.size ? 0 : 1) - (b.size === ship.size ? 0 : 1) + (this.rng() - 0.5) * 0.5);
    for (const p of cands) { const roll = this.chooseRoll(ship, p); if (roll !== null) return { port: p, roll }; }
    return null;
  }

  // ------------------------------------------------------------------ placement
  /** Place a ship docked at a port immediately (initial state): nose on the port plane, petals retracted. */
  placeDocked(ship, port, roll) {
    const g = ship.group;
    g.position.copy(port.position).addScaledVector(port.approachAxis, ship.noseOffset);
    this.dockQuat(port, roll, g.quaternion);
    ship.roll = roll; ship.port = port; port.occupant = ship; port.reserved = false;
    ship.state = 'docked'; ship.velocity.set(0, 0, 0);
    ship.petalOpen = 0; ship.petalExtend = 0; ship.panelDeploy = 1; ship.doorOpen = 1; ship.dockLightsOn = false; ship.dockedSince = this.t;
    ship.flight = null; g.visible = true;
    this.mod.updateColliders(ship);
    this.mod.setDishTarget(ship, 'earth');
  }

  _attitude(ship) {
    if (!ship.att) ship.att = new Attitude(ship.dyn.omega, ship.dyn.alpha);
    ship.att.omegaMax = ship.dyn.omega; ship.att.alphaMax = ship.dyn.alpha;
    return ship.att;
  }

  // ------------------------------------------------------------------ undocking
  startUndock(ship) {
    const port = ship.port, corr = this.corridor(port);
    const start = ship.group.position.clone();
    const path = Path.waypoints([start, corr.back.clone(), corr.hold.clone()], 6);
    const dBack = corr.dBack, L = path.length;
    const profile = (s) => Math.min(s < 10 ? 0.1 : s < dBack ? 0.4 : 0.8, Math.sqrt(2 * 0.012 * Math.max(0, L - s)));
    ship.flight = { phase: 'unlatch', t: 0, path, mover: new Mover().start(path, profile, ship.dyn.rcs * 0.6), corr, port, far: this.farDirection(corr) };
    ship.state = 'undock';
    const att = this._attitude(ship);
    att.target.copy(ship.group.quaternion); att.omega.set(0, 0, 0);
    ship.dockLightsOn = true;
    port.occupant = null; port.reserved = true;      // keep the port free of arrivals until the ship is away
    this.flying.push(ship);
    this.mod.log('undock', ship, port);
  }

  // ------------------------------------------------------------------ arrivals
  /** Spawn an arrival for `ship` toward `port`; `s0` = progress (m) along the inbound path (negative: distance from the end). */
  startArrival(ship, port, roll, s0 = 0) {
    const corr = this.corridor(port);
    const far = this.farDirection(corr);
    const lateral = new THREE.Vector3().crossVectors(far, UP).normalize().multiplyScalar((this.rng() - 0.5) * 900);
    const spawn = corr.hold.clone().addScaledVector(far, 4500).add(lateral).addScaledVector(UP, (this.rng() - 0.5) * 300);
    const p1 = spawn.clone().addScaledVector(far, -1500);
    const p2 = corr.hold.clone().addScaledVector(corr.holdDir, 700);
    const path = Path.bezier(spawn, p1, p2, corr.hold.clone(), 160);
    const L = path.length, vC = 8, vS = 1.5, aB = ship.dyn.main;
    const sbEnd = L - 650, sBurn = sbEnd - (vC * vC - vS * vS) / (2 * aB), sFlip = sBurn - 900;
    if (s0 < 0) s0 = Math.max(0, L + s0);
    const profile = (s) => (s < sbEnd ? Math.max(vS, Math.min(vC, Math.sqrt(vS * vS + 2 * aB * (sbEnd - s)))) : Math.min(vS, Math.max(0.05, Math.sqrt(2 * 0.012 * Math.max(0, L - s)))));
    const v0 = s0 > 0 ? profile(s0) : vC;
    ship.flight = { phase: 'arrive', t: 0, path, mover: new Mover().start(path, profile, Math.max(aB, 0.3), s0, v0), corr, port, roll, sFlip, sbEnd, far };
    ship.state = 'arrive';
    ship.port = null; port.reserved = true;
    ship.petalOpen = 1; ship.petalExtend = 1; ship.panelDeploy = 0; ship.doorOpen = 0; ship.dockLightsOn = false;
    ship.group.visible = true;
    // initial pose on the path
    path.sample(s0, ship.group.position, _t);
    const att = this._attitude(ship);
    const tailFirst = s0 >= sFlip && s0 < sbEnd;
    if (s0 >= sbEnd) this.dockQuat(port, roll, att.target);
    else targetQuat(ship.mainAxis, tailFirst ? _d.copy(_t).negate() : _t, ship.upAxis, UP, att.target);
    att.snap(ship.group.quaternion);
    ship.velocity.copy(_t).multiplyScalar(v0);
    this.flying.push(ship);
    this.mod.updateColliders(ship);
    this.mod.setDishTarget(ship, 'station');
    this.mod.log('arrive', ship, port);
  }

  /** Put an arriving ship straight onto the corridor (used for the initial scene). */
  startFinalApproach(ship, port, roll, s0) {
    const corr = this.corridor(port);
    ship.port = null; port.reserved = true; ship.roll = roll;
    ship.flight = { phase: 'hold', t: 1e9, corr, port, roll, far: null };
    ship.state = 'approach';
    ship.petalOpen = 1; ship.petalExtend = 1; ship.panelDeploy = 0; ship.doorOpen = 1; ship.dockLightsOn = true;
    ship.group.visible = true;
    const att = this._attitude(ship);
    this.dockQuat(port, roll, att.target); att.snap(ship.group.quaternion);
    this._beginApproach(ship, s0);
    this.flying.push(ship);
    this.mod.setDishTarget(ship, 'station');
  }

  _beginApproach(ship, s0 = 0) {
    const f = ship.flight, corr = f.corr;
    const dock = corr.dock.clone().addScaledVector(f.port.approachAxis, ship.noseOffset);
    const path = Path.waypoints([corr.hold.clone(), corr.back.clone(), dock], 6);
    const L = path.length, dBack = corr.dBack;
    const profile = (s) => {
      const toBack = L - dBack - s;
      if (toBack > 0) return Math.min(0.8, 0.3 + Math.sqrt(2 * 0.012 * toBack));
      const dist = L - s;
      return dist > 10 ? 0.3 : Math.max(0.05, 0.05 + 0.25 * dist / 10);
    };
    f.phase = 'approach'; f.t = 0; f.path = path; f.dock = dock;
    f.mover = new Mover().start(path, profile, ship.dyn.rcs * 0.6, s0, s0 > 0 ? profile(s0) : 0);
    path.sample(s0, ship.group.position, _t);
    ship.velocity.copy(_t).multiplyScalar(f.mover.speed);
    ship.state = 'approach';
    ship.dockLightsOn = true;
    this.mod.updateColliders(ship);
  }

  // ------------------------------------------------------------------ drones
  startLoiter(ship, kind) {
    ship.state = 'loiter';
    ship.flight = { phase: 'loiter', t: this.rng() * 1000, kind };
    ship.group.visible = true;
    ship.dockLightsOn = true;     // inspection floods
    this._attitude(ship);
    this._loiterPos(ship.flight, ship.flight.t, ship.group.position);
    ship.att.target.copy(ship.group.quaternion);
    this.flying.push(ship);
  }

  _loiterPos(f, t, out) {
    if (f.kind === 0) {           // below the station, long figure-8
      const w = (2 * Math.PI) / 1100;
      out.set(115 * Math.cos(w * t), -68 + 10 * Math.sin(2 * w * t + 0.7), 75 * Math.sin(w * t));
    } else {                      // circling ahead of the forward truss end
      const w = (2 * Math.PI) / 700;
      out.set(122 + 14 * Math.sin(2 * w * t), 46 * Math.cos(w * t), 46 * Math.sin(w * t));
    }
    return out;
  }

  // ------------------------------------------------------------------ scheduling
  update(dt) {
    dt = Math.min(dt, 10);
    this.t += dt;
    // undock schedule
    if (this.t >= this.nextUndock) {
      this.nextUndock = this.t + 90 + this.rng() * 90;
      const docked = this.mod.ships.filter((s) => s.state === 'docked' && s.docks && this.t - s.dockedSince > 60);
      if (docked.length > 1 || (docked.length === 1 && this.flying.filter((s) => s.state === 'arrive' || s.state === 'approach').length > 0)) {
        this.startUndock(docked[Math.floor(this.rng() * docked.length)]);
      }
    }
    // arrival schedule: keep ~60 % of the ports occupied (counting loop: no per-frame allocations)
    let dockedOrInbound = 0;
    for (const s of this.mod.ships) { const st = s.state; if (st === 'docked' || st === 'arrive' || st === 'approach' || st === 'dock') dockedOrInbound++; }
    if (dockedOrInbound < this.targetDocked) {
      if (this.nextArrival > 1e8) this.nextArrival = this.t + 20 + this.rng() * 70;
      if (this.t >= this.nextArrival) {
        this.nextArrival = 1e9;
        const idle = this.mod.ships.filter((s) => s.state === 'idle' && s.docks);
        if (idle.length) {
          const ship = idle[Math.floor(this.rng() * idle.length)];
          const slot = this.freePortFor(ship);
          if (slot) this.startArrival(ship, slot.port, slot.roll);
        }
      }
    } else this.nextArrival = 1e9;

    // integrate flying ships in sub-steps; particle look factor follows the time scale
    const k = Math.pow(THREE.MathUtils.clamp(this.ctx.time.scale || 1, 1, 300), 0.85);
    const n = Math.min(48, Math.max(1, Math.ceil(dt / 0.25)));
    const h = dt / n;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const ship = this.flying[i];
      for (let s = 0; s < n; s++) this._step(ship, h, k);
      this.mod.updateColliders(ship);
      if ((ship.state === 'docked' && !ship.flight) || ship.state === 'idle') this.flying.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ per-ship integration
  _step(ship, h, k) {
    const f = ship.flight, g = ship.group, att = ship.att;
    f.t += h;
    _v.copy(ship.velocity);
    let throttle = 0;
    switch (f.phase) {
      case 'unlatch': {
        // hooks release and the soft-capture ring extends (0..1.5 s), then the petals splay (1.5..3 s)
        ship.petalExtend = Math.min(1, f.t / 1.5);
        ship.petalOpen = THREE.MathUtils.clamp((f.t - 1.5) / 1.5, 0, 1);
        if (ship.def.parts.panels) ship.panelDeploy = Math.max(0, 1 - f.t / 25);
        if (f.t >= 3) { f.phase = 'pushoff'; }
        break;
      }
      case 'pushoff': {
        f.mover.step(h, g.position, _t);
        ship.velocity.copy(_t).multiplyScalar(f.mover.speed);
        if (ship.def.parts.panels) ship.panelDeploy = Math.max(0, 1 - (f.t) / 25);
        if (ship.def.parts.doors) ship.doorOpen = THREE.MathUtils.clamp(1 - (f.mover.s - 3) / 20, 0, 1);
        if (f.mover.s > f.corr.dBack + 2 && f.port.reserved) { f.port.reserved = false; }
        if (f.mover.s > 8) ship.dockLightsOn = false;
        if (f.mover.done) { f.phase = 'turn'; f.t = 0; ship.velocity.set(0, 0, 0); this._planDeparture(ship); }
        break;
      }
      case 'turn': {
        // wait until the main axis points along the departure path
        if (att.error < 0.02 && att.omega.lengthSq() < 1e-8 || f.t > 400) { f.phase = 'depart'; f.t = 0; ship.state = 'depart'; this.mod.log('depart', ship, f.port); }
        break;
      }
      case 'depart': {
        f.mover.step(h, g.position, _t);
        ship.velocity.copy(_t).multiplyScalar(f.mover.speed);
        throttle = f.mover.lastAccel > 0.05 ? Math.min(1, f.mover.lastAccel / ship.dyn.main) : 0;
        targetQuat(ship.mainAxis, _t, ship.upAxis, UP, att.target);
        if (f.mover.done || g.position.length() > 6000) { this._recycle(ship); return; }
        break;
      }
      case 'arrive': {
        const m = f.mover;
        m.step(h, g.position, _t);
        ship.velocity.copy(_t).multiplyScalar(m.speed);
        const decel = -m.lastAccel;
        if (m.s < f.sFlip) targetQuat(ship.mainAxis, _t, ship.upAxis, UP, att.target);
        else if (m.s < f.sbEnd) targetQuat(ship.mainAxis, _d.copy(_t).negate(), ship.upAxis, UP, att.target);
        else this.dockQuat(f.port, f.roll, att.target);
        if (decel > 0.1) {
          // main engine only when it actually points against the velocity
          _n.copy(ship.mainAxis).applyQuaternion(g.quaternion);
          if (_n.dot(_t) < -0.9) throttle = Math.min(1, decel / ship.dyn.main);
        }
        if (m.done) { f.phase = 'hold'; f.t = 0; ship.velocity.set(0, 0, 0); ship.dockLightsOn = true; }
        break;
      }
      case 'hold': {
        if (ship.def.parts.doors) ship.doorOpen = Math.min(1, f.t / 25);
        if ((att.error < 0.01 && f.t > 20) || f.t > 500) {
          if (f.port.occupant) { this._abortToIdle(ship); return; }   // someone took the port meanwhile
          this._beginApproach(ship, 0); this.mod.log('final', ship, f.port);
        }
        break;
      }
      case 'approach': {
        f.mover.step(h, g.position, _t);
        ship.velocity.copy(_t).multiplyScalar(f.mover.speed);
        this.dockQuat(f.port, f.roll, att.target);
        if (f.mover.done) {
          f.phase = 'dock'; f.t = 0; ship.state = 'dock'; ship.velocity.set(0, 0, 0);
          g.position.copy(f.dock); att.snap(g.quaternion);
          this.mod.log('capture', ship, f.port);
        }
        break;
      }
      case 'dock': {
        // soft capture: petals align (0..1.5 s), the ring retracts and the hooks close (1.5..3 s)
        ship.petalOpen = THREE.MathUtils.clamp(1 - f.t / 1.5, 0, 1);
        ship.petalExtend = THREE.MathUtils.clamp(1 - (f.t - 1.5) / 1.5, 0, 1);
        if (f.t >= 3) {
          const port = f.port;
          ship.petalOpen = 0; ship.petalExtend = 0;
          ship.state = 'docked'; ship.port = port; port.occupant = ship; port.reserved = false; ship.roll = f.roll; ship.dockedSince = this.t;
          ship.dockLightsOn = false;
          this.mod.setDishTarget(ship, 'earth');
          this.mod.log('dock', ship, port);
          ship.flight = { phase: 'settle', t: 0 };   // continue deploying panels while the ship is in `flying`
        }
        break;
      }
      case 'settle': {
        if (ship.def.parts.panels) ship.panelDeploy = Math.min(1, f.t / 30);
        else ship.panelDeploy = 1;
        if (f.t > 30) { ship.flight = null; this.mod.updateColliders(ship); }
        // ship.state is already 'docked' -> removed from `flying` after this update
        return;
      }
      case 'loiter': {
        this._loiterPos(f, f.t, g.position);
        this._loiterPos(f, f.t + 0.5, _t).sub(g.position).multiplyScalar(2);   // velocity by forward difference
        ship.velocity.copy(_t);
        _d.copy(STATION_CENTER).sub(g.position).normalize();
        targetQuat(ship.mainAxis, _d, ship.upAxis, UP, att.target);
        break;
      }
    }
    // attitude slew and puffs from the real velocity / rate changes
    att.step(g.quaternion, h);
    _acc.subVectors(ship.velocity, _v).multiplyScalar(1 / h);
    ship.burning = throttle > 0.02;
    this.rcs.emit(ship, _acc, att.alpha, throttle, h, k);
  }

  _planDeparture(ship) {
    const f = ship.flight, corr = f.corr, far = f.far;
    const p0 = ship.group.position.clone();
    const lateral = new THREE.Vector3().crossVectors(far, UP).normalize().multiplyScalar((this.rng() - 0.5) * 1200);
    const exit = p0.clone().addScaledVector(far, 4800).add(lateral);
    const p1 = p0.clone().addScaledVector(corr.holdDir, 250).addScaledVector(far, 250);
    const p2 = exit.clone().addScaledVector(far, -900);
    const path = Path.bezier(p0, p1, p2, exit, 160);
    const vDep = 7, aMain = ship.dyn.main;
    const profile = (s) => Math.min(vDep, Math.sqrt(2 * aMain * Math.max(0, s + 0.5)));
    f.mover = new Mover().start(path, profile, aMain, 0, 0);
    f.path = path;
    path.sample(0, _p, _t);
    targetQuat(ship.mainAxis, _t, ship.upAxis, UP, ship.att.target);
    this.mod.setDishTarget(ship, 'station');
  }

  _recycle(ship) {
    this.mod.log('gone', ship, ship.flight.port);
    this._abortToIdle(ship);
  }

  _abortToIdle(ship) {
    if (ship.flight && ship.flight.port && ship.flight.port.reserved && !ship.flight.port.occupant) ship.flight.port.reserved = false;
    ship.state = 'idle'; ship.flight = null; ship.port = null;
    ship.group.visible = false; ship.group.position.set(0, -20000, 0);
    ship.velocity.set(0, 0, 0); ship.burning = false; ship.engineGlow = 0;
    ship.petalOpen = 1; ship.petalExtend = 1;
    this.mod.updateColliders(ship);
  }
}
