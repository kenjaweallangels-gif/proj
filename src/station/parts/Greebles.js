import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { boxAt, bevelBoxAt, bevelBox, tubeAt, torusAt, latheAt, sphereAt, mat, scaleUV, Colliders, X_AXIS, Y_AXIS, Z_AXIS } from './Builder.js';
import { COL, boltCircle, radialBolts, boltRow, connectorPanel, standoffFoot } from './Detail.js';
import { domeAt } from './Builder.js';
import { grappleFixture } from './Hardware.js';
import { conformLatheAt } from './HullKit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const CY = LAYOUT.clusterY;
const NEG_Y = V(0, -1, 0), NEG_Z = V(0, 0, -1), NEG_X = V(-1, 0, 0);

function at(geo, surface, local = null) { if (local) geo.applyMatrix4(local); return geo.applyMatrix4(surface); }

/**
 * Secondary detail on the pressurised cluster and the truss: external experiment pallets, propellant tank
 * clusters, cable trays across the nodes, side hatches, vents, module numbers, grapple fixtures, pylon
 * handrails (EVA path cluster -> truss), a stowed robotic arm and a mobile transporter cart.
 * Everything is merged by the shared Builder; returns extra colliders.
 */
export function buildGreebles(ctx, station, b, rails, mods) {
  const colliders = [];
  const D = b.detail;     // close-range hardware (null on 'lite')
  const { lab, hab2, power, logi, hab1, med, green } = { lab: mods.hulls.lab, hab2: mods.hulls.hab2, power: mods.power, logi: mods.logi, hab1: mods.hab1, med: mods.med, green: mods.green };
  const h = LAYOUT.spineSize / 2;

  /** Exposed experiment pallet: open frame on four legs with a few instrument boxes on top. */
  function pallet(H, t, dir, seed) {
    const th = H.thetaFor(dir);
    const s = H.surface(t, th, H.r + 0.55, new THREE.Matrix4());
    // chamfered boxes on GPU presets (plain boxes on 'lite')
    const BX = (w, hh, d) => (D ? bevelBox(w, hh, d, Math.min(w, hh, d) * 0.12) : new THREE.BoxGeometry(w, hh, d));
    b.add('truss', at(BX(2.4, 0.12, 1.7), s), false);
    // legs down to the curved hull (the hull drops away from the pallet centre line: y = sqrt(r² - x²) - rho)
    const footY = (dx) => Math.sqrt(H.r * H.r - dx * dx) - (H.r + 0.55);
    for (const [dx, dz] of [[-1.05, -0.7], [1.05, -0.7], [-1.05, 0.7], [1.05, 0.7]]) {
      const fy = footY(dx), L = -0.04 - fy;
      b.add('metalDark', at(new THREE.CylinderGeometry(0.05, 0.05, L, 8).translate(dx, fy + L / 2, dz), s), false);
      b.add('metalDark', at(BX(0.16, 0.08, 0.16).translate(dx, 0.1, dz), s), false);
      b.add('metalDark', at(BX(0.2, 0.05, 0.2).translate(dx, fy + 0.005, dz), s), false);
    }
    // frame rails
    for (const dz of [-0.8, 0.8]) b.add('metalDark', at(BX(2.4, 0.08, 0.08).translate(0, 0.1, dz), s), false);
    for (const dx of [-1.15, 1.15]) b.add('metalDark', at(BX(0.08, 0.08, 1.7).translate(dx, 0.1, 0), s), false);
    // instruments (vary with seed)
    const kit = [
      ['mliGold', 0.7, 0.5, 0.6, -0.7, 0.35, 0.3], ['paintGray', 0.5, 0.35, 0.5, 0.25, 0.28, -0.4], ['mliBlack', 0.4, 0.6, 0.4, 0.85, 0.4, 0.35],
      ['metalBare', 0.3, 0.3, 0.3, 0.2, 0.25, 0.45], ['hullWhiteAged', 0.9, 0.25, 0.45, -0.4, 0.22, -0.45],
    ];
    for (let i = 0; i < kit.length; i++) {
      const [mn, w, hh, d, x, y, z] = kit[(i + seed) % kit.length];
      b.add(mn, at(BX(w, hh, d).translate(x + 0.08 * seed, y, z), s), false);
    }
    // a small aperture / sensor on the gold box and a cable to the hull
    b.add('metalDark', at(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 12).translate(-0.7, 0.66, 0.3), s), false);
    b.add('cable', at(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 5).rotateX(Math.PI / 2).translate(1.0, -0.1, -0.2).applyMatrix4(_m.makeRotationZ(0.6)), s), false);
    if (D) {
      for (const [dx, dz] of [[-1.05, -0.7], [1.05, -0.7], [-1.05, 0.7], [1.05, 0.7]]) {
        standoffFoot(D, s.clone().multiply(new THREE.Matrix4().makeTranslation(dx, footY(dx) + 0.03, dz)), 0.16, 0.05, 'mid');
        boltRow(D, s, dx - 0.05, dz - 0.05, dx + 0.05, dz + 0.05, 2, 0.14, 0.012, 0.009);
      }
      for (const dz of [-0.8, 0.8]) boltRow(D, s, -1.1, dz, 1.1, dz, 8, 0.14, 0.01, 0.007);
      connectorPanel(D, s.clone().multiply(new THREE.Matrix4().makeTranslation(0.6, 0.06, 0.55)), 0.4, 0.22, 3, 1, seed);
      D.rod('mid', 'paint', COL.black, H.point(t - 0.6, th, H.r + 0.6), H.point(t - 0.6, th, H.r + 0.02), 0.025, 'cyl6');
    }
    colliders.push(Colliders.box(H.point(t, th, H.r + 0.75), V(1.3, 0.75, 0.95), _q.setFromRotationMatrix(s), 'pallet'));
  }
  pallet(lab, -3.6, NEG_Z, 0);
  pallet(lab, 3.4, NEG_Z, 2);
  pallet(hab2, 1.5, NEG_Z, 1);

  /** Propellant / gas tank cluster: spheres in a cradle with straps, under a half shroud. */
  function tanks(H, t, dir, n) {
    const th = H.thetaFor(dir);
    for (let i = 0; i < n; i++) {
      const tt = t + (i - (n - 1) / 2) * 1.45;
      const s = H.surface(tt, th, H.r + 0.72, new THREE.Matrix4());
      b.add('mliSilver', at(new THREE.SphereGeometry(0.58, 18, 12), s), false);
      b.add('metalDark', at(new THREE.TorusGeometry(0.6, 0.035, 5, 24).rotateX(Math.PI / 2), s), false);
      b.add('metalDark', at(new THREE.TorusGeometry(0.6, 0.035, 5, 24), s), false);
      b.add('metalDark', at(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 8).translate(0, -0.45, 0), s), false);
      b.add('copper', at(new THREE.CylinderGeometry(0.03, 0.03, 1.45, 5).rotateX(Math.PI / 2).translate(0.3, 0.1, 0), s), false);
      if (D) {
        // strap buckles, boss + valve on top, pipe clamps
        for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) D.part('mid', 'metal', COL.bare, 'bbox', s, 0.6 * Math.cos(a), 0, 0.6 * Math.sin(a), 0.06, 0.1, 0.06);
        D.part('mid', 'metal', COL.bare, 'cyl12', s, 0, 0.6, 0, 0.09, 0.08, 0.09);
        D.part('mid', 'metal', COL.dark, 'bbox', s, 0.08, 0.68, 0, 0.1, 0.08, 0.06);
        boltCircle(D, s.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.64, 0)), 0.065, 6, 0, 0.01, 0.007);
      }
    }
    const sc = H.surface(t, th, H.r + 0.3, new THREE.Matrix4());
    // cradle plate on saddles that sit on the hull (box local X along the module axis, Z tangential)
    b.add('metalDark', at(bevelBox(1.5, 0.12, n * 1.45 + 0.4, 0.02), sc), false);
    b.add('hazard', at(bevelBox(0.12, 0.04, n * 1.45 + 0.4, 0.01).translate(0.72, 0.08, 0), sc), false);
    for (let i = 0; i <= n; i++) {
      const tt = t + (i - n / 2) * 1.45;
      b.add('metalDark', at(bevelBox(1.3, 0.4, 0.12, 0.02).translate(0, -0.19, 0), H.surface(tt, th, H.r + 0.3, new THREE.Matrix4())), false);
    }
    colliders.push(Colliders.capsule(H.point(t - (n - 1) / 2 * 1.45, th, H.r + 0.72), H.point(t + (n - 1) / 2 * 1.45, th, H.r + 0.72), 0.75, 'tanks'));
  }
  tanks(power, -1.0, NEG_Y, 4);
  tanks(power, -2.0, NEG_Z, 3);
  tanks(logi, 1.0, NEG_Y, 2);

  // cable trays and plumbing crossing the nodes (joining the module tops) + clamps
  for (const n of [mods.nodes.n1, mods.nodes.n2, mods.nodes.n3]) {
    const x = n.center.x, top = CY + n.r;
    for (const [dz, mn, rr] of [[-0.35, 'cable', 0.05], [-0.15, 'copper', 0.04], [0.1, 'metalBare', 0.05], [0.35, 'cable', 0.05]]) {
      b.add(mn, tubeAt(V(x, top + 0.22, dz), X_AXIS, rr, 6.2, 6, { uv: false }), false);
    }
    for (const dx of [-2.4, 0, 2.4]) b.add('metalDark', bevelBoxAt(V(x + dx, top + 0.1, 0), 0.14, 0.42, 1.0, null, 0.02), false);
    // vent grilles on the node sides (on the hull: frame sunk into it, louvre plate on top)
    for (const sz of [-1, 1]) {
      const thv = n.thetaFor(V(0, 1.4 / n.r, sz * Math.sqrt(1 - (1.4 / n.r) ** 2)));
      b.add('metalDark', at(bevelBox(0.5, 0.16, 0.3, 0.02).translate(0, 0.0, 0), n.surface(x - n.center.x + 1.4, thv, n.r + 0.02, new THREE.Matrix4()).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))), false);
      b.add('paintGray', at(bevelBox(0.42, 0.03, 0.22, 0.008), n.surface(x - n.center.x + 1.4, thv, n.r + 0.11, new THREE.Matrix4()).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))), false);
    }
  }

  // round side hatches (EVA / equipment) with a hazard ring on hab1 (+X), medical (-X) and logistics (+Z)
  for (const [H, t, dir] of [[hab1, 0.0, X_AXIS], [med, -0.5, NEG_X], [logi, -1.5, Z_AXIS]]) {
    const th = H.thetaFor(dir);
    const s = H.surface(t, th, H.r, new THREE.Matrix4());
    // hatch door, rim and hazard band wrapped onto the hull (closed solids, no flat discs floating off the curve)
    b.add('hullWhiteAged', conformLatheAt(H, t, th, [[0.62, -0.05], [0.62, 0.05], [0.6, 0.08], [0.5, 0.095], [0.0, 0.1]], 40), false);
    b.add('metalDark', conformLatheAt(H, t, th, [[0.6, -0.05], [0.7, -0.05], [0.7, 0.07], [0.68, 0.09], [0.64, 0.09], [0.62, 0.07], [0.62, -0.05]], 48), false);
    b.add('hazard', scaleUV(conformLatheAt(H, t, th, [[0.7, -0.02], [0.86, -0.02], [0.86, 0.012], [0.7, 0.012], [0.7, -0.02]], 48), 14, 14), false);
    b.add('metalBare', at(new THREE.TorusGeometry(0.2, 0.03, 6, 20).rotateX(Math.PI / 2).translate(0, 0.17, 0), s), false);
    for (const sx of [-1, 1]) b.add('metalBare', at(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8).translate(sx * 0.2, 0.13, 0), s), false);
    b.add('metalDark', conformLatheAt(H, t + 0.25, th + 0.3 / H.r, [[0.12, 0.05], [0.12, 0.1], [0.1, 0.115], [0.0, 0.115]], 20), false);
    b.add('glass', conformLatheAt(H, t + 0.25, th + 0.3 / H.r, [[0.0, 0.118], [0.09, 0.118]], 20), false);
    if (D) {
      boltCircle(D, s, 0.56, 24, 0.07, 0.012, 0.009);
      boltCircle(D, s, 0.74, 28, 0.03, 0.011, 0.008, COL.bare, 'fine', 0.05);
      for (const a of [0, Math.PI]) D.part('mid', 'metal', COL.dark, 'bbox', s, 0.66 * Math.cos(a), 0.07, 0.66 * Math.sin(a), 0.12, 0.08, 0.22);
    }
    for (const a of [0, 1, 2, 3]) rails.addRail(H.point(t + (a < 2 ? -1.1 : 1.1), th + (a % 2 ? 0.28 : -0.28), H.r), H.point(t + (a < 2 ? -1.1 : 1.1), th + (a % 2 ? 0.28 : -0.28) + (a % 2 ? -0.12 : 0.12), H.r), H.normal(th));
  }

  // vents / small boxes scattered on logistics and service hulls
  for (const [H, t, th, w] of [[logi, -2.5, 2.2, 0.4], [logi, 2.0, 4.1, 0.3], [power, -4.5, 2.4, 0.5], [power, 3.5, 3.9, 0.35], [hab2, -3.0, 4.2, 0.4], [hab1, 2.5, 0.9, 0.35]]) {
    const s = H.surface(t, th, H.r, new THREE.Matrix4());
    b.add('metalDark', at(bevelBox(w, 0.2, w * 0.7, 0.02).translate(0, 0.02, 0), s), false);
    b.add('paintGray', at(bevelBox(w - 0.08, 0.03, w * 0.7 - 0.08, 0.008).translate(0, 0.13, 0), s), false);
  }

  // module numbers near the end caps (both sides)
  const numbered = [[logi, '01'], [lab, '03'], [hab2, '05'], [power, '07'], [hab1, '04'], [green, '02'], [med, '06']];
  for (const [H, num] of numbered) {
    for (const side of [1, -1]) {
      const sideDir = new THREE.Vector3().crossVectors(H.dir, Y_AXIS).multiplyScalar(side).addScaledVector(Y_AXIS, -0.35).normalize();
      b.labelAt(num, 0.7, 0.7, H.axisPoint(-H.len / 2 + 1.2).addScaledVector(sideDir, H.r + 0.05), sideDir, { width: 256, height: 256, color: '#2a3340' });
    }
  }

  // grapple fixtures on hab2 (+Y) and the service module (+Z)
  for (const [H, t, dir] of [[hab2, -4.2, Y_AXIS], [power, -4.0, Z_AXIS]]) {
    const th = H.thetaFor(dir);
    const s = H.surface(t, th, H.r + 0.1, new THREE.Matrix4());
    if (D) { grappleFixture(b, D, H.surface(t, th, H.r + 0.06, new THREE.Matrix4())); continue; }
    b.add('metalBare', at(new THREE.BoxGeometry(0.8, 0.08, 0.8), s), false);
    b.add('hazard', at(new THREE.BoxGeometry(0.95, 0.07, 0.95).translate(0, -0.03, 0), s), false);
    b.add('metalBare', at(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 8).translate(0, 0.26, 0), s), false);
    b.add('metalDark', at(new THREE.TorusGeometry(0.16, 0.035, 6, 16).rotateX(Math.PI / 2).translate(0, 0.46, 0), s), false);
  }

  // EVA translation path: handrails up both pylons (cluster -> truss) at four angles
  for (const x of [mods.nodes.n2.center.x, LAYOUT.hubX]) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const n = V(Math.cos(a), 0, Math.sin(a));
      rails.addLine(V(x + 1.1 * n.x, CY + 2.7, 1.1 * n.z), V(x + 1.1 * n.x, -h - 0.3, 1.1 * n.z), n, 1.1, 0.3);
    }
  }

  // ---------- stowed robotic arm on the truss top tray (base grapple at x=26) ----------
  {
    const bx = 26, bz = -1.0, y0 = h + 0.78;
    const armMat = 'hullWhite', jointMat = 'metalDark';
    const joint = (p, axis, rr = 0.36, len = 0.7) => {
      b.add(jointMat, tubeAt(p, axis, rr, len, 16, { uv: false })); b.add('mliGold', torusAt(p, axis, rr + 0.02, 0.08, 6, 24), false);
      if (D) {
        const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, axis);
        for (const e of [-1, 1]) {
          b.add('metalBare', latheAt(p.clone().addScaledVector(axis, e * len / 2), axis.clone().multiplyScalar(e), [[rr * 0.5, -0.02], [rr + 0.03, -0.01], [rr + 0.03, 0.03], [rr * 0.5, 0.04]], 24), false);
          boltCircle(D, new THREE.Matrix4().compose(p.clone().addScaledVector(axis, e * (len / 2 + 0.04)), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, axis.clone().multiplyScalar(e)), V(1, 1, 1)), rr * 0.78, 16, 0, 0.014, 0.01);
        }
        radialBolts(D, new THREE.Matrix4().compose(p, q, V(1, 1, 1)), rr, 20, len * 0.3, 0.012, 0.009);
      }
    };
    const boom = (p0, p1, rr = 0.2) => {
      const d = p1.clone().sub(p0), len = d.length(); d.normalize();
      b.add(armMat, tubeAt(p0.clone().lerp(p1, 0.5), d, rr, len, 14));
      b.add('mliSilver', tubeAt(p0.clone().lerp(p1, 0.5), d, rr + 0.04, len * 0.42, 14));
      for (const e of [0.12, 0.88]) b.add(jointMat, torusAt(p0.clone().lerp(p1, e), d, rr + 0.03, 0.04, 5, 14), false);
      b.add('cable', tubeAt(p0.clone().lerp(p1, 0.5).add(V(0, rr + 0.05, 0)), d, 0.03, len, 5, { uv: false }), false);
      if (D) {
        for (let i = 1; i < 8; i++) D.part('mid', 'metal', COL.bare, 'box', new THREE.Matrix4().compose(p0.clone().lerp(p1, i / 8).add(V(0, rr + 0.045, 0)), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, d), V(1, 1, 1)), 0, 0, 0, 0.08, 0.03, 0.08);
        for (const e of [0.12, 0.88]) radialBolts(D, new THREE.Matrix4().compose(p0.clone().lerp(p1, e), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, d), V(1, 1, 1)), rr + 0.03, 16, 0, 0.01, 0.008);
      }
    };
    const S = V(bx, y0 + 0.5, bz), E = V(bx + 8.0, y0 + 1.2, bz), W = V(bx - 0.5, y0 + 2.0, bz);
    b.add('metalBare', bevelBoxAt(V(bx, y0 + 0.1, bz), 0.9, 0.2, 0.9, null, 0.03), false);
    joint(S, Y_AXIS, 0.42, 0.9);                        // shoulder yaw
    joint(S.clone().add(V(0, 0.55, 0)), Z_AXIS, 0.3, 0.8); // shoulder pitch
    boom(S.clone().add(V(0.4, 0.75, 0)), E.clone().add(V(-0.4, -0.1, 0)));
    joint(E, Z_AXIS, 0.34, 0.9);                        // elbow
    boom(E.clone().add(V(-0.4, 0.45, 0)), W.clone().add(V(0.5, 0.0, 0)));
    joint(W, Z_AXIS, 0.3, 0.8);                         // wrist pitch
    joint(W.clone().add(V(-0.6, 0.0, 0)), X_AXIS, 0.26, 0.6); // wrist roll
    b.add('metalBare', tubeAt(W.clone().add(V(-1.25, 0, 0)), X_AXIS, 0.32, 0.5, 16, { uv: false }), false); // end effector
    b.add('metalDark', torusAt(W.clone().add(V(-1.5, 0, 0)), X_AXIS, 0.3, 0.05, 6, 16), false);
    // camera + light on the elbow and wrist
    b.add('metalDark', tubeAt(E.clone().add(V(0, 0.42, 0.25)), Y_AXIS, 0.03, 0.2, 8, { uv: false }), false);
    b.add('antennaWhite', bevelBoxAt(E.clone().add(V(0, 0.62, 0.25)), 0.22, 0.2, 0.3, null, 0.025), false);
    b.add('rubberBlack', tubeAt(E.clone().add(V(0, 0.62, 0.43)), Z_AXIS, 0.05, 0.08, 12, { uv: false }), false);
    b.add('paintGray', bevelBoxAt(W.clone().add(V(-1.0, 0.36, 0.1)), 0.18, 0.13, 0.18, null, 0.02), false);
    b.add('dockLight', bevelBoxAt(W.clone().add(V(-1.0, 0.36, 0.195)), 0.14, 0.09, 0.012, null, 0.003), false);
    b.add('metalDark', tubeAt(W.clone().add(V(-1.0, 0.27, 0.1)), Y_AXIS, 0.03, 0.1, 8, { uv: false }), false);
    b.labelAt('МАНИПУЛЯТОР', 2.2, 0.28, V(bx + 4.0, y0 + 1.0, bz + 0.26), Z_AXIS, { width: 1024 });
    colliders.push(Colliders.box(V(bx + 3.8, y0 + 1.2, bz), V(4.6, 1.2, 0.5), null, 'robotArm'));
  }

  // ---------- mobile transporter cart on the top tray at x = -52.5 ----------
  {
    const cx = -52.5, y0 = h + 0.72;
    b.add('paintGray', bevelBoxAt(V(cx, y0 + 0.5, 0), 3.0, 0.7, 3.2, null, 0.05));
    b.add('metalDark', bevelBoxAt(V(cx, y0 + 0.9, 0), 2.6, 0.12, 2.8, null, 0.02), false);
    b.add('hazard', bevelBoxAt(V(cx, y0 + 0.5, 0), 3.02, 0.14, 3.22, null, 0.02), false);
    b.add('mliGold', bevelBoxAt(V(cx - 0.6, y0 + 1.31, 0.6), 1.2, 0.7, 1.0, null, 0.05));
    b.add('metalBare', tubeAt(V(cx + 0.8, y0 + 1.36, -0.6), Y_AXIS, 0.07, 0.8, 10, { uv: false }), false);
    b.add('metalDark', torusAt(V(cx + 0.8, y0 + 1.78, -0.6), Y_AXIS, 0.16, 0.035, 6, 16), false);
    // wheels on axles in bogie forks, running on the tray lids
    for (const dx of [-1.1, 1.1]) for (const dz of [-1.35, 1.35]) {
      b.add('rubberBlack', tubeAt(V(cx + dx, y0 + 0.23, dz), Z_AXIS, 0.22, 0.16, 16, { uv: false }), false);
      b.add('metalBare', tubeAt(V(cx + dx, y0 + 0.23, dz), Z_AXIS, 0.06, 0.3, 10, { uv: false }), false);
      b.add('metalDark', bevelBoxAt(V(cx + dx, y0 + 0.24, dz - Math.sign(dz) * 0.13), 0.3, 0.14, 0.04, null, 0.01), false);
    }
    for (const dz of [-1.0, 1.0]) b.add('windowGlow', bevelBoxAt(V(cx + 1.505, y0 + 0.5, dz), 0.02, 0.1, 0.3, null, 0.004), false);
    b.labelAt('ТРАНСПОРТЁР', 2.2, 0.3, V(cx, y0 + 0.5, 1.62), Z_AXIS, { width: 1024 });
    if (D) {
      const Mt = new THREE.Matrix4().makeTranslation(cx, y0 + 0.91, 0);
      for (const z of [-1.3, 1.3]) boltRow(D, Mt, -1.2, z, 1.2, z, 10, 0, 0.014, 0.01);
      for (const x of [-1.2, 1.2]) boltRow(D, Mt, x, -1.1, x, 1.1, 8, 0, 0.014, 0.01);
      connectorPanel(D, new THREE.Matrix4().makeTranslation(cx + 0.5, y0 + 0.91, 0.7), 0.5, 0.3, 3, 2, 4);
    }
    colliders.push(Colliders.box(V(cx, y0 + 0.7, 0), V(1.6, 0.9, 1.7), null, 'transporter'));
  }

  // ---------- external payload carriers under the outboard truss (ELC-style): deck on four trunnion struts from
  // the bottom longerons, payload boxes / tank / antenna / sensor hanging below, grapple fixture, harnesses
  for (const [cx, seed] of [[-71, 0], [58, 1]]) {
    const yDeck = -h - 0.55;
    // trunnion struts: longeron clamp block, strut, deck fitting
    for (const dx of [-1.7, 1.7]) for (const sz of [-1, 1]) {
      const top = V(cx + dx, -h - 0.12, sz * (h - 0.05)), bot = V(cx + dx * 0.9, yDeck + 0.08, sz * 1.15);
      b.add('metalBare', bevelBoxAt(V(cx + dx, -h, sz * h), 0.26, 0.42, 0.42, null, 0.04), false);
      const d = bot.clone().sub(top);
      b.add('truss', tubeAt(top.clone().lerp(bot, 0.5), d.clone().normalize(), 0.06, d.length(), 10, { uv: false }), false);
      b.add('metalBare', bevelBoxAt(bot, 0.18, 0.14, 0.18, null, 0.03), false);
    }
    b.add('hullWhiteAged', bevelBoxAt(V(cx, yDeck, 0), 4.4, 0.16, 2.8, null, 0.04));
    b.add('metalDark', bevelBoxAt(V(cx, yDeck - 0.1, 0), 4.2, 0.05, 2.6, null, 0.015), false);
    // payloads (hanging below the deck)
    const kit = seed ? [['mliGold', -1.2, 0.8, 1.4, 0.9, -0.55], ['mliSilver', 0.6, 1.0, 1.0, 1.1, 0.55], ['betaCloth', 1.5, 0.6, 0.8, 0.6, -0.6]]
      : [['mliSilver', -1.3, 0.9, 1.2, 1.0, 0.5], ['mliGold', 0.3, 0.7, 1.4, 0.8, -0.5], ['hullWhite', 1.55, 0.5, 0.7, 0.7, 0.6]];
    for (const [mn, x, hh, w, d, z] of kit) {
      const c = V(cx + x, yDeck - 0.125 - hh / 2, z);
      b.add(mn, bevelBoxAt(c, w, hh, d, null, 0.05));
      b.add('metalDark', bevelBoxAt(c.clone().setY(yDeck - 0.15), w + 0.1, 0.05, d + 0.1, null, 0.012), false);   // payload interface plate
    }
    // tank in a cradle, small dish antenna on a mast, sensor head
    const tc = V(cx - 0.2, yDeck - 0.65, seed ? 0.75 : -0.85);
    b.add('mliSilver', tubeAt(tc, X_AXIS, 0.32, 1.1, 20), false);
    for (const e of [-1, 1]) b.add('mliSilver', domeAt(tc.clone().add(V(e * 0.55, 0, 0)), V(e, 0, 0), 0.32, 0.2, 20), false);
    for (const dx of [-0.35, 0.35]) b.add('metalDark', bevelBoxAt(V(tc.x + dx, (yDeck - 0.15 + tc.y + 0.3) / 2, tc.z), 0.08, yDeck - 0.15 - (tc.y + 0.3) + 0.04, 0.5, null, 0.015), false);
    const am = V(cx + 1.6, yDeck - 0.15, seed ? -1.0 : 0.95);
    b.add('metalBare', tubeAt(am.clone().add(V(0, -0.35, 0)), Y_AXIS, 0.04, 0.7, 10, { uv: false }), false);
    b.add('antennaWhite', latheAt(am.clone().add(V(0, -0.72, 0)), V(0, -1, 0), [[0.03, 0.0], [0.34, 0.1], [0.36, 0.12], [0.33, 0.11], [0.0, 0.02]], 32), false);
    b.add('metalDark', tubeAt(am.clone().add(V(0, -0.95, 0)), Y_AXIS, 0.025, 0.24, 8, { uv: false }), false);
    if (D) {
      grappleFixture(b, D, new THREE.Matrix4().makeRotationX(Math.PI).setPosition(cx - 1.75, yDeck - 0.125, seed ? -0.9 : 0.9), { size: 0.5 });
      for (const sz of [-1, 1]) boltRow(D, new THREE.Matrix4().setPosition(cx, yDeck + 0.08, 0), -2.05, sz * 1.25, 2.05, sz * 1.25, 12, 0, 0.012, 0.009);
      D.rod('mid', 'paint', COL.black, V(cx - 1.9, yDeck - 0.13, -1.2), V(cx + 1.9, yDeck - 0.13, -1.2), 0.02, 'cyl8');
      for (let i = 0; i < 6; i++) pClampAt(D, cx - 1.6 + i * 0.64, yDeck - 0.13, -1.2);
    }
    colliders.push(Colliders.box(V(cx, yDeck - 0.6, 0), V(2.3, 0.8, 1.5), null, 'payloadCarrier'));
  }

  return { colliders };
}

/** P-clamp around a line along X at (x, y, z) hanging under a deck. */
function pClampAt(D, x, y, z) {
  D.part('mid', 'metal', COL.bare, 'bbox', new THREE.Matrix4(), x, y + 0.025, z, 0.05, 0.03, 0.08);
}
