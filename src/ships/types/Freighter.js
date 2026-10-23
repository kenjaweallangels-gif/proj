import * as THREE from 'three';
import { V, X_AXIS, Y_AXIS, Z_AXIS, tubeZ, latheZ, box, sphere, torus, cyl, rcsQuad, LocalColliders as C } from '../ShipBuilder.js';
import { Gimbal } from '../Gimbal.js';
import { shipStart, mainEngine, dockingNose, navLights, windowPane } from './Common.js';

/**
 * Cargo freighter «Ладья» (~18 m): pressurised cylinder in gold MLI, unpressurised trunk with exposed
 * pallets in a longeron frame, service section with two large solar wings, big tracking dish,
 * nav lights, main engine. Large port.
 */
export function buildFreighter(ctx, { name = 'Ладья', number = 1 } = {}) {
  const { b, lights, group, nozzles, colliders } = shipStart(ctx, 'freighter', name, number);
  const R = 1.2;

  const petals = dockingNose(b, R, group);

  // forward cone + pressurised cargo module
  b.add('hullDark', tubeZ(-0.7, -1.1, 1.5, 1.62, 48));
  b.add('hull', latheZ([[2.15, -1.95], [1.62, -1.1]], 56));
  b.add('mliGold', tubeZ(-1.95, -4.6, 2.16, 2.16, 56));
  b.add('hull', tubeZ(-4.6, -6.2, 2.15, 2.15, 56));
  b.add('mliGold', tubeZ(-6.2, -8.0, 2.16, 2.16, 56));
  for (const z of [-1.95, -4.6, -6.2, -8.0]) b.add('metalDark', torus(V(0, 0, z), Z_AXIS, 2.17, 0.04, 5, 56), false);
  b.add('hullDark', latheZ([[1.9, -8.45], [2.15, -8.0]], 48));
  // hazard band and labels on the white section
  b.add('hazard', tubeZ(-4.7, -4.85, 2.165, 2.165, 56, { uv: false }), false);
  for (const s of [-1, 1]) {
    b.label(`${name.toUpperCase()}-${number}`, 2.4, 0.55, V(0, s * 2.17, -5.45), V(0, s, 0), { right: V(-s, 0, 0), color: '#223047' });
    b.label('ГРУЗ · CARGO', 1.6, 0.3, V(s * 2.17, 0.4, -5.45), V(s, 0, 0), { right: V(0, 0, -s), color: '#9a2a1a' });
  }
  // grapple fixture and a small window on the cargo module
  b.add('metalBare', cyl(V(0, 2.15, -3.0), Y_AXIS, 0.12, 0.5, 10, { uv: false }), false);
  b.add('metalDark', sphere(V(0, 2.42, -3.0), 0.16, 10, 8), false);
  windowPane(b, V(0, -2.15, -3.0), V(0, -1, 0), 0.32, 0.32);
  // forward RCS quads (45 deg)
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const n = V(Math.cos(a), Math.sin(a), 0), tgt = V(-Math.sin(a), Math.cos(a), 0).multiplyScalar(k % 2 ? -1 : 1);
    rcsQuad(b, V(Math.cos(a) * 2.1, Math.sin(a) * 2.1, -2.5), n, [n, Z_AXIS, Z_AXIS.clone().negate(), tgt], nozzles, 0.1);
  }

  // unpressurised trunk: 4 longerons + 3 ring frames + diagonals, pallets inside
  const zT0 = -8.45, zT1 = -13.2, rL = 2.0;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    b.add('truss', box(V(Math.cos(a) * rL, Math.sin(a) * rL, (zT0 + zT1) / 2), 0.16, 0.16, zT0 - zT1, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a), false), false);
    const a2 = a + Math.PI / 2;
    for (const z of [zT0 - 0.08, (zT0 + zT1) / 2, zT1 + 0.08]) {
      const p0 = V(Math.cos(a) * rL, Math.sin(a) * rL, z), p1 = V(Math.cos(a2) * rL, Math.sin(a2) * rL, z);
      b.add('truss', box(p0.clone().lerp(p1, 0.5), 0.1, 0.1, p0.distanceTo(p1), new THREE.Quaternion().setFromUnitVectors(Z_AXIS, p1.clone().sub(p0).normalize()), false), false);
    }
    const d0 = V(Math.cos(a) * rL, Math.sin(a) * rL, zT0), d1 = V(Math.cos(a2) * rL, Math.sin(a2) * rL, (zT0 + zT1) / 2);
    b.add('metalBare', cyl(d0.clone().lerp(d1, 0.5), d1.clone().sub(d0).normalize(), 0.035, d0.distanceTo(d1), 6, { uv: false }), false);
  }
  // pallets: three boxes and a tank strapped to a central spine
  b.add('hullDark', box(V(0, 0, (zT0 + zT1) / 2), 0.5, 0.5, zT0 - zT1 - 0.2));
  b.add('hullAged', box(V(0.95, 0.9, -9.6), 1.5, 1.3, 1.6));
  b.add('mliSilver', box(V(-0.95, 0.9, -9.6), 1.5, 1.3, 1.6));
  b.add('hullAged', box(V(0, -1.0, -11.9), 2.4, 1.3, 1.9));
  b.add('mliGold', cyl(V(0.0, 1.0, -12.0), Z_AXIS, 0.75, 1.8, 24, { uv: false }));
  b.add('mliGold', sphere(V(0, 1.0, -11.1), 0.75, 16, 12)); b.add('mliGold', sphere(V(0, 1.0, -12.9), 0.75, 16, 12));
  for (const z of [-9.2, -10.0]) b.add('rubberBlack', torus(V(0, 0.9, z), Z_AXIS, 1.0, 0.03, 4, 24), false);
  b.add('paintOrange', box(V(0.95, 1.56, -9.6), 1.2, 0.04, 0.4, null, false), false);
  b.add('paintOrange', box(V(-0.95, 1.56, -9.6), 1.2, 0.04, 0.4, null, false), false);

  // service section + aft dome + engine
  b.add('mliSilver', tubeZ(-13.2, -14.6, 2.02, 2.02, 48));
  b.add('radiator', tubeZ(-14.6, -16.0, 2.0, 2.0, 48));
  b.add('mliSilver', tubeZ(-16.0, -16.6, 2.02, 2.02, 48));
  for (const z of [-13.2, -14.6, -16.0]) b.add('metalDark', torus(V(0, 0, z), Z_AXIS, 2.03, 0.035, 5, 48), false);
  b.add('mliDark', latheZ([[0.5, -17.3], [1.4, -17.1], [1.9, -16.8], [2.02, -16.6]], 48));
  const mainNozzles = [mainEngine(b, V(0, 0, -17.25), 0.28, 0.62, 1.0)];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const n = V(Math.cos(a), Math.sin(a), 0), tgt = V(-Math.sin(a), Math.cos(a), 0).multiplyScalar(k % 2 ? 1 : -1);
    rcsQuad(b, V(Math.cos(a) * 2.02, Math.sin(a) * 2.02, -16.3), n, [n, Z_AXIS.clone().negate(), tgt], nozzles, 0.1);
  }
  // two solar wings along +-X on short yokes
  for (const sx of [-1, 1]) {
    b.add('metalDark', cyl(V(sx * 2.6, 0, -15.0), X_AXIS, 0.12, 1.3, 10, { uv: false }), false);
    b.add('metalDark', box(V(sx * 3.3, 0, -15.0), 0.3, 0.3, 0.3, null, false), false);
    b.add('metalDark', box(V(sx * 7.9, 0, -15.0), 9.0, 0.06, 0.1, null, false), false);
    b.add('solar', box(V(sx * 7.9, 0.03, -15.0), 8.8, 0.025, 2.6));
    b.add('solarBack', box(V(sx * 7.9, -0.01, -15.0), 8.76, 0.02, 2.56));
    for (let i = 0; i <= 8; i++) b.add('metalDark', box(V(sx * (3.5 + i * 1.1), 0, -15.0), 0.03, 0.07, 2.6, null, false), false);
    colliders.push(C.box(V(sx * 7.9, 0, -15.0), V(4.5, 0.08, 1.35), null, 'wing'));
  }
  navLights(b, V(-12.4, 0.1, -15.0), V(12.4, 0.1, -15.0), [V(0, 2.05, -16.3), V(0, -2.05, -16.3), V(0, 2.2, -1.95)]);
  // large high-gain dish on a mast (+Y) above the cargo module
  const dish = new Gimbal(b, { radius: 1.1, mastLength: 1.2, position: V(0, 2.15, -6.8), up: Y_AXIS, maxRate: 0.06 });
  group.add(dish.base);
  b.build(group, group.name, { lights });

  colliders.push(C.sphere(V(0, 0, -0.35), 1.55, 'dockRing'));
  colliders.push(C.capsule(V(0, 0, -1.6), V(0, 0, -8.2), 2.2, 'cargoModule'));
  colliders.push(C.box(V(0, 0, (zT0 + zT1) / 2), V(2.1, 2.1, (zT0 - zT1) / 2), null, 'trunk'));
  colliders.push(C.capsule(V(0, 0, -13.2), V(0, 0, -17.4), 2.06, 'service'));
  colliders.push(C.sphere(V(0, 3.35, -6.8), 1.3, 'dish'));

  return {
    group, colliders, nozzles, mainNozzles, mainAxis: Z_AXIS.clone(), upAxis: Y_AXIS.clone(), noseOffset: 0, size: 'large', length: 18.3, boundRadius: 12.6,
    label: 'Грузовой корабль', shipName: `${name}-${number}`,
    parts: { lights, petals, dish },
    animate: null,
  };
}
