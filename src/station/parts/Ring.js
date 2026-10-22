import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { Builder, boxAt, tubeAt, torusAt, domeAt, scaleUV, mat, Colliders, X_AXIS, Y_AXIS, TEX_M } from './Builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion();

/**
 * Artificial-gravity habitat ring: torus R=40 m, tube 3.5 m, six spokes to a rotating collar on a
 * de-spun hub drum fixed to the spine. Rotates about X at 0.30 rad/s (~0.37 g at the rim).
 * Colliders are dynamic: 24 rim capsules + 6 spoke capsules + 6 counterweight spheres, rotated in place every frame.
 */
export class HabitatRing {
  constructor(ctx, station, bStatic) {
    const m = ctx.materials;
    const R = LAYOUT.ringR, r = LAYOUT.ringTube, X0 = LAYOUT.ringX, hubR = LAYOUT.ringHubR;
    this.radius = R;
    this.angularSpeed = 0.30;
    this.angle = 0;
    this.group = new THREE.Group();
    this.group.name = 'habitatRing';
    this.group.position.set(X0, 0, 0);
    station.add(this.group);
    const b = new Builder(m);

    // ----- rim torus (axis X) -----
    const torus = new THREE.TorusGeometry(R, r, 28, 192);
    scaleUV(torus, (2 * Math.PI * R) / TEX_M, (2 * Math.PI * r) / TEX_M);
    torus.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    b.add('hullWhite', torus);
    // structural ribs around the tube every 15 degrees
    for (let k = 0; k < 24; k++) {
      const phi = (k / 24) * Math.PI * 2;
      const c = V(0, R * Math.cos(phi), R * Math.sin(phi)), tangent = V(0, -Math.sin(phi), Math.cos(phi));
      b.add('metalDark', torusAt(c, tangent, r + 0.06, 0.09, 6, 40), false);
    }
    // inner-face radiator band + outer-face floor panels + side window strips
    const nSeg = 60;
    for (let k = 0; k < nSeg; k++) {
      const phi = (k + 0.5) / nSeg * Math.PI * 2;
      const q = _q.setFromAxisAngle(X_AXIS, phi);         // local Y -> (0, cos phi, sin phi)
      const segLen = (2 * Math.PI) / nSeg;
      b.add('radiator', boxAt(V(0, (R - r - 0.08) * Math.cos(phi), (R - r - 0.08) * Math.sin(phi)), 2.4, 0.08, (R - r) * segLen - 0.2, q));
      b.add('hullWhiteAged', boxAt(V(0, (R + r + 0.03) * Math.cos(phi), (R + r + 0.03) * Math.sin(phi)), 2.8, 0.06, (R + r) * segLen - 0.25, q));
      if (k % 2 === 0) {
        for (const sx of [-1, 1]) {
          const c = V(sx * (r + 0.02), R * Math.cos(phi), R * Math.sin(phi));
          b.add('metalDark', boxAt(c, 0.1, 0.7, R * segLen * 1.3, q), false);
          b.add('windowGlow', boxAt(V(sx * (r - 0.02), c.y, c.z), 0.08, 0.5, R * segLen * 1.3 - 0.3, q), false);
          b.add('glass', boxAt(V(sx * (r + 0.05), c.y, c.z), 0.02, 0.5, R * segLen * 1.3 - 0.3, q), false);
        }
      }
    }
    // ----- spokes -----
    const spokes = 6, spokeR = 0.9, spokeIn = hubR + 0.9, spokeOut = R - r + 0.4;
    this.dynamic = [];
    for (let k = 0; k < spokes; k++) {
      const phi = (k / spokes) * Math.PI * 2;
      const dir = V(0, Math.cos(phi), Math.sin(phi));
      const a = dir.clone().multiplyScalar(spokeIn), c = dir.clone().multiplyScalar(spokeOut);
      b.add('truss', tubeAt(a.clone().lerp(c, 0.5), dir, spokeR, spokeOut - spokeIn, 16));
      b.add('mliSilver', tubeAt(a.clone().lerp(c, 0.5), dir, spokeR + 0.12, 4.0, 16));
      // flanges at both ends, cable pairs alongside, hazard band at the rim end
      b.add('metalDark', tubeAt(dir.clone().multiplyScalar(spokeIn + 0.6), dir, spokeR + 0.5, 1.2, 16), false);
      b.add('metalDark', tubeAt(dir.clone().multiplyScalar(spokeOut - 0.6), dir, spokeR + 0.5, 1.2, 16), false);
      b.add('hazard', tubeAt(dir.clone().multiplyScalar(spokeOut - 1.6), dir, spokeR + 0.08, 0.6, 16, { uv: false }), false);
      const side = V(1, 0, 0);
      for (const s of [-1, 1]) b.add('cable', tubeAt(a.clone().lerp(c, 0.5).addScaledVector(side, s * (spokeR + 0.12)), dir, 0.06, spokeOut - spokeIn, 6, { uv: false }), false);
      // elevator car on spoke 0
      if (k === 0) b.add('mliGold', boxAt(dir.clone().multiplyScalar(R * 0.55).addScaledVector(side, spokeR + 0.5), 0.9, 2.2, 1.6, _q.setFromAxisAngle(X_AXIS, phi)));
      this.dynamic.push({ col: Colliders.capsule(a, c, spokeR + 0.2, 'spoke', true), la: a.clone(), lb: c.clone() });
    }
    // ----- counterweights between spokes on the outer rim -----
    for (let k = 0; k < spokes; k++) {
      const phi = ((k + 0.5) / spokes) * Math.PI * 2;
      const dir = V(0, Math.cos(phi), Math.sin(phi));
      const c = dir.clone().multiplyScalar(R + r + 0.7);
      const q = _q.setFromAxisAngle(X_AXIS, phi);
      b.add('mliBlack', boxAt(c, 2.6, 1.3, 2.6, q));
      b.add('hazard', boxAt(dir.clone().multiplyScalar(R + r + 1.38), 2.7, 0.06, 2.7, q, false), false);
      b.add('metalBare', boxAt(dir.clone().multiplyScalar(R + r + 0.05), 1.0, 0.12, 3.2, q), false);
      this.dynamic.push({ col: Colliders.sphere(c, 1.9, 'counterweight', true), la: c.clone(), lb: null });
    }
    // ----- rotating collar on the hub (bearing) -----
    b.add('mliSilver', tubeAt(V(0, 0, 0), X_AXIS, hubR + 0.8, 4.0, 48));
    b.add('metalBare', torusAt(V(-2.05, 0, 0), X_AXIS, hubR + 0.6, 0.22, 8, 48), false);
    b.add('metalBare', torusAt(V(2.05, 0, 0), X_AXIS, hubR + 0.6, 0.22, 8, 48), false);
    for (let k = 0; k < 24; k++) {
      const phi = (k / 24) * Math.PI * 2;
      b.add('metalDark', boxAt(V(0, (hubR + 0.82) * Math.cos(phi), (hubR + 0.82) * Math.sin(phi)), 3.6, 0.12, 0.5, _q.setFromAxisAngle(X_AXIS, phi)), false);
    }
    // name on the +X side of the rim (two places)
    for (const phi of [Math.PI / 6, Math.PI + Math.PI / 6]) {
      const c = V(r + 0.5, R * Math.cos(phi), R * Math.sin(phi));
      const n = V(1, 0, 0), right = V(0, -Math.sin(phi), Math.cos(phi));
      b.labelAt(LAYOUT.stationName, 4.6, 0.6, c, n, { right, width: 1024 });
    }
    // rotating nav strobe heads (emissive), lights module adds the halos
    this.strobePositions = [];
    for (let k = 0; k < 4; k++) {
      const phi = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const p = V(0, (R + r + 0.25) * Math.cos(phi), (R + r + 0.25) * Math.sin(phi));
      this.strobePositions.push(p);
    }
    b.build(this.group, { name: 'ring' });

    // rim colliders: 24 chords
    const nRim = 24;
    for (let k = 0; k < nRim; k++) {
      const p0 = (k / nRim) * Math.PI * 2, p1 = ((k + 1) / nRim) * Math.PI * 2;
      const a = V(0, R * Math.cos(p0), R * Math.sin(p0)), c = V(0, R * Math.cos(p1), R * Math.sin(p1));
      this.dynamic.push({ col: Colliders.capsule(a, c, r + 0.35, 'rim', true), la: a.clone(), lb: c.clone() });
    }
    this.colliders = this.dynamic.map((d) => d.col);
    for (const d of this.dynamic) { d.col.a?.setX(d.col.a.x + X0); d.col.b?.setX(d.col.b.x + X0); d.col.center?.setX(d.col.center.x + X0); }

    // ----- static hub drum (de-spun) on the spine -----
    bStatic.add('truss', tubeAt(V(X0 - 3.6, 0, 0), X_AXIS, hubR, 3.2, 48));
    bStatic.add('truss', tubeAt(V(X0 + 3.6, 0, 0), X_AXIS, hubR, 3.2, 48));
    // domed ends (convex, so they read as solid) with a bearing boss where the spine passes through
    bStatic.add('mliGold', domeAt(V(X0 - 5.2, 0, 0), V(-1, 0, 0), hubR, 1.6));
    bStatic.add('mliGold', domeAt(V(X0 + 5.2, 0, 0), X_AXIS, hubR, 1.6));
    bStatic.add('metalDark', tubeAt(V(X0 - 6.5, 0, 0), X_AXIS, 3.3, 0.6, 48));
    bStatic.add('metalDark', tubeAt(V(X0 + 6.5, 0, 0), X_AXIS, 3.3, 0.6, 48));
    bStatic.add('hazard', torusAt(V(X0 - 2.2, 0, 0), X_AXIS, hubR + 0.05, 0.12, 6, 48), false);
    bStatic.add('hazard', torusAt(V(X0 + 2.2, 0, 0), X_AXIS, hubR + 0.05, 0.12, 6, 48), false);
    bStatic.labelAt('ВРАЩЕНИЕ · ROTATION', 2.8, 0.36, V(X0 + 3.6, 0.6, hubR + 0.03), V(0, 0, 1), { width: 1024, color: '#b01818' });
    bStatic.labelAt('ВРАЩЕНИЕ · ROTATION', 2.8, 0.36, V(X0 - 3.6, 0.6, -(hubR + 0.03)), V(0, 0, -1), { width: 1024, color: '#b01818' });
    this.staticColliders = [Colliders.capsule(V(X0 - 5.6, 0, 0), V(X0 + 5.6, 0, 0), hubR + 0.9, 'ringHub')];
  }

  update(dt) {
    this.angle = (this.angle + this.angularSpeed * dt) % (Math.PI * 2);
    this.group.rotation.x = this.angle;
    const c = Math.cos(this.angle), s = Math.sin(this.angle), X0 = LAYOUT.ringX;
    for (const d of this.dynamic) {
      const col = d.col;
      if (col.type === 'capsule') {
        col.a.set(X0 + d.la.x, d.la.y * c - d.la.z * s, d.la.y * s + d.la.z * c);
        col.b.set(X0 + d.lb.x, d.lb.y * c - d.lb.z * s, d.lb.y * s + d.lb.z * c);
      } else {
        col.center.set(X0 + d.la.x, d.la.y * c - d.la.z * s, d.la.y * s + d.la.z * c);
      }
    }
  }
}
