import * as THREE from 'three';
import { ShipBuilder, ShipLights, V, X_AXIS, Z_AXIS, cyl, box, sphere, tubeZ, torus, quatZ, flipInside, buildPetals, setPetals, setHinged } from '../ShipBuilder.js';

/**
 * Shared pieces of a ship type build.
 *
 * Every type builder returns:
 *   { group, colliders (local), nozzles [{position, direction}], mainNozzles [{position, direction}],
 *     mainAxis (local unit: direction the ship accelerates when the main engine burns), upAxis,
 *     noseOffset (0: the docking face sits on the port plane), size: 'small'|'large', length, boundRadius,
 *     label (Russian type name), shipName,
 *     parts: { lights: ShipLights, petals, panels, dish, doors[], arm… },
 *     animate(dt, ship, ctx)  // type specific extras (optional)
 *   }
 * Local frame: +Z = docking axis (toward the port), docking plane at z = 0, body along -Z.
 */

/** Start a ship build: group, builder, animated light channels, nozzle / collider lists. */
export function shipStart(ctx, type, name, number) {
  const group = new THREE.Group();
  group.name = `${type}:${name}-${number}`;
  return { m: ctx.materials, b: new ShipBuilder(ctx.materials), lights: new ShipLights(), group, nozzles: [], colliders: [] };
}

/** Main engine: outer bell (nozzle) + inner hot liner at `pos`, exhaust along -Z (or `dir`). Returns the plume origin. */
export function mainEngine(b, pos, rThroat, rExit, length, dir = null) {
  const d = dir ? dir.clone().normalize() : V(0, 0, -1);
  const c = pos.clone().addScaledVector(d, length / 2);
  // cyl axis +Y mapped to d: radiusTop (at +d side) = exit radius
  b.add('nozzle', cyl(c, d, rThroat, length, 28, { rTop: rExit, open: true, uv: false }), false);
  const inner = cyl(c.clone().addScaledVector(d, 0.02), d, rThroat * 0.92, length * 0.98, 28, { rTop: rExit * 0.95, open: true, uv: false });
  b.add('hot', flipInside(inner), false);
  b.add('metalDark', cyl(pos.clone().addScaledVector(d, -0.08), d, rThroat * 1.3, 0.18, 16, { uv: false }), false);
  return { position: pos.clone().addScaledVector(d, length), direction: d };
}

/**
 * IDSS-style docking nose at z = 0: hard ring tunnel (face 3 cm behind the plane), 12 latch hooks, docking
 * lights, target, and the animated three-petal soft-capture ring. Returns the petal record.
 */
export function dockingNose(b, R, group) {
  const F = -0.03;   // mating face
  b.add('dockRing', tubeZ(F, -0.7, R + 0.3, R + 0.3, 40, { open: true, uv: false }), false);
  b.add('metalDark', tubeZ(F, -0.7, R + 0.03, R + 0.03, 32, { open: true, uv: false }), false);
  b.add('metalBare', new THREE.RingGeometry(R + 0.03, R + 0.3, 40).translate(0, 0, F), false);
  b.add('metalDark', new THREE.RingGeometry(R + 0.03, R + 0.3, 40).rotateY(Math.PI).translate(0, 0, -0.7), false);
  b.add('metalDark', torus(V(0, 0, -0.68), Z_AXIS, R + 0.3, 0.05, 6, 40), false);
  // 12 latch hooks on the outer face
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
    b.add('metalDark', box(V(Math.cos(a) * (R + 0.2), Math.sin(a) * (R + 0.2), -0.12), 0.14, 0.1, 0.18, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, a), false), false);
  }
  // alignment guides with docking lights, and the docking target (black disc + white cross) on the ring face
  for (const sx of [-1, 1]) {
    b.add('metalDark', box(V(sx * (R + 0.52), 0, -0.35), 0.22, 0.2, 0.5, null, false), false);
    b.add('dockLight', box(V(sx * (R + 0.52), 0, -0.09), 0.14, 0.12, 0.03, null, false), false);
  }
  b.add('rubberBlack', new THREE.CircleGeometry(0.16, 16).translate(0, R + 0.16, F + 0.004), false);
  b.add('antennaWhite', box(V(0, R + 0.16, F + 0.008), 0.24, 0.04, 0.01, null, false), false);
  b.add('antennaWhite', box(V(0, R + 0.16, F + 0.008), 0.04, 0.24, 0.01, null, false), false);
  return buildPetals(b.shared, R, group);
}

/** Red (port, -X) / green (starboard, +X) steady lights and white strobes. */
export function navLights(b, red, green, strobes) {
  b.add('navRed', sphere(red, 0.08, 8, 6), false);
  b.add('navGreen', sphere(green, 0.08, 8, 6), false);
  for (const p of strobes) b.add('strobe', sphere(p, 0.09, 8, 6), false);
}

/** Window: dark frame + glossy warm-lit pane, centred at p with outward normal n. */
export function windowPane(b, p, n, w, h) {
  const nn = n.clone().normalize(), q = quatZ(nn);
  b.add('metalDark', box(p.clone().addScaledVector(nn, -0.04), w + 0.1, h + 0.1, 0.12, q, false), false);
  b.add('window', box(p.clone().addScaledVector(nn, 0.025), w, h, 0.03, q, false), false);
}

/** MLI-wrapped cylinder along Z with seam rings. */
export function wrappedCylinder(b, z0, z1, r, matName, rings = 2) {
  b.add(matName, tubeZ(z0, z1, r, r, 48));
  for (let i = 0; i <= rings; i++) {
    const z = z0 + (z1 - z0) * (i / rings);
    b.add('metalDark', new THREE.TorusGeometry(r + 0.01, 0.03, 5, 48).translate(0, 0, z), false);
  }
}

/** Standard glow / strobe / docking-light / petal / panel / door animation shared by all types (called from Ships). */
export function animateCommon(dt, ship, t) {
  const p = ship.parts, L = p.lights;
  // engine glow saturates while burning, decays with a ~6 s time constant
  ship.engineGlow = THREE.MathUtils.clamp(ship.engineGlow + (ship.burning ? dt * 0.8 : -dt * 0.16), 0, 1);
  L.set('hot', Math.round(7 * ship.engineGlow * ship.engineGlow * 20) / 20);
  // anti-collision strobe: double flash every 1.6 s
  const ph = (t * 0.625 + ship.strobePhase) % 1;
  L.set('strobe', (ph < 0.045) || (ph > 0.12 && ph < 0.165) ? 14 : 0);
  // docking lights fade in / out (quantised so the texture is only re-uploaded while it actually changes)
  const target = ship.dockLightsOn ? 10 : 0;
  ship.dockLightLevel += (target - ship.dockLightLevel) * Math.min(1, dt * 2);
  if (Math.abs(ship.dockLightLevel - target) < 0.02) ship.dockLightLevel = target;
  L.set('dockLight', Math.round(ship.dockLightLevel * 10) / 10);
  // amber beacon (drones): slow blink
  if (ship.type === 'drone') L.set('beacon', ((t * 0.8 + ship.strobePhase) % 1) < 0.5 ? 6 : 0.4);
  L.commit();
  // petals: ship.petalOpen 0 (upright) .. 1 (splayed); ship.petalExtend 0 (retracted) .. 1 (extended)
  if (p.petals) setPetals(p.petals, ship.petalOpen, ship.petalExtend);
  // solar panels (capsule): ship.panelDeploy 0 (folded along the body) .. 1 (deployed)
  if (p.panels) setHinged(p.panels, ship.panelDeploy, X_AXIS, -(1 - ship.panelDeploy) * Math.PI / 2);
  // payload bay doors (shuttle): ship.doorOpen 0..1
  if (p.doors) for (const d of p.doors) d.group.rotation.z = d.sign * d.openAngle * ship.doorOpen;
}

export { ShipBuilder, V, Z_AXIS };
