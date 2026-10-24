import * as THREE from 'three';
import { lathe, flange, boltCircle, rod, block, thruster, lamp, axial, seam, V, X_AXIS, Y_AXIS, Z_AXIS, quatZ, LocalColliders } from './Kit.js';

/**
 * Docking / berthing mechanisms shared by the ship types (ship frame: +Z toward the port, docking plane z = 0).
 *
 *   idssActive  – IDSS/NDS-class androgynous system (Dragon, Starliner): hard-capture ring with 12 hooks,
 *                 soft-capture ring with 3 guide petals on 6 telescoping actuators (pivot 'scs'), umbilicals.
 *   ssvpProbe   – Russian probe-drogue active unit (Soyuz, Progress): docking frame with 8 hooks, probe
 *                 housing and telescoping probe with latch head (pivot 'probe').
 *   cbmPassive  – passive common berthing ring (Cygnus, HTV-X, cargo module): ring, 4 alignment guides,
 *                 16 bolt fittings, square hatch.
 * All return a small record the animation code uses.
 */

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

/** Hook part geometry for instancing: hinge axis = local X, body toward +Z, tip toward -Y (inward). */
function hookParts(k, len = 0.14) {
  const parts = [['metalBare', new THREE.BoxGeometry(0.05, 0.028, len).translate(0, 0, len / 2)]];
  parts.push(['metalBare', new THREE.BoxGeometry(0.05, 0.05, 0.026).translate(0, -0.022, len - 0.013)]);
  if (k.near) parts.push(['metalDark', new THREE.CylinderGeometry(0.014, 0.014, 0.07, 8).rotateZ(Math.PI / 2)]);
  return parts;
}

/**
 * IDSS-class active docking system. R = port ring radius (0.8 small). `base` = z where the tunnel meets the
 * vehicle's forward bulkhead. Creates pivot 'scs' and instanced set 'hooks'.
 */
export function idssActive(k, { R = 0.8, base = -0.62, tunnel = 'hullGray', petals = 3 } = {}) {
  const tpl = k.tpl, b = k.b;
  const Ro = R + 0.3, Ri = R + 0.03;
  // hard-capture ring: mating face (z = 0) with a chamfered outer lip, outer skirt down to the bulkhead
  lathe(k, b, 'dockRing', [[Ro + 0.02, base], [Ro + 0.02, -0.16], [Ro, -0.12], [Ro, -0.02], [Ro - 0.02, 0], [Ri + 0.02, 0], [Ri, -0.02], [Ri, -0.12]], { seg: 64, bev: 0.008, shadow: true });
  // inner tunnel wall (seen from inside) and the hatch at the bottom
  if (!k.far) {
    lathe(k, b, tunnel, [[Ri - 0.005, -0.12], [Ri - 0.005, base]], { seg: 48, bev: 0, shadow: false });   // inner wall (normals inward)
    lathe(k, b, 'hullAged', [[0.0001, base + 0.04], [Ri - 0.01, base + 0.04]].reverse(), { seg: 40, bev: 0, shadow: false });
    // hatch: raised dome plate, hinge block, handle
    lathe(k, b, 'paintGray', [[R * 0.62, base + 0.045], [R * 0.6, base + 0.07], [R * 0.2, base + 0.09], [0.0001, base + 0.092]], { seg: 32, bev: 0, shadow: false });
    if (k.near) {
      block(k, b, 'metalDark', V(0, R * 0.66, base + 0.08), 0.22, 0.08, 0.06, null, { bev: 0.01 });
      rod(k, b, 'metalBare', V(-0.12, -R * 0.3, base + 0.12), V(0.12, -R * 0.3, base + 0.12), 0.012, { seg: 6 });
      boltCircle(k, b, V(0, 0, base + 0.05), Z_AXIS, R * 0.72, 20, 0.009);
    }
  }
  // ring flanges / bolt circles on the face, seal groove
  flange(k, b, -0.17, Ro + 0.02, { h: 0.035, w: 0.05, bolts: 36 });
  seam(k, b, 0.001, (Ro + Ri) / 2, { surf: 'rubberBlack', t: 0.008 });
  boltCircle(k, b, V(0, 0, 0), Z_AXIS, Ri + 0.05, 24, 0.008);
  // 4 guide pins + sockets, 2 umbilical connectors, 8 push-off spring plungers
  if (!k.far) for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, rr = (Ro + Ri) / 2;
    const p = V(Math.cos(a) * rr, Math.sin(a) * rr, 0);
    if (i % 2 === 0) rod(k, b, 'metalBare', p, p.clone().setZ(0.07), 0.018, { seg: 10, rEnd: 0.008 });
    else { const g = new THREE.TorusGeometry(0.02, 0.006, 4, 10).translate(p.x, p.y, 0.002); b.add('metalDark', g, false); }
  }
  if (k.near) {
    for (const a of [0, Math.PI]) {
      const rr = (Ro + Ri) / 2, p = V(Math.cos(a) * rr, Math.sin(a) * rr, 0.0);
      const q = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a);
      block(k, b, 'metalDark', p.clone().setZ(0.012), 0.08, 0.14, 0.024, q, { bev: 0.005 });
      for (let j = 0; j < 4; j++) rod(k, b, 'gold', V(0, 0, 0).copy(p).add(V(0.0, (j - 1.5) * 0.028, 0).applyQuaternion(q)).setZ(0.024), V(0, 0, 0).copy(p).add(V(0.0, (j - 1.5) * 0.028, 0).applyQuaternion(q)).setZ(0.04), 0.006, { seg: 5 });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) / 8 * Math.PI * 2, rr = Ro - 0.04, p = V(Math.cos(a) * rr, Math.sin(a) * rr, 0);
      rod(k, b, 'metalBare', p, p.clone().setZ(0.025), 0.014, { seg: 8 });
    }
  }
  // 12 hook housings on the outer skirt + 12 animated hooks (instanced, hinge tangential)
  const hooks = [];
  const nH = 12, rH = Ro + 0.07;   // outside both mating rings: the hooks reach over the port's ring lip
  for (let i = 0; i < nH; i++) {
    const a = (i + 0.5) / nH * Math.PI * 2;
    const q = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a - Math.PI / 2);   // local Y -> radial
    if (!k.far) block(k, b, 'metalDark', V(Math.cos(a) * (Ro + 0.07), Math.sin(a) * (Ro + 0.07), -0.13), 0.11, 0.08, 0.14, q, { bev: 0.012 });
    hooks.push(new THREE.Matrix4().compose(V(Math.cos(a) * rH, Math.sin(a) * rH, -0.07), q, _s));
  }
  if (!k.far) k.instanced('hooks', hookParts(k), nH);
  tpl.hookBase = hooks;

  // soft-capture system: pivot 'scs' translating along Z (0 = retracted)
  tpl.pivot('scs');
  const s = k.on('scs');
  const rs = R * 0.9;
  lathe(k, s, 'metalBare', [[rs - 0.06, -0.06], [rs + 0.05, -0.06], [rs + 0.06, -0.04], [rs + 0.06, 0.0], [rs + 0.04, 0.02], [rs - 0.06, 0.02]], { seg: 56, bev: 0.006, shadow: false });
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 + Math.PI / 2;
    const q = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a - Math.PI / 2).multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, 0.42));
    const c = V(Math.cos(a) * (rs - 0.04), Math.sin(a) * (rs - 0.04), 0.13);
    // trapezoid petal plate: extruded shape
    const sh = new THREE.Shape(); sh.moveTo(-0.24, -0.12); sh.lineTo(0.24, -0.12); sh.lineTo(0.09, 0.15); sh.lineTo(-0.09, 0.15); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.025, bevelEnabled: !k.far, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
    g.rotateX(Math.PI / 2).translate(0, 0.0125, 0);   // shape Y -> local Z (outward), thickness along local Y (radial)
    s.add('metalBare', g.applyMatrix4(_m.compose(c, q, _s)), false);
    if (k.near) block(k, s, 'metalDark', c.clone().setZ(0.0), 0.12, 0.05, 0.05, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a - Math.PI / 2), { bev: 0.008 });
    // capture latch striker on the petal base
    if (k.near) block(k, s, 'gold', V(Math.cos(a) * (rs + 0.07), Math.sin(a) * (rs + 0.07), -0.02), 0.06, 0.03, 0.05, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a - Math.PI / 2));
  }
  // six actuators: cylinders fixed on the base ring, rods on the SCS ring (telescoping)
  if (!k.far) for (let i = 0; i < 6; i++) {
    const a0 = (Math.floor(i / 2) / 3) * Math.PI * 2 + Math.PI / 2 + (i % 2 ? 0.42 : -0.42);
    const a1 = (Math.floor(i / 2) / 3) * Math.PI * 2 + Math.PI / 2 + (i % 2 ? 0.2 : -0.2);
    const pb = V(Math.cos(a0) * (Ri - 0.1), Math.sin(a0) * (Ri - 0.1), base + 0.12);
    const pr = V(Math.cos(a1) * (rs - 0.02), Math.sin(a1) * (rs - 0.02), -0.06);
    rod(k, b, 'metalDark', pb, pb.clone().lerp(pr.clone().setZ(pr.z - 0.3), 0.7), 0.028, { seg: 10 });
    rod(k, s, 'metalBare', pr, pr.clone().lerp(pb.clone().setZ(pb.z + 0.3), 0.75), 0.016, { seg: 8 });
  }
  return { scs: 'scs', travel: 0.36, retracted: -0.26 };
}

/** Flip a geometry's normals and winding in place (for surfaces seen from inside). */
function flipNormals(g) {
  const idx = g.index;
  if (idx) for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, a); }
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

/**
 * Russian probe ("штырь") active docking unit at the front of an orbital / cargo compartment.
 * Frame ring r 0.62..1.0 on the docking plane, 8 hooks, probe on the axis (pivot 'probe': z offset, tip at
 * -0.04 retracted / +0.42 extended). Returns { tipRetracted, travel }.
 */
export function ssvpProbe(k, { base = -0.5, Ri = 0.42, Ro = 0.76 } = {}) {
  const tpl = k.tpl, b = k.b;
  lathe(k, b, 'dockRing', [[Ro + 0.03, base], [Ro + 0.03, -0.1], [Ro, -0.06], [Ro, -0.015], [Ro - 0.015, 0], [Ri + 0.015, 0], [Ri, -0.015], [Ri, -0.08]], { seg: 56, bev: 0.006 });
  seam(k, b, 0.001, (Ri + Ro) / 2, { surf: 'rubberBlack', t: 0.007 });
  boltCircle(k, b, V(0, 0, 0), Z_AXIS, Ri + 0.05, 16, 0.008);
  boltCircle(k, b, V(0, 0, 0), Z_AXIS, Ro - 0.05, 24, 0.008);
  flange(k, b, -0.12, Ro + 0.03, { h: 0.035, w: 0.05, bolts: 32 });
  if (!k.far) {
    // receiving bowl around the probe base + hatch behind it
    lathe(k, b, 'paintGray', [[0.0001, base + 0.02], [Ri - 0.01, base + 0.02], [Ri - 0.01, -0.08]].reverse(), { seg: 40, bev: 0, shadow: false });
    if (k.near) boltCircle(k, b, V(0, 0, base + 0.02), Z_AXIS, Ri - 0.06, 24, 0.008);
    // cross-beams carrying the probe housing
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      rod(k, b, 'metalBare', V(Math.cos(a) * 0.12, Math.sin(a) * 0.12, base + 0.15), V(Math.cos(a) * (Ri - 0.02), Math.sin(a) * (Ri - 0.02), base + 0.06), 0.022, { seg: 8 });
    }
    // probe housing (fixed) with shock absorber collar
    lathe(k, b, 'metalBare', [[0.13, base + 0.03], [0.13, base + 0.18], [0.1, base + 0.24], [0.075, base + 0.26], [0.075, base + 0.36], [0.06, base + 0.38]], { seg: 24, bev: 0.006, shadow: false });
    if (k.near) for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      rod(k, b, 'metalDark', V(Math.cos(a) * 0.12, Math.sin(a) * 0.12, base + 0.1), V(Math.cos(a) * 0.085, Math.sin(a) * 0.085, base + 0.3), 0.012, { seg: 6 });
    }
    // two guide pins and two connector plates on the frame, 4 push rods
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, p = V(Math.cos(a) * (Ri + Ro) / 2, Math.sin(a) * (Ri + Ro) / 2, 0);
      if (i % 2) rod(k, b, 'metalBare', p, p.clone().setZ(0.06), 0.016, { seg: 8, rEnd: 0.007 });
      else if (k.near) { block(k, b, 'metalDark', p.clone().setZ(0.01), 0.12, 0.07, 0.02, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a), { bev: 0.004 }); }
    }
    if (k.near) for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, p = V(Math.cos(a) * (Ri + Ro) / 2, Math.sin(a) * (Ri + Ro) / 2, 0);
      rod(k, b, 'metalBare', p, p.clone().setZ(0.03), 0.012, { seg: 6 });
    }
  }
  // 8 hooks with housings on the frame's outer rim
  const hooks = [];
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2;
    const q = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a - Math.PI / 2);
    if (!k.far) block(k, b, 'metalDark', V(Math.cos(a) * (Ro + 0.09), Math.sin(a) * (Ro + 0.09), -0.1), 0.1, 0.09, 0.12, q, { bev: 0.01 });
    hooks.push(new THREE.Matrix4().compose(V(Math.cos(a) * (Ro + 0.15), Math.sin(a) * (Ro + 0.15), -0.06), q, _s));
  }
  if (!k.far) k.instanced('hooks', hookParts(k, 0.11), 8);
  tpl.hookBase = hooks;
  // telescoping probe (pivot): rod + head with three latches; pivot z = extension offset
  const tipZ0 = -0.04;
  tpl.pivot('probe');
  const p = k.on('probe');
  if (!k.far) {
    rod(k, p, 'metalBare', V(0, 0, tipZ0 - 0.85), V(0, 0, tipZ0 - 0.1), 0.042, { seg: 14 });
    lathe(k, p, 'metalBare', [[0.042, tipZ0 - 0.12], [0.07, tipZ0 - 0.1], [0.075, tipZ0 - 0.06], [0.05, tipZ0 - 0.02], [0.018, tipZ0], [0.0001, tipZ0 + 0.004]], { seg: 20, bev: 0.004, shadow: false });
    if (k.near) for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2;
      block(k, p, 'metalDark', V(Math.cos(a) * 0.07, Math.sin(a) * 0.07, tipZ0 - 0.07), 0.025, 0.018, 0.04, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a), {});
    }
  }
  return { tipRetracted: tipZ0, travel: 0.46 };
}

/**
 * Passive berthing ring (CBM-class) for a large port (R 1.2): face annulus 1.05..1.45 at z = 0, a vestibule
 * cylinder down to z = -depth, 4 alignment guides straddling the port ring, 16 bolt fittings and a square hatch.
 */
export function cbmPassive(k, { depth = 0.62, Ro = 1.45, Ri = 1.05, surf = 'dockRing' } = {}) {
  const b = k.b;
  lathe(k, b, surf, [[Ro + 0.04, -depth], [Ro + 0.04, -0.12], [Ro, -0.08], [Ro, -0.015], [Ro - 0.015, 0], [Ri + 0.015, 0], [Ri, -0.015], [Ri, -0.1]], { seg: 72, bev: 0.008 });
  seam(k, b, 0.001, (Ro + Ri) / 2 + 0.06, { surf: 'rubberBlack', t: 0.01 });
  flange(k, b, -0.13, Ro + 0.04, { h: 0.04, w: 0.06, bolts: 48 });
  flange(k, b, -depth + 0.05, Ro + 0.04, { h: 0.05, w: 0.08, bolts: 48, face: -1 });
  boltCircle(k, b, V(0, 0, 0), Z_AXIS, Ri + 0.06, 32, 0.009);
  // 16 bolt fittings (nut housings) around the face
  if (!k.far) for (let i = 0; i < 16; i++) {
    const a = (i + 0.5) / 16 * Math.PI * 2, rr = (Ro + Ri) / 2 + 0.02;
    rod(k, b, 'metalBare', V(Math.cos(a) * rr, Math.sin(a) * rr, -0.002), V(Math.cos(a) * rr, Math.sin(a) * rr, 0.012), 0.03, { seg: 6 });
  }
  // 4 alignment guides (outside the mating ring, at 45 deg)
  if (!k.far) for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const q = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a - Math.PI / 2);
    const sh = new THREE.Shape(); sh.moveTo(-0.16, -0.22); sh.lineTo(0.16, -0.22); sh.lineTo(0.06, 0.2); sh.lineTo(-0.06, 0.2); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: !k.far, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
    g.rotateX(Math.PI / 2);                                 // shape Y -> +Z: wide foot on the ship, tip forward
    g.translate(0, Ro + 0.12, 0.0);
    b.add('metalBare', g.applyMatrix4(_m.makeRotationFromQuaternion(q)), false);
    block(k, b, 'metalDark', V(Math.cos(a) * (Ro + 0.11), Math.sin(a) * (Ro + 0.11), -0.25), 0.34, 0.08, 0.1, q, { bev: 0.01 });
  }
  // hatch: square with rounded corners, recessed
  if (!k.far) {
    lathe(k, b, 'hullGray', [[0.0001, -depth + 0.02], [Ri - 0.01, -depth + 0.02], [Ri - 0.01, -0.1]].reverse(), { seg: 48, bev: 0, shadow: false });
    const sh = new THREE.Shape(); const hw = 0.62, rc = 0.15;
    sh.moveTo(-hw + rc, -hw); sh.lineTo(hw - rc, -hw); sh.quadraticCurveTo(hw, -hw, hw, -hw + rc); sh.lineTo(hw, hw - rc); sh.quadraticCurveTo(hw, hw, hw - rc, hw);
    sh.lineTo(-hw + rc, hw); sh.quadraticCurveTo(-hw, hw, -hw, hw - rc); sh.lineTo(-hw, -hw + rc); sh.quadraticCurveTo(-hw, -hw, -hw + rc, -hw);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: !k.far, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1, curveSegments: k.near ? 4 : 2 });
    b.add('paintGray', g.translate(0, 0, -depth + 0.03), false);
    if (k.near) {
      rod(k, b, 'metalBare', V(-0.25, -0.3, -depth + 0.1), V(0.25, -0.3, -depth + 0.1), 0.014, { seg: 6 });
      block(k, b, 'metalDark', V(0, 0, -depth + 0.09), 0.18, 0.18, 0.04, null, { bev: 0.01 });
      for (const sx of [-1, 1]) block(k, b, 'metalDark', V(sx * 0.5, 0.66, -depth + 0.08), 0.12, 0.06, 0.06, null, { bev: 0.01 });
    }
  }
  k.collider(LocalColliders.sphere(V(0, 0, -0.3), Ro + 0.15, 'cbm'));
}

/** Two docking lights on short brackets and an optional TV camera, around a docking unit of outer radius R. */
export function dockingLights(k, R, { camera = true, z = -0.15, angle = 0 } = {}) {
  const b = k.b;
  for (const s of [-1, 1]) {
    const a = angle + (s > 0 ? 0 : Math.PI);
    const p = V(Math.cos(a) * (R + 0.18), Math.sin(a) * (R + 0.18), z);
    if (!k.far) rod(k, b, 'metalDark', V(Math.cos(a) * (R - 0.02), Math.sin(a) * (R - 0.02), z - 0.08), p.clone().setZ(z - 0.08), 0.02, { seg: 6 });
    lamp(k, b, p, Z_AXIS, 0.13, 'dockLight');
  }
  if (camera && !k.far) {
    const a = angle + Math.PI / 2, p = V(Math.cos(a) * (R + 0.15), Math.sin(a) * (R + 0.15), z);
    block(k, b, 'paintWhite', p.clone().setZ(z - 0.08), 0.14, 0.12, 0.22, null, { bev: 0.015 });
    lathe(k, b, 'metalDark', [[0.04, z + 0.02], [0.045, z + 0.05], [0.0001, z + 0.05]], { seg: 12, bev: 0, shadow: false });
    if (k.near) b.add('lens', axial(new THREE.CircleGeometry(0.03, 12), p.clone().setZ(z + 0.052), Z_AXIS), false);
  }
}

export { thruster };
