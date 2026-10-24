import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { Builder, Instancer, unitCylinder, boxAt, bevelBoxAt, bevelBox, tubeAt, torusAt, domeAt, latheAt, scaleUV, Colliders, X_AXIS, Y_AXIS, TEX_M } from './Builder.js';
import { COL, boltCircle, radialBolts, vent } from './Detail.js';
import { grappleFixture } from './Hardware.js';

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
    const D = bStatic.detail;           // close-range hardware (null on 'lite'); anchored to the rotating group
    if (D) D.anchor = this.group;
    const _M = new THREE.Matrix4();
    /** Frame on the rim tube at angle phi around the ring, angle psi around the tube (0 = outward), tube radius rho. */
    const tubeFrame = (phi, psi, rho, out = _M) => {
      const rad = radial(phi), tan = tangent(phi);
      const n = rad.clone().multiplyScalar(Math.cos(psi)).addScaledVector(X_AXIS, Math.sin(psi));
      const p = rad.clone().multiplyScalar(R).addScaledVector(n, rho);
      return out.makeBasis(tan, n, tan.clone().cross(n)).setPosition(p);
    };
    this.dynamic = [];
    /**
     * Closed slab on the rim tube: phi (around the ring) x psi (around the tube, 0 = outward, pi = toward the axis)
     * between tube radii rho0 and rho1 — panels that hug the torus.
     */
    const torusSlab = (phiA, phiB, psiA, psiB, rho0, rho1, nPhi = 3, nPsi = 6) => {
      const pos = [], nor = [], uv = [], idx = [];
      const P = (ph, ps, rho) => { const rad = V(0, Math.cos(ph), Math.sin(ph)); const n = rad.clone().multiplyScalar(Math.cos(ps)).addScaledVector(X_AXIS, Math.sin(ps)); return rad.multiplyScalar(R).addScaledVector(n, rho); };
      const Nn = (ph, ps) => V(0, Math.cos(ph), Math.sin(ph)).multiplyScalar(Math.cos(ps)).addScaledVector(X_AXIS, Math.sin(ps));
      const grid = (rho, sgn) => {
        const base = pos.length / 3;
        for (let i = 0; i <= nPhi; i++) for (let j = 0; j <= nPsi; j++) {
          const ph = phiA + (phiB - phiA) * i / nPhi, ps = psiA + (psiB - psiA) * j / nPsi;
          const p = P(ph, ps, rho), n = Nn(ph, ps).multiplyScalar(sgn);
          pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push((ph - phiA) * (R + rho) / TEX_M, (ps - psiA) * rho / TEX_M);
        }
        for (let i = 0; i < nPhi; i++) for (let j = 0; j < nPsi; j++) { const a0 = base + i * (nPsi + 1) + j, a1 = a0 + nPsi + 1; idx.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1); }
      };
      grid(rho1, 1); grid(rho0, -1);
      const wall = (pts, n) => { const base = pos.length / 3; for (const p of pts) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(0, 0); } idx.push(base, base + 1, base + 2, base, base + 2, base + 3); };
      for (const [ph, sg] of [[phiA, -1], [phiB, 1]]) for (let j = 0; j < nPsi; j++) {
        const ps0 = psiA + (psiB - psiA) * j / nPsi, ps1 = psiA + (psiB - psiA) * (j + 1) / nPsi;
        wall([P(ph, ps0, rho0), P(ph, ps1, rho0), P(ph, ps1, rho1), P(ph, ps0, rho1)], V(0, -Math.sin(ph), Math.cos(ph)).multiplyScalar(sg));
      }
      for (const [ps, sg] of [[psiA, -1], [psiB, 1]]) for (let i = 0; i < nPhi; i++) {
        const ph0 = phiA + (phiB - phiA) * i / nPhi, ph1 = phiA + (phiB - phiA) * (i + 1) / nPhi;
        const t = V(0, Math.cos((ph0 + ph1) / 2), Math.sin((ph0 + ph1) / 2)).multiplyScalar(-Math.sin(ps)).addScaledVector(X_AXIS, Math.cos(ps)).multiplyScalar(sg);
        wall([P(ph0, ps, rho0), P(ph1, ps, rho0), P(ph1, ps, rho1), P(ph0, ps, rho1)], t);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      // make every triangle's winding agree with its normal
      const pa = g.attributes.position, na = g.attributes.normal, I = g.index, e1 = V(0, 0, 0), e2 = V(0, 0, 0), vA = V(0, 0, 0), fn = V(0, 0, 0), vn = V(0, 0, 0);
      for (let k = 0; k < I.count; k += 3) {
        vA.fromBufferAttribute(pa, I.getX(k)); e1.fromBufferAttribute(pa, I.getX(k + 1)).sub(vA); e2.fromBufferAttribute(pa, I.getX(k + 2)).sub(vA);
        fn.crossVectors(e1, e2); vn.fromBufferAttribute(na, I.getX(k));
        if (fn.dot(vn) < 0) { const t = I.getX(k + 1); I.setX(k + 1, I.getX(k + 2)); I.setX(k + 2, t); }
      }
      g.computeBoundingSphere();
      return g;
    };
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
      if (D) for (let j = 0; j < 40; j++) {
        const psi = (j / 40) * Math.PI * 2;
        if (Math.abs(Math.sin(psi)) > 0.93) continue;   // window strips on the side faces
        D.bolt(tubeFrame(phi, psi, r + 0.06 + (k % 4 === 0 ? 0.11 : 0.07)), 0.016, 0.012, COL.bare, k % 4 === 0 ? 'mid' : 'fine');
      }
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
        // curved panels that follow the tube (flat boxes floated up to 0.28 m off the torus at their edges)
        const dphiI = (0.06 / (R - r)), dphiO = (0.09 / (R + r));
        b.add('radiator', torusSlab(phi - segLen / 2 + dphiI, phi + segLen / 2 - dphiI, Math.PI - 1.2 / r, Math.PI + 1.2 / r, r - 0.02, r + 0.07));
        b.add('hullWhiteAged', torusSlab(phi - segLen / 2 + dphiO, phi + segLen / 2 - dphiO, -1.4 / r, 1.4 / r, r - 0.02, r + 0.05));
      }
      if (pod) continue;
      const chord = R * segLen - 0.16;
      for (const sx of [-1, 1]) {
        const c = radial(phi).multiplyScalar(R).setX(sx * (r + 0.02));
        // window frame: two chamfered rails and end mullions around a recessed pane (glass 3 cm below the frame
        // face, interior glow behind it) — a closed frame, no coplanar faces
        for (const sy of [-1, 1]) b.add('metalDark', bevelBoxAt(c.clone().addScaledVector(radial(phi), sy * 0.33), 0.1, 0.12, chord, q, 0.02), false);
        for (const sz of [-1, 1]) b.add('metalDark', bevelBoxAt(c.clone().addScaledVector(tangent(phi), sz * (chord / 2 - 0.05)), 0.1, 0.56, 0.1, q, 0.02), false);
        b.add('windowGlow', boxAt(V(sx * (r - 0.02), c.y, c.z), 0.06, 0.56, chord - 0.1, q), false);
        b.add('glass', boxAt(V(sx * (r + 0.035), c.y, c.z), 0.012, 0.56, chord - 0.1, q), false);
        // small equipment / vent boxes above the window line every other segment
        if (k % 2 === 0) b.add('paintGray', bevelBoxAt(V(sx * (r - 0.35), c.y, c.z).addScaledVector(radial(phi), 1.3), 0.4, 0.28, 0.6, q, 0.03), false);
      }
      // skylights on the inner face flanking the radiator band (every third segment)
      if (k % 3 === 1) for (const sx of [-1, 1]) {
        // frame on the tube surface (local X along the ring, Y out of the tube, Z across), pane recessed 6 cm
        const F = tubeFrame(phi, Math.PI - Math.asin(sx * 1.95 / r), r, new THREE.Matrix4());
        for (const sa of [-1, 1]) b.add('metalDark', bevelBox(1.1, 0.1, 0.1, 0.02).translate(0, 0.04, sa * 0.3).applyMatrix4(F), false);
        for (const sz of [-1, 1]) b.add('metalDark', bevelBox(0.1, 0.1, 0.5, 0.02).translate(sz * 0.5, 0.04, 0).applyMatrix4(F), false);
        b.add('windowGlow', new THREE.BoxGeometry(0.92, 0.04, 0.52).translate(0, -0.03, 0).applyMatrix4(F), false);
        b.add('glass', new THREE.BoxGeometry(0.92, 0.012, 0.52).translate(0, 0.03, 0).applyMatrix4(F), false);
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
    for (const [x, rad] of [[-1.69, Ri], [1.69, Ri], [0.17, Ri - 1.5], [-0.17, Ri - 1.5]]) b.add('cable', torusAt(V(x, 0, 0), X_AXIS, rad, 0.05, 5, 160), false);   // resting on the lattice tori
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
      b.add('metalBare', bevelBoxAt(dir.clone().multiplyScalar((t0 + t1) / 2).addScaledVector(s1, latR), 0.28, t1 - t0, 0.5, _q.setFromAxisAngle(X_AXIS, phi)), false);
      if (k === 0) {
        const cc = dir.clone().multiplyScalar(R * 0.55).addScaledVector(s1, latR + 0.75);
        b.add('mliGold', bevelBoxAt(cc, 1.3, 2.6, 1.8, _q.setFromAxisAngle(X_AXIS, phi)));
        b.add('windowGlow', boxAt(cc.clone().addScaledVector(s1, 0.66), 0.03, 0.5, 1.2, _q.setFromAxisAngle(X_AXIS, phi)), false);
        b.add('hazard', boxAt(cc.clone().addScaledVector(dir, 1.32), 1.32, 0.05, 1.82, _q.setFromAxisAngle(X_AXIS, phi), false), false);
      }
      this.dynamic.push({ col: Colliders.capsule(a, c, latR + 0.15, 'spoke', true) });
      if (D) {
        // spoke joints: bolted flanges at the hub collar and the rim, gussets, bolt rings on the end flanges
        for (const [t, sg] of [[spokeIn + 1.2, 1], [spokeOut - 1.2, -1]]) {
          const c0 = dir.clone().multiplyScalar(t);
          b.add('metalBare', latheAt(c0, dir.clone().multiplyScalar(sg), [[spokeR, -0.05], [spokeR + 0.68, -0.03], [spokeR + 0.68, 0.06], [spokeR + 0.5, 0.12], [spokeR, 0.14]], 32));
          const Mf = new THREE.Matrix4().compose(c0, new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.clone().multiplyScalar(sg)), V(1, 1, 1));
          boltCircle(D, Mf, spokeR + 0.58, 24, 0.12, 0.018, 0.013, COL.bare, 'mid');
          radialBolts(D, Mf, spokeR + 0.68, 32, 0.0, 0.014, 0.01);
          for (let j = 0; j < 4; j++) {
            const a2 = (j / 4) * Math.PI * 2 + Math.PI / 4;
            const g = s1.clone().multiplyScalar(Math.cos(a2)).addScaledVector(s2, Math.sin(a2));
            const qg = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(g.clone().cross(dir), dir, g.clone().cross(dir).cross(dir)));
            b.add('metalBare', bevelBoxAt(c0.clone().addScaledVector(dir, sg * 0.35).addScaledVector(g, spokeR + 0.12), 0.04, 0.5, 0.26, qg, 0.01), false);
          }
        }
        // ring frames along the pressurised spoke tube
        for (let t = spokeIn + 2.4; t < spokeOut - 2.0; t += 2.0) {
          if (Math.abs(t - R * 0.62) < 2.2 || Math.abs(t - R * 0.3) < 1.5) continue;
          b.add('hullWhiteAged', latheAt(dir.clone().multiplyScalar(t), dir, [[spokeR, -0.06], [spokeR + 0.03, -0.045], [spokeR + 0.03, 0.045], [spokeR, 0.06]], 24), false);
          radialBolts(D, new THREE.Matrix4().compose(dir.clone().multiplyScalar(t), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir), V(1, 1, 1)), spokeR + 0.03, 18, 0, 0.01, 0.007);
        }
      }

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
      b.add('metalDark', bevelBoxAt(top.clone().addScaledVector(dir, 0.15).addScaledVector(s2, -2.6), 0.6, 0.3, 0.6, _q.setFromAxisAngle(X_AXIS, phi)), false);
      if (D) {
        grappleFixture(b, D, new THREE.Matrix4().makeBasis(s2, dir, s2.clone().cross(dir)).setPosition(top.clone().addScaledVector(dir, 0.0).addScaledVector(s1, 2.0)));
        // pod end flanges: bolt circles, weld lands with fastener rows, vents on the outer face
        for (const sx of [-1, 1]) {
          const Me = new THREE.Matrix4().compose(V(sx * PL / 2, pc.y, pc.z), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, V(sx, 0, 0)), V(1, 1, 1));
          boltCircle(D, Me, PR - 0.45, 56, 0.0, 0.016, 0.012);
          boltCircle(D, Me, 1.25, 20, 0.02, 0.012, 0.009);
          radialBolts(D, Me, PR, 80, -0.12, 0.014, 0.01);
        }
        for (const x of [-2.4, -0.8, 0.8, 2.4]) radialBolts(D, new THREE.Matrix4().compose(V(x, pc.y, pc.z), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, X_AXIS), V(1, 1, 1)), PR + 0.04, 72, 0, 0.011, 0.008, COL.bare, 'fine', 0.02);
        for (const off of [-1.2, 1.2]) vent(D, new THREE.Matrix4().makeBasis(s2, dir, s2.clone().cross(dir)).setPosition(top.clone().addScaledVector(s1, off * 2.6).addScaledVector(s2, 1.2)), 0.6, 0.4, 7);
      } else {
        b.add('metalBare', tubeAt(top.clone().addScaledVector(dir, 0.35).addScaledVector(s1, 2.0), dir, 0.07, 0.5, 8, { uv: false }), false);
        b.add('metalDark', torusAt(top.clone().addScaledVector(dir, 0.55).addScaledVector(s1, 2.0), dir, 0.16, 0.035, 6, 16), false);
      }
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
      b.add('mliBlack', bevelBoxAt(c, 2.6, 1.3, 2.6, q));
      b.add('hazard', boxAt(dir.clone().multiplyScalar(R + r + 1.38), 2.7, 0.06, 2.7, q, false), false);
      b.add('metalBare', bevelBoxAt(dir.clone().multiplyScalar(R + r + 0.05), 1.0, 0.12, 3.2, q), false);
      for (const sx of [-1, 1]) b.add('metalDark', bevelBoxAt(c.clone().addScaledVector(X_AXIS, sx * 1.4), 0.2, 1.0, 2.0, q), false);
      this.dynamic.push({ col: Colliders.sphere(c, 1.9, 'counterweight', true) });
    }
    if (D) {
      // counterweight fasteners
      for (let k = 0; k < spokes; k++) {
        const phi = ((k + 0.5) / spokes) * Math.PI * 2, dir = radial(phi);
        const Mc = new THREE.Matrix4().makeBasis(X_AXIS, dir, X_AXIS.clone().cross(dir)).setPosition(dir.clone().multiplyScalar(R + r + 1.41));
        for (const a of [-1.15, -0.4, 0.4, 1.15]) for (const z of [-1.15, 1.15]) { D.bolt(Mc.clone().multiply(new THREE.Matrix4().makeTranslation(a, 0, z)), 0.03, 0.02, COL.bare, 'mid'); D.bolt(Mc.clone().multiply(new THREE.Matrix4().makeTranslation(z, 0, a)), 0.03, 0.02, COL.bare, 'mid'); }
      }
      // collar races: bolt rings
      for (const sx of [-2.05, 2.05]) radialBolts(D, new THREE.Matrix4().compose(V(sx, 0, 0), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, X_AXIS), V(1, 1, 1)), hubR + 0.82, 96, 0, 0.016, 0.012);
      D.anchor = null;
    }
    // ----- rotating collar on the hub (bearing) -----
    b.add('mliSilver', tubeAt(V(0, 0, 0), X_AXIS, hubR + 0.8, 4.0, 48));
    b.add('metalBare', torusAt(V(-2.05, 0, 0), X_AXIS, hubR + 0.6, 0.22, 8, 48), false);
    b.add('metalBare', torusAt(V(2.05, 0, 0), X_AXIS, hubR + 0.6, 0.22, 8, 48), false);
    for (let k = 0; k < 24; k++) {
      const phi = (k / 24) * Math.PI * 2;
      b.add('metalDark', bevelBoxAt(V(0, (hubR + 0.82) * Math.cos(phi), (hubR + 0.82) * Math.sin(phi)), 3.6, 0.12, 0.5, _q.setFromAxisAngle(X_AXIS, phi)), false);
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
    if (D) {
      // static drum: flange bolt rings at the bosses and around the bearing gap, motor mounting bolts
      for (const sx of [-1, 1]) {
        const Mb = new THREE.Matrix4().compose(V(X0 + sx * 6.8, 0, 0), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, V(sx, 0, 0)), V(1, 1, 1));
        boltCircle(D, Mb, 3.05, 64, 0, 0.018, 0.013);
        radialBolts(D, new THREE.Matrix4().compose(V(X0 + sx * 2.1, 0, 0), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, X_AXIS), V(1, 1, 1)), hubR, 96, 0, 0.016, 0.012);
        radialBolts(D, new THREE.Matrix4().compose(V(X0 + sx * 5.1, 0, 0), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, X_AXIS), V(1, 1, 1)), hubR, 96, 0, 0.016, 0.012);
      }
    }
    // drive motors / bearing housings around the drum
    for (let k = 0; k < 8; k++) {
      const phi = (k / 8) * Math.PI * 2 + Math.PI / 8;
      for (const sx of [-1, 1]) bStatic.add('metalDark', bevelBoxAt(V(X0 + sx * 3.6, (hubR + 0.3) * Math.cos(phi), (hubR + 0.3) * Math.sin(phi)), 1.6, 0.6, 0.9, _q.setFromAxisAngle(X_AXIS, phi)), false);
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
