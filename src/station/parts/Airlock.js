import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { Builder, HullFrame, boxAt, tubeAt, torusAt, flipInside, scaleUV, mat, Colliders, X_AXIS, Y_AXIS, Z_AXIS, TEX_M } from './Builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CY = LAYOUT.clusterY;
const _q = new THREE.Quaternion();
const HATCH_TIME = 4.0;
const HATCH_SWING = 1.95;   // rad, outward

/**
 * EVA airlock module on node-1 (+Z): exterior hull, an interior chamber with handholds, panels,
 * suit rack and lights, and an outer round hatch that swings outward on a hinge (4 s).
 * Exposes the Airlock contract object via `info` and the dynamic hatch collider.
 */
export class AirlockModule {
  constructor(ctx, station, b, rails) {
    const m = ctx.materials;
    const A = LAYOUT.airlock;
    const AX = A.x, r = A.r, len = A.len, z0 = A.zStart, zEnd = z0 + len;
    const H = new HullFrame(V(AX, CY, z0 + len / 2), Z_AXIS, r, len, 'airlock');
    this.hull = H;
    this.hatchZ = zEnd;
    const colliders = [];

    // ---------- exterior ----------
    b.add('hullWhite', tubeAt(H.center, Z_AXIS, r, len, 48, { open: true }));
    b.add('mliSilver', tubeAt(V(AX, CY, z0 + 1.2), Z_AXIS, r + 0.05, 1.6, 48));
    b.add('mliGold', tubeAt(V(AX, CY, z0 + 4.2), Z_AXIS, r + 0.05, 1.2, 48));
    for (const z of [z0 + 2.2, z0 + 3.5, z0 + 5.0, zEnd - 0.5]) b.add('metalDark', torusAt(V(AX, CY, z), Z_AXIS, r + 0.015, 0.04, 5, 48), false);
    // end cap: annulus with a thick rim, hatch tunnel, hazard ring
    b.add('hullWhite', new THREE.RingGeometry(0.76, r + 0.02, 48, 1).translate(AX, CY, zEnd));
    b.add('metalDark', torusAt(V(AX, CY, zEnd - 0.06), Z_AXIS, r + 0.02, 0.12, 8, 48), false);
    b.add('metalBare', flipInside(new THREE.CylinderGeometry(0.76, 0.76, 0.4, 32, 1, true).rotateX(Math.PI / 2).translate(AX, CY, zEnd - 0.15)), false);
    b.add('hazard', new THREE.RingGeometry(0.78, 0.98, 48, 1).translate(AX, CY, zEnd + 0.01), false);
    b.add('metalDark', torusAt(V(AX, CY, zEnd + 0.02), Z_AXIS, 0.78, 0.035, 5, 48), false);
    // hinge brackets, EVA lights, tether anchor, foot restraint, toolbox
    for (const sx of [-1, 1]) {
      b.add('metalDark', boxAt(V(AX + sx * 0.32, CY + 0.86, zEnd + 0.06), 0.12, 0.2, 0.16, null, false), false);
      b.add('metalDark', boxAt(V(AX + sx * 1.25, CY + 1.0, zEnd + 0.12), 0.26, 0.26, 0.26, null, false), false);
      b.add('dockLight', boxAt(V(AX + sx * 1.25, CY + 1.0, zEnd + 0.26), 0.2, 0.2, 0.03, null, false), false);
    }
    this.tetherAnchor = V(AX, CY + 1.5, zEnd + 0.16);
    b.add('metalBare', boxAt(V(AX, CY + 1.5, zEnd + 0.04), 0.3, 0.3, 0.08, null, false), false);
    b.add('metalBare', torusAt(this.tetherAnchor, Y_AXIS, 0.1, 0.025, 6, 16), false);
    b.add('hullWhiteAged', boxAt(V(AX, CY - 1.45, zEnd + 0.12), 0.5, 0.06, 0.24, null, false), false);
    b.add('hullWhiteAged', boxAt(V(AX + 1.3, CY - 1.0, zEnd + 0.18), 0.6, 0.34, 0.36), false);
    b.add('hazard', boxAt(V(AX + 1.3, CY - 1.0, zEnd + 0.37), 0.62, 0.36, 0.02, null, false), false);
    // labels
    b.labelAt('ВЫХОД · EVA-1', 1.6, 0.2, V(AX, CY + 1.3, zEnd + 0.02), Z_AXIS, { width: 1024 });
    b.labelAt('ШЛЮЗ', 2.6, 0.5, V(AX + r + 0.05, CY + 0.2, z0 + len / 2), X_AXIS, { width: 512 });
    b.labelAt('AIRLOCK', 2.6, 0.4, V(AX - r - 0.05, CY + 0.2, z0 + len / 2), V(-1, 0, 0), { width: 512 });
    // exterior handrails: four lines along the module, a ring near the cap, bars on the cap face
    for (const th of [H.thetaFor(Y_AXIS), H.thetaFor(X_AXIS), H.thetaFor(V(-1, 0, 0)), H.thetaFor(V(0, -1, 0))]) rails.addAlongHull(H, th, -len / 2 + 0.8, len / 2 - 0.9, 1.1, 0.3);
    rails.addAroundHull(H, len / 2 - 0.7, 8, 0.9, 0.4);
    for (const sx of [-1, 1]) rails.addRail(V(AX + sx * 1.1, CY - 0.5, zEnd), V(AX + sx * 1.1, CY + 0.5, zEnd), Z_AXIS);
    rails.addRail(V(AX - 0.5, CY - 1.1, zEnd), V(AX + 0.5, CY - 1.1, zEnd), Z_AXIS);

    // ---------- interior ----------
    const ri = 1.85, zi0 = z0 + 0.2, zi1 = zEnd - 0.15;
    const bi = new Builder(m);
    const wall = new THREE.CylinderGeometry(ri, ri, zi1 - zi0, 32, 1, true);
    scaleUV(wall, (2 * Math.PI * ri) / 3.2, (zi1 - zi0) / 3.2);
    bi.add('hullWhiteAged', flipInside(wall).rotateX(Math.PI / 2).translate(AX, CY, (zi0 + zi1) / 2));
    bi.add('hullWhiteAged', new THREE.CylinderGeometry(ri, ri, 0.05, 32).rotateX(Math.PI / 2).translate(AX, CY, zi0));
    bi.add('hullWhiteAged', new THREE.RingGeometry(0.76, ri, 32, 1).rotateY(Math.PI).translate(AX, CY, zi1));
    bi.add('hazard', new THREE.RingGeometry(0.78, 0.95, 32, 1).rotateY(Math.PI).translate(AX, CY, zi1 - 0.01), false);
    // inner hatch (closed) with wheel
    bi.add('metalDark', new THREE.CylinderGeometry(0.72, 0.72, 0.1, 32).rotateX(Math.PI / 2).translate(AX, CY, zi0 + 0.08), false);
    bi.add('metalBare', torusAt(V(AX, CY, zi0 + 0.1), Z_AXIS, 0.76, 0.05, 6, 32), false);
    bi.add('metalBare', torusAt(V(AX, CY, zi0 + 0.25), Z_AXIS, 0.28, 0.03, 6, 20), false);
    for (let k = 0; k < 4; k++) bi.add('metalBare', boxAt(V(AX, CY, zi0 + 0.25), 0.56, 0.03, 0.03, _q.setFromAxisAngle(Z_AXIS, (k / 4) * Math.PI), false), false);
    // wall frames, light strips, handholds
    for (const z of [zi0 + 1.6, zi0 + 3.4, zi0 + 5.2]) bi.add('metalDark', torusAt(V(AX, CY, z), Z_AXIS, ri - 0.04, 0.05, 5, 32), false);
    const lightMat = m.get('floodLight').clone(); lightMat.emissiveIntensity = 2.2; lightMat.name = 'airlockStrip';
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const q = _q.setFromAxisAngle(Z_AXIS, a + Math.PI / 2);
      bi.add('floodLight', boxAt(V(AX + (ri - 0.08) * Math.cos(a), CY + (ri - 0.08) * Math.sin(a), (zi0 + zi1) / 2), 0.1, 0.05, zi1 - zi0 - 1.2, q, false), false, lightMat);
      bi.add('metalDark', boxAt(V(AX + (ri - 0.05) * Math.cos(a), CY + (ri - 0.05) * Math.sin(a), (zi0 + zi1) / 2), 0.16, 0.05, zi1 - zi0 - 1.1, q, false), false);
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const n = V(-Math.cos(a), -Math.sin(a), 0);
      const pa = V(AX + ri * Math.cos(a), CY + ri * Math.sin(a), zi0 + 1.0), pb = V(AX + ri * Math.cos(a), CY + ri * Math.sin(a), zi1 - 0.8);
      rails.addLine(pa, pb, n, 1.0, 0.3);
    }
    // control panel (+X wall), suit rack (-X wall), O2 tanks (floor), tether reel near the hatch
    const pm = mat(AX + ri - 0.12, CY + 0.3, zi0 + 2.6, _q.setFromAxisAngle(Y_AXIS, -Math.PI / 2));
    bi.add('paintGray', boxAt(V(0, 0, 0), 0.7, 0.55, 0.12, null, false).applyMatrix4(pm), false);
    bi.add('windowGlow', boxAt(V(0.08, 0.08, 0.07), 0.4, 0.26, 0.01, null, false).applyMatrix4(pm), false);
    bi.add('navGreen', boxAt(V(-0.22, -0.15, 0.07), 0.05, 0.05, 0.01, null, false).applyMatrix4(pm), false);
    bi.add('navRed', boxAt(V(-0.12, -0.15, 0.07), 0.05, 0.05, 0.01, null, false).applyMatrix4(pm), false);
    bi.add('navWhite', boxAt(V(0.2, -0.18, 0.07), 0.1, 0.04, 0.01, null, false).applyMatrix4(pm), false);
    for (const dz of [-0.6, 0.6]) {
      const c = V(AX - ri + 0.45, CY + 0.1, zi0 + 2.4 + dz);
      bi.add('hullWhite', boxAt(c, 0.42, 0.75, 0.5), false);
      bi.add('hullWhite', boxAt(V(c.x, c.y - 0.75, c.z), 0.36, 0.7, 0.42), false);
      bi.add('hullWhite', new THREE.SphereGeometry(0.19, 14, 10).translate(c.x, c.y + 0.58, c.z), false);
      bi.add('visorGold', new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI).rotateY(Math.PI / 2).translate(c.x + 0.07, c.y + 0.58, c.z), false);
      bi.add('metalDark', boxAt(V(AX - ri + 0.1, c.y + 0.9, c.z), 0.2, 0.06, 0.6, null, false), false);
    }
    for (const dx of [-0.5, 0.5]) bi.add('metalBare', tubeAt(V(AX + dx, CY - ri + 0.3, zi0 + 4.2), Z_AXIS, 0.2, 1.3, 14, { uv: false }), false);
    bi.add('metalDark', tubeAt(V(AX + 1.2, CY - 1.1, zi1 - 0.5), X_AXIS, 0.18, 0.3, 14, { uv: false }), false);
    bi.add('hazard', tubeAt(V(AX + 1.2, CY - 1.1, zi1 - 0.5), X_AXIS, 0.19, 0.08, 14, { uv: false }), false);
    bi.build(station, { name: 'airlockInterior' });

    // ---------- outer hatch (hinged at the top, swings outward) ----------
    this.pivot = new THREE.Group();
    this.pivot.position.set(AX, CY + 0.8, zEnd + 0.08);
    station.add(this.pivot);
    const bh = new Builder(m);
    const d = V(0, -0.8, 0.05);
    bh.add('hullWhite', new THREE.CylinderGeometry(0.73, 0.73, 0.12, 32).rotateX(Math.PI / 2).translate(d.x, d.y, d.z));
    bh.add('metalDark', new THREE.CylinderGeometry(0.66, 0.66, 0.02, 32).rotateX(Math.PI / 2).translate(d.x, d.y, d.z - 0.065), false);
    bh.add('hazard', new THREE.RingGeometry(0.6, 0.72, 32, 1).translate(d.x, d.y, d.z + 0.065), false);
    bh.add('metalDark', torusAt(V(d.x, d.y, d.z + 0.065), Z_AXIS, 0.17, 0.03, 5, 20), false);
    bh.add('windowGlow', new THREE.CylinderGeometry(0.13, 0.13, 0.03, 20).rotateX(Math.PI / 2).translate(d.x, d.y, d.z - 0.02), false);
    bh.add('glass', new THREE.CylinderGeometry(0.14, 0.14, 0.02, 20).rotateX(Math.PI / 2).translate(d.x, d.y, d.z + 0.07), false);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      bh.add('metalBare', new THREE.BoxGeometry(0.12, 0.1, 0.1).translate(0, 0.64, d.z - 0.08).applyMatrix4(new THREE.Matrix4().makeRotationZ(a)).translate(d.x, d.y, 0), false);
    }
    bh.add('metalBare', boxAt(V(d.x, d.y - 0.3, d.z + 0.16), 0.5, 0.04, 0.04, null, false), false);
    for (const sx of [-1, 1]) bh.add('metalBare', boxAt(V(d.x + sx * 0.23, d.y - 0.3, d.z + 0.1), 0.04, 0.04, 0.12, null, false), false);
    for (const sx of [-1, 1]) bh.add('metalDark', boxAt(V(sx * 0.32, -0.38, 0.1), 0.08, 0.8, 0.08, null, false), false);
    bh.add('metalDark', tubeAt(V(0, 0, 0), X_AXIS, 0.05, 0.9, 10, { uv: false }), false);
    bh.build(this.pivot, { name: 'hatch' });
    this.anchor = new THREE.Object3D(); this.anchor.position.copy(d); this.pivot.add(this.anchor);
    this.hatchCollider = Colliders.box(V(AX, CY, zEnd + 0.13), V(0.73, 0.73, 0.07), null, 'hatch', true);

    // ---------- colliders: wall slabs (shared by interior and exterior), cap ring, bulkhead ----------
    for (let k = 0; k < 8; k++) {
      const phi = (k / 8) * Math.PI * 2;
      colliders.push(Colliders.box(V(AX + 2.0 * Math.cos(phi), CY + 2.0 * Math.sin(phi), z0 + len / 2), V(0.9, 0.17, len / 2), _q.setFromAxisAngle(Z_AXIS, phi + Math.PI / 2), 'airlockWall'));
    }
    const hh = 0.76, capZ = zEnd - 0.05;
    colliders.push(Colliders.box(V(AX, CY + hh + 0.62, capZ), V(2.0, 0.62, 0.12), null, 'airlockCap'));
    colliders.push(Colliders.box(V(AX, CY - hh - 0.62, capZ), V(2.0, 0.62, 0.12), null, 'airlockCap'));
    colliders.push(Colliders.box(V(AX - hh - 0.62, CY, capZ), V(0.62, hh, 0.12), null, 'airlockCap'));
    colliders.push(Colliders.box(V(AX + hh + 0.62, CY, capZ), V(0.62, hh, 0.12), null, 'airlockCap'));
    colliders.push(Colliders.box(V(AX, CY, zi0 - 0.05), V(2.0, 2.0, 0.12), null, 'airlockBulkhead'));
    colliders.push(this.hatchCollider);
    this.colliders = colliders;

    // ---------- contract object ----------
    const self = this;
    this.progress = 0; this.target = 0; this._waiters = [];
    this.info = {
      standPosition: V(AX, CY, z0 + len / 2 + 0.3),
      exitDirection: V(0, 0, 1),
      lookDirection: V(0, 0, 1),
      tetherAnchor: this.tetherAnchor,
      interiorColliders: colliders,
      hatch: {
        get isOpen() { return self.progress >= 0.999; },
        get progress() { return self.progress; },
        get isMoving() { return self.progress !== self.target; },
        open() { return self._go(1); },
        close() { return self._go(0); },
      },
      // extra info for other modules
      x: AX, hatchZ: zEnd, hatchCenter: V(AX, CY, zEnd), interiorLight: V(AX, CY + 1.3, z0 + 3.4), radius: r,
    };
    this._applyHatch();
  }

  _go(target) {
    // resolve waiters of a reversed motion so nobody hangs
    if (this.target !== target) { for (const w of this._waiters) w(); this._waiters.length = 0; }
    this.target = target;
    if (this.progress === target) return Promise.resolve();
    return new Promise((res) => this._waiters.push(res));
  }

  _applyHatch() {
    const p = this.progress, e = p * p * (3 - 2 * p);
    this.pivot.rotation.x = -HATCH_SWING * e;
    this.pivot.updateMatrixWorld(true);
    this.anchor.getWorldPosition(this.hatchCollider.center);
    this.anchor.getWorldQuaternion(this.hatchCollider.quaternion);
  }

  update(dt) {
    if (this.progress !== this.target) {
      const step = dt / HATCH_TIME;
      this.progress = this.target > this.progress ? Math.min(this.target, this.progress + step) : Math.max(this.target, this.progress - step);
      this._applyHatch();
      if (this.progress === this.target) { for (const w of this._waiters) w(); this._waiters.length = 0; }
    }
  }
}
