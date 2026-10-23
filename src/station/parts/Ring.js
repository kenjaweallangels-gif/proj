import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { Builder, Instancer, unitCylinder, boxAt, tubeAt, torusAt, domeAt, scaleUV, Colliders, X_AXIS, Y_AXIS, TEX_M } from './Builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion();

/**
 * Artificial-gravity habitat ring: torus R=40 m, tube 3.5 m, six lattice spokes to a rotating collar on a
 * de-spun hub drum fixed to the spine. Six "sector" drums sit on the rim where the spokes meet it, an inner
 * utility ring (triangular lattice) is tied to the rim by radial struts, continuous window strips run along
 * both side faces. Rotates about X at 0.30 rad/s (~0.37 g at the rim).
 *
 * Local frame of `group`: rim in the YZ plane, phi measured from +Y toward +Z: (0, R cos phi, R sin phi).
 * Colliders are dynamic: rim capsules, spoke capsules, sector-pod capsules, utility-ring capsules and
 * counterweight spheres, all rotated in place every frame (no allocations).
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
    b.labelsDynamic = true;
    this.dynamic = [];
    const spokes = 6;
    const radial = (phi) => V(0, Math.cos(phi), Math.sin(phi));
    const tangent = (phi) => V(0, -Math.sin(phi), Math.cos(phi));
    const nearPod = (phi) => { for (let k = 0; k < spokes; k++) { let d = Math.abs(phi - (k / spokes) * Math.PI * 2) % (Math.PI * 2); d = Math.min(d, Math.PI * 2 - d); if (d < 0.125) return true; } return false; };

    // ----- rim torus (axis X) -----
    const torus = new THREE.TorusGeometry(R, r, 28, 192);
    scaleUV(torus, (2 * Math.PI * R) / TEX_M, (2 * Math.PI * r) / TEX_M);
    torus.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    b.add('hullWhite', torus);
    // structural ribs around the tube every 7.5 degrees (thicker every 30)
    for (let k = 0; k < 48; k++) {
      const phi = (k / 48) * Math.PI * 2;
      if (nearPod(phi)) continue;
      b.add('metalDark', torusAt(radial(phi).multiplyScalar(R), tangent(phi), r + 0.06, k % 4 === 0 ? 0.11 : 0.07, 6, 40), false);
    }
    // outer maintenance rails (two continuous tracks on the outer face) and a central keel strip
    for (const sx of [-1, 1]) b.add('metalBare', torusAt(V(sx * 2.0, 0, 0), X_AXIS, R + 2.99, 0.07, 6, 192), false);
    b.add('metalDark', torusAt(V(0, 0, 0), X_AXIS, R + r + 0.04, 0.12, 6, 192), false);
    // inner-face radiator band, outer-face floor panels, window strips on both side faces
    const nSeg = 96;
    const segLen = (2 * Math.PI) / nSeg;
    for (let k = 0; k < nSeg; k++) {
      const phi = (k + 0.5) * segLen;
      const q = _q.setFromAxisAngle(X_AXIS, phi);         // local Y -> radial(phi)
      const pod = nearPod(phi);
      if (!pod) {
        b.add('radiator', boxAt(radial(phi).multiplyScalar(R - r - 0.08), 2.4, 0.08, (R - r) * segLen - 0.12, q));
        b.add('hullWhiteAged', boxAt(radial(phi).multiplyScalar(R + r + 0.03), 2.8, 0.06, (R + r) * segLen - 0.18, q));
      }
      if (pod) continue;
      const chord = R * segLen - 0.16;
      for (const sx of [-1, 1]) {
        const c = radial(phi).multiplyScalar(R).setX(sx * (r + 0.02));
        b.add('metalDark', boxAt(c, 0.1, 0.78, chord, q), false);
        b.add('windowGlow', boxAt(V(sx * (r - 0.01), c.y, c.z), 0.08, 0.56, chord - 0.22, q), false);
        b.add('glass', boxAt(V(sx * (r + 0.06), c.y, c.z), 0.02, 0.56, chord - 0.22, q), false);
        // small equipment / vent boxes above the window line every other segment
        if (k % 2 === 0) b.add('paintGray', boxAt(V(sx * (r - 0.35), c.y, c.z).addScaledVector(radial(phi), 1.3), 0.4, 0.28, 0.6, q), false);
      }
      // skylights on the inner face flanking the radiator band (every third segment)
      if (k % 3 === 1) for (const sx of [-1, 1]) {
        const c = radial(phi).multiplyScalar(R - r + 0.25).setX(sx * 1.95);
        b.add('metalDark', boxAt(c, 0.7, 0.1, 1.1, q), false);
        b.add('windowGlow', boxAt(c.clone().addScaledVector(radial(phi), 0.03), 0.5, 0.06, 0.9, q), false);
        b.add('glass', boxAt(c.clone().addScaledVector(radial(phi), -0.04), 0.5, 0.02, 0.9, q), false);
      }
    }

    // ----- inner utility ring: triangular lattice (three tori + battens) tied to the rim by radial struts -----
    const Ri = R - r - 2.4;
    const members = new Instancer(unitCylinder(6), m.get('truss'), { name: 'ringLattice', shadow: false });
    b.add('truss', torusAt(V(-1.5, 0, 0), X_AXIS, Ri, 0.22, 6, 192));
    b.add('truss', torusAt(V(1.5, 0, 0), X_AXIS, Ri, 0.22, 6, 192));
    b.add('truss', torusAt(V(0, 0, 0), X_AXIS, Ri - 1.3, 0.22, 6, 192));
    for (let k = 0; k < 96; k++) {
      const phi = (k / 96) * Math.PI * 2;
      const A = radial(phi).multiplyScalar(Ri).setX(-1.5), B = radial(phi).multiplyScalar(Ri).setX(1.5), C = radial(phi).multiplyScalar(Ri - 1.3);
      members.addSegment(A, B, 0.05); members.addSegment(B, C, 0.05); members.addSegment(C, A, 0.05);
      // diagonal to the next batten on the outer face
      const phi2 = ((k + 1) / 96) * Math.PI * 2;
      members.addSegment(A, radial(phi2).multiplyScalar(Ri).setX(1.5), 0.035);
      if (k % 2 === 0 && !nearPod(phi)) {
        const a = radial(phi).multiplyScalar(Ri + 0.1), c = radial(phi).multiplyScalar(R - r + 0.25);
        b.add('truss', tubeAt(a.clone().lerp(c, 0.5), radial(phi), 0.13, a.distanceTo(c), 6, { uv: false }), false);
        b.add('metalDark', tubeAt(radial(phi).multiplyScalar(R - r + 0.05), radial(phi), 0.3, 0.3, 8, { uv: false }), false);
      }
    }
    // cable bundles riding on the utility ring
    for (const [x, rad] of [[-1.72, Ri], [1.72, Ri], [0.25, Ri - 1.55], [-0.25, Ri - 1.55]]) b.add('cable', torusAt(V(x, 0, 0), X_AXIS, rad, 0.05, 5, 160), false);
    for (let k = 0; k < 24; k++) {
      const p0 = (k / 24) * Math.PI * 2, p1 = ((k + 1) / 24) * Math.PI * 2;
      this.dynamic.push({ col: Colliders.capsule(radial(p0).multiplyScalar(Ri - 0.6), radial(p1).multiplyScalar(Ri - 0.6), 1.9, 'utilityRing', true) });
    }

    // ----- spokes: pressurised tube + three-longeron lattice, elevator rail and car on spoke 0 -----
    const spokeR = 0.9, spokeIn = hubR + 0.9, spokeOut = R - r + 0.4, latR = 1.35;
    for (let k = 0; k < spokes; k++) {
      const phi = (k / spokes) * Math.PI * 2;
      const dir = radial(phi), s1 = X_AXIS, s2 = tangent(phi);
      const a = dir.clone().multiplyScalar(spokeIn), c = dir.clone().multiplyScalar(spokeOut);
      b.add('truss', tubeAt(a.clone().lerp(c, 0.5), dir, spokeR, spokeOut - spokeIn, 16));
      b.add('mliSilver', tubeAt(dir.clone().multiplyScalar(R * 0.62), dir, spokeR + 0.12, 4.0, 16));
      b.add('mliGold', tubeAt(dir.clone().multiplyScalar(R * 0.3), dir, spokeR + 0.12, 2.6, 16));
      // flanges at both ends, hazard band at the rim end, collar where the spoke crosses the utility ring
      b.add('metalDark', tubeAt(dir.clone().multiplyScalar(spokeIn + 0.6), dir, spokeR + 0.5, 1.2, 16), false);
      b.add('metalDark', tubeAt(dir.clone().multiplyScalar(spokeOut - 0.6), dir, spokeR + 0.5, 1.2, 16), false);
      b.add('hazard', tubeAt(dir.clone().multiplyScalar(spokeOut - 1.6), dir, spokeR + 0.08, 0.6, 16, { uv: false }), false);
      b.add('metalDark', tubeAt(dir.clone().multiplyScalar(Ri - 0.5), dir, latR + 0.35, 1.2, 12, { uv: false }), false);
      // lattice: longerons at 90/210/330 degrees around the spoke axis (the +X side stays free for the elevator)
      const offs = [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6].map((ang) => s1.clone().multiplyScalar(latR * Math.cos(ang)).addScaledVector(s2, latR * Math.sin(ang)));
      const t0 = spokeIn + 1.3, t1 = spokeOut - 1.3, nb = Math.round((t1 - t0) / 2.4);
      for (const o of offs) members.addSegment(dir.clone().multiplyScalar(t0).add(o), dir.clone().multiplyScalar(t1).add(o), 0.06);
      for (let i = 0; i <= nb; i++) {
        const t = t0 + (i / nb) * (t1 - t0), tn = t0 + ((i + 1) / nb) * (t1 - t0);
        for (let j = 0; j < 3; j++) {
          const p = dir.clone().multiplyScalar(t).add(offs[j]), pn = dir.clone().multiplyScalar(t).add(offs[(j + 1) % 3]);
          members.addSegment(p, pn, 0.035);
          if (i < nb) members.addSegment(p, dir.clone().multiplyScalar(tn).add(offs[(j + 1) % 3]), 0.03);
        }
      }
      // cable pair alongside the tube
      for (const s of [-1, 1]) b.add('cable', tubeAt(a.clone().lerp(c, 0.5).addScaledVector(s2, s * (spokeR + 0.1)), dir, 0.05, spokeOut - spokeIn, 6, { uv: false }), false);
      // elevator rail (+X side) and car on spoke 0, rail only on the others
      b.add('metalBare', boxAt(dir.clone().multiplyScalar((t0 + t1) / 2).addScaledVector(s1, latR), 0.28, t1 - t0, 0.5, _q.setFromAxisAngle(X_AXIS, phi)), false);
      if (k === 0) {
        const cc = dir.clone().multiplyScalar(R * 0.55).addScaledVector(s1, latR + 0.75);
        b.add('mliGold', boxAt(cc, 1.3, 2.6, 1.8, _q.setFromAxisAngle(X_AXIS, phi)));
        b.add('windowGlow', boxAt(cc.clone().addScaledVector(s1, 0.66), 0.03, 0.5, 1.2, _q.setFromAxisAngle(X_AXIS, phi)), false);
        b.add('hazard', boxAt(cc.clone().addScaledVector(dir, 1.32), 1.32, 0.05, 1.82, _q.setFromAxisAngle(X_AXIS, phi), false), false);
      }
      this.dynamic.push({ col: Colliders.capsule(a, c, latR + 0.15, 'spoke', true) });

      // ----- sector pod at the rim junction: drum with axis X wrapping the torus -----
      const pc = dir.clone().multiplyScalar(R), PR = 4.7, PL = 8.4;
      b.add('hullWhiteAged', tubeAt(pc, X_AXIS, PR, PL, 40));
      b.add('mliGold', tubeAt(V(-3.3, pc.y, pc.z), X_AXIS, PR + 0.06, 1.0, 40));
      b.add('mliGold', tubeAt(V(3.3, pc.y, pc.z), X_AXIS, PR + 0.06, 1.0, 40));
      for (const x of [-2.4, -0.8, 0.8, 2.4]) b.add('metalDark', torusAt(V(x, pc.y, pc.z), X_AXIS, PR + 0.02, 0.05, 5, 40), false);
      for (const sx of [-1, 1]) {
        b.add('metalDark', torusAt(V(sx * PL / 2, pc.y, pc.z), X_AXIS, PR - 0.2, 0.14, 6, 40), false);
        b.add('hazard', torusAt(V(sx * (PL / 2 + 0.01), pc.y, pc.z), X_AXIS, 1.05, 0.12, 5, 24), false);
        b.add('metalDark', tubeAt(V(sx * (PL / 2 + 0.05), pc.y, pc.z), X_AXIS, 0.9, 0.12, 24, { uv: false }), false);   // end hatch
        b.add('metalBare', torusAt(V(sx * (PL / 2 + 0.12), pc.y, pc.z), X_AXIS, 0.3, 0.035, 5, 16), false);
        // three portholes on each end face along the tangent
        for (const off of [-2.6, 0, 2.6]) {
          const wc = pc.clone().addScaledVector(s2, off).addScaledVector(dir, 2.4).setX(sx * PL / 2);
          b.add('metalDark', torusAt(wc, X_AXIS, 0.4, 0.05, 5, 20), false);
          b.add('windowGlow', tubeAt(wc.clone().setX(sx * (PL / 2 - 0.08)), X_AXIS, 0.34, 0.04, 20, { uv: false }), false);
          b.add('glass', tubeAt(wc.clone().setX(sx * (PL / 2 + 0.02)), X_AXIS, 0.34, 0.02, 20, { uv: false }), false);
        }
      }
      // outer-face equipment on the pod: antenna stub, light mast, grapple fixture
      const top = pc.clone().addScaledVector(dir, PR);
      b.add('antennaWhite', tubeAt(top.clone().addScaledVector(dir, 0.6).addScaledVector(s2, 2.6), dir, 0.03, 1.2, 6, { uv: false }), false);
      b.add('metalDark', boxAt(top.clone().addScaledVector(dir, 0.15).addScaledVector(s2, -2.6), 0.6, 0.3, 0.6, _q.setFromAxisAngle(X_AXIS, phi)), false);
      b.add('metalBare', tubeAt(top.clone().addScaledVector(dir, 0.35).addScaledVector(s1, 2.0), dir, 0.07, 0.5, 8, { uv: false }), false);
      b.add('metalDark', torusAt(top.clone().addScaledVector(dir, 0.55).addScaledVector(s1, 2.0), dir, 0.16, 0.035, 6, 16), false);
      // sector label on the outer face
      b.labelAt(`СЕКТОР ${k + 1}`, 2.6, 0.4, top.clone().addScaledVector(dir, 0.04), dir, { right: s2, width: 1024 });
      this.dynamic.push({ col: Colliders.capsule(V(-PL / 2, pc.y, pc.z), V(PL / 2, pc.y, pc.z), PR + 0.2, 'sectorPod', true) });
    }
    members.build(this.group);

    // ----- counterweights between spokes on the outer rim -----
    for (let k = 0; k < spokes; k++) {
      const phi = ((k + 0.5) / spokes) * Math.PI * 2;
      const dir = radial(phi);
      const c = dir.clone().multiplyScalar(R + r + 0.7);
      const q = _q.setFromAxisAngle(X_AXIS, phi);
      b.add('mliBlack', boxAt(c, 2.6, 1.3, 2.6, q));
      b.add('hazard', boxAt(dir.clone().multiplyScalar(R + r + 1.38), 2.7, 0.06, 2.7, q, false), false);
      b.add('metalBare', boxAt(dir.clone().multiplyScalar(R + r + 0.05), 1.0, 0.12, 3.2, q), false);
      for (const sx of [-1, 1]) b.add('metalDark', boxAt(c.clone().addScaledVector(X_AXIS, sx * 1.4), 0.2, 1.0, 2.0, q), false);
      this.dynamic.push({ col: Colliders.sphere(c, 1.9, 'counterweight', true) });
    }
    // ----- rotating collar on the hub (bearing) -----
    b.add('mliSilver', tubeAt(V(0, 0, 0), X_AXIS, hubR + 0.8, 4.0, 48));
    b.add('metalBare', torusAt(V(-2.05, 0, 0), X_AXIS, hubR + 0.6, 0.22, 8, 48), false);
    b.add('metalBare', torusAt(V(2.05, 0, 0), X_AXIS, hubR + 0.6, 0.22, 8, 48), false);
    for (let k = 0; k < 24; k++) {
      const phi = (k / 24) * Math.PI * 2;
      b.add('metalDark', boxAt(V(0, (hubR + 0.82) * Math.cos(phi), (hubR + 0.82) * Math.sin(phi)), 3.6, 0.12, 0.5, _q.setFromAxisAngle(X_AXIS, phi)), false);
    }
    // name on both sides of the rim between sectors (four places)
    for (let k = 0; k < 4; k++) {
      const phi = (k / 4) * Math.PI * 2 + Math.PI / 6 + Math.PI / 12;
      const right = tangent(phi);
      for (const sx of [-1, 1]) {
        const c = radial(phi).multiplyScalar(R + 1.9).setX(sx * (r - 0.55));
        b.labelAt(sx > 0 ? LAYOUT.stationName : LAYOUT.stationNameLatin, 4.2, 0.55, c, V(sx, 0, 0), { right: right.clone().multiplyScalar(sx), width: 1024 });
      }
    }
    // rotating nav strobe heads at the pods' outer points (Lights adds the halos)
    this.strobePositions = [];
    for (let k = 0; k < spokes; k++) {
      const phi = (k / spokes) * Math.PI * 2;
      this.strobePositions.push(radial(phi).multiplyScalar(R + 4.7 + 0.3).addScaledVector(X_AXIS, -2.0));
    }
    b.build(this.group, { name: 'ring' });

    // rim colliders: 24 chords
    const nRim = 24;
    for (let k = 0; k < nRim; k++) {
      const p0 = (k / nRim) * Math.PI * 2, p1 = ((k + 1) / nRim) * Math.PI * 2;
      this.dynamic.push({ col: Colliders.capsule(radial(p0).multiplyScalar(R), radial(p1).multiplyScalar(R), r + 0.35, 'rim', true) });
    }
    // remember local (unrotated) endpoints; world positions are written in update()
    for (const d of this.dynamic) {
      const col = d.col;
      if (col.type === 'capsule') { d.la = col.a.clone(); d.lb = col.b.clone(); }
      else { d.la = col.center.clone(); d.lb = null; }
    }
    this.colliders = this.dynamic.map((d) => d.col);
    // surface motion for contacts: the ring spins about the spine (X) through its hub
    this.omega = new THREE.Vector3(this.angularSpeed, 0, 0);
    this.pivot = new THREE.Vector3(LAYOUT.ringX, 0, 0);
    for (const col of this.colliders) { col.omega = this.omega; col.pivot = this.pivot; }

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
    // drive motors / bearing housings around the drum
    for (let k = 0; k < 8; k++) {
      const phi = (k / 8) * Math.PI * 2 + Math.PI / 8;
      for (const sx of [-1, 1]) bStatic.add('metalDark', boxAt(V(X0 + sx * 3.6, (hubR + 0.3) * Math.cos(phi), (hubR + 0.3) * Math.sin(phi)), 1.6, 0.6, 0.9, _q.setFromAxisAngle(X_AXIS, phi)), false);
    }
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
