import * as THREE from 'three';

/**
 * Signed distance to interior containment volumes (negative inside) and the outward gradient.
 * Volume types (see Zone.js): box {center, half, quat, qi}, cyl {a, b, r}, polar {x0, x1, r0, r1, p0, p1}
 * (ring-local: x along the spin axis, polar angle from +Y toward +Z). No allocations.
 */

const _l = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const TWO_PI = Math.PI * 2;

/** 3D box SDF from q = |local| - half; writes the outward normal in the local frame (signs from s). */
function boxSdf(qx, qy, qz, sx, sy, sz, outN) {
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
  if (outside > 0) { outN.set(ox * sx / outside, oy * sy / outside, oz * sz / outside); return outside; }
  if (qx >= qy && qx >= qz) { outN.set(sx, 0, 0); return qx; }
  if (qy >= qz) { outN.set(0, sy, 0); return qy; }
  outN.set(0, 0, sz); return qz;
}

/** Signed distance from p to volume v; outward unit normal into outN (frame of the volume). */
export function volumeDistance(v, p, outN) {
  if (v.type === 'box') {
    _l.subVectors(p, v.center).applyQuaternion(v.qi);
    const h = v.half;
    const d = boxSdf(Math.abs(_l.x) - h.x, Math.abs(_l.y) - h.y, Math.abs(_l.z) - h.z, _l.x < 0 ? -1 : 1, _l.y < 0 ? -1 : 1, _l.z < 0 ? -1 : 1, outN);
    outN.applyQuaternion(v.quat);
    return d;
  }
  if (v.type === 'cyl') {
    _u.subVectors(v.b, v.a);
    const L = _u.length();
    _u.multiplyScalar(1 / L);
    _l.subVectors(p, v.a);
    const t = _l.dot(_u);
    _r.copy(_l).addScaledVector(_u, -t);
    const rho = _r.length();
    const q1 = rho - v.r, q2 = Math.abs(t - L / 2) - L / 2;
    const o1 = Math.max(q1, 0), o2 = Math.max(q2, 0), outside = Math.sqrt(o1 * o1 + o2 * o2);
    const sa = t - L / 2 < 0 ? -1 : 1;
    if (rho > 1e-6) _r.multiplyScalar(1 / rho); else _r.set(0, 1, 0).addScaledVector(_u, -_u.y).normalize();
    if (outside > 0) { outN.copy(_r).multiplyScalar(o1 / outside).addScaledVector(_u, sa * o2 / outside); return outside; }
    if (q1 >= q2) { outN.copy(_r); return q1; }
    outN.copy(_u).multiplyScalar(sa); return q2;
  }
  if (v.type === 'polar') {
    const rho = Math.sqrt(p.y * p.y + p.z * p.z);
    let phi = Math.atan2(p.z, p.y);
    const pc = (v.p0 + v.p1) * 0.5, hp = (v.p1 - v.p0) * 0.5;
    let dphi = phi - pc;
    dphi -= TWO_PI * Math.round(dphi / TWO_PI);
    const xc = (v.x0 + v.x1) * 0.5, hx = (v.x1 - v.x0) * 0.5, rc = (v.r0 + v.r1) * 0.5, hr = (v.r1 - v.r0) * 0.5;
    const s = rho * dphi, hs = rho * hp;
    const lx = p.x - xc, lr = rho - rc;
    const d = boxSdf(Math.abs(lx) - hx, Math.abs(lr) - hr, Math.abs(s) - hs, lx < 0 ? -1 : 1, lr < 0 ? -1 : 1, s < 0 ? -1 : 1, outN);
    // local (x, radial, tangential) -> ring-local vector
    const c = Math.cos(phi), sn = Math.sin(phi);
    const nx = outN.x, nr = outN.y, nt = outN.z;
    outN.set(nx, nr * c - nt * sn, nr * sn + nt * c);
    return d;
  }
  return Infinity;
}

/**
 * Keep a sphere (centre p, radius rad) inside the union of volumes. Returns the push applied (m) and writes the
 * contact normal (pointing inward, i.e. the push direction) into outN. Velocity loses its outward component
 * (restitution e) and some tangential speed (friction f).
 */
const _n = new THREE.Vector3();
const _bestN = new THREE.Vector3();
export function containSphere(p, vel, rad, vols, e, f, outN) {
  let total = 0;
  outN.set(0, 0, 0);
  for (let iter = 0; iter < 3; iter++) {
    let best = Infinity, any = false;
    for (let i = 0, n = vols.length; i < n; i++) {
      const v = vols[i];
      if (v.gate && !v.gate.isOpen) continue;
      const d = volumeDistance(v, p, _n);
      if (d < best) { best = d; _bestN.copy(_n); any = true; }
    }
    if (!any) return total;
    const pen = best + rad;
    if (pen <= 0) break;
    // push inward (against the outward normal)
    p.addScaledVector(_bestN, -pen);
    total += pen;
    outN.copy(_bestN).negate();
    const vn = vel.dot(_bestN);
    if (vn > 0) {
      vel.addScaledVector(_bestN, -(1 + e) * vn);
      // friction on the tangential part
      const tx = vel.x - _bestN.x * vel.dot(_bestN), ty = vel.y - _bestN.y * vel.dot(_bestN), tz = vel.z - _bestN.z * vel.dot(_bestN);
      vel.x -= tx * f; vel.y -= ty * f; vel.z -= tz * f;
    }
  }
  return total;
}

/** Smallest signed distance of point p to the union (ignores gates when ignoreGates). */
export function unionDistance(p, vols, ignoreGates = false) {
  let best = Infinity;
  for (let i = 0, n = vols.length; i < n; i++) {
    const v = vols[i];
    if (!ignoreGates && v.gate && !v.gate.isOpen) continue;
    const d = volumeDistance(v, p, _n);
    if (d < best) best = d;
  }
  return best;
}
