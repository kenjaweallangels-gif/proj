import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ShipBuilder, V, X_AXIS, Y_AXIS, Z_AXIS, tubeZ, latheZ, box, sphere, torus, cyl, rcsQuad, LocalColliders as C, quatZ, mergeMulti } from '../ShipBuilder.js';
import { Gimbal } from '../Gimbal.js';
import { shipMaterials, mainEngine, dockingNose, navLights } from './Common.js';

/**
 * Crew capsule «Орёл» (~8 m): docking ring with petals, truncated-cone capsule with tiled heat
 * shield, windows and hatch, cylindrical service module with four deployable solar panels,
 * RCS quads, small tracking dish. Small port.
 */
export function buildCapsule(ctx, { name = 'Орёл', number = 1 } = {}) {
  const m = ctx.materials;
  const mats = shipMaterials(m);
  const group = new THREE.Group();
  group.name = `capsule:${name}-${number}`;
  const b = new ShipBuilder(m);
  const nozzles = [];
  const colliders = [];
  const R = 0.8;   // small port ring radius

  const petals = dockingNose(b, m, R, group, mats.dockLight);

  // forward tunnel + orbital compartment shoulder
  b.add('hullWhiteAged', tubeZ(-0.7, -1.05, 1.1, 1.08, 32));
  b.add('metalDark', torus(V(0, 0, -1.05), Z_AXIS, 1.1, 0.04, 5, 32), false);
  // capsule cone (increasing z for outward normals): shoulder at z=-3.05 r 2.08 -> z=-1.05 r 1.12
  b.add('shipHull', latheZ([[2.08, -3.3], [2.1, -3.08], [1.14, -1.08], [1.08, -1.0]], 56));
  b.add('mliSilver', latheZ([[2.11, -3.3], [2.12, -3.15], [1.98, -2.82], [1.96, -2.8]], 56));
  // heat shield: convex tiled disc with a titanium rim
  b.add('shipTiles', latheZ([[0.0, -3.66], [0.9, -3.62], [1.6, -3.52], [2.02, -3.4], [2.1, -3.3]], 56));
  b.add('metalDark', torus(V(0, 0, -3.3), Z_AXIS, 2.1, 0.05, 6, 56), false);
  // windows (two on the cone, tilted with the surface) and the side hatch outline
  for (const a of [Math.PI * 0.42, Math.PI * 0.58]) {
    const z = -1.75, r = 2.1 - 0.48 * (z + 3.08);     // radius on the cone at z
    const n = V(Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0.43).normalize();
    const p = V(Math.cos(a) * r, Math.sin(a) * r, z);
    const q = quatZ(n);
    b.add('metalDark', box(p.clone().addScaledVector(n, -0.04), 0.5, 0.42, 0.12, q, false), false);
    b.add('glass', box(p.clone().addScaledVector(n, 0.025), 0.4, 0.32, 0.03, q, false), false);
    b.add('windowGlow', box(p.clone().addScaledVector(n, -0.05), 0.36, 0.28, 0.02, q, false), false);
  }
  {
    const a = -Math.PI / 2, z = -2.2, r = 2.1 - 0.48 * (z + 3.08);
    const n = V(0, -0.9, 0.43).normalize(), p = V(0, -r, z);
    b.add('metalDark', torus(p, n, 0.5, 0.035, 5, 32), false);
    b.add('hullWhiteAged', cyl(p.clone().addScaledVector(n, 0.03), n, 0.46, 0.05, 32, { uv: false }), false);
    b.add('metalBare', box(p.clone().addScaledVector(n, 0.07), 0.12, 0.3, 0.06, quatZ(n), false), false);
    void a;
  }
  // RCS quads on the cone shoulder (4), alternating roll nozzles
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const n = V(Math.cos(a), Math.sin(a), 0), tgt = V(-Math.sin(a), Math.cos(a), 0).multiplyScalar(k % 2 ? -1 : 1);
    rcsQuad(b, V(Math.cos(a) * 2.0, Math.sin(a) * 2.0, -2.95), n, [n, Z_AXIS, Z_AXIS.clone().negate(), tgt], nozzles, 0.09);
  }
  // adapter ring and service module
  b.add('metalDark', tubeZ(-3.66, -3.9, 2.0, 1.76, 48));
  b.add('hullWhite', tubeZ(-3.9, -4.7, 1.76, 1.76, 48));
  b.add('mliGold', tubeZ(-4.7, -6.3, 1.78, 1.78, 48));
  b.add('radiator', tubeZ(-6.3, -7.0, 1.76, 1.76, 48));
  b.add('metalDark', torus(V(0, 0, -4.7), Z_AXIS, 1.78, 0.035, 5, 48), false);
  b.add('metalDark', torus(V(0, 0, -6.3), Z_AXIS, 1.78, 0.035, 5, 48), false);
  b.add('metalDark', tubeZ(-7.0, -7.12, 1.76, 1.6, 48));
  b.add('mliBlack', new THREE.CircleGeometry(1.6, 48).rotateY(Math.PI).translate(0, 0, -7.12));
  // RCS quads on the service module
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const n = V(Math.cos(a), Math.sin(a), 0), tgt = V(-Math.sin(a), Math.cos(a), 0).multiplyScalar(k % 2 ? 1 : -1);
    rcsQuad(b, V(Math.cos(a) * 1.78, Math.sin(a) * 1.78, -6.65), n, [n, Z_AXIS.clone().negate(), tgt], nozzles, 0.09);
  }
  // main engine + two small verniers
  const mainNozzles = [mainEngine(b, mats.hot, V(0, 0, -7.12), 0.2, 0.46, 0.8)];
  for (const sx of [-1, 1]) b.add('nozzle', cyl(V(sx * 0.9, 0, -7.3), V(0, 0, -1), 0.08, 0.3, 10, { rTop: 0.16, open: true, uv: false }), false);
  // nav lights and labels
  navLights(b, mats.strobe, V(-1.8, 0.3, -4.25), V(1.8, 0.3, -4.25), [V(0, 1.78, -6.9), V(0, -1.78, -6.9)]);
  for (const s of [-1, 1]) {
    b.label(`${name.toUpperCase()}-${number}`, 1.6, 0.42, V(0, s * 1.79, -4.3), V(0, s, 0), { right: V(-s, 0, 0), width: 512, height: 128, color: '#243246' });
    b.label('РОСКОСМОС', 1.1, 0.26, V(s * 1.79, 0.5, -4.3), V(s, 0, 0), { right: V(0, 0, -s), width: 512, height: 128, color: '#1d3f8a' });
  }
  b.add('paintBlue', tubeZ(-4.42, -4.6, 1.785, 1.785, 48, { uv: false }), false);
  b.build(group, group.name);

  // four deployable solar panels: one InstancedMesh (hinge local +Y = radial, folds toward -Z about local X)
  const panelGeo = mergeMulti(m, [
    ['metalDark', mergeGeometries([box(V(0, 0.15, 0), 0.18, 0.3, 0.18, null, false), box(V(0, 2.05, 0), 0.08, 3.7, 0.05, null, false), ...[0, 1, 2, 3, 4].map((i) => box(V(0, 0.3 + i * 0.9, 0), 1.3, 0.03, 0.06, null, false))], false)],
    ['solarCell', box(V(0, 2.1, -0.03), 1.3, 3.6, 0.025)],
    ['solarBack', box(V(0, 2.1, 0.0), 1.26, 3.56, 0.02)],
  ]);
  const panelMesh = new THREE.InstancedMesh(panelGeo.geometry, panelGeo.materials, 4);
  panelMesh.name = 'panels'; panelMesh.castShadow = true; panelMesh.receiveShadow = true; panelMesh.frustumCulled = false;
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
  const panels = [{ mesh: panelMesh, hinges: panelHinges, open: -1 }];
  // small high-gain dish on a mast
  const dish = new Gimbal(m, { radius: 0.38, mastLength: 0.6, position: V(0, 1.78, -6.0), up: Y_AXIS });
  group.add(dish.base);

  colliders.push(C.sphere(V(0, 0, -0.35), 1.15, 'dockRing'));
  colliders.push(C.capsule(V(0, 0, -1.2), V(0, 0, -3.3), 1.8, 'capsule'));
  colliders.push(C.capsule(V(0, 0, -3.9), V(0, 0, -7.3), 1.82, 'serviceModule'));

  return {
    group, colliders, nozzles, mainNozzles, mainAxis: Z_AXIS.clone(), noseOffset: 0.08, size: 'small', length: 8.0, boundRadius: 4.2,
    label: 'Пилотируемый корабль', shipName: `${name}-${number}`,
    parts: { petals, panels, dish, hot: mats.hot, strobe: mats.strobe, dockLight: mats.dockLight },
    animate: null,
  };
}
