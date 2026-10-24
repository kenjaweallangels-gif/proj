/**
 * Keeps a camera (free camera, observer orbit camera) out of solid geometry: the station hull, docked and
 * flying ships, and — when the camera is inside a pressurised compartment — inside the compartment volumes.
 * Positions are in the station frame (metres).
 *
 *   const cc = new CameraCollider(app);
 *   cc.constrain(from, to, radius)   // moves `to` back out of solids (stop / slide), returns true on contact
 *
 * Preferred backend: the exact BVH collision service `ctx.collision` (src/core/CollisionWorld.js, when present):
 * sphereCast(from, to, radius, outHit) for the sweep and resolveSphere(position, radius, outNormal) for the push-out.
 * Fallback: the analytic colliders (station.colliders, the airlock's EVA colliders, ship colliders) and the interior
 * compartment volumes / equipment solids (src/station/interior). Fast moves are swept in steps of the radius.
 * A start position that already penetrates (e.g. a hand-placed view) is left alone, so cameras can always get out.
 */
import * as THREE from 'three';
import { CollisionWorld, colliderDistance } from '../player/Collision.js';
import { containSphere } from '../station/interior/Volumes.js';

const _seg = new THREE.Vector3(), _p = new THREE.Vector3(), _vel = new THREE.Vector3(), _n = new THREE.Vector3();
const _rl = new THREE.Vector3(), _hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, t: 0 };
const MAX_STEPS = 160;

export class CameraCollider {
  constructor(app) {
    this.app = app;
    this.world = new CollisionWorld();
    this.zone = null;
    this._sig = -1;
    this.contact = false;
  }

  /** Rebuild the exterior collider set when its sources change (ships recycle their arrays rarely). */
  _refresh() {
    const st = this.app.station, ships = this.app.ships?.ships || [];
    let sig = (st?.colliders?.length || 0) + 31 * ships.length;
    for (const s of ships) sig = (sig * 7 + (s.colliders?.length || 0) + (s.group.visible ? 1 : 0)) % 1e9;
    if (sig === this._sig) return;
    this._sig = sig;
    const lists = [st?.colliders, st?.airlock?.interiorColliders];
    for (const s of ships) if (s.group.visible && s.colliders) lists.push(s.colliders);
    this.world.setColliders(...lists);
  }

  /** Constrain the move from -> to (station frame, m). `to` is modified in place. */
  constrain(from, to, radius = 0.25) {
    this.contact = false;
    const svc = this.app.ctx?.collision;
    if (svc?.resolveSphere) {
      if (svc.sphereCast && svc.sphereCast(from, to, radius, _hit)) {
        // stop at the hit and slide the rest of the move along the surface
        _seg.subVectors(to, from);
        const t = THREE.MathUtils.clamp(_hit.t ?? (_hit.distance / Math.max(_seg.length(), 1e-9)), 0, 1);
        _p.copy(from).addScaledVector(_seg, t);
        _seg.multiplyScalar(1 - t);
        if (_hit.normal) { const dn = _seg.dot(_hit.normal); if (dn < 0) _seg.addScaledVector(_hit.normal, -dn); }
        to.copy(_p).add(_seg);
        this.contact = true;
      }
      if (svc.resolveSphere(to, radius, _n)) this.contact = true;
      return this.contact;
    }
    return this._fallback(from, to, radius);
  }

  _fallback(from, to, radius) {
    const app = this.app, I = app.station?.interior;
    // inside a compartment: stay within its volumes (hatches open into the neighbours), off the equipment
    const zone = I?.ready ? I.locate(from, this.zone, 0.3) : null;
    this.zone = zone;
    if (zone) return this._inside(I, zone, from, to, radius);
    // outside: quick reject far from the station and the ships
    this._refresh();
    const list = this.world.colliders;
    if (!list.length) return false;
    const sph = app.universe?.stationSphere?.();
    if (sph) {
      const d = distSegPoint(from, to, sph.center);
      let far = d > sph.radius + radius + 10;
      if (far) for (const s of app.ships?.ships || []) if (s.group.visible && distSegPoint(from, to, s.group.position) < (s.boundRadius || 30) + radius + 10) { far = false; break; }
      if (far) return false;
    }
    // a start that already penetrates (hand-placed view, dynamic part swept into the camera): leave it alone
    if (this.world.distance(from) < radius * 0.5) return false;
    _seg.subVectors(to, from);
    const len = _seg.length();
    const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(len / Math.max(radius, 0.05))));
    _p.copy(from);
    _vel.copy(_seg).multiplyScalar(1 / steps);
    for (let i = 0; i < steps; i++) {
      _p.add(_vel);
      _rl.copy(_vel);
      const c = this.world.resolve(_p, _rl, radius, 0, 0);
      if (c.count > 0) {
        this.contact = true;
        // slide: keep only the tangential part of the remaining motion
        _vel.copy(_rl);
      }
    }
    to.copy(_p);
    return this.contact;
  }

  _inside(I, zone, from, to, radius) {
    const ring = zone.frame === 'ring';
    if (ring) { I.toRing(to, _p); } else _p.copy(to);
    const frame = ring ? 'ring' : 'station';
    _vel.set(0, 0, 0);
    if (containSphere(_p, _vel, radius, I.volumesFor(zone, frame), 0, 0, _n) > 0) this.contact = true;
    for (const c of I.solidsFor(zone, frame)) {
      const d = colliderDistance(c, _p, _n);
      if (d < radius) { _p.addScaledVector(_n, radius - d); this.contact = true; }
    }
    if (ring) I.toWorldFromRing(_p, to); else to.copy(_p);
    return this.contact;
  }
}

/** Distance from point c to the segment a-b. */
function distSegPoint(a, b, c) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-12 ? ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + abx * t - c.x, y = a.y + aby * t - c.y, z = a.z + abz * t - c.z;
  return Math.sqrt(x * x + y * y + z * z);
}
