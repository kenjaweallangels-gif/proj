import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { boxAt, bevelBoxAt, tubeAt, torusAt, latheAt, plate, scaleUV, mat, quatZ, Colliders, X_AXIS, Y_AXIS, Z_AXIS } from './Builder.js';
import { COL, boltCircle, radialBolts, boltRow, connectorPanel } from './Detail.js';
import { cameraAssembly, evaLamp } from './Hardware.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CY = LAYOUT.clusterY;
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** Apply the port frame (origin = docking plane, +Z outward) to a geometry built in port-local space. */
function P(geo, frame) { return geo.applyMatrix4(frame); }

/**
 * Docking hub (hexagonal node with 6 ports) + IDSS-style docking ports on module ends.
 * Port record: { id, name, position, quaternion, size, occupant, approachAxis } with local +Z = approachAxis.
 */
export function buildDocking(ctx, station, b, rails, mods) {
  const ports = [];
  const colliders = [];
  const D = b.detail;     // close-range hardware (null on 'lite')
  const ROT_X90 = new THREE.Matrix4().makeRotationX(Math.PI / 2);   // local Y -> port +Z
  const HX = LAYOUT.hubX, HR = 3.1, HL = 6;

  /** One docking port. base = point on the hull; axis = outward unit; depth = tunnel length to the docking plane. */
  function addPort({ id, name, base, axis, depth, size }) {
    const R = size === 'large' ? 1.2 : 0.8;
    const q = quatZ(axis);
    const position = base.clone().addScaledVector(axis, depth);
    const F = new THREE.Matrix4().compose(position, q, V(1, 1, 1));
    const O = V(0, 0, 0);
    // Port body as closed lathe solids (profiles counter-clockwise in (radius, axial)): tunnel from inside the
    // hull with a bolted base flange, slightly tapered wall, machined hard-capture ring (outer lip, docking face,
    // bore, hatch seat). MLI boot with taped edges over the tunnel, raised hazard band on the ring.
    b.add('hullWhite', P(latheAt(O, Z_AXIS, [[R - 0.12, -depth - 0.25], [R + 0.36, -depth - 0.25], [R + 0.36, -depth + 0.18], [R + 0.52, -depth + 0.2], [R + 0.52, -depth + 0.31], [R + 0.36, -depth + 0.36], [R + 0.3, -0.36]], 40), F));
    b.add('metalMachined', P(latheAt(O, Z_AXIS, [[R + 0.3, -0.36], [R + 0.32, -0.34], [R + 0.32, -0.02], [R + 0.29, 0.0], [R + 0.03, 0.0], [R - 0.02, -0.03], [R - 0.02, -0.08], [R - 0.12, -0.08], [R - 0.12, -depth - 0.25]], 48), F));
    if (depth > 0.75) b.add('mliBlack', P(latheAt(O, Z_AXIS, [[R + 0.33, -depth + 0.37], [R + 0.41, -depth + 0.41], [R + 0.41, -0.49], [R + 0.31, -0.42]], 40), F));
    b.add('hazard', P(scaleUV(latheAt(O, Z_AXIS, [[R + 0.32, -0.3], [R + 0.335, -0.29], [R + 0.335, -0.21], [R + 0.32, -0.2], [R + 0.32, -0.3]], 48), 14, 14), F), false);
    b.add('rubberBlack', P(latheAt(O, Z_AXIS, [[R + 0.06, 0.0], [R + 0.06, 0.006], [R + 0.14, 0.006], [R + 0.14, 0.0]].reverse(), 48), F), false);
    // closed hatch in the seat: slightly domed plug with a handle and an equalisation valve
    b.add('hullWhiteAged', P(latheAt(O, Z_AXIS, [[R - 0.12, -0.075], [R - 0.2, -0.06], [0.0, -0.045]], 40), F), false);
    b.add('metalBare', P(tubeAt(V(0, -R * 0.35, -0.0), X_AXIS, 0.018, R * 0.6, 10, { uv: false }), F), false);
    for (const sx of [-1, 1]) b.add('metalBare', P(tubeAt(V(sx * R * 0.28, -R * 0.35, -0.025), Z_AXIS, 0.014, 0.05, 8, { uv: false }), F), false);
    b.add('metalDark', P(latheAt(V(R * 0.3, R * 0.3, -0.05), Z_AXIS, [[0.06, 0], [0.06, 0.03], [0.035, 0.05], [0, 0.05]], 16), F), false);
    // twelve hook housings on the ring's outer wall, each with a hook arm reaching over the docking face
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
      const Mk = new THREE.Matrix4().makeRotationZ(a);
      b.add('metalDark', P(bevelBoxAt(V(R + 0.38, 0, -0.16), 0.12, 0.17, 0.22, null, 0.02).applyMatrix4(Mk), F), false);
      b.add('metalBare', P(bevelBoxAt(V(R + 0.3, 0, 0.02), 0.2, 0.07, 0.05, null, 0.012).applyMatrix4(Mk), F), false);
      b.add('metalDark', P(bevelBoxAt(V(R + 0.38, 0, -0.03), 0.07, 0.08, 0.07, null, 0.012).applyMatrix4(Mk), F), false);
      b.add('metalBare', P(bevelBoxAt(V(R + 0.22, 0, 0.012), 0.05, 0.07, 0.03, null, 0.01).applyMatrix4(Mk), F), false);
    }
    // passive interface: no soft-capture system (the visiting vehicle carries it); two alignment guide pins and
    // two umbilical connector housings on the docking face
    for (const k of [0, 1]) {
      const a = k * Math.PI + Math.PI / 2;
      b.add('metalBare', P(latheAt(V((R + 0.16) * Math.cos(a), (R + 0.16) * Math.sin(a), 0), Z_AXIS, [[0.035, 0], [0.035, 0.05], [0.02, 0.09], [0, 0.095]], 12), F), false);
      const ac = a + Math.PI / 2;
      b.add('metalDark', P(bevelBoxAt(V((R + 0.16) * Math.cos(ac), (R + 0.16) * Math.sin(ac), 0.02), 0.16, 0.16, 0.04, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, ac), 0.01), F), false);
    }
    // docking target on the hatch: bolted foot, standoff post, black disc with a rim, white cross
    b.add('metalDark', P(latheAt(V(-R * 0.5, 0, -0.05), Z_AXIS, [[0.07, 0], [0.07, 0.015], [0.03, 0.03], [0, 0.03]], 16), F), false);
    b.add('metalDark', P(tubeAt(V(-R * 0.5, 0, 0.09), Z_AXIS, 0.022, 0.26, 10, { uv: false }), F), false);
    b.add('rubberBlack', P(latheAt(V(-R * 0.5, 0, 0.215), Z_AXIS, [[0, -0.012], [0.19, -0.012], [0.2, -0.004], [0.2, 0.008], [0.19, 0.012], [0.0, 0.012]], 24), F), false);
    b.add('antennaWhite', P(bevelBoxAt(V(-R * 0.5, 0, 0.231), 0.28, 0.045, 0.012, null, 0.004), F), false);
    b.add('antennaWhite', P(bevelBoxAt(V(-R * 0.5, 0, 0.231), 0.045, 0.28, 0.012, null, 0.004), F), false);
    // two docking lights on the base flange, aimed along the approach axis
    if (depth >= 0.6) for (const sx of [-1, 1]) evaLamp(b, D, V(sx * (R + 0.44), 0, -depth + 0.31).applyMatrix4(F), sx, { n: axis, up: V(0, 1, 0).applyQuaternion(q) });
    // hand rails around the base for EVA access
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const n = V(Math.cos(a), Math.sin(a), 0).applyQuaternion(q);
      const p0 = base.clone().addScaledVector(axis, Math.max(0.15, depth - 0.9)).addScaledVector(n, R + 0.42);
      const p1 = base.clone().addScaledVector(axis, Math.max(0.15, depth - 0.9) + 0.6).addScaledVector(n, R + 0.42);
      if (depth > 0.8) rails.addRail(p0, p1, n);
    }
    // port id plate on the tunnel side (two sides) so pilots and EVA crew can read it
    if (depth >= 0.9) for (const sgn of [1, -1]) {
      const n = V(0, sgn, 0).applyQuaternion(q);
      b.labelAt(id, 0.7, 0.35, base.clone().addScaledVector(axis, depth * 0.45).addScaledVector(n, R + 0.4), n, { width: 256, height: 128, color: '#2a3340', right: V(sgn, 0, 0).applyQuaternion(q) });
    }
    colliders.push(Colliders.capsule(base.clone().addScaledVector(axis, -0.2), position.clone().addScaledVector(axis, 0.45), R + 0.45, `port:${id}`));
    const port = { id, name, position, quaternion: q, size, occupant: null, approachAxis: axis.clone().normalize() };
    ports.push(port);
    return port;
  }

  // ---------- hexagonal docking hub "Гавань" ----------
  const hubC = V(HX, CY, 0);
  // closed hexagonal prism (apothem 3.2) with raised, chamfered face panels, bevelled edge rails along the six
  // corners and two hex end flanges; polygons in the YZ plane are extruded along X (plate() + rotation)
  const hexPts = (ap) => { const rv = ap / Math.cos(Math.PI / 6), p = []; for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; p.push([rv * Math.cos(a), rv * Math.sin(a)]); } return p; };
  const toHub = (g, x) => g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2)).translate(HX + x, CY, 0);
  b.add('hullWhite', toHub(plate(hexPts(3.2), HL - 0.1, 0.04), 0));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;           // face normal angle from +Z toward +Y
    const dir = V(0, Math.sin(a), Math.cos(a));
    const qf = new THREE.Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2 - a);   // local Y -> dir
    const fw = 2 * 3.2 * Math.tan(Math.PI / 6);
    for (const sx of [-1, 1]) b.add(k === 1 ? 'hullWhiteAged' : 'hullWhite', bevelBoxAt(hubC.clone().addScaledVector(dir, 3.225).add(V(sx * (HL / 4 - 0.02), 0, 0)), HL / 2 - 0.3, 0.05, fw - 0.36, qf, 0.015));
    // corner rail at the vertex between this face and the next
    const av = a + Math.PI / 6, dv = V(0, Math.sin(av), Math.cos(av));
    b.add('metalDark', bevelBoxAt(hubC.clone().addScaledVector(dv, 3.2 / Math.cos(Math.PI / 6) - 0.04), HL - 0.12, 0.14, 0.16, new THREE.Quaternion().setFromAxisAngle(X_AXIS, Math.PI / 2 - av), 0.03), false);
  }
  for (const e of [-1, 1]) {
    b.add('mliBlack', toHub(plate(hexPts(3.3), 0.34, 0.05), e * (HL / 2 + 0.12)));
    b.add('hullWhite', toHub(plate(hexPts(3.1), 0.22, 0.04), e * (HL / 2 + 0.36)));
  }
  // tunnel to the service module
  b.add('mliSilver', tubeAt(V(HX - HL / 2 - 1.0, CY, 0), X_AXIS, 1.45, 2.2, 32));
  b.add('metalDark', torusAt(V(HX - HL / 2 - 0.3, CY, 0), X_AXIS, 1.48, 0.07, 6, 32), false);
  colliders.push(Colliders.capsule(V(HX - HL / 2 - 0.6, CY, 0), V(HX + HL / 2 + 0.6, CY, 0), HR + 0.6, 'hub'));
  colliders.push(Colliders.capsule(V(HX - HL / 2 - 2.5, CY, 0), V(HX - HL / 2, CY, 0), 1.55, 'hubTunnel'));
  // hub labels on the forward end plate (below the axial port) and cameras
  b.labelAt('ГАВАНЬ · HARBOR', 3.2, 0.42, V(HX + HL / 2 + 0.47, CY - 2.5, 0), X_AXIS, { width: 1024 });
  for (const sz of [-1, 1]) {
    // camera booms at the hub ends watching the radial ports
    cameraAssembly(b, D, V(HX + 2.6, CY + 3.25, sz * 1.0), Y_AXIS, V(0.25, -0.35, sz), { stand: 0.8 });
  }
  // handrails along the hub edges (between faces)
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;      // hex vertices (edges between faces)
    const dir = V(0, Math.sin(a), Math.cos(a));
    rails.addLine(hubC.clone().addScaledVector(dir, HR + 0.3).add(V(-2.4, 0, 0)), hubC.clone().addScaledVector(dir, HR + 0.3).add(V(2.4, 0, 0)), dir, 1.1, 0.3);
  }

  // hub ports: axial +X (large) and five radial (angles from +Z toward +Y; 90° is the pylon)
  addPort({ id: 'H1', name: 'Гавань-1 (осевой)', base: V(HX + HL / 2 + 0.45, CY, 0), axis: X_AXIS, depth: 1.1, size: 'large' });
  const radial = [[-30, 'large', 'H2'], [-90, 'large', 'H3'], [-150, 'large', 'H4'], [30, 'small', 'H5'], [150, 'small', 'H6']];
  for (const [deg, size, id] of radial) {
    const a = deg * Math.PI / 180;
    const axis = V(0, Math.sin(a), Math.cos(a));
    addPort({ id, name: `Гавань-${id[1]}`, base: hubC.clone().addScaledVector(axis, HR), axis, depth: 1.2, size });
  }
  // ports on module ends / node stubs
  const n1 = mods.nodes.n1, n3 = mods.nodes.n3;
  addPort({ id: 'N1', name: 'Узел-1 надир-бок', base: V(n1.center.x, CY, -(n1.r + 0.55)), axis: V(0, 0, -1), depth: 0.9, size: 'small' });
  addPort({ id: 'N3', name: 'Узел-3 бок', base: V(n3.center.x, CY, -(n3.r + 0.55)), axis: V(0, 0, -1), depth: 0.9, size: 'small' });
  const hab1 = mods.hab1, green = mods.green;
  addPort({ id: 'P1', name: 'Горизонт торец', base: hab1.axisPoint(hab1.len / 2 + 0.95), axis: hab1.dir, depth: 0.7, size: 'small' });
  addPort({ id: 'P2', name: 'Флора торец', base: green.axisPoint(green.len / 2 + 0.95), axis: green.dir, depth: 0.7, size: 'small' });

  return { ports, colliders };
}
