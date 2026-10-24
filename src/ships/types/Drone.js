import * as THREE from 'three';
import { rod, block, thruster, lamp, beacon, solarPanelParts, V, X_AXIS, Y_AXIS, Z_AXIS, LocalColliders as C } from '../Kit.js';

/**
 * Inspection drone «Шмель» (~1.5 m): MLI-wrapped framed cube with a camera and two LED floods on +Z (its
 * nose), twelve cold-gas nozzles on the corner blocks, amber beacon, two small solar panels.
 * Loiters around the station and never docks.
 */
function droneAuthor(k) {
  const b = k.b, H = 0.42;
  block(k, b, 'mliSilver', V(0, 0, 0), 2 * H, 2 * H, 2 * H, null, { bev: k.near ? 0.02 : 0, shadow: false });
  if (!k.far) {
    for (const ax of [X_AXIS, Y_AXIS, Z_AXIS]) for (const [u, w] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const c = ax === Z_AXIS ? V(u * H, w * H, 0) : ax === X_AXIS ? V(0, u * H, w * H) : V(u * H, 0, w * H);
      rod(k, b, 'metalDark', c.clone().addScaledVector(ax, -H - 0.03), c.clone().addScaledVector(ax, H + 0.03), 0.035, { seg: 6 });
    }
  }
  rod(k, b, 'metalDark', V(0, 0, H), V(0, 0, H + 0.2), 0.17, { seg: 16 });
  b.add('camera', new THREE.CircleGeometry(0.13, k.seg(16)).translate(0, 0, H + 0.205), false);
  for (const sx of [-1, 1]) lamp(k, b, V(sx * 0.3, -0.26, H + 0.06), Z_AXIS, 0.11, 'dockLight');
  beacon(k, b, V(0, H + 0.02, -0.2), Y_AXIS, 'beacon', 0.06);
  if (!k.far) rod(k, b, 'antennaWhite', V(0.25, H, -0.25), V(0.25, H + 0.7, -0.25), 0.012, { seg: 5 });
  for (const sx of [-1, 1]) {
    rod(k, b, 'metalDark', V(sx * H, 0, 0), V(sx * (H + 0.17), 0, 0), 0.03, { seg: 6 });
    // panel: hinge line along the boom end, spanning outward (+-X), cells up (+Y)
    const m = new THREE.Matrix4().makeBasis(V(0, 0, 1), V(sx, 0, 0), V(0, sx, 0)).setPosition(sx * (H + 0.17), 0, 0);
    if (sx < 0) m.makeBasis(V(0, 0, -1), V(-1, 0, 0), V(0, 1, 0)).setPosition(-(H + 0.17), 0, 0);
    for (const [s, g] of solarPanelParts(k, 0.5, 0.6, { hinge: false, cellUV: 2 })) b.add(s, g.applyMatrix4(m), false);
  }
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const c = V(sx * (H + 0.02), sy * (H + 0.02), -0.15);
    block(k, b, 'mliBlack', c, 0.14, 0.14, 0.2, null, { bev: 0.01 });
    for (const d of [V(sx, 0, 0), V(0, sy, 0), V(0, 0, (sx * sy > 0 ? -1 : 1))]) thruster(k, b, c.clone().addScaledVector(d, 0.07), d, 0.022, { bell: 1.8 });
  }
  k.label('{name}-{num}', 0.5, 0.14, V(0, -H - 0.003, 0), V(0, -1, 0), { right: V(1, 0, 0), color: '#223047' });
  k.collider(C.sphere(V(0, 0, 0), 0.8, 'drone'));
  return {};
}

export const DRONE = { type: 'drone', name: 'Шмель', label: 'Инспекционный дрон', size: 'small', length: 1.5, boundRadius: 1.1, mainAxis: Z_AXIS, upAxis: Y_AXIS, author: droneAuthor };
