import * as THREE from 'three';
import { V, X_AXIS, Y_AXIS, Z_AXIS, tubeZ, latheZ, box, cyl, torus, rcsQuad, LocalColliders as C, quatZ, instancedParts, mergeAll } from '../ShipBuilder.js';
import { Gimbal } from '../Gimbal.js';
import { shipStart, mainEngine, dockingNose, navLights, windowPane } from './Common.js';

/**
 * Crew capsule «Орёл» (~8 m): docking ring with petals, truncated-cone capsule with a tiled heat shield,
 * windows and hatch, cylindrical service module with four deployable solar panels (Orion-style X),
 * RCS quads, small tracking dish. Small port.
 */
export function buildCapsule(ctx, { name = 'Орёл', number = 1 } = {}) {
  const { b, lights, group, nozzles, colliders } = shipStart(ctx, 'capsule', name, number);
  const R = 0.8;   // small port ring radius

  const petals = dockingNose(b, R, group);

  // forward tunnel + orbital compartment shoulder
  b.add('hullAged', tubeZ(-0.7, -1.05, 1.1, 1.08, 32));
  b.add('metalDark', torus(V(0, 0, -1.05), Z_AXIS, 1.1, 0.04, 5, 32), false);
  // capsule cone (increasing z for outward normals): shoulder at z=-3.08 r 2.1 -> z=-1.08 r 1.14
  b.add('hull', latheZ([[2.08, -3.3], [2.1, -3.08], [1.14, -1.08], [1.08, -1.0]], 56));
  b.add('mliSilver', latheZ([[2.11, -3.3], [2.12, -3.15], [1.98, -2.82], [1.96, -2.8]], 56));
  // heat shield: convex tiled disc with a titanium rim
  b.add('tiles', latheZ([[0.0, -3.66], [0.9, -3.62], [1.6, -3.52], [2.02, -3.4], [2.1, -3.3]], 56));
  b.add('metalDark', torus(V(0, 0, -3.3), Z_AXIS, 2.1, 0.05, 6, 56), false);
  // two windows on the cone, tilted with the surface
  for (const a of [Math.PI * 0.42, Math.PI * 0.58]) {
    const z = -1.75, r = 2.1 - 0.48 * (z + 3.08);
    windowPane(b, V(Math.cos(a) * r, Math.sin(a) * r, z), V(Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0.43), 0.4, 0.32);
  }
  // side hatch outline
  {
    const z = -2.2, r = 2.1 - 0.48 * (z + 3.08);
    const n = V(0, -0.9, 0.43).normalize(), p = V(0, -r, z);
    b.add('metalDark', torus(p, n, 0.5, 0.035, 5, 32), false);
    b.add('hullAged', cyl(p.clone().addScaledVector(n, 0.03), n, 0.46, 0.05, 32, { uv: false }), false);
    b.add('metalBare', box(p.clone().addScaledVector(n, 0.07), 0.12, 0.3, 0.06, quatZ(n), false), false);
  }
  // RCS quads on the cone shoulder (4), alternating roll nozzles
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const n = V(Math.cos(a), Math.sin(a), 0), tgt = V(-Math.sin(a), Math.cos(a), 0).multiplyScalar(k % 2 ? -1 : 1);
    rcsQuad(b, V(Math.cos(a) * 2.0, Math.sin(a) * 2.0, -2.95), n, [n, Z_AXIS, Z_AXIS.clone().negate(), tgt], nozzles, 0.09);
  }
  // adapter ring and service module
  b.add('hullDark', tubeZ(-3.66, -3.9, 2.0, 1.76, 48));
  b.add('hull', tubeZ(-3.9, -4.7, 1.76, 1.76, 48));
  b.add('mliGold', tubeZ(-4.7, -6.3, 1.78, 1.78, 48));
  b.add('radiator', tubeZ(-6.3, -7.0, 1.76, 1.76, 48));
  b.add('metalDark', torus(V(0, 0, -4.7), Z_AXIS, 1.78, 0.035, 5, 48), false);
  b.add('metalDark', torus(V(0, 0, -6.3), Z_AXIS, 1.78, 0.035, 5, 48), false);
  b.add('metalDark', tubeZ(-7.0, -7.12, 1.76, 1.6, 48), false);
  b.add('mliBlack', new THREE.CircleGeometry(1.6, 48).rotateY(Math.PI).translate(0, 0, -7.12), false);
  // RCS quads on the service module
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const n = V(Math.cos(a), Math.sin(a), 0), tgt = V(-Math.sin(a), Math.cos(a), 0).multiplyScalar(k % 2 ? 1 : -1);
    rcsQuad(b, V(Math.cos(a) * 1.78, Math.sin(a) * 1.78, -6.65), n, [n, Z_AXIS.clone().negate(), tgt], nozzles, 0.09);
  }
  // main engine + two small verniers
  const mainNozzles = [mainEngine(b, V(0, 0, -7.12), 0.2, 0.46, 0.8)];
  for (const sx of [-1, 1]) b.add('nozzle', cyl(V(sx * 0.9, 0, -7.3), V(0, 0, -1), 0.08, 0.3, 10, { rTop: 0.16, open: true, uv: false }), false);
  // nav lights, labels, a blue band
  navLights(b, V(-1.8, 0.3, -4.25), V(1.8, 0.3, -4.25), [V(0, 1.78, -6.9), V(0, -1.78, -6.9)]);
  for (const s of [-1, 1]) {
    b.label(`${name.toUpperCase()}-${number}`, 1.6, 0.42, V(0, s * 1.79, -4.3), V(0, s, 0), { right: V(-s, 0, 0), color: '#243246' });
    b.label('РОСКОСМОС', 1.1, 0.26, V(s * 1.79, 0.5, -4.3), V(s, 0, 0), { right: V(0, 0, -s), color: '#1d3f8a' });
  }
  b.add('paintBlue', tubeZ(-4.42, -4.6, 1.785, 1.785, 48, { uv: false }), false);
  // small high-gain dish on a mast (pedestal merged into the hull, dish is one moving mesh)
  const dish = new Gimbal(b, { radius: 0.38, mastLength: 0.6, position: V(0, 1.78, -6.0), up: Y_AXIS });
  group.add(dish.base);
  b.build(group, group.name, { lights });

  // four deployable solar panels: one InstancedMesh (hinge local +Y = radial, folds toward -Z about local X)
  const part = instancedParts(b.shared, [
    ['metalDark', mergeAll([box(V(0, 0.15, 0), 0.18, 0.3, 0.18, null, false), box(V(0, 2.05, 0), 0.08, 3.7, 0.05, null, false), ...[0, 1, 2, 3, 4].map((i) => box(V(0, 0.3 + i * 0.9, 0), 1.3, 0.03, 0.06, null, false))])],
    ['paintGray', box(V(0, 2.1, 0.0), 1.26, 3.56, 0.02, null, false)],
    ['solar', box(V(0, 2.1, -0.03), 1.3, 3.6, 0.025)],
  ]);
  const panelMesh = new THREE.InstancedMesh(part.geometry, part.materials, 4);
  panelMesh.name = 'panels'; panelMesh.castShadow = true; panelMesh.receiveShadow = false; panelMesh.frustumCulled = false;
  const panelHinges = [];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const q = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a - Math.PI / 2);   // local +Y -> radial
    const hinge = new THREE.Matrix4().compose(V(Math.cos(a) * 1.8, Math.sin(a) * 1.8, -5.5), q, V(1, 1, 1));
    panelHinges.push(hinge); panelMesh.setMatrixAt(k, hinge);
    colliders.push(C.box(V(Math.cos(a) * (1.8 + 2.1), Math.sin(a) * (1.8 + 2.1), -5.5), V(0.66, 1.85, 0.06), q, 'panel'));
  }
  panelMesh.instanceMatrix.needsUpdate = true;
  group.add(panelMesh);
  const panels = { mesh: panelMesh, hinges: panelHinges, open: -1 };

  colliders.push(C.sphere(V(0, 0, -0.35), 1.15, 'dockRing'));
  colliders.push(C.capsule(V(0, 0, -1.2), V(0, 0, -3.3), 1.8, 'capsule'));
  colliders.push(C.capsule(V(0, 0, -3.9), V(0, 0, -7.3), 1.82, 'serviceModule'));

  return {
    group, colliders, nozzles, mainNozzles, mainAxis: Z_AXIS.clone(), upAxis: Y_AXIS.clone(), noseOffset: 0, size: 'small', length: 8.0, boundRadius: 4.2,
    label: 'Пилотируемый корабль', shipName: `${name}-${number}`,
    parts: { lights, petals, panels, dish },
    animate: null,
  };
}
