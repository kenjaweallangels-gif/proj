import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { Instancer, unitCylinder, boxAt, tubeAt, torusAt, mat, Colliders, X_AXIS, Y_AXIS, Z_AXIS, TEX_M, scaleUV } from './Builder.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _qx = new THREE.Quaternion();

/**
 * Integrated truss spine along X: 4 longerons, battens, diagonals (instanced tubes), utility trays,
 * cable runs, grapple fixtures, battery ORUs, hazard decals, labels and end plates.
 */
export function buildTruss(ctx, station, b, rails) {
  const m = ctx.materials;
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

  // joint spheres (instanced) where battens meet longerons
  const joints = new Instancer(new THREE.SphereGeometry(1, 8, 6), m.get('metalDark'), { name: 'trussJoints' });
  for (let i = 0; i <= nBays; i++) for (const [y, z] of corners) joints.add(mat(-H + i * bay, y, z, null, new THREE.Vector3(0.24, 0.24, 0.24)));
  joints.build(station);

  // utility trays on top (two) + cross ribs; cable runs on top and both sides
  for (const z of [-1.0, 1.0]) {
    b.add('paintGray', boxAt(V(0, h + 0.42, z), 2 * H - 2, 0.5, 0.9));
    b.add('metalDark', boxAt(V(0, h + 0.7, z), 2 * H - 2, 0.06, 0.96));  // tray lid
  }
  const ribs = new Instancer(new THREE.BoxGeometry(1, 1, 1), m.get('metalDark'), { name: 'trayRibs' });
  for (let i = 0; i <= nBays; i++) ribs.add(mat(-H + i * bay, h + 0.2, 0, null, new THREE.Vector3(0.12, 0.3, 2.4)));
  ribs.build(station);
  for (const [y, z, r] of [[h + 0.22, 0, 0.07], [h + 0.22, 0.2, 0.05], [h + 0.22, -0.2, 0.05], [0.3, h + 0.2, 0.06], [-0.3, h + 0.2, 0.05], [0.3, -h - 0.2, 0.06], [-0.3, -h - 0.2, 0.05]]) {
    b.add('cable', tubeAt(V(0, y, z), X_AXIS, r, 2 * H - 2, 6, { uv: false }), false);
  }
  // cable clamps
  const clamps = new Instancer(new THREE.BoxGeometry(1, 1, 1), m.get('metalBare'), { name: 'cableClamps' });
  for (let i = 0; i < nBays * 2; i++) {
    const x = -H + 1.4 + i * bay / 2;
    clamps.add(mat(x, h + 0.22, 0, null, new THREE.Vector3(0.12, 0.22, 0.62)));
    clamps.add(mat(x, 0.0, h + 0.2, null, new THREE.Vector3(0.12, 0.9, 0.2)));
    clamps.add(mat(x, 0.0, -h - 0.2, null, new THREE.Vector3(0.12, 0.9, 0.2)));
  }
  clamps.build(station);

  // grapple fixtures (robot-arm attach points) along the top of the trays
  for (const x of [-72, -52, -8, 26, 56, 70]) {
    const c = V(x, h + 0.76, -1.0);
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
        b.add('hullWhiteAged', boxAt(V(x, -0.2, sz * (h + 0.75)), 1.8, 1.9, 1.3));
        b.add('metalDark', boxAt(V(x, -0.2, sz * (h + 1.42)), 1.5, 1.6, 0.06), false);
      }
    }
    // MLI-wrapped equipment boxes below the truss
    b.add('mliGold', boxAt(V(sx * 48, -h - 1.0, 0.8), 3.0, 1.6, 1.8));
    b.add('mliSilver', boxAt(V(sx * 48, -h - 0.9, -1.2), 2.2, 1.4, 1.6));
  }

  // hazard stripe bands around the longerons at bay joints every 4 bays + "NO STEP" style plates
  for (let i = 0; i <= nBays; i += 4) {
    const x = -H + i * bay;
    for (const [y, z] of corners) b.add('hazard', boxAt(V(x + 0.4, y, z), 0.35, 0.4, 0.4, null, false), false);
  }

  // end plates with whip antennas + a stowed cargo pallet aft
  for (const sx of [-1, 1]) {
    b.add('truss', boxAt(V(sx * H, 0, 0), 0.3, LAYOUT.spineSize + 0.2, LAYOUT.spineSize + 0.2));
    b.add('hazard', boxAt(V(sx * (H + 0.1), 0, 0), 0.12, 1.2, 1.2, null, false), false);
    for (const [y, z] of [[1.6, 1.6], [-1.6, -1.6]]) b.add('antennaWhite', tubeAt(V(sx * (H + 1.2), y, z), X_AXIS, 0.025, 2.4, 6, { uv: false }), false);
  }
  b.add('mliSilver', boxAt(V(-80, -h - 1.3, 0), 4.0, 2.0, 3.2));
  b.add('metalDark', boxAt(V(-80, -h - 2.4, 0), 4.2, 0.2, 3.4), false);
  for (const z of [-1.4, 1.4]) b.add('truss', boxAt(V(-80, -h - 0.15, z), 4.0, 0.3, 0.3));

  // labels on the tray sides (segments named like ISS truss segments)
  const labelY = h + 0.42;
  for (const [x, text] of [[-62, 'П-2'], [-20, 'П-1'], [28, 'С-1'], [66, 'С-2']]) {
    b.label(text, 3.0, 0.42, mat(x, labelY, 1.47, _qx.identity()), { width: 512 });
    b.label(text, 3.0, 0.42, mat(x, labelY, -1.47, _qx.setFromAxisAngle(Y_AXIS, Math.PI)), { width: 512 });
  }
  b.label(LAYOUT.stationNameLatin, 6.0, 0.42, mat(-30, labelY, 1.47, _qx.identity()), { width: 1024 });
  b.label(LAYOUT.stationName, 6.0, 0.42, mat(48, labelY, -1.47, _qx.setFromAxisAngle(Y_AXIS, Math.PI)), { width: 1024 });

  // handrails along the top trays (EVA translation path) near the cluster
  for (const z of [-1.6, 1.6]) rails.addLine(V(-36, h + 0.75, z), V(60, h + 0.75, z), Y_AXIS, 1.3, 0.5);
  for (const sz of [-1, 1]) rails.addLine(V(-36, 1.5, sz * (h + 0.1)), V(60, 1.5, sz * (h + 0.1)), V(0, 0, sz), 1.3, 0.5);

  // colliders: the whole spine (incl. trays) + ORU rows + end plates
  colliders.push(Colliders.box(V(0, 0.35, 0), V(H, 2.65, h), null, 'spine'));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) colliders.push(Colliders.box(V(sx * 62.4, -0.2, sz * (h + 0.75)), V(5.5, 1.0, 0.7), null, 'oru'));
  colliders.push(Colliders.box(V(-80, -h - 1.3, 0), V(2.1, 1.3, 1.7), null, 'pallet'));
  return { colliders };
}
