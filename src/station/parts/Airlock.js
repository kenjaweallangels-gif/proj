import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { Builder, HullFrame, boxAt, tubeAt, torusAt, flipInside, scaleUV, mat, Colliders, X_AXIS, Y_AXIS, Z_AXIS, TEX_M } from './Builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CY = LAYOUT.clusterY;
const _q = new THREE.Quaternion();
const HATCH_TIME = 4.0;
const HATCH_SWING = 1.95;   // rad, outward
const INNER_TIME = 2.5;
const INNER_SWING = 1.75;   // rad, into the equipment lock

/**
 * EVA airlock module on node-1 (+Z): exterior hull, the outer round hatch that swings outward on a hinge (4 s)
 * and the inner hatch between the equipment lock and the crew lock (2.5 s). The two interiors are built by
 * src/station/interior/AirlockInterior.js. Exposes the Airlock contract object via `info` (+ innerHatch,
 * suitPosition, equipmentLockCenter) and the EVA colliders of the crew lock.
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
    // The equipment lock / crew lock interiors are built by src/station/interior (AirlockInterior.js); this part
    // owns the hatches. Inner hatch between the two sections: hinged round door, animated like the outer one.
    this.innerPivot = new THREE.Group();
    this.innerPivot.name = 'innerHatch';
    this.innerPivot.userData.animated = true;
    this.innerPivot.position.set(AX - 0.66, CY, 6.30);
    station.add(this.innerPivot);
    this.innerDoorGeos = null;      // filled by the interior builder

    // ---------- outer hatch (hinged at the top, swings outward) ----------
    this.pivot = new THREE.Group();
    this.pivot.userData.animated = true;   // moves only on open()/close(): keep out of static batching
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

    // ---------- colliders (EVA physics): crew-lock wall slabs, cap ring around the hatch, inner bulkhead ----------
    const rc = 1.15, zc0 = 6.45, zc1 = zEnd - 0.12;
    // solid wall between the crew-lock liner (r 1.15) and the hull (r 2.0), and the equipment-lock section as a capsule
    for (let k = 0; k < 8; k++) {
      const phi = (k / 8) * Math.PI * 2, rm = (rc + r + 0.05) / 2, ht = (r + 0.05 - rc) / 2;
      colliders.push(Colliders.box(V(AX + rm * Math.cos(phi), CY + rm * Math.sin(phi), (zc0 + zc1) / 2), V(0.85, ht, (zc1 - zc0) / 2), _q.setFromAxisAngle(Z_AXIS, phi + Math.PI / 2), 'airlockWall'));
    }
    const zh0 = z0 + 0.1, zh1 = zc0 - 0.06;
    for (const a of [0, Math.PI / 4]) colliders.push(Colliders.box(V(AX, CY, (zh0 + zh1) / 2), V(r * 0.93, r * 0.93, (zh1 - zh0) / 2), _q.setFromAxisAngle(Z_AXIS, a), 'airlockHull'));
    const hh = 0.76, capZ = zEnd - 0.05;
    colliders.push(Colliders.box(V(AX, CY + hh + 0.62, capZ), V(2.0, 0.62, 0.12), null, 'airlockCap'));
    colliders.push(Colliders.box(V(AX, CY - hh - 0.62, capZ), V(2.0, 0.62, 0.12), null, 'airlockCap'));
    colliders.push(Colliders.box(V(AX - hh - 0.62, CY, capZ), V(0.62, hh, 0.12), null, 'airlockCap'));
    colliders.push(Colliders.box(V(AX + hh + 0.62, CY, capZ), V(0.62, hh, 0.12), null, 'airlockCap'));
    colliders.push(Colliders.box(V(AX, CY, zc0 - 0.06), V(2.0, 2.0, 0.08), null, 'airlockBulkhead'));
    colliders.push(this.hatchCollider);
    this.colliders = colliders;

    // ---------- contract object ----------
    const self = this;
    this.progress = 0; this.target = 0; this._waiters = [];
    this.innerProgress = 0; this.innerTarget = 0; this._innerWaiters = [];
    this.innerHatch = {
      get isOpen() { return self.innerProgress >= 0.999; },
      get progress() { return self.innerProgress; },
      get isMoving() { return self.innerProgress !== self.innerTarget; },
      open() { return self._goInner(1); },
      close() { return self._goInner(0); },
    };
    this.info = {
      standPosition: V(AX, CY, 8.05),
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
      // inner hatch between the equipment lock and the crew lock (see docs/ARCHITECTURE.md, Airlock contract)
      innerHatch: this.innerHatch,
      innerHatchCenter: V(AX, CY, 6.4),
      equipmentLockCenter: V(AX, CY, 4.5),
      suitPosition: V(AX, CY + 0.1, 4.45),
      // extra info for other modules
      x: AX, hatchZ: zEnd, hatchCenter: V(AX, CY, zEnd), interiorLight: V(AX, CY + 0.6, 8.0), radius: r,
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

  _goInner(target) {
    if (this.innerTarget !== target) { for (const w of this._innerWaiters) w(); this._innerWaiters.length = 0; }
    this.innerTarget = target;
    if (this.innerProgress === target) return Promise.resolve();
    return new Promise((res) => this._innerWaiters.push(res));
  }

  /** Attach the inner door meshes (built by the interior with the interior materials). */
  setInnerDoor(meshes) {
    for (const m of meshes) this.innerPivot.add(m);
    this._applyInner();
  }

  _applyInner() {
    const p = this.innerProgress, e = p * p * (3 - 2 * p);
    this.innerPivot.rotation.y = INNER_SWING * e;
  }

  _applyHatch() {
    const p = this.progress, e = p * p * (3 - 2 * p);
    this.pivot.rotation.x = -HATCH_SWING * e;
    this.pivot.updateMatrixWorld(true);
    this.anchor.getWorldPosition(this.hatchCollider.center);
    this.anchor.getWorldQuaternion(this.hatchCollider.quaternion);
  }

  update(dt) {
    if (this.innerProgress !== this.innerTarget) {
      const step = dt / INNER_TIME;
      this.innerProgress = this.innerTarget > this.innerProgress ? Math.min(this.innerTarget, this.innerProgress + step) : Math.max(this.innerTarget, this.innerProgress - step);
      this._applyInner();
      if (this.innerProgress === this.innerTarget) { for (const w of this._innerWaiters) w(); this._innerWaiters.length = 0; }
    }
    if (this.progress !== this.target) {
      const step = dt / HATCH_TIME;
      this.progress = this.target > this.progress ? Math.min(this.target, this.progress + step) : Math.max(this.target, this.progress - step);
      this._applyHatch();
      if (this.progress === this.target) { for (const w of this._waiters) w(); this._waiters.length = 0; }
    }
  }
}
