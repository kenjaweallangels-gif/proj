import * as THREE from 'three';
import { lathe, flange, boltCircle, boltRow, seam, rod, block, handrail, thruster, porthole, hatchRound, lamp, beacon, axial, patch, connector, cable, vent, V, X_AXIS, Y_AXIS, Z_AXIS, LocalColliders as C } from '../Kit.js';
import { idssActive, dockingLights } from '../Mechanisms.js';
import { flag } from './Russian.js';

/**
 * «Вега» — Crew Dragon-class capsule (small port, IDSS-class active docking system):
 *   hinged nose cone over the docking system (opens at the hold point, closes after departure), forward
 *   bulkhead with forward-firing Dracos, rendezvous sensor and docking lights; steep white sidewall with
 *   four windows, side hatch, Draco thruster clusters and four SuperDraco "doghouses"; PICA-style heat shield
 *   band; trunk with body-mounted solar cells on one half, radiators on the other, four aft fins.
 */

const _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1);
const SIDE = [[1.86, -3.56], [1.38, -0.8]];   // sidewall cone (r, z): aft -> fore
const rSide = (z) => SIDE[0][0] + (SIDE[1][0] - SIDE[0][0]) * (z - SIDE[0][1]) / (SIDE[1][1] - SIDE[0][1]);
const sideNormal = (a) => V(Math.cos(a), Math.sin(a), (SIDE[0][0] - SIDE[1][0]) / (SIDE[1][1] - SIDE[0][1])).normalize();
const onSide = (a, z, lift = 0) => { const r = rSide(z) + lift; return V(Math.cos(a) * r, Math.sin(a) * r, z); };
const frameAt = (a, z) => { const n = sideNormal(a), t = V(-Math.sin(a), Math.cos(a), 0), u = new THREE.Vector3().crossVectors(n, t); return new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(t, u, n)); };

function dragonAuthor(k) {
  const b = k.b, tpl = k.tpl;
  const scs = idssActive(k, { R: 0.8, base: -0.55 });
  dockingLights(k, 1.12, { z: -0.5, angle: 0, camera: false });
  // forward bulkhead under the nose cone: flat annulus with a raised rim
  lathe(k, b, 'paintWhite', [[1.38, -0.82], [1.38, -0.78], [1.34, -0.75], [1.12, -0.75]], { seg: 64 });
  flange(k, b, -0.74, 1.12, { h: 0.04, w: 0.05, bolts: 40 });
  // forward Dracos (translation away from the port), rendezvous sensor (lidar + thermal camera)
  for (const a of [Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.6, Math.PI * 1.9]) {
    const p = V(Math.cos(a) * 1.27, Math.sin(a) * 1.27, -0.72);
    if (!k.far) block(k, b, 'blackAnod', p.clone().setZ(-0.74), 0.14, 0.14, 0.05, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a), { bev: 0.01 });
    thruster(k, b, p.clone().setZ(-0.71), Z_AXIS, 0.03, { bell: 1.8 });
  }
  if (!k.far) {
    const p = V(Math.cos(Math.PI * 1.42) * 1.21, Math.sin(Math.PI * 1.42) * 1.21, -0.42);
    block(k, b, 'blackAnod', p, 0.22, 0.14, 0.12, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, Math.PI * 1.42), { bev: 0.015 });
    for (const dx of [-0.05, 0.05]) b.add('lens', axial(new THREE.CircleGeometry(0.035, 12), p.clone().add(V(dx, 0, 0.061)), Z_AXIS), false);
  }
  // sidewall: white backshell with panel seams, shoulder and the heat shield rim
  lathe(k, b, 'hull', [[1.9, -3.72], [1.92, -3.66], [1.9, -3.6], SIDE[0], SIDE[1], [1.38, -0.82]], { seg: 96, bev: 0.02, uv: 0.55, relief: { depth: 0.006, mode: 'groove', width: 0.02, sub: 4 } });
  for (const z of [-1.4, -2.2, -2.95]) seam(k, b, z, rSide(z) + 0.002, { surf: 'metalDark', t: 0.006 });
  if (k.near) for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + 0.13; rod(k, b, 'metalDark', onSide(a, -3.5, 0.002), onSide(a, -0.75, 0.002), 0.005, { seg: 4 }); }
  lathe(k, b, 'tilesHS', [[1.76, -3.98], [1.86, -3.86], [1.9, -3.72]], { seg: 80, uv: 4 });
  // windows (two pairs) and the side hatch with its window
  for (const a of [Math.PI * 0.22, Math.PI * 0.38, Math.PI * 0.62, Math.PI * 0.78].map((x) => x + Math.PI)) {
    const z = -1.55, q = frameAt(a, z), p = onSide(a, z, 0.01), n = sideNormal(a);
    if (!k.far) block(k, b, 'blackAnod', p.clone().addScaledVector(n, -0.005), 0.42, 0.42, 0.03, q, { bev: 0.04 });
    porthole(k, b, p.clone().addScaledVector(n, 0.012), n, 0.15, { frame: 0.03 });
  }
  {
    const a = Math.PI / 2, z = -1.9, n = sideNormal(a), p = onSide(a, z, 0.004);
    hatchRound(k, b, p, n, 0.5, { surf: 'hull', hingeDir: Z_AXIS });
    porthole(k, b, p.clone().addScaledVector(n, 0.03).addScaledVector(Z_AXIS, 0.15), n, 0.13, { frame: 0.025 });
    if (k.near) for (const s of [-1, 1]) handrail(k, b, onSide(a + s * 0.36, -1.5), onSide(a + s * 0.36, -2.3), sideNormal(a + s * 0.36), { surf: 'metalBare' });
  }
  // Draco clusters: four upper (pitch/yaw/roll + aft), four lower (radial + aft)
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    for (const [z, dirs] of [[-1.05, ['n', 't+', 't-', 'aft']], [-3.0, ['n', 'aft']]]) {
      const n = sideNormal(a), t = V(-Math.sin(a), Math.cos(a), 0), q = frameAt(a, z), p = onSide(a, z, 0.0);
      if (!k.far) block(k, b, 'blackAnod', p.clone().addScaledVector(n, -0.01), 0.36, 0.28, 0.04, q, { bev: 0.02 });
      for (const d of dirs) {
        const dir = d === 'n' ? V(Math.cos(a), Math.sin(a), 0) : d === 't+' ? t : d === 't-' ? t.clone().negate() : V(0, 0, -1).addScaledVector(n, 0.25).normalize();
        const off = d === 't+' ? t.clone().multiplyScalar(0.11) : d === 't-' ? t.clone().multiplyScalar(-0.11) : d === 'aft' ? V(0, 0, -0.08) : V(0, 0, 0.04);
        thruster(k, b, p.clone().add(off).addScaledVector(n, -0.03), dir, 0.026, { bell: 1.6, main: false });
      }
    }
  }
  // SuperDraco doghouses (bulged fairings with two canted nozzles each)
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4 + Math.PI / 8, z = -2.85, n = sideNormal(a), q = frameAt(a, z), p = onSide(a, z, 0.0);
    const g = new THREE.CapsuleGeometry(0.2, 0.55, k.seg(4, 2), k.seg(12, 6));
    g.scale(1.0, 1.0, 0.55);
    b.add('hull', g.applyMatrix4(_m.compose(p.clone().addScaledVector(n, 0.02), q, _s)), true);
    if (!k.far) {
      const opening = p.clone().addScaledVector(n, 0.08).addScaledVector(Z_AXIS, -0.38);
      block(k, b, 'blackAnod', opening, 0.3, 0.12, 0.16, q, { bev: 0.02 });
      for (const s of [-1, 1]) {
        const d = V(0, 0, -1).addScaledVector(n, 0.35).normalize();
        thruster(k, b, opening.clone().add(V(s * 0.07, 0, 0).applyQuaternion(q)).addScaledVector(d, -0.05), d, 0.05, { bell: 1.6, register: false });
      }
    }
  }
  // trunk: separation ring, solar half (+Y), radiator half (-Y), aft ring, internal bulkhead, four fins
  flange(k, b, -3.98, 1.78, { h: 0.06, w: 0.08, bolts: 48 });
  lathe(k, b, 'metalDark', [[1.84, -4.06], [1.84, -3.96]], { seg: 72 });
  lathe(k, b, 'solar', [[1.85, -6.62], [1.85, -4.08]], { seg: 72, th0: 0, thl: Math.PI, bev: 0, uv: 3.5 });
  lathe(k, b, 'radiator', [[1.85, -6.62], [1.85, -4.08]], { seg: 72, th0: Math.PI, thl: Math.PI, bev: 0, uv: 1.5 });
  for (const a of [0, Math.PI]) if (!k.far) rod(k, b, 'paintWhite', V(Math.cos(a) * 1.86, Math.sin(a) * 1.86, -6.62), V(Math.cos(a) * 1.86, Math.sin(a) * 1.86, -4.08), 0.03, { seg: 6 });
  for (const z of [-4.08, -5.35, -6.62]) flange(k, b, z, 1.85, { h: 0.03, w: 0.06, surf: 'paintWhite', bolts: z === -5.35 ? 0 : 48 });
  if (!k.far) {
    lathe(k, b, 'hullGray', [[1.83, -4.1], [1.83, -6.66]], { seg: 64, bev: 0, shadow: false });   // inner wall (seen through the open aft end)
    lathe(k, b, 'paintWhite', [[1.825, -6.66], [1.885, -6.66]], { seg: 64, bev: 0, shadow: false });   // aft rim closing the wall
    lathe(k, b, 'mliDark', [[1.82, -5.9], [0.0001, -5.9]], { seg: 48, bev: 0, shadow: false });
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; rod(k, b, 'metalBare', V(Math.cos(a) * 1.8, Math.sin(a) * 1.8, -6.6), V(Math.cos(a) * 0.4, Math.sin(a) * 0.4, -5.95), 0.03, { seg: 6 }); }
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const sh = new THREE.Shape(); sh.moveTo(0, -6.66); sh.lineTo(0, -5.55); sh.lineTo(0.62, -6.15); sh.lineTo(0.62, -6.66); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: !k.far, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 });
    g.translate(0, 0, -0.035);
    // shape X -> radial, shape Y -> ship Z, extrusion -> tangential
    const t = V(-Math.sin(a), Math.cos(a), 0), n = V(Math.cos(a), Math.sin(a), 0);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(n, Z_AXIS, t.clone().negate()).setPosition(n.clone().multiplyScalar(1.85)));
    b.add('hull', g, true);
    if (k.near) boltRow(k, b, n.clone().multiplyScalar(1.87).setZ(-5.65).addScaledVector(t, 0.05), n.clone().multiplyScalar(1.87).setZ(-6.6).addScaledVector(t, 0.05), n, 6, 0.008);
  }
  // cabin vents, ground-umbilical plate, trunk attach fittings and harness inside the trunk
  for (const a of [Math.PI * 0.05, Math.PI * 0.95]) vent(k, b, onSide(a, -2.4, 0.0), sideNormal(a), 0.035);
  connector(k, b, onSide(Math.PI * 0.32, -3.3, 0.0), sideNormal(Math.PI * 0.32), { plugs: 4, w: 0.22, h: 0.12 });
  if (k.near) for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; block(k, b, 'metalBare', V(Math.cos(a) * 1.8, Math.sin(a) * 1.8, -4.12), 0.16, 0.08, 0.1, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a + Math.PI / 2), { bev: 0.01 }); }
  { const pts = []; for (let z = -4.15; z >= -5.85; z -= 0.3) pts.push(V(-1.78, 0.25, z)); cable(k, b, pts, 0.02); }
  // umbilical fairing between trunk and capsule, nav lights, strobes
  if (!k.far) block(k, b, 'paintWhite', V(0, -1.88, -4.0), 0.36, 0.12, 0.34, null, { bev: 0.03 });
  beacon(k, b, V(-1.87, 0, -4.4), V(-1, 0, 0), 'navRed');
  beacon(k, b, V(1.87, 0, -4.4), X_AXIS, 'navGreen');
  beacon(k, b, onSide(Math.PI * 0.5, -0.9, 0.01), sideNormal(Math.PI * 0.5), 'strobe', 0.04);
  beacon(k, b, V(0, -1.87, -6.3), V(0, -1, 0), 'strobe', 0.04);
  // markings
  k.label('{name}-{num}', 1.2, 0.26, onSide(Math.PI * 1.5, -2.5, 0.006), sideNormal(Math.PI * 1.5), { right: V(1, 0, 0), color: '#1a2230' });
  k.label('{name}', 1.6, 0.36, V(0, 1.86, -5.0), Y_AXIS, { right: V(-1, 0, 0), color: '#e8e8e8' });
  flag(k, b, rSide(-2.5), Math.PI * 1.5 + 0.38, -2.5, 0.32, 0.2);

  // hinged nose cone: pivot on the +Y rim, rotates about X (0 closed .. -1.95 open)
  const hinge = V(0, 1.37, -0.76);
  tpl.pivot('nose', { position: hinge });
  const nb = k.on('nose');
  const cone = [[1.39, -0.8], [1.37, -0.66], [1.27, -0.4], [1.07, -0.14], [0.76, 0.07], [0.36, 0.19], [0.0001, 0.22]];
  const rel = (pts) => pts.map(([r, z]) => [r, z]);
  const outer = lathe(k, null, 'hull', rel(cone), { seg: 72, bev: 0.01 });
  nb.add('hull', outer.translate(0, -hinge.y, -hinge.z), true);
  if (!k.far) {
    const inner = lathe(k, null, 'paintWhite', cone.map(([r, z]) => [r - 0.045, z - 0.03]).reverse(), { seg: 56, bev: 0 });
    nb.add('paintWhite', inner.translate(0, -hinge.y, -hinge.z), false);
    const rim = lathe(k, null, 'paintWhite', [[1.33, -0.805], [1.39, -0.805]], { seg: 64, bev: 0 });
    nb.add('paintWhite', rim.translate(0, -hinge.y, -hinge.z), false);
    // hinge: two lugs on the cone rim, a cranked arm pair and the actuator strut down to the bulkhead
    for (const sx of [-0.3, 0.3]) {
      block(k, nb, 'metalBare', V(sx, -0.16, 0.1), 0.07, 0.36, 0.09, null, { bev: 0.012 });
      rod(k, nb, 'metalDark', V(sx - 0.06, 0, 0), V(sx + 0.06, 0, 0), 0.04, { seg: 12 });
      block(k, nb, 'metalBare', V(sx, -0.34, 0.05), 0.09, 0.08, 0.2, null, { bev: 0.01 });
    }
    rod(k, nb, 'metalBare', V(0, -0.3, 0.06), V(0, -0.85, -0.02), 0.025, { seg: 8 });
    if (k.near) boltCircle(k, nb, V(0, -hinge.y, -0.805 - hinge.z), V(0, 0, -1), 1.36, 36, 0.008);
  }
  if (!k.far) for (const sx of [-0.28, 0.28]) block(k, b, 'metalDark', V(sx, 1.36, -0.78), 0.12, 0.1, 0.08, null, { bev: 0.01 });

  k.collider(C.sphere(V(0, 0, -0.3), 1.15, 'dockRing'));
  k.collider(C.capsule(V(0, 0, -1.0), V(0, 0, -3.3), 1.75, 'capsule'));
  k.collider(C.capsule(V(0, 0, -4.2), V(0, 0, -6.4), 1.9, 'trunk'));
  k.collider(C.sphere(V(0, 2.15, -0.45), 0.78, 'noseCone'));
  return { scs, hinges: [{ pivot: 'nose', axis: 'x', from: 0, to: -1.75, channel: 'nose' }] };
}

export const DRAGON = {
  type: 'dragon', name: 'Вега', label: 'Корабль-капсула', size: 'small', length: 7.3, boundRadius: 4.2,
  mainAxis: Z_AXIS, upAxis: Y_AXIS, author: dragonAuthor,
};
