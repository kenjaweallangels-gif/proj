import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { boxAt, tubeAt, torusAt, mat, quatZ, Colliders, X_AXIS, Y_AXIS, Z_AXIS } from './Builder.js';

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
  const HX = LAYOUT.hubX, HR = 3.1, HL = 6;

  /** One docking port. base = point on the hull; axis = outward unit; depth = tunnel length to the docking plane. */
  function addPort({ id, name, base, axis, depth, size }) {
    const R = size === 'large' ? 1.2 : 0.8;
    const q = quatZ(axis);
    const position = base.clone().addScaledVector(axis, depth);
    const F = new THREE.Matrix4().compose(position, q, V(1, 1, 1));
    // base tunnel from the hull to the ring, with an MLI collar and hazard band
    b.add('hullWhite', P(new THREE.CylinderGeometry(R + 0.28, R + 0.34, depth + 0.3, 32, 1, true).rotateX(Math.PI / 2).translate(0, 0, -depth / 2 - 0.05), F));
    b.add('mliBlack', P(new THREE.CylinderGeometry(R + 0.4, R + 0.4, Math.min(0.5, depth * 0.5), 32).rotateX(Math.PI / 2).translate(0, 0, -depth + 0.15), F));
    b.add('hazard', P(new THREE.TorusGeometry(R + 0.33, 0.045, 5, 40).translate(0, 0, -0.55), F), false);
    // hard-capture ring (docking plane) and the closed hatch face behind it
    b.add('metalBare', P(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 0.32, 40).rotateX(Math.PI / 2).translate(0, 0, -0.16), F));
    b.add('metalDark', P(new THREE.CylinderGeometry(R + 0.02, R + 0.02, 0.06, 32).rotateX(Math.PI / 2).translate(0, 0, -0.05), F), false);
    b.add('hullWhiteAged', P(new THREE.CylinderGeometry(R - 0.1, R - 0.1, 0.05, 32).rotateX(Math.PI / 2).translate(0, 0, -0.06), F), false);
    b.add('metalBare', P(new THREE.TorusGeometry(R + 0.12, 0.04, 6, 40).translate(0, 0, 0.02), F), false);
    // 12 latches / hooks around the ring
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      b.add('metalBare', P(new THREE.BoxGeometry(0.16, 0.12, 0.2).translate(0, R + 0.22, -0.1).applyMatrix4(_m.makeRotationZ(a)), F), false);
    }
    // soft-capture ring on three struts (extended), with petals and guide pins
    const rs = R * 0.86;
    b.add('metalBare', P(new THREE.TorusGeometry(rs, 0.05, 8, 48).translate(0, 0, 0.42), F), false);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      b.add('metalDark', P(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 6).rotateX(Math.PI / 2).translate(0, rs, 0.21).applyMatrix4(_m.makeRotationZ(a)), F), false);
      b.add('metalDark', P(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6).rotateX(Math.PI / 2).translate(0, rs + 0.02, 0.55).applyMatrix4(_m.makeRotationZ(a)), F), false);
      const petal = new THREE.BoxGeometry(0.42, 0.14, 0.26).translate(0, rs + 0.1, 0.5).applyMatrix4(_m.makeRotationX(-0.35)).applyMatrix4(_m.makeRotationZ(a + Math.PI / 3));
      b.add('metalBare', P(petal, F), false);
    }
    // docking target: standoff post + white cross on a black disc (as seen by an approaching ship)
    b.add('metalDark', P(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 6).rotateX(Math.PI / 2).translate(-R * 0.55, 0, 0.08), F), false);
    b.add('rubberBlack', P(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 16).rotateX(Math.PI / 2).translate(-R * 0.55, 0, 0.22), F), false);
    b.add('antennaWhite', P(new THREE.BoxGeometry(0.3, 0.05, 0.015).translate(-R * 0.55, 0, 0.235), F), false);
    b.add('antennaWhite', P(new THREE.BoxGeometry(0.05, 0.3, 0.015).translate(-R * 0.55, 0, 0.235), F), false);
    // two docking lights with hoods
    for (const sx of [-1, 1]) {
      b.add('metalDark', P(new THREE.BoxGeometry(0.22, 0.22, 0.26).translate(sx * (R + 0.52), 0, -0.3), F), false);
      b.add('dockLight', P(new THREE.BoxGeometry(0.14, 0.14, 0.03).translate(sx * (R + 0.52), 0, -0.16), F), false);
    }
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
  b.add('hullWhite', tubeAt(hubC, X_AXIS, HR - 0.1, HL, 24));
  for (let k = 0; k < 6; k++) {
    // flat hex face panels (apothem HR), rotated about X; angle from +Z towards +Y
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const dir = V(0, Math.sin(a), Math.cos(a));
    const c = hubC.clone().addScaledVector(dir, HR + 0.1);
    const qf = _q.setFromAxisAngle(X_AXIS, Math.PI / 2 - a);   // box local Y -> dir
    b.add(k === 1 ? 'hullWhiteAged' : 'hullWhite', boxAt(c, HL - 0.3, 0.22, 2 * (HR + 0.1) * Math.tan(Math.PI / 6) - 0.1, qf));
    b.add('metalDark', boxAt(c.clone().addScaledVector(dir, -0.02), HL - 0.2, 0.26, 0.18, qf), false);
  }
  for (const e of [-1, 1]) {
    b.add('mliBlack', new THREE.CylinderGeometry(HR + 0.55, HR + 0.55, 0.35, 6).rotateX(0).rotateZ(Math.PI / 2).translate(HX + e * (HL / 2 + 0.1), CY, 0));
    b.add('hullWhite', new THREE.CylinderGeometry(HR + 0.2, HR + 0.2, 0.2, 6).rotateZ(Math.PI / 2).translate(HX + e * (HL / 2 + 0.36), CY, 0));
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
    const base = V(HX + 2.6, CY + 2.6, sz * 1.0);
    b.add('metalDark', tubeAt(base.clone().add(V(0, 0.5, 0)), Y_AXIS, 0.05, 1.0, 6, { uv: false }), false);
    b.add('rubberBlack', boxAt(base.clone().add(V(0, 1.1, 0)), 0.3, 0.24, 0.24, null, false), false);
    b.add('metalBare', tubeAt(base.clone().add(V(0, 1.1, sz * 0.2)), V(0, 0, sz), 0.07, 0.12, 12, { uv: false }), false);
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
    addPort({ id, name: `Гавань-${id[1]}`, base: hubC.clone().addScaledVector(axis, HR + 0.2), axis, depth: 1.0, size });
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
