import * as THREE from 'three';
import { ShipBuilder, V, Z_AXIS, X_AXIS, cyl, sphere, tubeZ, buildDockingNose, registerShipMaterials, setPetals, setHinged } from '../ShipBuilder.js';

/**
 * Shared pieces of a ship type build.
 *
 * Every type builder returns:
 *   { group, colliders (local), nozzles [{position, direction}], mainNozzles [{position, direction}],
 *     mainAxis (local unit: direction the ship accelerates when the main engine burns),
 *     noseOffset, size: 'small'|'large', length, boundRadius, label (Russian type name),
 *     parts: { petals[], panels[], dish, doors[], hot, strobe, dockLight, blink, extra... },
 *     animate(dt, ship, ctx)  // type specific extras (optional)
 *   }
 * Local frame: +Z = docking axis (toward the port), docking plane at z = 0, body along -Z.
 */

/** Per-ship material clones that are animated (shared materials must not be mutated). */
export function shipMaterials(materials) {
  registerShipMaterials(materials);
  const hot = materials.get('nozzleHot').clone(); hot.emissiveIntensity = 0;
  const strobe = materials.get('navWhite').clone(); strobe.emissiveIntensity = 0;
  const dockLight = materials.get('shipDockLight').clone();
  return { hot, strobe, dockLight };
}

/** Main engine: outer bell (nozzle) + inner hot liner at `pos`, exhaust along -Z (or `dir`). */
export function mainEngine(b, hotMat, pos, rThroat, rExit, length, dir = null) {
  const d = dir ? dir.clone().normalize() : V(0, 0, -1);
  const c = pos.clone().addScaledVector(d, length / 2);
  // cyl axis +Y mapped to d: radiusTop (at +d side) = exit radius
  b.add('nozzle', cyl(c, d, rThroat, length, 28, { rTop: rExit, open: true, uv: false }), false);
  const inner = cyl(c.clone().addScaledVector(d, 0.02), d, rThroat * 0.92, length * 0.98, 28, { rTop: rExit * 0.95, open: true, uv: false });
  // flip to show the inside of the bell
  const idx = inner.index; if (idx) for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, a); }
  const n = inner.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  b.add('nozzleHot', inner, false, hotMat);
  b.add('metalDark', cyl(pos.clone().addScaledVector(d, -0.08), d, rThroat * 1.3, 0.18, 16, { uv: false }), false);
  return { position: pos.clone().addScaledVector(d, length), direction: d };
}

/** Builds the docking nose and returns the petal hinges. */
export function dockingNose(b, materials, R, group, dockLightMat) {
  const petals = [];
  buildDockingNose(b, materials, R, group, petals, dockLightMat);
  return petals;
}

/** Red (port, -X) / green (starboard, +X) steady lights and a white strobe (own material). */
export function navLights(b, strobeMat, red, green, strobes) {
  b.add('navRed', sphere(red, 0.08, 8, 6), false);
  b.add('navGreen', sphere(green, 0.08, 8, 6), false);
  for (const p of strobes) b.add('navWhite', sphere(p, 0.09, 8, 6), false, strobeMat);
}

/** Simple MLI-wrapped cylinder along Z with seam rings. */
export function wrappedCylinder(b, z0, z1, r, matName, rings = 2) {
  b.add(matName, tubeZ(z0, z1, r, r, 48));
  for (let i = 0; i <= rings; i++) {
    const z = z0 + (z1 - z0) * (i / rings);
    b.add('metalDark', new THREE.TorusGeometry(r + 0.01, 0.03, 5, 48).translate(0, 0, z), false);
  }
}

/** Standard engine-glow/strobe/dock-light/petal animation shared by all types (called from Ships). */
export function animateCommon(dt, ship, t) {
  const p = ship.parts;
  // engine glow decays with ~6 s time constant, saturates while burning
  ship.engineGlow = THREE.MathUtils.clamp(ship.engineGlow + (ship.burning ? dt * 0.8 : -dt * 0.16), 0, 1);
  if (p.hot) p.hot.emissiveIntensity = 7 * ship.engineGlow * ship.engineGlow;
  // anti-collision strobe: double flash every 1.6 s
  if (p.strobe) {
    const ph = (t * 0.625 + ship.strobePhase) % 1;
    const on = (ph < 0.045) || (ph > 0.12 && ph < 0.165);
    p.strobe.emissiveIntensity = on ? 14 : 0;
  }
  // docking lights fade in/out
  if (p.dockLight) {
    const target = ship.dockLightsOn ? 10 : 0;
    p.dockLight.emissiveIntensity += (target - p.dockLight.emissiveIntensity) * Math.min(1, dt * 2);
  }
  // petals: ship.petalOpen 0 (upright, latched) .. 1 (splayed outward)
  if (p.petals) for (const h of p.petals) setPetals(h, ship.petalOpen);
  // solar panels (capsule): ship.panelDeploy 0 (folded along the body) .. 1 (deployed)
  if (p.panels) for (const pv of p.panels) setHinged(pv, ship.panelDeploy, X_AXIS, -(1 - ship.panelDeploy) * Math.PI / 2);
  // payload bay doors (shuttle): ship.doorOpen 0..1
  if (p.doors) for (const d of p.doors) d.group.rotation.z = d.sign * d.openAngle * ship.doorOpen;
}

export { ShipBuilder, V, Z_AXIS };
