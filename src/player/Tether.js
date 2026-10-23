import * as THREE from 'three';
import { LAYERS } from '../core/constants.js';

/**
 * Safety tether rendered as a chain of instanced cylinder segments following a quadratic curve
 * from the anchor to the astronaut's hip. The slack part floats with a slow wobble (zero-g),
 * a taut tether is straight. No per-frame allocations.
 */
const SEGMENTS = 36;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);

export class Tether {
  constructor(ctx, parent) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 7, 1, false);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9c6bb, roughness: 0.8, metalness: 0.05 });
    mat.name = 'tetherRope';
    this.mesh = new THREE.InstancedMesh(geo, mat, SEGMENTS);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'tether';
    this.radius = 0.012;
    // hook at the hip end
    const hookMat = ctx.materials.get('metalBare');
    this.hook = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.009, 6, 14), hookMat);
    this.hook.castShadow = false;
    this.hook.name = 'tetherHook';
    this.group = new THREE.Group();
    this.group.name = 'tetherGroup';
    this.group.add(this.mesh, this.hook);
    parent.add(this.group);
    this.time = 0;
  }

  setVisible(v) { this.group.visible = v; }

  /**
   * anchor, hip: world points; length: reel length; dt for the wobble.
   */
  update(anchor, hip, length, dt, away = null) {
    this.time += dt;
    _a.copy(anchor); _b.copy(hip);
    _dir.subVectors(_b, _a);
    const d = _dir.length();
    if (d < 1e-4) { _dir.set(0, 0, 1); } else _dir.multiplyScalar(1 / d);
    // slack bows the rope sideways; direction wobbles slowly so it looks like it floats
    // The reel is spring-loaded (a retractable EVA tether): the rope never floats in wide loops,
    // only a modest bow remains that grows with slack and never comes close to the helmet.
    const slack = Math.max(0, length - d);
    const bow = Math.min(0.35 * Math.min(slack, 4), 0.12 * d);
    const t = this.time;
    _side.set(Math.sin(t * 0.21) * 0.6 + 0.4, Math.cos(t * 0.17) * 0.5 + 0.9, Math.sin(t * 0.13 + 1.7) * 0.6);
    // keep the bow out of the astronaut's face: bias it away from the view direction (the rope
    // leaves the hip backwards/downwards instead of rising in front of the visor and the lamp)
    if (away) _side.addScaledVector(away, -2.2);
    _side.addScaledVector(_dir, -_side.dot(_dir));
    if (_side.lengthSq() < 1e-6) _side.set(0, 1, 0).addScaledVector(_dir, -_dir.y);
    _side.normalize();
    _c.copy(_a).addScaledVector(_dir, d * 0.5).addScaledVector(_side, bow);
    // small secondary ripple travelling along the rope
    const ripple = Math.min(slack, 3) * 0.03;
    for (let i = 0; i < SEGMENTS; i++) {
      const u0 = i / SEGMENTS, u1 = (i + 1) / SEGMENTS;
      quadratic(_a, _c, _b, u0, _p0);
      quadratic(_a, _c, _b, u1, _p1);
      if (ripple > 0) {
        _p0.addScaledVector(_side, Math.sin(u0 * 9 + t * 0.9) * ripple * Math.sin(u0 * Math.PI));
        _p1.addScaledVector(_side, Math.sin(u1 * 9 + t * 0.9) * ripple * Math.sin(u1 * Math.PI));
      }
      _seg.subVectors(_p1, _p0);
      const len = _seg.length();
      _mid.addVectors(_p0, _p1).multiplyScalar(0.5);
      if (len > 1e-6) _q.setFromUnitVectors(Y, _seg.multiplyScalar(1 / len)); else _q.identity();
      _s.set(this.radius, len * 1.02, this.radius);
      _m.compose(_mid, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.hook.position.copy(_b);
    this.hook.quaternion.setFromUnitVectors(Y, _dir);
    return d;
  }
}

function quadratic(a, c, b, u, out) {
  const w0 = (1 - u) * (1 - u), w1 = 2 * (1 - u) * u, w2 = u * u;
  out.set(a.x * w0 + c.x * w1 + b.x * w2, a.y * w0 + c.y * w1 + b.y * w2, a.z * w0 + c.z * w1 + b.z * w2);
}
