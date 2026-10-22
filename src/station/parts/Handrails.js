import * as THREE from 'three';
import { Instancer, unitCylinder, Y_AXIS } from './Builder.js';

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * EVA handrails: yellow bars on short stanchions. Every bar is pushed to `station.handrails`
 * as a world-frame segment {a, b, radius} so the player can grab it.
 */
export class Handrails {
  constructor(materials, list) {
    this.list = list;                       // station.handrails
    if (!materials.factories.handrailYellow) materials.register('handrailYellow', () => new THREE.MeshStandardMaterial({ color: 0xf2c21a, roughness: 0.55, metalness: 0.25 }));
    this.bars = new Instancer(unitCylinder(8), materials.get('handrailYellow'), { name: 'handrails' });
    this.posts = new Instancer(unitCylinder(6), materials.get('metalDark'), { name: 'handrailPosts' });
    this.radius = 0.028;
    this.stand = 0.13;                      // bar height above the hull
  }

  /** One bar between a and b (points ON the hull); normal = outward hull direction at the bar. */
  addRail(a, b, normal) {
    _a.copy(a).addScaledVector(normal, this.stand);
    _b.copy(b).addScaledVector(normal, this.stand);
    this.bars.addSegment(_a, _b, this.radius);
    // stanchions
    for (const p of [a, b]) {
      _v.copy(p).addScaledVector(normal, this.stand * 0.5);
      _q.setFromUnitVectors(Y_AXIS, normal);
      this.posts.add(_m.compose(_v, _q, _s.set(0.022, this.stand, 0.022)));
    }
    this.list.push({ a: _a.clone(), b: _b.clone(), radius: this.radius });
  }

  /** Line of rails from a to b (on the hull, straight), segment ~1.2 m with gaps. */
  addLine(a, b, normal, seg = 1.2, gap = 0.35) {
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.floor((len + gap) / (seg + gap)));
    const step = (len - n * seg - (n - 1) * gap) / 2;
    const dir = _dir.subVectors(b, a).normalize();
    const sa = new THREE.Vector3(), sb = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t0 = step + i * (seg + gap);
      sa.copy(a).addScaledVector(dir, t0); sb.copy(a).addScaledVector(dir, t0 + seg);
      this.addRail(sa, sb, normal);
    }
  }

  /** Rails along a HullFrame module at angle theta from axial t0 to t1 (on the hull surface). */
  addAlongHull(hull, theta, t0, t1, seg = 1.2, gap = 0.35, rho = hull.r) {
    const a = hull.point(t0, theta, rho), b = hull.point(t1, theta, rho), n = hull.normal(theta);
    this.addLine(a, b, n, seg, gap);
  }

  /** Ring of short rails around a hull at axial t (circumferential). */
  addAroundHull(hull, t, count = 8, seg = 0.9, offset = 0) {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
    const dTheta = seg / hull.r;
    for (let i = 0; i < count; i++) {
      const th = offset + (i / count) * Math.PI * 2;
      hull.point(t, th - dTheta / 2, hull.r, a); hull.point(t, th + dTheta / 2, hull.r, b); hull.normal(th, n);
      this.addRail(a, b, n);
    }
  }

  build(parent) {
    this.bars.build(parent);
    this.posts.build(parent);
  }
}
