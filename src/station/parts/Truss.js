import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { Instancer, unitCylinder, boxAt, bevelBoxAt, tubeAt, torusAt, latheAt, mat, Colliders, X_AXIS, Y_AXIS, Z_AXIS, TEX_M, scaleUV } from './Builder.js';
import { bevelBox } from './Builder.js';
import { COL, boltRow, radialBolts, pClamp, connectorPanel } from './Detail.js';
import { grappleFixture } from './Hardware.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _qx = new THREE.Quaternion();
const _M = new THREE.Matrix4();
const _I = new THREE.Matrix4();
const _FLIPY = new THREE.Matrix4().makeRotationX(Math.PI);

/**
 * Integrated truss spine along X: 4 longerons, battens, diagonals (instanced tubes), utility trays,
 * cable runs, grapple fixtures, battery ORUs, hazard decals, labels and end plates.
 */
export function buildTruss(ctx, station, b, rails) {
  const m = ctx.materials;
  const D = b.detail;     // close-range hardware (null on 'lite')
  const H = LAYOUT.spineHalf, h = LAYOUT.spineSize / 2;
  const bay = 5.5, nBays = Math.round((2 * H) / bay);
  const colliders = [];

  // longerons (continuous tubes)
  const corners = [[h, h], [h, -h], [-h, -h], [-h, h]];
  for (const [y, z] of corners) b.add('truss', tubeAt(V(0, y, z), X_AXIS, 0.17, 2 * H, 10));

  // battens + diagonals as instanced unit cylinders
  const members = new Instancer(unitCylinder(6), m.get('truss'), { name: 'trussMembers', shadow: true });
  for (let i = 0; i <= nBays; i++) {
    const x = -H + i * bay;
    for (let k = 0; k < 4; k++) {
      const [y0, z0] = corners[k], [y1, z1] = corners[(k + 1) % 4];
      members.addSegment(V(x, y0, z0), V(x, y1, z1), 0.09);
      if (i < nBays) {
        // one diagonal per face per bay, alternating direction
        const flip = (i + k) % 2 === 0;
        members.addSegment(V(x, flip ? y0 : y1, flip ? z0 : z1), V(x + bay, flip ? y1 : y0, flip ? z1 : z0), 0.07);
      }
    }
    // small node gussets at the batten/longeron joints
  }
  members.build(station);
  if (D) {
    // member end sleeves (battens + diagonals)
    for (let i = 0; i <= nBays; i++) {
      const x = -H + i * bay;
      for (let k = 0; k < 4; k++) {
        const [y0, z0] = corners[k], [y1, z1] = corners[(k + 1) % 4];
        const a = V(x, y0, z0), c = V(x, y1, z1), d = c.clone().sub(a).normalize();
        for (const [p, sg] of [[a, 1], [c, -1]]) D.rod('mid', 'metal', COL.bare, p.clone().addScaledVector(d, sg * 0.24), p.clone().addScaledVector(d, sg * 0.44), 0.13, 'cyl8');
        if (i < nBays) {
          const flip = (i + k) % 2 === 0;
          const pa = V(x, flip ? y0 : y1, flip ? z0 : z1), pb = V(x + bay, flip ? y1 : y0, flip ? z1 : z0), dd = pb.clone().sub(pa).normalize();
          D.rod('mid', 'metal', COL.bare, pa.clone().addScaledVector(dd, 0.3), pa.clone().addScaledVector(dd, 0.5), 0.1, 'cyl8');
          D.rod('mid', 'metal', COL.bare, pb.clone().addScaledVector(dd, -0.5), pb.clone().addScaledVector(dd, -0.3), 0.1, 'cyl8');
        }
      }
    }
  }

  if (!D) {
    // joint spheres (instanced) where battens meet longerons
    const joints = new Instancer(new THREE.SphereGeometry(1, 8, 6), m.get('metalDark'), { name: 'trussJoints' });
    for (let i = 0; i <= nBays; i++) for (const [y, z] of corners) joints.add(mat(-H + i * bay, y, z, null, new THREE.Vector3(0.24, 0.24, 0.24)));
    joints.build(station);
  } else {
    // node fittings: chamfered block on the longeron, gusset plates in both faces, bolted; member end
    // sleeves; longeron splice collars mid-bay
    for (let i = 0; i <= nBays; i++) {
      const x = -H + i * bay;
      for (const [y, z] of corners) {
        const sy = Math.sign(y), sz = Math.sign(z);
        b.add('metalBare', bevelBoxAt(V(x, y, z), 0.46, 0.4, 0.4, null, 0.05));
        b.add('hullWhiteAged', bevelBoxAt(V(x, y + sy * 0.0, z - sz * 0.3), 0.7, 0.03, 0.5, null, 0.012), false);
        b.add('hullWhiteAged', bevelBoxAt(V(x, y - sy * 0.3, z), 0.7, 0.5, 0.03, null, 0.012), false);
        // bolts on both gussets (3 x 2 each side of the batten)
        for (const dx of [-0.27, -0.15, 0.15, 0.27]) for (const dd of [0.32]) {
          D.bolt(_M.makeTranslation(x + dx, y + sy * 0.015, z - sz * dd).multiply(sy > 0 ? _I : _FLIPY), 0.011, 0.008);
          D.bolt(_M.makeBasis(X_AXIS, V(0, 0, sz), V(0, -sz, 0)).setPosition(x + dx, y - sy * dd, z + sz * 0.015), 0.011, 0.008);
        }
        // block face bolts
        for (const dx of [-0.13, 0.13]) for (const dz of [-0.1, 0.1]) D.bolt(_M.makeTranslation(x + dx, y + sy * 0.2, z + dz).multiply(sy > 0 ? _I : _FLIPY), 0.014, 0.01);
      }
      if (i < nBays) for (const [y, z] of corners) {
        const xm = x + bay / 2;
        D.rod('mid', 'metal', COL.bare, V(xm - 0.12, y, z), V(xm + 0.12, y, z), 0.215, 'cyl12');
        radialBolts(D, new THREE.Matrix4().makeRotationZ(-Math.PI / 2).setPosition(xm, y, z), 0.215, 10, 0, 0.012, 0.009);
      }
    }
  }

  // utility trays on top (two) + cross ribs; cable runs on top and both sides
  for (const z of [-1.0, 1.0]) {
    b.add('paintGray', bevelBoxAt(V(0, h + 0.42, z), 2 * H - 2, 0.5, 0.9, null, 0.03));
    b.add('metalDark', bevelBoxAt(V(0, h + 0.7, z), 2 * H - 2, 0.06, 0.96, null, 0.015));  // tray lid
  }
  const ribs = new Instancer(new THREE.BoxGeometry(1, 1, 1), m.get('metalDark'), { name: 'trayRibs' });
  for (let i = 0; i <= nBays; i++) ribs.add(mat(-H + i * bay, h + 0.2, 0, null, new THREE.Vector3(0.12, 0.3, 2.4)));
  ribs.build(station);
  for (const [y, z, r] of [[h + 0.22, 0, 0.07], [h + 0.22, 0.2, 0.05], [h + 0.22, -0.2, 0.05], [0.3, h + 0.2, 0.06], [-0.3, h + 0.2, 0.05], [0.3, -h - 0.2, 0.06], [-0.3, -h - 0.2, 0.05]]) {
    b.add('cable', tubeAt(V(0, y, z), X_AXIS, r, 2 * H - 2, 6, { uv: false }), false);
  }
  // cable clamp bars: the top ones span between the two trays, the side ones run from the upper to the lower
  // longeron (every clamp is attached to structure at both ends)
  const clamps = new Instancer(bevelBox(1, 1, 1, 0.12), m.get('metalBare'), { name: 'cableClamps' });
  for (let i = 0; i < nBays * 2; i++) {
    const x = -H + 1.4 + i * bay / 2;
    clamps.add(mat(x, h + 0.22, 0, null, new THREE.Vector3(0.12, 0.22, 1.14)));
    clamps.add(mat(x, 0.0, h + 0.2, null, new THREE.Vector3(0.12, 2 * h + 0.28, 0.12)));
    clamps.add(mat(x, 0.0, -h - 0.2, null, new THREE.Vector3(0.12, 2 * h + 0.28, 0.12)));
  }
  clamps.build(station);
  if (D) {
    // P-clamps around the side cables, QD connector blocks each bay, two fluid lines per side with couplings
    for (const sz of [-1, 1]) {
      const zc = sz * (h + 0.2);
      for (let i = 0; i < nBays * 4; i++) {
        const x = -H + 2.0 + i * bay / 4;
        if (Math.abs(x) > H - 1.5) continue;
        for (const [y, r] of [[0.3, 0.06], [-0.3, 0.05]]) pClamp(D, new THREE.Matrix4().makeBasis(V(0, 1, 0), V(0, 0, sz), V(1, 0, 0)).setPosition(x, y, zc - sz * 0.0), r);
      }
      for (const [y, col] of [[-0.75, COL.bare], [-0.95, COL.copper]]) {
        D.rod('mid', 'metal', col, V(-H + 1.5, y, sz * (h + 0.16)), V(H - 1.5, y, sz * (h + 0.16)), 0.035, 'cyl8');
        for (let i = 0; i < nBays; i++) {
          const x = -H + bay * (i + 0.5);
          D.rod('mid', 'metal', col, V(x - 0.1, y, sz * (h + 0.16)), V(x + 0.1, y, sz * (h + 0.16)), 0.06, 'cyl12');
          D.part('fine', 'metal', COL.bare, 'bolt', new THREE.Matrix4().makeRotationZ(-Math.PI / 2).setPosition(x + 0.1, y, sz * (h + 0.16)), 0, 0, 0, 0.07, 0.05, 0.07);
          for (const dx of [-1.4, 1.4]) pClamp(D, new THREE.Matrix4().makeBasis(V(0, 1, 0), V(0, 0, sz), V(1, 0, 0)).setPosition(x + dx, y, sz * (h + 0.12)), 0.035);
        }
      }
      for (let i = 1; i < nBays; i += 2) {
        const x = -H + i * bay + 1.6;
        connectorPanel(D, new THREE.Matrix4().makeBasis(V(1, 0, 0), V(0, 0, sz), V(0, -sz, 0)).setPosition(x, 0.85, sz * (h + 0.12)), 0.5, 0.36, 3, 2, i);
      }
    }
    // tray lid seams, latches and handles
    for (const z of [-1.0, 1.0]) for (let x = -H + 1 + 2.75; x < H - 1; x += 2.75) {
      D.part('mid', 'metal', COL.dark, 'box', _M.makeTranslation(x, h + 0.735, z), 0, 0, 0, 0.03, 0.012, 0.98);
      for (const sz of [-1, 1]) D.part('mid', 'metal', COL.bare, 'bbox', _M.makeTranslation(x + 0.25, h + 0.7, z + sz * 0.5), 0, 0, 0, 0.12, 0.06, 0.04);
    }
  }

  // grapple fixtures (robot-arm attach points) along the top of the trays
  for (const x of [-72, -52, -8, 26, 56, 70]) {
    const c = V(x, h + 0.76, -1.0);
    if (D) { grappleFixture(b, D, new THREE.Matrix4().makeTranslation(c.x, c.y - 0.03, c.z), { size: 0.62 }); continue; }
    b.add('metalBare', boxAt(V(c.x, c.y + 0.04, c.z), 0.8, 0.08, 0.8), false);
    b.add('metalBare', tubeAt(V(c.x, c.y + 0.3, c.z), Y_AXIS, 0.07, 0.45, 8, { uv: false }), false);
    b.add('metalDark', torusAt(V(c.x, c.y + 0.5, c.z), Y_AXIS, 0.16, 0.035, 6, 16), false);
    b.add('hazard', boxAt(V(c.x, c.y + 0.045, c.z), 0.95, 0.07, 0.95, null, false), false);
  }

  // battery / avionics ORUs in rows near the array joints (both sides)
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = sx * (58 + i * 2.2);
      for (const sz of [-1, 1]) {
        if (!D) {
          b.add('hullWhiteAged', boxAt(V(x, -0.2, sz * (h + 0.75)), 1.8, 1.9, 1.3));
          b.add('metalDark', boxAt(V(x, -0.2, sz * (h + 1.42)), 1.5, 1.6, 0.06), false);
          continue;
        }
        b.add('hullWhiteAged', bevelBoxAt(V(x, -0.2, sz * (h + 0.75)), 1.8, 1.9, 1.3, null, 0.05));
        b.add('metalDark', bevelBoxAt(V(x, -0.2, sz * (h + 1.42)), 1.5, 1.6, 0.06, null, 0.015), false);
        // ORU face: H-handle, connector panel, corner fasteners, ID plate
        const Fh = new THREE.Matrix4().makeBasis(V(1, 0, 0), V(0, 0, sz), V(0, -sz, 0)).setPosition(x, -0.2, sz * (h + 1.45));
        for (const dx of [-0.25, 0.25]) {
          D.rod('mid', 'paint', COL.gray, V(x + dx, 0.25, sz * (h + 1.6)), V(x + dx, -0.05, sz * (h + 1.6)), 0.018, 'cyl8');
          for (const yy of [0.25, -0.05]) D.rod('mid', 'paint', COL.gray, V(x + dx, yy, sz * (h + 1.45)), V(x + dx, yy, sz * (h + 1.61)), 0.016, 'cyl6');
        }
        D.rod('mid', 'paint', COL.gray, V(x - 0.25, 0.1, sz * (h + 1.6)), V(x + 0.25, 0.1, sz * (h + 1.6)), 0.016, 'cyl8');
        connectorPanel(D, Fh.clone().multiply(_M.makeTranslation(0, 0, 0.55)), 0.5, 0.26, 3, 1, i + (sz > 0 ? 3 : 0));
        D.part('mid', 'paint', COL.white, 'box', Fh, 0, 0.004, -0.62, 0.36, 0.006, 0.12);
        for (const dx of [-0.66, 0.66]) for (const dz of [-0.72, 0.72]) D.bolt(Fh.clone().multiply(_M.makeTranslation(dx, 0, dz)), 0.018, 0.012);
      }
    }
    // MLI-wrapped equipment boxes below the truss, hung from two cross beams bolted to the bottom longerons
    for (const dx of [-1.25, 1.25]) b.add('truss', bevelBoxAt(V(sx * 48 + dx, -h - 0.1, 0), 0.22, 0.2, 2 * h + 0.3, null, 0.03));
    b.add('mliGold', bevelBoxAt(V(sx * 48, -h - 1.0, 0.8), 3.0, 1.6, 1.8, null, 0.06));
    b.add('mliSilver', bevelBoxAt(V(sx * 48, -h - 0.9, -1.2), 2.2, 1.4, 1.6, null, 0.06));
  }

  // hazard stripe bands around the longerons at bay joints every 4 bays + "NO STEP" style plates
  for (let i = 0; i <= nBays; i += 4) {
    const x = -H + i * bay;
    for (const [y, z] of corners) b.add('hazard', tubeAt(V(x + 0.45, y, z), X_AXIS, 0.178, 0.3, 16, { uv: false }), false);
  }

  // end plates with whip antennas + a stowed cargo pallet aft
  for (const sx of [-1, 1]) {
    b.add('truss', bevelBoxAt(V(sx * H, 0, 0), 0.3, LAYOUT.spineSize + 0.2, LAYOUT.spineSize + 0.2, null, 0.05));
    b.add('hazard', bevelBoxAt(V(sx * (H + 0.16), 0, 0), 0.04, 1.2, 1.2, null, 0.01), false);
    for (const [y, z] of [[1.6, 1.6], [-1.6, -1.6]]) b.add('metalDark', latheAt(V(sx * (H + 0.15), y, z), V(sx, 0, 0), [[0.09, 0], [0.09, 0.03], [0.05, 0.06], [0.03, 0.12], [0, 0.12]], 12), false);
    for (const [y, z] of [[1.6, 1.6], [-1.6, -1.6]]) b.add('antennaWhite', tubeAt(V(sx * (H + 1.2), y, z), X_AXIS, 0.025, 2.4, 6, { uv: false }), false);
  }
  b.add('mliSilver', bevelBoxAt(V(-80, -h - 1.35, 0), 4.0, 2.0, 3.2, null, 0.08));
  b.add('metalDark', bevelBoxAt(V(-80, -h - 2.45, 0), 4.2, 0.2, 3.4, null, 0.04), false);
  for (const dx of [-1.6, 1.6]) b.add('truss', bevelBoxAt(V(-80 + dx, -h - 0.17, 0), 0.3, 0.34, 2 * h + 0.3, null, 0.04));

  // labels on the tray sides (segments named like ISS truss segments)
  const labelY = h + 0.42;
  for (const [x, text] of [[-62, 'П-2'], [-20, 'П-1'], [28, 'С-1'], [66, 'С-2']]) {
    b.label(text, 3.0, 0.42, mat(x, labelY, 1.47, _qx.identity()), { width: 512 });
    b.label(text, 3.0, 0.42, mat(x, labelY, -1.47, _qx.setFromAxisAngle(Y_AXIS, Math.PI)), { width: 512 });
  }
  b.label(LAYOUT.stationNameLatin, 6.0, 0.42, mat(-30, labelY, 1.47, _qx.identity()), { width: 1024 });
  b.label(LAYOUT.stationName, 6.0, 0.42, mat(48, labelY, -1.47, _qx.setFromAxisAngle(Y_AXIS, Math.PI)), { width: 1024 });

  // handrails along the top trays (EVA translation path) near the cluster
  // (rail feet sit on the tray lids and on the outer face of the top longerons)
  for (const z of [-1.43, 1.43]) rails.addLine(V(-36, h + 0.73, z), V(60, h + 0.73, z), Y_AXIS, 1.3, 0.5);
  for (const sz of [-1, 1]) rails.addLine(V(-36, h, sz * (h + 0.16)), V(60, h, sz * (h + 0.16)), V(0, 0, sz), 1.3, 0.5);

  // colliders: the whole spine (incl. trays) + ORU rows + end plates
  colliders.push(Colliders.box(V(0, 0.35, 0), V(H, 2.65, h), null, 'spine'));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) colliders.push(Colliders.box(V(sx * 62.4, -0.2, sz * (h + 0.75)), V(5.5, 1.0, 0.7), null, 'oru'));
  colliders.push(Colliders.box(V(-80, -h - 1.3, 0), V(2.1, 1.3, 1.7), null, 'pallet'));
  return { colliders };
}
