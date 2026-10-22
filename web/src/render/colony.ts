// Procedural colony from data/scene/d0_layout.json: modules (dome, airlock, cylinders, boxes, garage), pressurised
// corridors, props (solar field, antenna, tank cluster, light masts), the rover and the lava-tube cave mouth. Static
// geometry is pre-transformed into one batch (one draw); the rover, wheels and beacons are instanced dynamic meshes.
import type { SceneLayout, Vec3 } from '../contracts.ts';
import { FLAG, MAT, MeshBuilder, type GeometryPool, type Material } from './geometry.ts';
import { clamp, deg, dirFromLayoutAngle, m4, rng, v3 } from './math.ts';
import { caveBenchHeight } from './bake.ts';

// ---------------------------------------------------------------- palette (sRGB)
const WHITE: Vec3 = [0.83, 0.82, 0.79];
const WHITE2: Vec3 = [0.74, 0.73, 0.70];
const ORANGE: Vec3 = [0.88, 0.38, 0.09];
const GREY: Vec3 = [0.56, 0.57, 0.59];
const DARKC: Vec3 = [0.08, 0.08, 0.09];
const GOLD: Vec3 = [0.82, 0.6, 0.26];
const CONCRETE: Vec3 = [0.42, 0.36, 0.31];

const paint = (color: Vec3, roughness = 0.5, flags = 0): Material => ({ id: MAT.PAINT, color, roughness, flags });
const metal = (color: Vec3 = GREY, roughness = 0.35): Material => ({ id: MAT.METAL, color, roughness, metallic: 1 });
const dark = (roughness = 0.65): Material => ({ id: MAT.DARK, color: DARKC, roughness });
const windowMat: Material = { id: MAT.WINDOW, color: [0, 0, 0], roughness: 0.1, flags: FLAG.NO_DUST };
const lampMat = (color: Vec3): Material => ({ id: MAT.LAMP, color, roughness: 0.3, flags: FLAG.NO_DUST });
const hazard: Material = { id: MAT.HAZARD, color: [0.9, 0.7, 0.1], roughness: 0.6 };
const screen = (color: Vec3): Material => ({ id: MAT.SCREEN, color, roughness: 0.2, flags: FLAG.NO_DUST });
const solar: Material = { id: MAT.SOLAR, color: [0.05, 0.07, 0.15], roughness: 0.2 };
const plate: Material = { id: MAT.PLATE, color: [0.35, 0.34, 0.33], roughness: 0.7, metallic: 0.6 };
const interior = (color: Vec3): Material => ({ id: MAT.PAINT, color, roughness: 0.7, flags: FLAG.INTERIOR | FLAG.NO_DUST });

export interface ModuleInfo {
  zone: string;
  kind: string;
  index: number;
  position: Vec3;
  rotY: number;
  size: Vec3;
  /** Oriented footprint for actor push-out: centre, half extents (local x, z) and yaw. */
  footprint: { center: [number, number]; half: [number, number]; rotY: number; round: boolean };
  /** Glow of the windows when nothing is wrong (sector C is empty and dark). */
  windowGlow: number;
}

export interface LampInfo {
  pos: Vec3;
  color: Vec3;
  range: number;
  kind: 'mast' | 'door' | 'interior' | 'antenna' | 'garage';
  dir?: Vec3;
  cone?: number;
  module?: number;
}

export interface BeaconInfo { pos: Vec3; module: number }

export interface ColonyBuild {
  modules: ModuleInfo[];
  lamps: LampInfo[];
  beacons: BeaconInfo[];
  rover: { park: Vec3; rotY: number };
  cave: { mouth: Vec3; facing: Vec3; depth: number };
  stats: { staticTriangles: number };
}

type Ground = (x: number, z: number) => number;

/** Corridors mirror the pressurised door graph of data/world/zero_echo_d0.json (renderer has only the layout). */
const CORRIDORS: [string, string][] = [
  ['hab_main', 'airlock_a'], ['hab_main', 'niche_a'], ['hab_main', 'niche_b'], ['hab_main', 'lab_geo'], ['hab_main', 'medbay'],
  ['hab_main', 'workshop'], ['hab_main', 'power_hub'], ['workshop', 'sector_c'], ['power_hub', 'garage'],
];

const modelOf = (pos: Vec3, rotYdeg: number) => m4.multiply(m4.translation(pos[0], pos[1], pos[2]), m4.rotationY(deg(rotYdeg)));

/** Local +X direction of a module in world space (layout rotation convention). */
function axisX(rotYdeg: number): Vec3 {
  const a = deg(rotYdeg);
  return [Math.cos(a), 0, -Math.sin(a)];
}

export function buildColony(scene: SceneLayout, ground: Ground, pool: GeometryPool): ColonyBuild {
  const b = new MeshBuilder();
  const modules: ModuleInfo[] = [];
  const lamps: LampInfo[] = [];
  const beacons: BeaconInfo[] = [];
  const toWorld = (m: Float32Array, p: Vec3): Vec3 => m4.transformPoint(m, p);

  scene.modules.forEach((mod, index) => {
    const y = ground(mod.position[0], mod.position[2]);
    const pos: Vec3 = [mod.position[0], y, mod.position[2]];
    const M = modelOf(pos, mod.rotation_y_deg);
    b.module = index < 16 ? index : 255;
    b.push(M);
    const ctx: ModCtx = { b, M, size: mod.size, lamps, beacons, index, toWorld: (p) => toWorld(M, p) };
    let round = false;
    switch (mod.kind) {
      case 'dome': buildDome(ctx); round = true; break;
      case 'airlock': buildAirlock(ctx); break;
      case 'cylinder': buildCylinderModule(ctx, mod.zone); break;
      case 'garage': buildGarage(ctx); break;
      default: buildBoxModule(ctx, mod.zone); break;
    }
    b.pop();
    modules.push({
      zone: mod.zone, kind: mod.kind, index, position: pos, rotY: deg(mod.rotation_y_deg), size: mod.size,
      footprint: {
        center: [pos[0], pos[2]],
        half: mod.kind === 'dome' ? [mod.size[0] / 2 + 0.4, mod.size[2] / 2 + 0.4] : [mod.size[0] / 2 + (mod.kind === 'cylinder' ? 0.55 : 0.25), mod.size[2] / 2 + 0.25],
        rotY: deg(mod.rotation_y_deg),
        round,
      },
      windowGlow: mod.zone === 'sector_c' ? 0.0 : 1.0,
    });
  });
  b.module = 255;

  buildCorridors(b, scene, modules);
  for (const prop of scene.props) {
    const y = ground(prop.position[0], prop.position[2]);
    const pos: Vec3 = [prop.position[0], y, prop.position[2]];
    switch (prop.kind) {
      case 'solar_field': buildSolarField(b, pos, prop.size ?? [36, 1.6, 22], prop.rows ?? 6, prop.cols ?? 10, scene, ground); break;
      case 'antenna': buildAntenna(b, pos, prop.size ?? [1.2, 14, 1.2], lamps, beacons); break;
      case 'tank_cluster': buildTanks(b, pos, prop.size ?? [5, 4, 5]); break;
      case 'light_mast': buildLightMast(b, pos, prop.size ?? [0.5, 8, 0.5], lamps); break;
      default: break; // rover is dynamic
    }
  }
  const cave = buildCave(b, scene, ground);
  const staticRange = pool.add('colony_static', b);

  // Dynamic meshes.
  pool.add('rover_body', buildRoverBody());
  pool.add('rover_wheel', buildWheel());
  pool.add('beacon', buildBeacon());
  const roverProp = scene.props.find((p) => p.kind === 'rover');
  const park: Vec3 = roverProp ? [roverProp.position[0], ground(roverProp.position[0], roverProp.position[2]), roverProp.position[2]] : [34, 0, 19];
  return {
    modules, lamps, beacons,
    rover: { park, rotY: deg(roverProp?.rotation_y_deg ?? -35) },
    cave,
    stats: { staticTriangles: staticRange.indexCount / 3 },
  };
}

interface ModCtx {
  b: MeshBuilder;
  M: Float32Array;
  size: Vec3;
  lamps: LampInfo[];
  beacons: BeaconInfo[];
  index: number;
  toWorld: (p: Vec3) => Vec3;
}

// ---------------------------------------------------------------- dome (hab_main)
function buildDome(c: ModCtx): void {
  const { b } = c;
  const R = c.size[0] / 2;
  const H = c.size[1];
  const wallTop = 1.9;
  // Foundation ring.
  b.set(paint(CONCRETE, 0.9));
  b.lathe([[R + 0.45, 0], [R + 0.45, 0.3], [R + 0.1, 0.42]], 40);
  // Base wall with alternating panels.
  for (let k = 0; k < 2; k++) {
    b.set(paint(k ? WHITE2 : WHITE, 0.45));
    b.lathe([[R, 0.4 + k * 0.75], [R, 0.4 + (k + 1) * 0.75]], 40);
  }
  b.set(paint(ORANGE, 0.5));
  b.lathe([[R + 0.012, wallTop - 0.15], [R + 0.012, wallTop]], 40);
  // Dome cap in panel bands.
  const bands = 6;
  for (let k = 0; k < bands; k++) {
    const prof: [number, number][] = [];
    for (let i = 0; i <= 4; i++) {
      const th = ((k + i / 4) / bands) * (Math.PI / 2);
      prof.push([Math.max(R * Math.cos(th), 0.02), wallTop + (H - wallTop) * Math.sin(th)]);
    }
    b.set(paint(k % 2 ? WHITE2 : WHITE, 0.42));
    b.lathe(prof, 40);
  }
  // Meridian ribs and latitude rings.
  b.set(metal(GREY, 0.4));
  for (let m = 0; m < 12; m++) {
    const a = (m / 12) * Math.PI * 2;
    let prev: Vec3 | null = null;
    for (let i = 0; i <= 10; i++) {
      const th = (i / 10) * (Math.PI / 2) * 0.93;
      const r = R * Math.cos(th) + 0.05;
      const p: Vec3 = [r * Math.cos(a), wallTop + (H - wallTop) * Math.sin(th) + 0.03, r * Math.sin(a)];
      if (prev) b.beam(prev, p, 0.1);
      prev = p;
    }
  }
  for (let k = 1; k < bands; k++) {
    const th = (k / bands) * (Math.PI / 2);
    b.push(m4.translation(0, wallTop + (H - wallTop) * Math.sin(th), 0));
    b.torus(R * Math.cos(th) + 0.03, 0.045, 40, 5);
    b.pop();
  }
  b.push(m4.translation(0, wallTop, 0));
  b.torus(R + 0.03, 0.07, 40, 6);
  b.pop();
  // Windows in the base wall (skip the +X side where the airlock corridor attaches).
  for (let w = 0; w < 10; w++) {
    const a = (w / 10) * Math.PI * 2 + Math.PI / 10;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.45) continue;
    domeWindow(b, R, a, 1.0, 1.55, 0.2);
  }
  // Cupola, top hatch and mast with a beacon.
  b.set(paint(WHITE, 0.5));
  b.push(m4.translation(0, H - 0.08, 0));
  b.lathe([[0.95, 0], [0.95, 0.35], [0.8, 0.5], [0.001, 0.55]], 24);
  b.set(metal(GREY));
  b.cylinder(0.05, 0.5, 1.6, 6);
  b.pop();
  c.beacons.push({ pos: c.toWorld([0, H + 1.65, 0]), module: c.index });
  // Door lamp over the corridor to the airlock.
  b.set(lampMat([1, 0.85, 0.6]));
  b.box([R + 0.05, 2.75, 0], [0.12, 0.12, 0.5]);
  c.lamps.push({ pos: c.toWorld([R + 0.4, 2.7, 0]), color: [1, 0.8, 0.55], range: 9, kind: 'door', module: c.index });
}

function domeWindow(b: MeshBuilder, R: number, a: number, y0: number, y1: number, halfAng: number): void {
  const pt = (ang: number, y: number, r: number): Vec3 => [r * Math.cos(ang), y, r * Math.sin(ang)];
  b.set(windowMat);
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const a0 = a - halfAng + (2 * halfAng * i) / steps, a1 = a - halfAng + (2 * halfAng * (i + 1)) / steps;
    const r = R + 0.025;
    b.quadP(pt(a0, y0, r), pt(a0, y1, r), pt(a1, y1, r), pt(a1, y0, r));
  }
  // Frame.
  b.set(dark(0.5));
  const r = R + 0.035;
  b.beam(pt(a - halfAng, y0 - 0.04, r), pt(a + halfAng, y0 - 0.04, r), 0.07);
  b.beam(pt(a - halfAng, y1 + 0.04, r), pt(a + halfAng, y1 + 0.04, r), 0.07);
}

// ---------------------------------------------------------------- airlock: hollow, outer door open (+X)
function buildAirlock(c: ModCtx): void {
  const { b } = c;
  const [L, H, W] = c.size;
  const hx = L / 2, hz = W / 2;
  const t = 0.16;
  const doorW = 1.25, doorH = 2.15;
  // Exterior shell (no +X face; built with the door frame below).
  b.set(paint(WHITE, 0.5));
  b.box([0, H / 2, 0], [L, H, W], { skip: ['px', 'ny'] });
  b.set(paint(ORANGE, 0.5));
  b.box([0, H - 0.25, 0], [L + 0.02, 0.18, W + 0.02], { skip: ['px', 'nx', 'py', 'ny'] });
  // Ribs on the long sides.
  b.set(metal(GREY, 0.45));
  for (let i = 0; i < 4; i++) {
    const x = -hx + 0.6 + (i * (L - 1.2)) / 3;
    b.box([x, H / 2, hz + 0.04], [0.12, H, 0.08]);
    b.box([x, H / 2, -hz - 0.04], [0.12, H, 0.08]);
  }
  // Outer end wall with the door opening (outside face +X, inside face -X).
  const endOuter = (z0: number, z1: number, y0: number, y1: number) => {
    b.set(paint(WHITE2, 0.5));
    b.quadP([hx, y0, z1], [hx, y0, z0], [hx, y1, z0], [hx, y1, z1]);
    b.set(interior([0.5, 0.48, 0.46]));
    b.quadP([hx - t, y0, z0], [hx - t, y0, z1], [hx - t, y1, z1], [hx - t, y1, z0]);
  };
  endOuter(-hz, -doorW / 2, 0, H);
  endOuter(doorW / 2, hz, 0, H);
  endOuter(-doorW / 2, doorW / 2, doorH, H);
  // Door jambs (reveal).
  b.set(hazard);
  b.quadP([hx, 0, -doorW / 2], [hx - t, 0, -doorW / 2], [hx - t, doorH, -doorW / 2], [hx, doorH, -doorW / 2]);
  b.quadP([hx - t, 0, doorW / 2], [hx, 0, doorW / 2], [hx, doorH, doorW / 2], [hx - t, doorH, doorW / 2]);
  b.quadP([hx, doorH, -doorW / 2], [hx - t, doorH, -doorW / 2], [hx - t, doorH, doorW / 2], [hx, doorH, doorW / 2]);
  // Slid-open door leaf beside the opening, hazard frame, threshold.
  b.set(paint(WHITE2, 0.55));
  b.box([hx + 0.06, doorH / 2, -doorW / 2 - 0.62], [0.06, doorH, 1.22]);
  b.set(dark(0.5));
  b.box([hx + 0.02, 0.06, 0], [0.4, 0.12, doorW + 0.2]);
  // Interior: floor, ceiling, side walls, inner door (all inward-facing, no sun).
  b.set(interior([0.36, 0.35, 0.34]));
  b.box([0, 0.12, 0], [L - 2 * t, 0.02, W - 2 * t], { skip: ['ny', 'px', 'nx', 'pz', 'nz'] });
  b.set(interior([0.55, 0.53, 0.5]));
  b.box([0, H / 2, 0], [L - 2 * t, H - 0.25, W - 2 * t], { skip: ['px', 'ny'], inward: true });
  // Suit racks and benches inside (silhouettes against the open door).
  b.set(interior([0.25, 0.25, 0.27]));
  for (let i = 0; i < 3; i++) b.box([-hx + 0.7 + i * 0.9, 1.25, -hz + 0.35], [0.5, 1.6, 0.3]);
  b.box([-0.2, 0.45, hz - 0.35], [2.4, 0.08, 0.5]);
  b.set(lampMat([1.0, 0.25, 0.12]));
  b.box([0, H - 0.17, 0], [1.2, 0.04, 0.12]);
  c.lamps.push({ pos: c.toWorld([0, H - 0.4, 0]), color: [1.0, 0.25, 0.1], range: 5, kind: 'interior', module: c.index });
  // Exterior control panel next to the door, door lamp and beacon.
  b.set(dark(0.5));
  b.box([hx + 0.08, 1.35, -doorW / 2 - 1.35], [0.12, 0.6, 0.42]);
  b.set(screen([0.2, 0.9, 0.55]));
  b.box([hx + 0.145, 1.42, -doorW / 2 - 1.35], [0.01, 0.28, 0.3]);
  b.set(lampMat([1.0, 0.82, 0.6]));
  b.box([hx + 0.08, doorH + 0.32, 0], [0.12, 0.1, 0.6]);
  c.lamps.push({ pos: c.toWorld([hx + 0.5, doorH + 0.25, 0]), color: [1.0, 0.8, 0.55], range: 9, kind: 'door', module: c.index });
  c.beacons.push({ pos: c.toWorld([hx - 0.4, H + 0.18, hz - 0.4]), module: c.index });
}

// ---------------------------------------------------------------- horizontal cylinder modules
function buildCylinderModule(c: ModCtx, zone: string): void {
  const { b } = c;
  const [L, D, W] = c.size;
  const R = D / 2;
  const h = R + 0.32;
  const hl = L / 2;
  // Hull along local X: lathe around Y rotated so +Y -> +X.
  b.push(m4.multiply(m4.translation(0, h, 0), m4.rotationZ(-Math.PI / 2)));
  const nb = Math.max(2, Math.round(L / 1.15));
  for (let k = 0; k < nb; k++) {
    const y0 = -hl + (L * k) / nb, y1 = -hl + (L * (k + 1)) / nb;
    b.set(paint(k % 2 ? WHITE2 : WHITE, 0.45));
    b.lathe([[R, y0], [R, y1]], 32);
  }
  for (const s of [-1, 1]) {
    b.set(paint(WHITE, 0.45));
    const cap: [number, number][] = [[R, s * hl], [R * 0.95, s * (hl + 0.16)], [R * 0.78, s * (hl + 0.33)], [R * 0.45, s * (hl + 0.45)], [0.002, s * (hl + 0.5)]];
    b.lathe(s > 0 ? cap : cap.reverse(), 32);
  }
  b.set(metal(GREY, 0.4));
  for (let k = 0; k <= nb; k++) {
    b.push(m4.translation(0, -hl + (L * k) / nb, 0));
    b.torus(R + 0.025, 0.05, 32, 5);
    b.pop();
  }
  b.set(paint(ORANGE, 0.5));
  b.lathe([[R + 0.012, hl - 0.45], [R + 0.012, hl - 0.25]], 32);
  b.lathe([[R + 0.012, -hl + 0.25], [R + 0.012, -hl + 0.45]], 32);
  // Hatch ring and door on the +X end cap.
  b.set(metal(GREY, 0.35));
  b.push(m4.translation(0, hl + 0.44, 0));
  b.torus(0.52, 0.06, 24, 6);
  b.set(dark(0.45));
  b.cylinder(0.5, -0.04, 0.05, 20);
  b.pop();
  b.pop();
  // Windows on both sides.
  const nw = Math.max(1, Math.round(L / 2.4));
  for (const side of [-1, 1]) {
    for (let i = 0; i < nw; i++) {
      const x = -hl + (L * (i + 0.5)) / nw;
      const z = side * (R + 0.02);
      b.set(windowMat);
      const y0 = h - 0.18, y1 = h + 0.2;
      if (side > 0) b.quadP([x - 0.32, y0, z], [x + 0.32, y0, z], [x + 0.32, y1, z], [x - 0.32, y1, z]);
      else b.quadP([x + 0.32, y0, z], [x - 0.32, y0, z], [x - 0.32, y1, z], [x + 0.32, y1, z]);
      b.set(dark(0.5));
      b.box([x, y1 + 0.04, side * (R + 0.01)], [0.72, 0.06, 0.05]);
      b.box([x, y0 - 0.04, side * (R + 0.01)], [0.72, 0.06, 0.05]);
    }
  }
  // Cradles.
  b.set(metal([0.4, 0.41, 0.43], 0.55));
  for (const x of [-L / 3, L / 3]) {
    b.box([x, (h - R * 0.75) / 2, 0], [0.32, h - R * 0.75, W * 0.78]);
    b.set(paint(CONCRETE, 0.9));
    b.box([x, 0.06, 0], [0.7, 0.12, W * 0.9]);
    b.set(metal([0.4, 0.41, 0.43], 0.55));
  }
  // End-cap equipment: panel with a screen, valves, conduit to the ground; lamp over the hatch; step.
  const ex = hl + 0.2;
  b.set(dark(0.5));
  b.box([ex + 0.08, h - 0.25, R * 0.62], [0.16, 0.75, 0.5]);
  b.set(screen(zone === 'niche_a' || zone === 'niche_b' ? [1.0, 0.55, 0.15] : [0.2, 0.85, 0.6]));
  b.box([ex + 0.165, h - 0.12, R * 0.62], [0.01, 0.3, 0.36]);
  b.set(metal([0.7, 0.2, 0.12], 0.4));
  for (let i = 0; i < 3; i++) {
    b.push(m4.multiply(m4.translation(ex + 0.18, h - 0.48, R * 0.62 - 0.15 + i * 0.15), m4.rotationZ(Math.PI / 2)));
    b.cylinder(0.045, 0, 0.08, 8);
    b.pop();
  }
  b.set(metal(GOLD, 0.35));
  b.beam([ex + 0.05, h - 0.6, R * 0.62 + 0.2], [ex + 0.05, 0.02, R * 0.62 + 0.25], 0.07);
  b.set(lampMat([1, 0.85, 0.62]));
  b.box([hl + 0.33, h + 0.72, 0], [0.12, 0.08, 0.36]);
  c.lamps.push({ pos: c.toWorld([hl + 0.8, h + 0.6, 0]), color: [1, 0.8, 0.55], range: 7, kind: 'door', module: c.index });
  b.set(plate);
  b.box([hl + 0.75, 0.1, 0], [0.6, 0.2, 1.1]);
  // Gold MLI blanket on the far end, radiator panel on top for larger modules.
  b.set(metal(GOLD, 0.45));
  b.box([-hl - 0.05, h + R * 0.55, 0], [0.5, 0.06, R * 0.9]);
  if (L >= 6) {
    b.set(paint([0.9, 0.9, 0.9], 0.3));
    b.box([0, h + R + 0.35, 0], [L * 0.55, 0.05, 1.3]);
    b.set(metal(GREY));
    b.box([-L * 0.2, h + R + 0.17, 0], [0.08, 0.36, 0.08]);
    b.box([L * 0.2, h + R + 0.17, 0], [0.08, 0.36, 0.08]);
  }
  if (zone === 'workshop') {
    // Drone landing pad with hazard ring next to the workshop.
    b.set(plate);
    b.box([-0.8, 0.05, -W / 2 - 1.1], [1.6, 0.1, 1.6]);
    b.set(hazard);
    b.box([-0.8, 0.105, -W / 2 - 1.1], [1.7, 0.01, 0.12]);
  }
}

// ---------------------------------------------------------------- box modules (power hub, sector C)
function buildBoxModule(c: ModCtx, zone: string): void {
  const { b } = c;
  const [L, H, W] = c.size;
  const hx = L / 2, hz = W / 2;
  b.set(paint(CONCRETE, 0.9));
  b.box([0, 0.1, 0], [L + 0.4, 0.2, W + 0.4]);
  b.set(paint(zone === 'sector_c' ? [0.66, 0.64, 0.6] : WHITE, 0.55));
  b.box([0, 0.2 + (H - 0.2) / 2, 0], [L, H - 0.2, W], { skip: ['ny'] });
  b.set(metal(GREY, 0.45));
  b.box([0, H + 0.05, 0], [L + 0.1, 0.1, W + 0.1], { skip: ['ny'] });
  for (let i = 0; i <= 6; i++) {
    const x = -hx + (L * i) / 6;
    b.box([x, H / 2 + 0.1, hz + 0.03], [0.08, H - 0.2, 0.06]);
    b.box([x, H / 2 + 0.1, -hz - 0.03], [0.08, H - 0.2, 0.06]);
  }
  // Door (+X) with hazard frame and lamp.
  b.set(dark(0.45));
  b.box([hx + 0.02, 1.1, 0], [0.06, 2.0, 1.1]);
  b.set(hazard);
  b.box([hx + 0.03, 2.18, 0], [0.06, 0.12, 1.4]);
  b.set(lampMat([1, 0.85, 0.62]));
  b.box([hx + 0.08, 2.45, 0], [0.12, 0.08, 0.4]);
  c.lamps.push({ pos: c.toWorld([hx + 0.5, 2.4, 0]), color: [1, 0.8, 0.55], range: 7, kind: 'door', module: c.index });
  // Small windows.
  for (const z of [-hz + 0.9, hz - 0.9]) {
    b.set(windowMat);
    b.quadP([hx + 0.01, 1.4, z - 0.3], [hx + 0.01, 1.4, z + 0.3], [hx + 0.01, 1.75, z + 0.3], [hx + 0.01, 1.75, z - 0.3].map((v, i) => v) as Vec3);
  }
  if (zone === 'power_hub') {
    // Radiator fins and battery cabinets.
    b.set(paint([0.92, 0.92, 0.9], 0.3));
    for (let i = 0; i < 6; i++) b.box([-hx + 0.7 + i * ((L - 1.4) / 5), H + 0.75, 0], [0.06, 1.3, W * 0.7]);
    b.set(dark(0.6));
    for (let i = 0; i < 3; i++) b.box([-hx + 1 + i * 1.3, 0.85, -hz - 0.55], [1.0, 1.3, 0.7]);
    b.set(screen([0.3, 0.75, 1.0]));
    for (let i = 0; i < 3; i++) b.box([-hx + 1 + i * 1.3, 1.15, -hz - 0.91], [0.5, 0.2, 0.01]);
    c.beacons.push({ pos: c.toWorld([hx - 0.5, H + 0.2, hz - 0.5]), module: c.index });
  } else {
    b.set(metal(GREY, 0.5));
    b.box([0, H + 0.35, 0], [1.2, 0.5, 1.2]);
  }
}

// ---------------------------------------------------------------- garage (quonset hangar, door +X)
function buildGarage(c: ModCtx): void {
  const { b } = c;
  const [L, H, W] = c.size;
  const hx = L / 2, R = W / 2;
  const wall = Math.max(0.6, H - R);
  const doorW = 5.4, doorH = Math.min(3.8, H - 0.9);
  b.set(paint(CONCRETE, 0.9));
  b.box([0, 0.08, 0], [L + 0.6, 0.16, W + 0.6]);
  b.set(paint(WHITE2, 0.55));
  b.box([0, wall / 2, R - 0.08], [L, wall, 0.16]);
  b.box([0, wall / 2, -R + 0.08], [L, wall, 0.16]);
  // Arched roof (outside), with raised ribs.
  b.push(m4.multiply(m4.translation(0, wall, 0), m4.rotationZ(-Math.PI / 2)));
  const arc: [number, number] = [Math.PI / 2, (3 * Math.PI) / 2];
  const nb = 6;
  for (let k = 0; k < nb; k++) {
    b.set(paint(k % 2 ? WHITE : WHITE2, 0.5));
    b.lathe([[R, -hx + (L * k) / nb], [R, -hx + (L * (k + 1)) / nb]], 24, { arc });
  }
  b.set(metal(GREY, 0.45));
  for (let k = 0; k <= nb; k++) {
    const y = -hx + (L * k) / nb;
    b.lathe([[R + 0.06, y - 0.08], [R + 0.06, y + 0.08]], 24, { arc });
  }
  // Interior of the arch (dark, inward).
  b.flip = true;
  b.set(interior([0.4, 0.39, 0.38]));
  b.lathe([[R - 0.12, -hx + 0.1], [R - 0.12, hx - 0.1]], 24, { arc });
  b.flip = false;
  b.pop();
  // End walls: strips following the arch; the +X wall has the big door opening.
  const strips = 16;
  for (const end of [-1, 1]) {
    const x = end * hx;
    for (let i = 0; i < strips; i++) {
      const z0 = -R + (2 * R * i) / strips, z1 = -R + (2 * R * (i + 1)) / strips;
      const top = (z: number) => wall + Math.sqrt(Math.max(R * R - z * z, 0));
      const inDoor = end > 0 && Math.abs((z0 + z1) / 2) < doorW / 2;
      const y0 = inDoor ? doorH : 0;
      b.set(paint(WHITE, 0.55));
      if (end > 0) b.quadP([x, y0, z1], [x, y0, z0], [x, top(z0), z0], [x, top(z1), z1]);
      else b.quadP([x, y0, z0], [x, y0, z1], [x, top(z1), z1], [x, top(z0), z0]);
      b.set(interior([0.38, 0.37, 0.36]));
      const xi = x - end * 0.12;
      if (end > 0) b.quadP([xi, y0, z0], [xi, y0, z1], [xi, top(z1) - 0.12, z1], [xi, top(z0) - 0.12, z0]);
      else b.quadP([xi, y0, z1], [xi, y0, z0], [xi, top(z0) - 0.12, z0], [xi, top(z1) - 0.12, z1]);
    }
  }
  // Rolled-up door, frame with hazard stripes, floor plates inside, interior lamp, door lamps.
  b.set(dark(0.5));
  b.box([hx + 0.05, doorH + 0.25, 0], [0.4, 0.5, doorW + 0.2]);
  b.set(hazard);
  b.box([hx + 0.04, doorH / 2, -doorW / 2 - 0.1], [0.1, doorH, 0.2]);
  b.box([hx + 0.04, doorH / 2, doorW / 2 + 0.1], [0.1, doorH, 0.2]);
  b.set(interior([0.3, 0.3, 0.3]));
  b.box([0, 0.17, 0], [L - 0.3, 0.02, W - 0.4], { skip: ['ny', 'px', 'nx', 'pz', 'nz'] });
  b.set(interior([0.22, 0.22, 0.24]));
  b.box([-hx + 1.2, 1.2, 0], [0.9, 2.0, W * 0.6]);
  b.set(lampMat([1, 0.86, 0.62]));
  b.box([0, wall + R - 0.35, 0], [2.5, 0.06, 0.3]);
  c.lamps.push({ pos: c.toWorld([0, wall + R - 1.0, 0]), color: [1, 0.82, 0.58], range: 11, kind: 'garage', module: c.index });
  b.set(lampMat([1, 0.85, 0.62]));
  b.box([hx + 0.28, doorH + 0.62, -doorW / 2], [0.14, 0.1, 0.4]);
  b.box([hx + 0.28, doorH + 0.62, doorW / 2], [0.14, 0.1, 0.4]);
  c.lamps.push({ pos: c.toWorld([hx + 1.0, doorH + 0.5, 0]), color: [1, 0.8, 0.55], range: 12, kind: 'door', module: c.index });
  c.beacons.push({ pos: c.toWorld([hx - 0.6, H + 0.15, 0]), module: c.index });
}

// ---------------------------------------------------------------- corridors (skipped where a stand point would end up inside)
function buildCorridors(b: MeshBuilder, scene: SceneLayout, modules: ModuleInfo[]): void {
  const byZone = new Map(modules.map((m) => [m.zone, m]));
  const stands = Object.values(scene.zone_stand_points);
  const port = (m: ModuleInfo, toward: Vec3): { p: Vec3; h: number } => {
    const dir = v3.norm([toward[0] - m.position[0], 0, toward[2] - m.position[2]]);
    if (m.kind === 'dome') {
      const R = m.size[0] / 2;
      return { p: v3.madd(m.position, dir, R - 0.25), h: 1.25 };
    }
    const ax = axisX(deg(0) + (m.rotY * 180) / Math.PI);
    const along = v3.dot(dir, ax);
    const half = m.size[0] / 2;
    if (m.kind === 'cylinder') return { p: v3.madd(m.position, ax, Math.sign(along || 1) * (half + 0.35)), h: m.size[1] / 2 + 0.32 };
    // Boxes / garage / airlock: exit through the face closest to the other module.
    const side: Vec3 = [-ax[2], 0, ax[0]];
    const across = v3.dot(dir, side);
    if (Math.abs(along) * m.size[2] >= Math.abs(across) * m.size[0]) return { p: v3.madd(m.position, ax, Math.sign(along) * (half - 0.1)), h: 1.25 };
    return { p: v3.madd(m.position, side, Math.sign(across) * (m.size[2] / 2 - 0.1)), h: 1.25 };
  };
  for (const [za, zb] of CORRIDORS) {
    const A = byZone.get(za), B = byZone.get(zb);
    if (!A || !B) continue;
    const pa = port(A, B.position), pb = port(B, A.position);
    const a: Vec3 = [pa.p[0], pa.h, pa.p[2]], c: Vec3 = [pb.p[0], pb.h, pb.p[2]];
    const len = v3.dist(a, c);
    if (len < 0.5) continue;
    // Skip corridors that would swallow a stand point (crew are shown outside at their zone points).
    const blocked = stands.some((s) => segDist2D(s, a, c) < 1.7);
    if (blocked) continue;
    const dir = v3.norm(v3.sub(c, a));
    const yaw = Math.atan2(dir[0], dir[2]);
    const pitch = Math.asin(clamp(dir[1], -1, 1));
    // Tube along local +Y, oriented from a to c.
    const M = m4.multiply(m4.translation(a[0], a[1], a[2]), m4.multiply(m4.rotationY(yaw), m4.rotationX(Math.PI / 2 - pitch)));
    b.push(M);
    b.set(paint(WHITE2, 0.55));
    b.cylinder(0.95, 0, len, 20, false);
    b.set(metal(GREY, 0.45));
    const rings = Math.max(1, Math.round(len / 1.4));
    for (let i = 0; i <= rings; i++) {
      b.push(m4.translation(0, (len * i) / rings, 0));
      b.torus(0.98, 0.05, 20, 4);
      b.pop();
    }
    b.pop();
    // Supports.
    b.set(metal([0.4, 0.41, 0.43], 0.55));
    const n = Math.max(1, Math.floor(len / 3));
    for (let i = 1; i <= n; i++) {
      const p = v3.lerp(a, c, i / (n + 1));
      b.box([p[0], (p[1] - 0.9) / 2, p[2]], [0.25, Math.max(p[1] - 0.9, 0.05), 0.25]);
    }
  }
}

function segDist2D(p: Vec3, a: Vec3, c: Vec3): number {
  const abx = c[0] - a[0], abz = c[2] - a[2];
  const t = clamp(((p[0] - a[0]) * abx + (p[2] - a[2]) * abz) / Math.max(abx * abx + abz * abz, 1e-6), 0, 1);
  return Math.hypot(p[0] - (a[0] + abx * t), p[2] - (a[2] + abz * t));
}

// ---------------------------------------------------------------- props
function buildSolarField(b: MeshBuilder, pos: Vec3, size: Vec3, rows: number, cols: number, scene: SceneLayout, ground: Ground): void {
  const sun = dirFromLayoutAngle(scene.sun.azimuth_deg);
  const yaw = Math.atan2(sun[0], sun[2]); // panel normal faces the sun azimuth
  const cellX = size[0] / cols, cellZ = size[2] / rows;
  const pw = cellX * 0.9, pd = Math.min(cellZ * 0.6, 2.2);
  const tilt = deg(26);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = pos[0] - size[0] / 2 + cellX * (k + 0.5);
      const z = pos[2] - size[2] / 2 + cellZ * (r + 0.5);
      const y = ground(x, z);
      b.push(m4.multiply(m4.translation(x, y, z), m4.rotationY(yaw)));
      // Legs.
      b.set(metal([0.5, 0.5, 0.52], 0.5));
      b.box([-pw * 0.35, 0.45, 0], [0.08, 0.9, 0.08]);
      b.box([pw * 0.35, 0.45, 0], [0.08, 0.9, 0.08]);
      b.box([0, 0.9, 0], [pw * 0.85, 0.08, 0.08]);
      b.push(m4.multiply(m4.translation(0, 1.0, 0), m4.rotationX(tilt)));
      b.set(metal([0.6, 0.6, 0.62], 0.4));
      b.box([0, -0.03, 0], [pw + 0.06, 0.05, pd + 0.06]);
      b.set(solar);
      b.box([0, 0.0, 0], [pw, 0.02, pd], { skip: ['ny'] });
      b.pop();
      b.pop();
    }
    // Cable tray along the row and an inverter box at its end.
    const z = pos[2] - size[2] / 2 + cellZ * (r + 0.5);
    b.set(dark(0.7));
    b.box([pos[0], ground(pos[0], z) + 0.08, z + 0.9], [size[0], 0.12, 0.2]);
    b.set(paint(WHITE2, 0.5));
    const ex = pos[0] - size[0] / 2 - 0.8;
    b.box([ex, ground(ex, z) + 0.55, z], [0.6, 1.1, 0.8]);
  }
  // Trunk cable toward the power hub.
  b.set(dark(0.7));
  const hub = scene.modules.find((m) => m.zone === 'power_hub')?.position ?? [22, 0, -14];
  const start: Vec3 = [pos[0] - size[0] / 2 - 0.8, 0.1, pos[2]];
  b.beam([start[0], ground(start[0], start[2]) + 0.08, start[2]], [hub[0] + 3.4, ground(hub[0], hub[2]) + 0.08, hub[2]], 0.16);
}

function buildAntenna(b: MeshBuilder, pos: Vec3, size: Vec3, lamps: LampInfo[], beacons: BeaconInfo[]): void {
  const H = size[1];
  const w = size[0] / 2;
  b.push(m4.translation(pos[0], pos[1], pos[2]));
  b.set(paint(CONCRETE, 0.9));
  b.box([0, 0.15, 0], [size[0] + 1.2, 0.3, size[2] + 1.2]);
  b.set(metal([0.7, 0.7, 0.72], 0.4));
  const taper = (y: number) => w * (1 - 0.55 * (y / H));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.beam([sx * w, 0.3, sz * w], [sx * taper(H), H, sz * taper(H)], 0.07);
  const levels = Math.round(H / 1.4);
  for (let i = 0; i < levels; i++) {
    const y0 = 0.3 + (i * (H - 0.3)) / levels, y1 = 0.3 + ((i + 1) * (H - 0.3)) / levels;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4];
      b.beam([ax * taper(y0), y0, az * taper(y0)], [bx * taper(y1), y1, bz * taper(y1)], 0.035);
      b.beam([ax * taper(y1), y1, az * taper(y1)], [bx * taper(y1), y1, bz * taper(y1)], 0.035);
    }
  }
  // Dish on a gimbal near the top, whip antenna, aviation light.
  b.push(m4.multiply(m4.translation(0, H * 0.78, w * 0.4), m4.rotationX(deg(-55))));
  b.set(paint([0.92, 0.92, 0.9], 0.35));
  b.lathe([[0.002, 0.0], [0.5, 0.06], [0.95, 0.22], [1.25, 0.42]], 28);
  b.flip = true;
  b.lathe([[0.002, 0.01], [0.5, 0.07], [0.95, 0.23], [1.25, 0.43]], 28);
  b.flip = false;
  b.set(metal(GREY));
  b.cylinder(0.04, 0.0, 0.9, 6);
  b.pop();
  b.set(metal(GREY));
  b.cylinder(0.03, H, H + 2.2, 6);
  b.set(lampMat([1.0, 0.12, 0.06]));
  b.push(m4.translation(0, H + 0.05, 0));
  b.sphere(0.12, 8, 4);
  b.pop();
  b.pop();
  lamps.push({ pos: [pos[0], pos[1] + H + 0.05, pos[2]], color: [1.0, 0.1, 0.05], range: 4, kind: 'antenna' });
  beacons.push({ pos: [pos[0] + w * 0.6, pos[1] + H * 0.55, pos[2] - w * 0.6], module: -1 });
}

function buildTanks(b: MeshBuilder, pos: Vec3, size: Vec3): void {
  b.push(m4.translation(pos[0], pos[1], pos[2]));
  b.set(metal([0.45, 0.45, 0.47], 0.55));
  b.box([0, 0.15, 0], [size[0], 0.3, size[2]]);
  b.set(hazard);
  b.box([0, 0.31, size[2] / 2 - 0.05], [size[0], 0.03, 0.1]);
  const r = Math.min(size[0], size[2]) * 0.2;
  const h = size[1] - r - 0.4;
  const offs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  offs.forEach(([sx, sz], i) => {
    b.push(m4.translation(sx * size[0] * 0.24, 0.3, sz * size[2] * 0.24));
    b.set(paint(i === 2 ? ORANGE : WHITE, 0.4));
    const prof: [number, number][] = [[r, 0], [r, h]];
    for (let k = 1; k <= 5; k++) { const a = (k / 5) * (Math.PI / 2); prof.push([Math.max(r * Math.cos(a), 0.002), h + r * Math.sin(a)]); }
    b.lathe(prof, 20);
    b.set(paint(ORANGE, 0.5));
    b.lathe([[r + 0.01, h * 0.75], [r + 0.01, h * 0.75 + 0.14]], 20);
    b.set(metal(GREY));
    b.cylinder(0.05, h + r - 0.02, h + r + 0.25, 6);
    b.pop();
  });
  b.set(metal(GOLD, 0.4));
  b.beam([-size[0] * 0.24, size[1] - 0.2, -size[2] * 0.24], [size[0] * 0.24, size[1] - 0.2, -size[2] * 0.24], 0.08);
  b.beam([-size[0] * 0.24, size[1] - 0.2, size[2] * 0.24], [size[0] * 0.24, size[1] - 0.2, size[2] * 0.24], 0.08);
  b.beam([size[0] * 0.24, size[1] - 0.2, -size[2] * 0.24], [size[0] * 0.24, size[1] - 0.2, size[2] * 0.24], 0.08);
  b.pop();
}

function buildLightMast(b: MeshBuilder, pos: Vec3, size: Vec3, lamps: LampInfo[]): void {
  const H = size[1];
  b.push(m4.translation(pos[0], pos[1], pos[2]));
  b.set(paint(CONCRETE, 0.9));
  b.box([0, 0.12, 0], [0.9, 0.24, 0.9]);
  b.set(paint(WHITE2, 0.5));
  b.cylinder(0.11, 0.2, H, 10);
  b.set(paint(ORANGE, 0.5));
  b.cylinder(0.115, 1.2, 1.5, 10, false);
  b.set(metal(GREY, 0.4));
  b.box([0, H, 0], [1.6, 0.1, 0.12]);
  for (const s of [-1, 1]) {
    b.push(m4.multiply(m4.translation(s * 0.7, H - 0.12, 0), m4.rotationZ(s * deg(25))));
    b.set(dark(0.5));
    b.box([0, 0, 0], [0.42, 0.18, 0.32]);
    b.set(lampMat([1.0, 0.9, 0.75]));
    b.box([0, -0.095, 0], [0.36, 0.01, 0.26]);
    b.pop();
    lamps.push({ pos: [pos[0] + s * 0.8, pos[1] + H - 0.3, pos[2]], color: [1.0, 0.88, 0.7], range: 34, kind: 'mast', dir: v3.norm([s * 0.45, -1, 0]), cone: 62 });
  }
  b.pop();
}

// ---------------------------------------------------------------- cave mouth (lava tube) — the heightfield cannot express it
function buildCave(b: MeshBuilder, scene: SceneLayout, ground: Ground): ColonyBuild['cave'] {
  const cm = scene.terrain.cave_mouth;
  const facing = dirFromLayoutAngle(cm.facing_deg);
  const origin: Vec3 = [cm.position[0], cm.position[1], cm.position[2]];
  const M = modelOf(origin, cm.facing_deg); // local +Z = facing (out of the cliff), local X = along the face
  const w2 = cm.width_m / 2;
  const Hc = cm.height_m;
  const depth = 44;
  const notchHalf = w2 + 1.5;
  const bench = caveBenchHeight(scene);
  const r = rng(scene.seed ^ 0xca5e);
  const noise = (x: number, y: number, z: number) => rockNoise(x, y, z);
  const toW = (p: Vec3): Vec3 => m4.transformPoint(M, p);
  const groundLocal = (x: number, z: number): number => {
    const w = toW([x, 0, z]);
    return ground(w[0], w[2]) - origin[1];
  };
  // Roof height above the notch: interpolate the bench height sampled just outside both notch edges.
  const roof = (x: number, z: number): number => {
    const hl = groundLocal(-(notchHalf + 3), z), hr = groundLocal(notchHalf + 3, z);
    const t = clamp((x + notchHalf + 3) / (2 * notchHalf + 6), 0, 1);
    return Math.max(Hc + 3, hl + (hr - hl) * t + 0.4, bench * 0.6);
  };
  const archY = (x: number, d: number): number => {
    const k = 1 - 0.18 * (d / depth); // tube narrows and lowers with depth
    const xx = clamp(Math.abs(x) / (w2 * k), 0, 1);
    return Hc * k * Math.pow(1 - xx * xx, 0.42);
  };
  const floorAt = (d: number): number => -0.07 * d;
  void r;
  b.push(M);
  b.module = 255;
  b.set({ id: MAT.CAVE, color: [0.3, 0.2, 0.15], roughness: 0.9 });
  // Tunnel interior: rings of the arch profile from the mouth (z = 0) to the back (z = -depth).
  const nz = 22, na = 22;
  const ring: number[][] = [];
  for (let iz = 0; iz <= nz; iz++) {
    const d = (iz / nz) * depth;
    const k = 1 - 0.18 * (d / depth);
    const row: number[] = [];
    for (let ia = 0; ia <= na; ia++) {
      const a = Math.PI * (ia / na); // 0..PI across the arch (x from +w to -w)
      const ex = Math.cos(a) * w2 * k;
      let y = archY(ex, d);
      // Steep side walls near the floor.
      if (ia === 0 || ia === na) y = 0;
      const base: Vec3 = [ex, y + floorAt(d), -d];
      const nrm = v3.norm([-Math.cos(a) * 1.0, -Math.sin(a) * 1.3, 0]);
      const disp = noise(base[0] * 0.35, base[1] * 0.35, base[2] * 0.35) * 0.9 * (ia === 0 || ia === na ? 0.3 : 1);
      const p = v3.madd(base, nrm, -disp);
      const ao = Math.min(1, 0.06 + 0.9 * Math.exp(-d / 8.5)) * (0.75 + 0.25 * Math.sin(a));
      row.push(b.vertex(p, nrm, ao));
    }
    ring.push(row);
  }
  for (let iz = 0; iz < nz; iz++) for (let ia = 0; ia < na; ia++) b.quad(ring[iz][ia], ring[iz][ia + 1], ring[iz + 1][ia + 1], ring[iz + 1][ia]);
  // Back wall.
  const back: number[] = [];
  const dBack = depth;
  const centre = b.vertex([0, Hc * 0.35 + floorAt(dBack), -dBack - 1.5], [0, 0, 1], 0.03);
  for (let ia = 0; ia <= na; ia++) back.push(ring[nz][ia]);
  for (let ia = 0; ia < na; ia++) b.tri(centre, back[ia + 1], back[ia]);
  // Front face around the opening, up to the roof, and the roof slab over the notch.
  const fx = 18;
  const span = notchHalf + 2.5;
  const face: number[][] = [];
  const fy = 10;
  for (let ix = 0; ix <= fx; ix++) {
    const x = -span + (2 * span * ix) / fx;
    const y0 = Math.abs(x) < w2 ? archY(x, 0) : -0.8;
    const y1 = roof(x, 0);
    const col: number[] = [];
    for (let iy = 0; iy <= fy; iy++) {
      const y = y0 + ((y1 - y0) * iy) / fy;
      const out = noise(x * 0.3, y * 0.3, 3.7) * 1.1 + (iy / fy) * 0.8;
      col.push(b.vertex([x, y, out], [0, 0.15, 1], 1));
    }
    face.push(col);
  }
  for (let ix = 0; ix < fx; ix++) for (let iy = 0; iy < fy; iy++) b.quad(face[ix][iy], face[ix + 1][iy], face[ix + 1][iy + 1], face[ix][iy + 1]);
  const rx = 10, rz = 14;
  const top: number[][] = [];
  for (let ix = 0; ix <= rx; ix++) {
    const x = -span + (2 * span * ix) / rx;
    const row: number[] = [];
    for (let iz = 0; iz <= rz; iz++) {
      const z = 1.2 - ((depth + 4) * iz) / rz;
      const y = roof(x, z) + noise(x * 0.25, z * 0.25, 9.1) * 0.5;
      row.push(b.vertex([x, y, z], [0, 1, 0], 1));
    }
    top.push(row);
  }
  for (let ix = 0; ix < rx; ix++) for (let iz = 0; iz < rz; iz++) b.quad(top[ix][iz], top[ix][iz + 1], top[ix + 1][iz + 1], top[ix + 1][iz]);
  b.pop();
  return { mouth: [origin[0], origin[1] + groundLocal(0, 2), origin[2]], facing, depth };
}

function rockNoise(x: number, y: number, z: number): number {
  const s = Math.sin(x * 1.7 + Math.sin(y * 1.3 + z * 0.7) * 1.9) * Math.cos(z * 1.3 + Math.sin(x * 0.9) * 1.4);
  const t = Math.sin(y * 2.9 + x * 0.6) * Math.cos(z * 2.3 - y * 0.8) * 0.5;
  return (s + t) / 1.5;
}

// ---------------------------------------------------------------- dynamic meshes
/** Rover body, local +X forward, origin on the ground at the centre between the axles. */
function buildRoverBody(): MeshBuilder {
  const b = new MeshBuilder();
  b.set(metal([0.42, 0.43, 0.45], 0.5));
  b.box([0, 0.85, 0], [5.4, 0.35, 2.3]);
  b.set(dark(0.6));
  for (const x of [-1.9, 0, 1.9]) for (const z of [-1.0, 1.0]) b.box([x, 0.62, z], [0.5, 0.2, 0.3]);
  // Pressurised cabin with a rounded roof.
  b.set(paint(WHITE, 0.45));
  b.box([0.55, 1.65, 0], [3.4, 1.25, 2.1]);
  b.push(m4.multiply(m4.translation(0.55, 2.27, 0), m4.rotationZ(-Math.PI / 2)));
  b.lathe([[1.05, -1.7], [1.05, 1.7]], 16, { arc: [Math.PI * 0.62, Math.PI * 1.38] });
  b.pop();
  b.set(paint(ORANGE, 0.5));
  b.box([0.55, 1.12, 0], [3.42, 0.14, 2.12]);
  // Front windows, headlights, rear hatch.
  b.set(windowMat);
  b.quadP([2.26, 1.5, -0.85], [2.26, 1.5, 0.85], [2.26, 2.15, 0.85], [2.26, 2.15, -0.85]);
  b.set(lampMat([1.0, 0.95, 0.85]));
  b.box([2.72, 1.0, -0.8], [0.06, 0.16, 0.36]);
  b.box([2.72, 1.0, 0.8], [0.06, 0.16, 0.36]);
  b.set(dark(0.4));
  b.box([-1.17, 1.7, 0], [0.06, 1.0, 0.9]);
  // Roof solar panel, mast, cargo rack.
  b.set(solar);
  b.box([0.3, 2.42, 0], [2.4, 0.04, 1.6], { skip: ['ny'] });
  b.set(metal(GREY));
  b.cylinder(0.03, 2.3, 3.4, 6);
  b.beam([-1.3, 1.1, -1.0], [-2.6, 1.1, -1.0], 0.06);
  b.beam([-1.3, 1.1, 1.0], [-2.6, 1.1, 1.0], 0.06);
  b.beam([-2.6, 1.1, -1.0], [-2.6, 1.1, 1.0], 0.06);
  b.beam([-2.6, 1.1, -1.0], [-2.6, 1.6, -1.0], 0.05);
  b.beam([-2.6, 1.1, 1.0], [-2.6, 1.6, 1.0], 0.05);
  b.set(paint([0.55, 0.5, 0.42], 0.7));
  b.box([-1.95, 1.35, 0], [1.1, 0.45, 1.5]);
  b.set(hazard);
  b.box([2.71, 0.85, 0], [0.04, 0.3, 2.0]);
  return b;
}

/** Wheel around local +Z (axle), radius 0.55. */
function buildWheel(): MeshBuilder {
  const b = new MeshBuilder();
  b.push(m4.rotationX(Math.PI / 2));
  b.set({ id: MAT.DARK, color: [0.06, 0.06, 0.06], roughness: 0.85 });
  const prof: [number, number][] = [[0.36, -0.22], [0.5, -0.22], [0.55, -0.16], [0.56, 0], [0.55, 0.16], [0.5, 0.22], [0.36, 0.22]];
  b.lathe(prof, 18);
  // Tread blocks.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.push(m4.rotationY(a));
    b.box([0.56, 0, 0], [0.05, 0.42, 0.1]);
    b.pop();
  }
  b.set(metal([0.6, 0.6, 0.62], 0.35));
  b.lathe([[0.36, -0.18], [0.36, 0.2], [0.12, 0.24], [0.002, 0.25]], 14);
  b.pop();
  return b;
}

function buildBeacon(): MeshBuilder {
  const b = new MeshBuilder();
  b.set(dark(0.5));
  b.cylinder(0.13, 0, 0.06, 12);
  b.set({ id: MAT.BEACON, color: [0.5, 0.05, 0.03], roughness: 0.3, flags: FLAG.NO_DUST });
  b.lathe([[0.1, 0.06], [0.1, 0.2], [0.07, 0.26], [0.002, 0.28]], 16);
  return b;
}
