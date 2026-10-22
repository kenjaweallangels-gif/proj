import * as THREE from 'three';

/**
 * Sphere-vs-collider resolution for the EVA player (and anything else that needs it).
 * Colliders follow the contract in docs/ARCHITECTURE.md:
 *   { type:'sphere', center, radius } | { type:'capsule', a, b, radius } | { type:'box', center, halfSize, quaternion }
 * Dynamic colliders are updated in place by their owners, so we only keep references.
 * No per-frame allocations: all math goes through module scratch objects.
 */

const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _lp = new THREE.Vector3();
const _cp = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _t = new THREE.Vector3();

/** Closest point on segment ab to p, written into out. Returns the segment parameter 0..1. */
export function closestOnSegment(a, b, p, out) {
  _ab.subVectors(b, a);
  const l2 = _ab.lengthSq();
  let t = l2 > 1e-12 ? THREE.MathUtils.clamp(_d.subVectors(p, a).dot(_ab) / l2, 0, 1) : 0;
  out.copy(a).addScaledVector(_ab, t);
  return t;
}

/**
 * Signed distance from point p to the collider surface (negative inside).
 * Writes the outward unit normal (direction to push p out) into outN.
 */
export function colliderDistance(c, p, outN) {
  switch (c.type) {
    case 'sphere': {
      _d.subVectors(p, c.center);
      const l = _d.length();
      if (l < 1e-6) { outN.set(0, 1, 0); return -c.radius; }
      outN.copy(_d).multiplyScalar(1 / l);
      return l - c.radius;
    }
    case 'capsule': {
      closestOnSegment(c.a, c.b, p, _cp);
      _d.subVectors(p, _cp);
      const l = _d.length();
      if (l < 1e-6) {
        // on the axis: any perpendicular will do
        _ab.subVectors(c.b, c.a);
        outN.set(-_ab.y, _ab.x, 0);
        if (outN.lengthSq() < 1e-9) outN.set(0, 0, 1); else outN.normalize();
        return -c.radius;
      }
      outN.copy(_d).multiplyScalar(1 / l);
      return l - c.radius;
    }
    case 'box': {
      _q.copy(c.quaternion).invert();
      _lp.subVectors(p, c.center).applyQuaternion(_q);
      const h = c.halfSize;
      const ax = Math.abs(_lp.x), ay = Math.abs(_lp.y), az = Math.abs(_lp.z);
      if (ax <= h.x && ay <= h.y && az <= h.z) {
        // inside: exit through the nearest face
        const dx = h.x - ax, dy = h.y - ay, dz = h.z - az;
        let dist;
        if (dx <= dy && dx <= dz) { _n.set(_lp.x < 0 ? -1 : 1, 0, 0); dist = -dx; }
        else if (dy <= dz) { _n.set(0, _lp.y < 0 ? -1 : 1, 0); dist = -dy; }
        else { _n.set(0, 0, _lp.z < 0 ? -1 : 1); dist = -dz; }
        outN.copy(_n).applyQuaternion(c.quaternion);
        return dist;
      }
      _cp.set(THREE.MathUtils.clamp(_lp.x, -h.x, h.x), THREE.MathUtils.clamp(_lp.y, -h.y, h.y), THREE.MathUtils.clamp(_lp.z, -h.z, h.z));
      _d.subVectors(_lp, _cp);
      const l = _d.length();
      outN.copy(_d).multiplyScalar(1 / Math.max(l, 1e-9)).applyQuaternion(c.quaternion);
      return l;
    }
    default:
      return Infinity;
  }
}

/** Result of a resolve() pass (reused). */
export class ContactInfo {
  constructor() {
    this.count = 0;                      // number of penetrating colliders this pass
    this.impact = 0;                     // strongest normal approach speed (m/s)
    this.normal = new THREE.Vector3();   // normal of the strongest contact
    this.tangent = new THREE.Vector3();  // tangential velocity at that contact (before friction)
    this.minDistance = Infinity;         // closest surface distance (sphere centre to surface)
    this.nearest = null;                 // the closest collider
    this.penetration = 0;                // total correction applied (m)
  }
  reset() { this.count = 0; this.impact = 0; this.minDistance = Infinity; this.nearest = null; this.penetration = 0; }
}

/**
 * Collider set with sphere resolution.
 *   world.setColliders([...arrays])  // de-duplicated by reference
 *   world.resolve(position, velocity, radius, restitution, friction, out)
 */
export class CollisionWorld {
  constructor() {
    this.colliders = [];
    this.info = new ContactInfo();
  }

  /** Replace the collider set (several arrays, duplicates dropped). Rebuild only when the sources change. */
  setColliders(...arrays) {
    const set = new Set();
    const list = this.colliders;
    list.length = 0;
    for (const arr of arrays) {
      if (!arr) continue;
      for (const c of arr) { if (c && !set.has(c)) { set.add(c); list.push(c); } }
    }
    return list.length;
  }

  /**
   * Push the sphere (position, radius) out of every collider it penetrates and bounce the velocity.
   * restitution: normal bounce factor; friction: fraction of tangential velocity removed per contact.
   * Two passes handle corners; also fills out.minDistance / out.nearest for the whole set.
   */
  resolve(position, velocity, radius, restitution, friction, out = this.info) {
    out.reset();
    const list = this.colliders;
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      for (let i = 0, n = list.length; i < n; i++) {
        const c = list[i];
        const dist = colliderDistance(c, position, _n);
        if (dist !== dist) continue; // NaN guard
        if (pass === 0 && dist - radius < out.minDistance) { out.minDistance = dist - radius; out.nearest = c; }
        if (dist < radius) {
          const pen = radius - dist;
          position.addScaledVector(_n, pen);
          out.penetration += pen;
          any = true;
          if (pass === 0) out.count++;
          const vn = velocity.dot(_n);
          if (vn < 0) {
            velocity.addScaledVector(_n, -(1 + restitution) * vn);
            _t.copy(velocity).addScaledVector(_n, -velocity.dot(_n));
            if (-vn > out.impact) { out.impact = -vn; out.normal.copy(_n); out.tangent.copy(_t); }
            velocity.addScaledVector(_t, -friction);
          } else if (pass === 0 && out.impact === 0 && out.count === 1) {
            out.normal.copy(_n); out.tangent.copy(velocity).addScaledVector(_n, -vn);
          }
        }
      }
      if (!any) break;
    }
    if (out.minDistance === Infinity) out.minDistance = 1e9;
    return out;
  }

  /** Closest surface distance from a point to the set (no resolution). */
  distance(point) {
    let best = 1e9;
    const list = this.colliders;
    for (let i = 0, n = list.length; i < n; i++) {
      const d = colliderDistance(list[i], point, _n);
      if (d < best) best = d;
    }
    return best;
  }
}
