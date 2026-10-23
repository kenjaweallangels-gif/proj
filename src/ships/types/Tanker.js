import * as THREE from 'three';
import { ShipBuilder, V, X_AXIS, Y_AXIS, Z_AXIS, tubeZ, latheZ, box, sphere, torus, cyl, rcsQuad, LocalColliders as C } from '../ShipBuilder.js';
import { Gimbal } from '../Gimbal.js';
import { shipStart, mainEngine, dockingNose, navLights, windowPane } from './Common.js';

/**
 * Tanker / tug «Буксир» (~14 m): small control module behind the docking ring, two spherical
 * propellant tanks in an open longeron truss, a large main engine bell and an articulated grapple
 * arm that idles slowly while docked. Large port.
 */
export function buildTanker(ctx, { name = 'Буксир', number = 1 } = {}) {
  const { m, b, lights, group, nozzles, colliders } = shipStart(ctx, 'tanker', name, number);
  const R = 1.2;

  const petals = dockingNose(b, R, group);

  // control / avionics module
  b.add('hullDark', tubeZ(-0.7, -1.0, 1.5, 1.72, 48));
  b.add('hullAged', tubeZ(-1.0, -3.2, 1.75, 1.75, 48));
  b.add('hazard', tubeZ(-1.15, -1.3, 1.765, 1.765, 48, { uv: false }), false);
  b.add('metalDark', torus(V(0, 0, -3.2), Z_AXIS, 1.75, 0.04, 5, 48), false);
  b.add('mliDark', latheZ([[1.25, -3.65], [1.75, -3.2]], 48));
  // two cabin windows on the flanks
  for (const sx of [-1, 1]) windowPane(b, V(sx * 1.75, 0.6, -1.9), V(sx, 0, 0), 0.32, 0.26);
  for (const s of [-1, 1]) b.label(`${name.toUpperCase()}-${number}`, 1.5, 0.4, V(0, s * 1.76, -2.4), V(0, s, 0), { right: V(-s, 0, 0), color: '#3a2a10' });
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const n = V(Math.cos(a), Math.sin(a), 0), tgt = V(-Math.sin(a), Math.cos(a), 0).multiplyScalar(k % 2 ? -1 : 1);
    rcsQuad(b, V(Math.cos(a) * 1.75, Math.sin(a) * 1.75, -2.85), n, [n, Z_AXIS, Z_AXIS.clone().negate(), tgt], nozzles, 0.1);
  }

  // truss frame: 4 longerons at 45 deg, 3 square ring frames, diagonals
  const z0 = -3.5, z1 = -11.7, rL = 1.95;
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2, a2 = a + Math.PI / 2;
    b.add('truss', box(V(Math.cos(a) * rL, Math.sin(a) * rL, (z0 + z1) / 2), 0.15, 0.15, z0 - z1, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a), false), false);
    for (const z of [z0 - 0.1, -7.4, z1 + 0.1]) {
      const p0 = V(Math.cos(a) * rL, Math.sin(a) * rL, z), p1 = V(Math.cos(a2) * rL, Math.sin(a2) * rL, z);
      b.add('truss', box(p0.clone().lerp(p1, 0.5), 0.1, 0.1, p0.distanceTo(p1), new THREE.Quaternion().setFromUnitVectors(Z_AXIS, p1.clone().sub(p0).normalize()), false), false);
    }
    for (const [za, zb] of [[z0, -7.4], [-7.4, z1]]) {
      const d0 = V(Math.cos(a) * rL, Math.sin(a) * rL, za), d1 = V(Math.cos(a2) * rL, Math.sin(a2) * rL, zb);
      b.add('metalBare', cyl(d0.clone().lerp(d1, 0.5), d1.clone().sub(d0).normalize(), 0.03, d0.distanceTo(d1), 6, { uv: false }), false);
    }
    // corner RCS on the aft ring
    const n = V(Math.cos(a), Math.sin(a), 0), tgt = V(-Math.sin(a), Math.cos(a), 0).multiplyScalar(k % 2 ? 1 : -1);
    rcsQuad(b, V(Math.cos(a) * (rL + 0.1), Math.sin(a) * (rL + 0.1), -11.2), n, [n, Z_AXIS.clone().negate(), tgt], nozzles, 0.1);
  }
  // spherical tanks with straps and plumbing; four small pressurant bottles
  b.add('mliSilver', sphere(V(0, 0, -5.4), 1.62, 32, 24));
  b.add('mliGold', sphere(V(0, 0, -9.5), 1.62, 32, 24));
  for (const z of [-5.4, -9.5]) { b.add('metalDark', torus(V(0, 0, z), Z_AXIS, 1.63, 0.05, 6, 48), false); b.add('metalDark', torus(V(0, 0, z), X_AXIS, 1.63, 0.04, 6, 48), false); }
  b.add('metalBare', cyl(V(0, 0, -7.45), Z_AXIS, 0.22, 2.6, 16, { uv: false }), false);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    b.add('tank', sphere(V(Math.cos(a) * 1.35, Math.sin(a) * 1.35, -7.45), 0.38, 14, 10), false);
    b.add('copper', cyl(V(Math.cos(a) * 0.9, Math.sin(a) * 0.9, -7.45), V(Math.cos(a), Math.sin(a), 0), 0.04, 1.3, 6, { uv: false }), false);
  }
  // thrust structure and the big engine
  b.add('hullDark', latheZ([[0.6, -12.3], [1.3, -12.0], [1.45, -11.75]], 32));
  b.add('mliBlack', new THREE.CircleGeometry(1.45, 32).translate(0, 0, -11.75), false);
  const mainNozzles = [mainEngine(b, V(0, 0, -12.3), 0.36, 1.05, 1.7)];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    b.add('nozzle', cyl(V(Math.cos(a) * 1.2, Math.sin(a) * 1.2, -12.35), V(0, 0, -1), 0.08, 0.35, 10, { rTop: 0.18, open: true, uv: false }), false);
  }
  navLights(b, V(-1.78, 0, -1.6), V(1.78, 0, -1.6), [V(0, 2.05, -11.7), V(0, -2.05, -11.7)]);
  // small dish (-Y side)
  const dish = new Gimbal(b, { radius: 0.45, mastLength: 0.5, position: V(0, -1.75, -2.4), up: V(0, -1, 0) });
  group.add(dish.base);

  // grapple arm: pedestal on the +Y side of the control module (static), upper arm + forearm with claw (two moving meshes)
  b.add('metalDark', cyl(V(0, 1.9, -2.2), Y_AXIS, 0.3, 0.3, 16, { uv: false }), false);
  b.add('paintGray', sphere(V(0, 2.15, -2.2), 0.26, 14, 10), false);
  b.build(group, group.name, { lights });

  const seg1 = new THREE.Group(), seg2 = new THREE.Group();
  seg1.position.set(0, 2.15, -2.2);
  {
    const s1 = new ShipBuilder(m);
    s1.add('antennaWhite', cyl(V(0, 1.2, 0), Y_AXIS, 0.13, 2.4, 12, { uv: false }), false);
    s1.add('antennaWhite', box(V(0, 1.2, 0), 0.08, 2.4, 0.3, null, false), false);
    s1.add('paintGray', sphere(V(0, 2.45, 0), 0.22, 14, 10), false);
    s1.build(seg1, 'armSeg1', { shadows: false, receive: false });
    seg2.position.set(0, 2.45, 0);
    const s2 = new ShipBuilder(m);
    s2.add('antennaWhite', cyl(V(0, 1.0, 0), Y_AXIS, 0.11, 2.0, 12, { uv: false }), false);
    s2.add('paintGray', sphere(V(0, 2.05, 0), 0.18, 14, 10), false);
    // wrist + three-finger claw
    s2.add('metalDark', cyl(V(0, 2.25, 0), Y_AXIS, 0.14, 0.4, 12, { uv: false }), false);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const p0 = V(Math.cos(a) * 0.12, 2.45, Math.sin(a) * 0.12), p1 = V(Math.cos(a) * 0.3, 2.9, Math.sin(a) * 0.3);
      s2.add('metalDark', cyl(p0.clone().lerp(p1, 0.5), p1.clone().sub(p0).normalize(), 0.03, p0.distanceTo(p1), 6, { uv: false }), false);
    }
    s2.add('camera', sphere(V(0.18, 2.35, 0), 0.07, 10, 8), false);
    s2.build(seg2, 'armSeg2', { shadows: false, receive: false });
    seg1.add(seg2); group.add(seg1);
  }
  // stowed pose: folded back along the truss
  seg1.rotation.x = -1.35; seg2.rotation.x = 2.5;
  colliders.push(C.capsule(V(0, 2.15, -2.2), V(0, 2.6, -4.5), 0.35, 'arm'));

  colliders.push(C.sphere(V(0, 0, -0.35), 1.55, 'dockRing'));
  colliders.push(C.capsule(V(0, 0, -1.2), V(0, 0, -3.4), 1.8, 'control'));
  colliders.push(C.sphere(V(0, 0, -5.4), 1.7, 'tank1'));
  colliders.push(C.sphere(V(0, 0, -9.5), 1.7, 'tank2'));
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k * Math.PI) / 2; colliders.push(C.capsule(V(Math.cos(a) * rL, Math.sin(a) * rL, z0), V(Math.cos(a) * rL, Math.sin(a) * rL, z1), 0.14, 'longeron')); }
  colliders.push(C.capsule(V(0, 0, -11.7), V(0, 0, -13.9), 1.1, 'engine'));

  const armState = { t: Math.random() * 10 };
  return {
    group, colliders, nozzles, mainNozzles, mainAxis: Z_AXIS.clone(), upAxis: Y_AXIS.clone(), noseOffset: 0, size: 'large', length: 14.0, boundRadius: 7.5,
    label: 'Танкер-буксир', shipName: `${name}-${number}`,
    parts: { lights, petals, dish, arm: { seg1, seg2 } },
    /** Slow idle motion of the grapple arm while docked (crews re-stow it before departure). */
    animate(dt, ship) {
      armState.t += dt;
      const k = ship.state === 'docked' ? 1 : 0;
      const target1 = -1.35 + k * 0.35 * Math.sin(armState.t * 0.11), target2 = 2.5 - k * 0.5 * (0.5 + 0.5 * Math.sin(armState.t * 0.07 + 1));
      seg1.rotation.x += (target1 - seg1.rotation.x) * Math.min(1, dt * 0.3);
      seg2.rotation.x += (target2 - seg2.rotation.x) * Math.min(1, dt * 0.3);
    },
  };
}
