import * as THREE from 'three';
import { ShipBuilder, V, X_AXIS, Y_AXIS, Z_AXIS, latheZ, box, torus, cyl, rcsQuad, LocalColliders as C, scaleUV, TEX_M, flipInside } from '../ShipBuilder.js';
import { shipStart, mainEngine, dockingNose, navLights, windowPane } from './Common.js';

/**
 * Spaceplane «Стриж» (~24 m): delta-wing orbiter with black tiles underneath, white top, OMS pods,
 * cockpit windows and a docking adapter standing in the open payload bay (doors animated).
 *
 * The docking axis is the ship's local +Z (dorsal), so the fuselage lies along local X (nose +X),
 * wings span local Y, belly faces -Z.  Geometry is authored in a "fuselage frame" F
 * (axis +Z_F = nose, dorsal +Y_F) and mapped with M: X_F -> +Y, Y_F -> +Z, Z_F -> +X.
 */
export function buildShuttle(ctx, { name = 'Стриж', number = 1 } = {}) {
  const { m, b, lights, group, nozzles, colliders } = shipStart(ctx, 'shuttle', name, number);
  const R = 1.2;
  const M = new THREE.Matrix4().makeBasis(V(0, 1, 0), V(0, 0, 1), V(1, 0, 0));
  const toShip = (v) => v.clone().applyMatrix4(M);
  const addF = (mat, geo, shadow = true, tint = null) => b.add(mat, geo.applyMatrix4(M), shadow, tint);
  const AX = -3.3;          // fuselage axis height (y_F) below the docking plane
  const FLAT = 0.88;        // cross-section flattening (y_F)

  const petals = dockingNose(b, R, group);

  // ---- fuselage (lathe around Z_F; theta=0 is -Y_F = belly, theta=PI is dorsal) ----
  const fus = (profile, seg, th0, thl) => { const g = latheZ(profile, seg, th0, thl); g.scale(1, FLAT, 1); g.translate(0, AX, 0); return g; };
  const bayA = 1.0;         // half-angle of the bay opening
  // tail section, bay section (hull minus the opening), nose section
  addF('felt', fus([[1.85, -12.2], [2.05, -11.6], [2.2, -10.2], [2.2, -7.5]], 48, 0, Math.PI * 2));
  addF('felt', fus([[2.2, -7.5], [2.2, 2.5]], 48, Math.PI + bayA, Math.PI * 2 - 2 * bayA));
  addF('felt', fus([[2.2, 2.5], [2.15, 4.5], [1.95, 6.2], [1.55, 8.0], [1.0, 9.8], [0.45, 11.2], [0.0, 11.8]], 48, 0, Math.PI * 2));
  // belly tiles (lower half, slightly outside the hull)
  addF('tilesFine', fus([[1.88, -12.1], [2.08, -11.6], [2.23, -10.2], [2.23, 4.5], [1.98, 6.2], [1.58, 8.0], [1.03, 9.8], [0.5, 11.1]], 48, -Math.PI / 2 + 0.12, Math.PI - 0.24));
  // nose cap in RCC
  addF('tiles', fus([[0.44, 11.0], [0.0, 11.85]], 32, 0, Math.PI * 2), false);
  // aft bulkhead
  addF('mliBlack', fus([[0.0, -12.3], [1.84, -12.2]], 48, 0, Math.PI * 2), false);
  // bay liner (inside, light grey), floor, sill rails
  { const g = latheZ([[2.1, -7.4], [2.1, 2.4]], 48, Math.PI + bayA - 0.05, Math.PI * 2 - 2 * bayA + 0.1); g.scale(1, FLAT, 1); g.translate(0, AX, 0);
    addF('hullGray', flipInside(g), false); }
  addF('hullGray', box(V(0, AX - 1.1, -2.5), 3.0, 0.1, 9.8));
  addF('metalDark', box(V(0, AX + 2.2 * FLAT * Math.cos(bayA) - 0.05, -7.5), 2 * 2.2 * Math.sin(bayA) + 0.2, 0.25, 0.2, null, false), false);
  addF('metalDark', box(V(0, AX + 2.2 * FLAT * Math.cos(bayA) - 0.05, 2.5), 2 * 2.2 * Math.sin(bayA) + 0.2, 0.25, 0.2, null, false), false);
  for (const s of [-1, 1]) addF('metalDark', box(V(s * 2.2 * Math.sin(bayA), AX + 2.2 * FLAT * Math.cos(bayA), -2.5), 0.16, 0.12, 10.0, null, false), false);
  // docking adapter standing in the bay: tunnel + truss legs up to the ring (z=0 ship = y_F 0)
  const sill = AX + 2.2 * FLAT * Math.cos(bayA);   // bay sill height
  addF('hull', cyl(V(0, (sill - 1.0 + -0.7) / 2, 0), Y_AXIS, 1.35, -0.7 - (sill - 1.0), 40));
  addF('metalDark', torus(V(0, sill - 0.3, 0), Y_AXIS, 1.38, 0.05, 6, 40), false);
  addF('mliSilver', box(V(0, sill - 1.3, 0), 3.2, 0.6, 3.2));
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const p0 = V(Math.cos(a) * 1.5, sill - 1.0, Math.sin(a) * 1.5), p1 = V(Math.cos(a) * 1.3, -0.75, Math.sin(a) * 1.3);
    addF('metalBare', cyl(p0.clone().lerp(p1, 0.5), p1.clone().sub(p0).normalize(), 0.05, p0.distanceTo(p1), 8, { uv: false }), false);
  }
  // cockpit windows: six panes around the upper nose
  for (let i = 0; i < 6; i++) {
    const a = Math.PI + (-0.75 + i * 0.3);        // around the dorsal
    const z = 7.6 + Math.abs(i - 2.5) * 0.25, r = 1.62 - (z - 7.6) * 0.22;
    const p = V(Math.sin(a) * r, -Math.cos(a) * r * FLAT + AX, z);
    const n = V(Math.sin(a), -Math.cos(a) * FLAT, 0.55).normalize();
    windowPane(b, toShip(p), toShip(n), 0.5, 0.38);
  }
  // side hatch, markings
  addF('metalDark', torus(V(2.2, AX + 0.3, 5.0), X_AXIS, 0.55, 0.035, 5, 32), false);
  addF('hullAged', cyl(V(2.22, AX + 0.3, 5.0), X_AXIS, 0.5, 0.04, 32, { uv: false }), false);
  for (const s of [-1, 1]) {
    b.label(`${name.toUpperCase()}`, 2.6, 0.6, toShip(V(s * 2.21, AX + 0.9, -3.2)), toShip(V(s, 0.25, 0)).normalize(), { right: toShip(V(0, 0, s)), color: '#1d2f55' });
    b.label(`${number}`, 0.8, 0.6, toShip(V(s * 2.2, AX + 0.2, 7.4)), toShip(V(s, 0, 0)), { right: toShip(V(0, 0, s)), color: '#1d2f55' });
  }
  b.add('paintBlue', box(toShip(V(0, AX + 1.95 * FLAT + 0.02, -9.0)), 0.9, 0.02, 2.6), false);

  // ---- wings (delta, one extrusion through the fuselage) ----
  const wing = new THREE.Shape();
  wing.moveTo(-9.0, -11.6); wing.lineTo(9.0, -11.6); wing.lineTo(9.0, -7.6); wing.lineTo(1.9, 0.6); wing.lineTo(-1.9, 0.6); wing.lineTo(-9.0, -7.6); wing.closePath();
  const wgeo = new THREE.ExtrudeGeometry(wing, { depth: 0.42, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.12, bevelSegments: 2 });
  wgeo.rotateX(Math.PI / 2);              // shape Y -> z_F, extrusion -> -y_F
  wgeo.translate(0, AX - 1.0, 0);
  scaleUV(wgeo, 1 / TEX_M, 1 / TEX_M);
  addF('tilesFine', wgeo);
  const skin = new THREE.ShapeGeometry(wing); skin.rotateX(Math.PI / 2); skin.translate(0, AX - 1.0 + 0.12, 0); skin.scale(0.985, 1, 0.985);
  // ShapeGeometry normal is +Z before rotation -> -y_F after rotateX(+90): flip to face up
  scaleUV(flipInside(skin), 1 / TEX_M, 1 / TEX_M);
  addF('felt', skin, false);
  // elevons and body flap
  for (const s of [-1, 1]) addF('metalDark', box(V(s * 5.6, AX - 1.0 - 0.2, -11.4), 6.4, 0.3, 0.9, null, false), false);
  addF('tiles', box(V(0, AX - 1.7, -12.4), 3.4, 0.25, 1.2), false);
  // wing collider approximations (stepped boxes), both sides
  for (const s of [-1, 1]) {
    colliders.push(C.box(toShip(V(s * 3.2, AX - 1.0, -6.55)), V(5.05, 1.3, 0.4), null, 'wingIn'));
    colliders.push(C.box(toShip(V(s * 5.75, AX - 1.0, -8.05)), V(3.55, 1.25, 0.4), null, 'wingMid'));
    colliders.push(C.box(toShip(V(s * 8.0, AX - 1.0, -9.45)), V(2.15, 1.0, 0.4), null, 'wingOut'));
  }

  // ---- vertical tail (dorsal, toward +Z ship) ----
  const tail = new THREE.Shape();
  tail.moveTo(-12.0, AX + 1.7); tail.lineTo(-7.6, AX + 1.7); tail.lineTo(-10.2, AX + 5.2); tail.lineTo(-12.0, AX + 5.2); tail.closePath();
  const tgeo = new THREE.ExtrudeGeometry(tail, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.06, bevelSegments: 1 });
  tgeo.rotateY(-Math.PI / 2);   // shape X -> z_F, Y stays, extrusion -> -x_F
  tgeo.translate(0.16, 0, 0);
  scaleUV(tgeo, 1 / TEX_M, 1 / TEX_M);
  addF('felt', tgeo);
  addF('metalDark', box(V(0, AX + 3.5, -11.75), 0.36, 3.3, 0.5, null, false), false);   // rudder hinge line
  colliders.push(C.box(toShip(V(0, AX + 3.4, -10.4)), V(1.8, 0.2, 1.75), null, 'tail'));
  // OMS pods with their engines
  const omsNozzles = [];
  for (const s of [-1, 1]) {
    const c = V(s * 1.55, AX + 1.6, -10.6);
    addF('felt', latheZ([[0.75, -12.0], [0.95, -11.2], [0.95, -9.4], [0.55, -8.2], [0.0, -7.9]], 24, 0, Math.PI * 2).translate(c.x, c.y, 0));
    omsNozzles.push(mainEngine(b, toShip(V(c.x, c.y + 0.1, -12.0)), 0.16, 0.36, 0.7, toShip(V(0, 0.08, -1)).normalize()));
    // aft RCS pod nozzles on the OMS pod flanks
    const nn = V(s, 0, 0);
    rcsQuad(b, toShip(V(s * 2.45, AX + 1.4, -10.0)), toShip(nn), [toShip(nn), toShip(V(0, 1, 0)), toShip(V(0, -1, 0)), toShip(V(0, 0, -1))], nozzles, 0.1);
  }
  // three main engines on the aft bulkhead (exhaust -X ship = -Z_F)
  const mainNozzles = [...omsNozzles];
  for (const [x, y] of [[0, AX + 0.9], [-1.1, AX - 0.4], [1.1, AX - 0.4]]) mainNozzles.push(mainEngine(b, toShip(V(x, y, -12.3)), 0.3, 0.7, 1.1, X_AXIS.clone().negate()));
  // nose RCS cluster
  for (const [a, dirs] of [[Math.PI, [V(0, 1, 0), V(0, 0, 1)]], [Math.PI * 0.5, [V(1, 0, 0), V(0, 0, 1)]], [Math.PI * 1.5, [V(-1, 0, 0), V(0, 0, 1)]], [0, [V(0, -1, 0), V(0, 0, 1)]]]) {
    const r = 1.35, p = V(Math.sin(a) * r, -Math.cos(a) * r * FLAT + AX, 8.9), n = V(Math.sin(a), -Math.cos(a) * FLAT, 0).normalize();
    rcsQuad(b, toShip(p), toShip(n), dirs.map((d) => toShip(d)), nozzles, 0.09);
  }
  navLights(b, toShip(V(8.9, AX - 0.3, -9.5)), toShip(V(-8.9, AX - 0.3, -9.5)), [toShip(V(0, AX + 5.25, -11.0)), toShip(V(0, AX - 2.0, 2.0))]);
  b.build(group, group.name, { lights });

  // ---- payload bay doors: two half-shells hinged at the sill, open outward (one hull-material mesh each) ----
  const doors = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    const hx = s * 2.2 * Math.sin(bayA) * 1.02, hy = sill;
    hinge.position.copy(toShip(V(hx, hy, -2.5)));
    hinge.quaternion.setFromRotationMatrix(M);          // hinge axes = fuselage frame axes
    const door = new THREE.Group();                      // animated child: rotation about z_F (= local Z)
    const db = new ShipBuilder(m);
    const th0 = s > 0 ? Math.PI - bayA : Math.PI, g = latheZ([[2.24, -7.45], [2.24, 2.45]], 24, th0, bayA);
    g.scale(1, FLAT, 1); g.translate(-hx, AX - hy, 2.5);  // door geometry relative to its hinge
    db.add('felt', g, true);
    const gi = latheZ([[2.16, -7.4], [2.16, 2.4]], 24, th0, bayA); gi.scale(1, FLAT, 1); gi.translate(-hx, AX - hy, 2.5);
    db.add('radiator', flipInside(gi), false);
    db.build(door, 'bayDoor', { receive: false });
    hinge.add(door); group.add(hinge);
    doors.push({ group: door, sign: -s, openAngle: 2.6 });
  }

  colliders.push(C.sphere(V(0, 0, -0.35), 1.55, 'dockRing'));
  colliders.push(C.capsule(toShip(V(0, AX, -11.0)), toShip(V(0, AX, 9.5)), 2.25, 'fuselage'));
  colliders.push(C.capsule(toShip(V(0, AX, 9.5)), toShip(V(0, AX, 11.4)), 0.9, 'nose'));
  colliders.push(C.box(toShip(V(0, (sill - 1.0) / 2, 0)), V(1.5, 1.5, Math.abs(sill - 1.0) / 2), null, 'adapter'));

  return {
    group, colliders, nozzles, mainNozzles, mainAxis: X_AXIS.clone(), upAxis: Z_AXIS.clone(), noseOffset: 0, size: 'large', length: 24.1, boundRadius: 13.0,
    label: 'Космоплан', shipName: `${name}-${number}`,
    parts: { lights, petals, doors },
    animate: null,
  };
}
