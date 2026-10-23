import * as THREE from 'three';
import { V, X_AXIS, Y_AXIS, Z_AXIS, box, sphere, cyl, LocalColliders as C } from '../ShipBuilder.js';
import { shipStart } from './Common.js';

/**
 * Inspection drone «Шмель» (~1.5 m): MLI-wrapped framed cube with a camera and two LED floods on +Z (its
 * nose), twelve tiny cold-gas nozzles on the corner blocks, amber beacon, two small solar panels.
 * Loiters around the station and never docks.
 */
export function buildDrone(ctx, { name = 'Шмель', number = 1 } = {}) {
  const { b, lights, group, nozzles } = shipStart(ctx, 'drone', name, number);
  const H = 0.42;   // half size of the body

  b.add('mliSilver', box(V(0, 0, 0), 2 * H, 2 * H, 2 * H, null, false));
  // frame edges
  for (const [ax, p] of [[Z_AXIS, [1, 1]], [Z_AXIS, [1, -1]], [Z_AXIS, [-1, 1]], [Z_AXIS, [-1, -1]], [X_AXIS, [1, 1]], [X_AXIS, [1, -1]], [X_AXIS, [-1, 1]], [X_AXIS, [-1, -1]], [Y_AXIS, [1, 1]], [Y_AXIS, [1, -1]], [Y_AXIS, [-1, 1]], [Y_AXIS, [-1, -1]]]) {
    const c = ax === Z_AXIS ? V(p[0] * H, p[1] * H, 0) : ax === X_AXIS ? V(0, p[0] * H, p[1] * H) : V(p[0] * H, 0, p[1] * H);
    b.add('metalDark', cyl(c, ax, 0.035, 2 * H + 0.06, 6, { uv: false }), false);
  }
  // camera + LED floods on the nose face (+Z)
  b.add('metalDark', cyl(V(0, 0, H + 0.1), Z_AXIS, 0.17, 0.2, 16, { uv: false }), false);
  b.add('camera', cyl(V(0, 0, H + 0.21), Z_AXIS, 0.13, 0.02, 16, { uv: false }), false);
  for (const sx of [-1, 1]) {
    b.add('metalDark', box(V(sx * 0.3, -0.26, H + 0.04), 0.14, 0.12, 0.08, null, false), false);
    b.add('dockLight', box(V(sx * 0.3, -0.26, H + 0.085), 0.1, 0.08, 0.02, null, false), false);
  }
  // beacon on top and a whip antenna
  b.add('beacon', sphere(V(0, H + 0.1, -0.2), 0.06, 10, 8), false);
  b.add('metalBare', cyl(V(0, H + 0.08, -0.2), Y_AXIS, 0.02, 0.16, 6, { uv: false }), false);
  b.add('antennaWhite', cyl(V(0.25, H + 0.35, -0.25), Y_AXIS, 0.012, 0.7, 5, { uv: false }), false);
  // two small solar panels on +-X
  for (const sx of [-1, 1]) {
    b.add('metalDark', cyl(V(sx * (H + 0.08), 0, 0), X_AXIS, 0.03, 0.16, 6, { uv: false }), false);
    b.add('solar', box(V(sx * (H + 0.47), 0, 0), 0.6, 0.02, 0.5), false);
    b.add('paintGray', box(V(sx * (H + 0.47), -0.012, 0), 0.58, 0.01, 0.48, null, false), false);
  }
  // twelve nozzles: three per corner block (blocks at +-X,+-Y of the back half)
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const c = V(sx * (H + 0.02), sy * (H + 0.02), -0.15);
    b.add('mliBlack', box(c, 0.14, 0.14, 0.2, null, false), false);
    for (const d of [V(sx, 0, 0), V(0, sy, 0), V(0, 0, (sx * sy > 0 ? -1 : 1))]) {
      const pos = c.clone().addScaledVector(d, 0.1);
      b.add('nozzle', cyl(pos, d, 0.02, 0.07, 8, { rTop: 0.04, open: true, uv: false }), false);
      nozzles.push({ position: pos.clone().addScaledVector(d, 0.04), direction: d.clone() });
    }
  }
  b.label(`${name.toUpperCase()}-${number}`, 0.5, 0.14, V(0, -H - 0.001, 0), V(0, -1, 0), { right: V(1, 0, 0), color: '#223047' });
  b.add('hazard', box(V(0, 0, -H - 0.005), 0.5, 0.08, 0.01, null, false), false);
  b.build(group, group.name, { lights, shadows: false, receive: false });

  return {
    group, colliders: [C.sphere(V(0, 0, 0), 0.8, 'drone')], nozzles, mainNozzles: [], mainAxis: Z_AXIS.clone(), upAxis: Y_AXIS.clone(), noseOffset: 0, size: 'small', length: 1.5, boundRadius: 1.1,
    label: 'Инспекционный дрон', shipName: `${name}-${number}`,
    parts: { lights },
    animate: null,
  };
}
