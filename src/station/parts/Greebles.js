import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { boxAt, tubeAt, torusAt, sphereAt, mat, Colliders, X_AXIS, Y_AXIS, Z_AXIS } from './Builder.js';

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
  const { lab, hab2, power, logi, hab1, med, green } = { lab: mods.hulls.lab, hab2: mods.hulls.hab2, power: mods.power, logi: mods.logi, hab1: mods.hab1, med: mods.med, green: mods.green };
  const h = LAYOUT.spineSize / 2;

  /** Exposed experiment pallet: open frame on four legs with a few instrument boxes on top. */
  function pallet(H, t, dir, seed) {
    const th = H.thetaFor(dir);
    const s = H.surface(t, th, H.r + 0.55, new THREE.Matrix4());
    b.add('truss', at(new THREE.BoxGeometry(2.4, 0.12, 1.7), s), false);
    for (const [dx, dz] of [[-1.05, -0.7], [1.05, -0.7], [-1.05, 0.7], [1.05, 0.7]]) {
      b.add('metalDark', at(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 6).translate(dx, -0.3, dz), s), false);
      b.add('metalDark', at(new THREE.BoxGeometry(0.16, 0.08, 0.16).translate(dx, 0.1, dz), s), false);
    }
    // frame rails
    for (const dz of [-0.8, 0.8]) b.add('metalDark', at(new THREE.BoxGeometry(2.4, 0.08, 0.08).translate(0, 0.1, dz), s), false);
    for (const dx of [-1.15, 1.15]) b.add('metalDark', at(new THREE.BoxGeometry(0.08, 0.08, 1.7).translate(dx, 0.1, 0), s), false);
    // instruments (vary with seed)
    const kit = [
      ['mliGold', 0.7, 0.5, 0.6, -0.7, 0.35, 0.3], ['paintGray', 0.5, 0.35, 0.5, 0.25, 0.28, -0.4], ['mliBlack', 0.4, 0.6, 0.4, 0.85, 0.4, 0.35],
      ['metalBare', 0.3, 0.3, 0.3, 0.2, 0.25, 0.45], ['hullWhiteAged', 0.9, 0.25, 0.45, -0.4, 0.22, -0.45],
    ];
    for (let i = 0; i < kit.length; i++) {
      const [mn, w, hh, d, x, y, z] = kit[(i + seed) % kit.length];
      b.add(mn, at(new THREE.BoxGeometry(w, hh, d).translate(x + 0.08 * seed, y, z), s), false);
    }
    // a small aperture / sensor on the gold box and a cable to the hull
    b.add('metalDark', at(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 12).translate(-0.7, 0.66, 0.3), s), false);
    b.add('cable', at(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 5).rotateX(Math.PI / 2).translate(1.0, -0.1, -0.2).applyMatrix4(_m.makeRotationZ(0.6)), s), false);
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
    }
    const sc = H.surface(t, th, H.r + 0.3, new THREE.Matrix4());
    b.add('metalDark', at(new THREE.BoxGeometry(n * 1.45 + 0.4, 0.12, 1.5), sc), false);
    b.add('hazard', at(new THREE.BoxGeometry(n * 1.45 + 0.4, 0.04, 0.12).translate(0, 0.08, 0.72), sc), false);
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
    for (const dx of [-2.4, 0, 2.4]) b.add('metalDark', boxAt(V(x + dx, top + 0.18, 0), 0.14, 0.26, 1.0, null, false), false);
    // vent grilles and a fluid connector panel on the node sides
    for (const sz of [-1, 1]) {
      b.add('metalDark', boxAt(V(x + 1.4, CY + 1.4, sz * (n.r + 0.02)), 0.5, 0.3, 0.08, null, false), false);
      b.add('paintGray', boxAt(V(x + 1.4, CY + 1.4, sz * (n.r + 0.07)), 0.42, 0.22, 0.03, null, false), false);
    }
  }

  // round side hatches (EVA / equipment) with a hazard ring on hab1 (+X), medical (-X) and logistics (+Z)
  for (const [H, t, dir] of [[hab1, 0.0, X_AXIS], [med, -0.5, NEG_X], [logi, -1.5, Z_AXIS]]) {
    const th = H.thetaFor(dir);
    const s = H.surface(t, th, H.r, new THREE.Matrix4());
    b.add('hullWhiteAged', at(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 28).translate(0, 0.02, 0), s), false);
    b.add('metalDark', at(new THREE.TorusGeometry(0.64, 0.05, 5, 28).rotateX(Math.PI / 2).translate(0, 0.05, 0), s), false);
    b.add('hazard', at(new THREE.RingGeometry(0.66, 0.84, 28, 1).rotateX(-Math.PI / 2).translate(0, 0.02, 0), s), false);
    b.add('metalBare', at(new THREE.TorusGeometry(0.2, 0.03, 5, 16).rotateX(Math.PI / 2).translate(0, 0.1, 0), s), false);
    b.add('windowGlow', at(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 14).translate(0.3, 0.07, 0.25), s), false);
    for (const a of [0, 1, 2, 3]) rails.addRail(H.point(t + (a < 2 ? -1.1 : 1.1), th + (a % 2 ? 0.28 : -0.28), H.r), H.point(t + (a < 2 ? -1.1 : 1.1), th + (a % 2 ? 0.28 : -0.28) + (a % 2 ? -0.12 : 0.12), H.r), H.normal(th));
  }

  // vents / small boxes scattered on logistics and service hulls
  for (const [H, t, th, w] of [[logi, -2.5, 2.2, 0.4], [logi, 2.0, 4.1, 0.3], [power, -4.5, 2.4, 0.5], [power, 3.5, 3.9, 0.35], [hab2, -3.0, 4.2, 0.4], [hab1, 2.5, 0.9, 0.35]]) {
    const s = H.surface(t, th, H.r, new THREE.Matrix4());
    b.add('metalDark', at(new THREE.BoxGeometry(w, 0.12, w * 0.7).translate(0, 0.06, 0), s), false);
    b.add('paintGray', at(new THREE.BoxGeometry(w - 0.08, 0.03, w * 0.7 - 0.08).translate(0, 0.13, 0), s), false);
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
    const joint = (p, axis, rr = 0.36, len = 0.7) => { b.add(jointMat, tubeAt(p, axis, rr, len, 16, { uv: false })); b.add('mliGold', torusAt(p, axis, rr + 0.02, 0.08, 6, 24), false); };
    const boom = (p0, p1, rr = 0.2) => {
      const d = p1.clone().sub(p0), len = d.length(); d.normalize();
      b.add(armMat, tubeAt(p0.clone().lerp(p1, 0.5), d, rr, len, 14));
      b.add('mliSilver', tubeAt(p0.clone().lerp(p1, 0.5), d, rr + 0.04, len * 0.42, 14));
      for (const e of [0.12, 0.88]) b.add(jointMat, torusAt(p0.clone().lerp(p1, e), d, rr + 0.03, 0.04, 5, 14), false);
      b.add('cable', tubeAt(p0.clone().lerp(p1, 0.5).add(V(0, rr + 0.05, 0)), d, 0.03, len, 5, { uv: false }), false);
    };
    const S = V(bx, y0 + 0.5, bz), E = V(bx + 8.0, y0 + 1.2, bz), W = V(bx - 0.5, y0 + 2.0, bz);
    b.add('metalBare', boxAt(V(bx, y0 + 0.1, bz), 0.9, 0.2, 0.9), false);
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
    b.add('rubberBlack', boxAt(E.clone().add(V(0, 0.65, 0.25)), 0.22, 0.2, 0.3), false);
    b.add('dockLight', boxAt(W.clone().add(V(-1.0, 0.3, 0.1)), 0.16, 0.12, 0.16), false);
    b.labelAt('МАНИПУЛЯТОР', 2.2, 0.28, V(bx + 4.0, y0 + 1.0, bz + 0.26), Z_AXIS, { width: 1024 });
    colliders.push(Colliders.box(V(bx + 3.8, y0 + 1.2, bz), V(4.6, 1.2, 0.5), null, 'robotArm'));
  }

  // ---------- mobile transporter cart on the top tray at x = -52.5 ----------
  {
    const cx = -52.5, y0 = h + 0.72;
    b.add('paintGray', boxAt(V(cx, y0 + 0.45, 0), 3.0, 0.7, 3.2));
    b.add('metalDark', boxAt(V(cx, y0 + 0.85, 0), 2.6, 0.12, 2.8), false);
    b.add('hazard', boxAt(V(cx, y0 + 0.45, 0), 3.02, 0.14, 3.22, null, false), false);
    b.add('mliGold', boxAt(V(cx - 0.6, y0 + 1.25, 0.6), 1.2, 0.7, 1.0));
    b.add('metalBare', tubeAt(V(cx + 0.8, y0 + 1.3, -0.6), Y_AXIS, 0.07, 0.8, 8, { uv: false }), false);
    b.add('metalDark', torusAt(V(cx + 0.8, y0 + 1.72, -0.6), Y_AXIS, 0.16, 0.035, 6, 16), false);
    for (const dx of [-1.1, 1.1]) for (const dz of [-1.35, 1.35]) b.add('rubberBlack', tubeAt(V(cx + dx, y0 + 0.1, dz), Z_AXIS, 0.22, 0.2, 12, { uv: false }), false);
    for (const dz of [-1.0, 1.0]) b.add('windowGlow', boxAt(V(cx + 1.52, y0 + 0.45, dz), 0.02, 0.1, 0.3, null, false), false);
    b.labelAt('ТРАНСПОРТЁР', 2.2, 0.3, V(cx, y0 + 0.5, 1.62), Z_AXIS, { width: 1024 });
    colliders.push(Colliders.box(V(cx, y0 + 0.7, 0), V(1.6, 0.9, 1.7), null, 'transporter'));
  }

  return { colliders };
}
