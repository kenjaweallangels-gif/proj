import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { Builder, HullFrame, boxAt, bevelBoxAt, tubeAt, torusAt, latheAt, flipInside, scaleUV, mat, Colliders, X_AXIS, Y_AXIS, Z_AXIS, TEX_M } from './Builder.js';
import { COL, boltCircle, radialBolts, boltRow } from './Detail.js';
import { mliBand, weldLand } from './HullKit.js';
import { evaLamp, toolBox } from './Hardware.js';

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
    const D = b.detail;
    b.add('hullWhite', tubeAt(H.center, Z_AXIS, r, len, 48, { open: true }));
    b.add('mliSilver', tubeAt(V(AX, CY, z0 + 1.2), Z_AXIS, r + 0.05, 1.6, 48));
    b.add('mliGold', tubeAt(V(AX, CY, z0 + 4.2), Z_AXIS, r + 0.05, 1.2, 48));
    if (D) {
      // blanket edges and weld lands with fasteners (GPU presets)
      mliBand(b, D, H, z0 + 0.4 - (z0 + len / 2), z0 + 2.0 - (z0 + len / 2), 'mliSilver', { rho: r + 0.05, seamTheta: H.thetaFor(V(0, -1, 0)) + 0.6 });
      mliBand(b, D, H, z0 + 3.6 - (z0 + len / 2), z0 + 4.8 - (z0 + len / 2), 'mliGold', { rho: r + 0.05, seamTheta: H.thetaFor(V(0, -1, 0)) - 0.6 });
      for (const z of [z0 + 2.2, z0 + 3.5, z0 + 5.0, zEnd - 0.5]) weldLand(b, D, H, z - (z0 + len / 2));
    } else for (const z of [z0 + 2.2, z0 + 3.5, z0 + 5.0, zEnd - 0.5]) b.add('metalDark', torusAt(V(AX, CY, z), Z_AXIS, r + 0.015, 0.04, 5, 48), false);
    // end bulkhead: a closed solid ring (outer rim flange, gently coned face, raised hatch frame, inner bore) —
    // real wall thickness everywhere an edge shows; the hazard band is a raised strip on the face
    const EC = V(AX, CY, zEnd);
    b.add('hullWhite', latheAt(EC, Z_AXIS, [[0.8, -0.16], [0.84, -0.16], [0.84, -0.1], [r - 0.02, -0.1], [r + 0.03, -0.07], [r + 0.03, 0.0], [r - 0.03, 0.05], [1.12, 0.09], [1.0, 0.12], [0.8, 0.12], [0.8, -0.16]], 64));
    b.add('metalBare', latheAt(EC, Z_AXIS, [[0.8, 0.12], [1.0, 0.12], [1.0, 0.2], [0.97, 0.225], [0.85, 0.225], [0.8, 0.19], [0.8, 0.12]], 64));
    b.add('hazard', scaleUV(latheAt(EC, Z_AXIS, [[1.32, 0.0786], [1.5, 0.0701], [1.5, 0.0761], [1.32, 0.0846], [1.32, 0.0786]], 64), 14, 14), false);
    b.add('rubberBlack', latheAt(EC, Z_AXIS, [[0.87, 0.224], [0.95, 0.224], [0.95, 0.232], [0.87, 0.232], [0.87, 0.224]], 64), false);
    // bore liner (seen from the crew lock through the open hatch)
    b.add('metalBare', flipInside(new THREE.CylinderGeometry(0.795, 0.795, 0.5, 40, 1, true).rotateX(Math.PI / 2).translate(AX, CY, zEnd - 0.07)), false);
    // rim flange where the bulkhead meets the cylinder
    b.add('hullWhiteAged', latheAt(EC, Z_AXIS, [[r - 0.01, -0.3], [r + 0.075, -0.28], [r + 0.095, -0.25], [r + 0.095, -0.1], [r + 0.04, -0.07], [r + 0.03, -0.07]], 64));
    if (D) {
      radialBolts(D, new THREE.Matrix4().compose(V(AX, CY, zEnd - 0.17), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, Z_AXIS), V(1, 1, 1)), r + 0.095, 64, 0, 0.014, 0.01);
      const Mf = new THREE.Matrix4().compose(V(AX, CY, zEnd + 0.2), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, Z_AXIS), V(1, 1, 1));
      boltCircle(D, Mf, 0.985, 32, 0, 0.011, 0.008);
      boltCircle(D, new THREE.Matrix4().compose(V(AX, CY, zEnd + 0.07), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, Z_AXIS), V(1, 1, 1)), 1.62, 40, 0, 0.012, 0.009, COL.bare, 'fine', 0.04);
    }
    // hinge brackets (fixed half of the hinge): bolted base plates + knuckles
    for (const sx of [-1, 1]) {
      b.add('metalDark', bevelBoxAt(V(AX + sx * 0.36, CY + 1.0, zEnd + 0.12), 0.16, 0.16, 0.06, null, 0.015), false);
      b.add('metalDark', bevelBoxAt(V(AX + sx * 0.36, CY + 0.96, zEnd + 0.24), 0.1, 0.1, 0.2, null, 0.02), false);
      b.add('metalBare', tubeAt(V(AX + sx * 0.36, CY + 0.94, zEnd + 0.33), X_AXIS, 0.04, 0.1, 14, { uv: false }), false);
    }
    // EVA flood lights: bolted bracket, finned housing, recessed lens under a hood
    for (const sx of [-1, 1]) evaLamp(b, D, V(AX + sx * 1.3, CY + 1.0, zEnd + 0.07), sx);
    // tether anchor: bolted plate with a forged eye
    this.tetherAnchor = V(AX, CY + 1.42, zEnd + 0.2);
    b.add('metalBare', bevelBoxAt(V(AX, CY + 1.42, zEnd + 0.07), 0.3, 0.24, 0.05, null, 0.012), false);
    b.add('metalBare', latheAt(V(AX, CY + 1.42, zEnd + 0.095), Z_AXIS, [[0.07, 0], [0.06, 0.05], [0.035, 0.07], [0.0, 0.07]], 16), false);
    b.add('metalBare', torusAt(V(AX, CY + 1.42, zEnd + 0.15), Y_AXIS, 0.055, 0.016, 8, 20), false);
    // foot restraint socket (WIF) below the hatch, tool box with lid, latches and handles
    b.add('hullWhiteAged', bevelBoxAt(V(AX, CY - 1.38, zEnd + 0.09), 0.5, 0.08, 0.2, null, 0.02), false);
    b.add('metalBare', bevelBoxAt(V(AX, CY - 1.38, zEnd + 0.16), 0.12, 0.12, 0.1, null, 0.015), false);
    toolBox(b, D, V(AX + 1.3, CY - 1.0, zEnd + 0.07), 0.6, 0.34, 0.36);
    if (D) {
      boltRow(D, new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(AX, CY + 1.42, zEnd + 0.095), -0.12, -0.09, 0.12, -0.09, 2, 0, 0.011, 0.008);
      boltRow(D, new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(AX, CY + 1.42, zEnd + 0.095), -0.12, 0.09, 0.12, 0.09, 2, 0, 0.011, 0.008);
    }
    // labels
    b.labelAt('ВЫХОД · EVA-1', 1.3, 0.16, V(AX, CY + 1.27, zEnd + 0.098), Z_AXIS, { width: 1024 });
    b.labelAt('ШЛЮЗ', 2.6, 0.5, V(AX + r + 0.056, CY + 0.2, z0 + len / 2), X_AXIS, { width: 512 });
    b.labelAt('AIRLOCK', 2.6, 0.4, V(AX - r - 0.056, CY + 0.2, z0 + len / 2), V(-1, 0, 0), { width: 512 });
    // exterior handrails: four lines along the module, a ring near the cap, bars on the cap face
    for (const th of [H.thetaFor(Y_AXIS), H.thetaFor(X_AXIS), H.thetaFor(V(-1, 0, 0)), H.thetaFor(V(0, -1, 0))]) rails.addAlongHull(H, th, -len / 2 + 0.8, len / 2 - 0.9, 1.1, 0.3, r + 0.05);
    rails.addAroundHull(H, len / 2 - 0.7, 8, 0.9, 0.4);
    for (const sx of [-1, 1]) rails.addRail(V(AX + sx * 1.1, CY - 0.5, zEnd + 0.09), V(AX + sx * 1.1, CY + 0.5, zEnd + 0.09), Z_AXIS);
    rails.addRail(V(AX - 0.5, CY - 1.1, zEnd + 0.09), V(AX + 0.5, CY - 1.1, zEnd + 0.09), Z_AXIS);

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
    // solid door: lathe body with a chamfered rim, slightly domed outer skin and a recessed inner face; sealing
    // land on the frame; centre viewport with a two-pane window in a bolted frame; handle on stand-offs; eight
    // latch dogs on the rim; hinge arms with knuckles around the pin
    this.pivot = new THREE.Group();
    this.pivot.userData.animated = true;   // moves only on open()/close(): keep out of static batching
    this.pivot.position.set(AX, CY + 0.94, zEnd + 0.33);
    station.add(this.pivot);
    const bh = new Builder(m);
    bh.detail = null;
    const d = V(0, -0.94, -0.098);          // door centre (rim seal plane) relative to the hinge pin
    const DC = d.clone();
    // profiles are closed and counter-clockwise in (radius, axial) so every face points out of the solid
    bh.add('hullWhite', latheAt(DC, Z_AXIS, [[0.87, 0.0], [0.9, 0.025], [0.9, 0.07], [0.84, 0.1], [0.5, 0.125], [0.2, 0.13]], 48));
    bh.add('metalDark', latheAt(DC, Z_AXIS, [[0.2, 0.13], [0.2, -0.03], [0.78, -0.03], [0.87, 0.0]], 48));
    bh.add('hazard', scaleUV(latheAt(DC, Z_AXIS, [[0.7, 0.11], [0.82, 0.1012], [0.82, 0.1072], [0.7, 0.116], [0.7, 0.11]], 48), 14, 14), false);
    // viewport: frame ring (solid, lipped), outer and inner panes seated in it
    bh.add('metalBare', latheAt(DC, Z_AXIS, [[0.145, -0.04], [0.2, -0.04], [0.2, 0.18], [0.188, 0.195], [0.13, 0.195], [0.13, 0.175], [0.145, 0.165], [0.145, -0.04]], 32));
    bh.add('glass', new THREE.CylinderGeometry(0.162, 0.162, 0.016, 32).rotateX(Math.PI / 2).translate(d.x, d.y, d.z + 0.15), false);
    bh.add('glass', new THREE.CylinderGeometry(0.162, 0.162, 0.012, 32).rotateX(Math.PI / 2).translate(d.x, d.y, d.z + 0.0), false);
    // handle: bar on two stand-offs with feet
    bh.add('metalBare', tubeAt(V(d.x, d.y - 0.42, d.z + 0.26), X_AXIS, 0.022, 0.46, 12, { uv: false }), false);
    for (const sx of [-1, 1]) {
      bh.add('metalBare', tubeAt(V(d.x + sx * 0.2, d.y - 0.42, d.z + 0.19), Z_AXIS, 0.018, 0.14, 10, { uv: false }), false);
      bh.add('metalBare', latheAt(V(d.x + sx * 0.2, d.y - 0.42, d.z + 0.115), Z_AXIS, [[0.045, 0.0], [0.045, 0.012], [0.025, 0.03], [0.0, 0.03]], 12), false);
      bh.add('metalBare', new THREE.SphereGeometry(0.024, 10, 8).translate(d.x + sx * 0.23, d.y - 0.42, d.z + 0.26), false);
    }
    // latch dogs around the rim (bevelled blocks with a pivot boss), clamping onto the frame
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const ca = Math.cos(a), sa = Math.sin(a);
      const qd = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a);
      bh.add('metalDark', bevelBoxAt(V(d.x + 0.86 * ca, d.y + 0.86 * sa, d.z + 0.07), 0.14, 0.09, 0.07, qd, 0.015), false);
      bh.add('metalBare', tubeAt(V(d.x + 0.8 * ca, d.y + 0.8 * sa, d.z + 0.115), Z_AXIS, 0.03, 0.03, 12, { uv: false }), false);
    }
    // hinge arms from the door skin up to the knuckles on the pin
    for (const sx of [-1, 1]) {
      bh.add('metalDark', bevelBoxAt(V(sx * 0.22, -0.4, 0.056), 0.07, 0.75, 0.07, null, 0.015), false);
      bh.add('metalDark', bevelBoxAt(V(sx * 0.22, -0.06, 0.02), 0.08, 0.14, 0.1, null, 0.02), false);
      bh.add('metalBare', tubeAt(V(sx * 0.2, 0, 0), X_AXIS, 0.045, 0.16, 14, { uv: false }), false);
    }
    bh.add('metalBare', tubeAt(V(0, 0, 0), X_AXIS, 0.022, 0.86, 10, { uv: false }), false);
    bh.build(this.pivot, { name: 'hatch' });
    this.anchor = new THREE.Object3D(); this.anchor.position.copy(d).add(V(0, 0, 0.05)); this.pivot.add(this.anchor);
    this.hatchCollider = Colliders.box(V(AX, CY, zEnd + 0.36), V(0.8, 0.8, 0.07), null, 'hatch', true);

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
