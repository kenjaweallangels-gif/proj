// Turns the game's WorldView + the control-route state into what the GPU draws this frame: local lights (with a fixed
// budget), module states (sealed / window glow / alarm), the rover pose, beacons, sensor alarm pulses, sealed-zone
// barriers, biography details and crew animation. CPU only; survives device loss.
import type { BiographyView, MarkerView, SceneLayout, Vec3, WorldView } from '../contracts.ts';
import type { ColonyBuild, LampInfo, ModuleInfo } from './colony.ts';
import { CrewAnimator } from './actors.ts';
import type { RouteState } from './camera.ts';
import { MAX_LIGHTS, MAX_MODULES, type LightDesc } from './frame.ts';
import { SPRITE_KIND, type FxBuffer } from './fx.ts';
import type { GpuScene } from './gpu_scene.ts';
import { clamp, dirFromLayoutAngle, m4, v3, type Mat4 } from './math.ts';
import type { InstanceParams } from './scene_draws.ts';

export const EMPTY_WORLD: WorldView = { simTimeS: 0, emergencyLights: false, sealedZones: [], actors: [], markers: [], biography: [] };

/** Lamp intensities per kind (linear scene units; sun irradiance at the ground is ~3–6). */
const LAMP_INTENSITY: Record<LampInfo['kind'], number> = { mast: 95, door: 9, interior: 5, antenna: 0.6, garage: 14, work: 160, string: 7 };

export interface PresentState {
  t: number;
  dt: number;
  /** Camera cut / frozen reference shot: snap transitions instead of fading. */
  cut: boolean;
  camPos: Vec3;
  camFwd: Vec3;
  route: RouteState | null;
}

export interface Effects {
  emergency: number;
  dimmed: number;
  torch: boolean;
  dustGust: number;
}

export class WorldPresenter {
  readonly crew = new CrewAnimator();
  private world: WorldView = EMPTY_WORLD;
  private readonly scene: SceneLayout;
  private colony: ColonyBuild | null = null;
  private ground: (x: number, z: number) => number = () => 0;
  private emergencyLevel = 0;
  private roverDistance = 0;
  private lastRover: Vec3 | null = null;
  /** Rover track (garage park -> valley floor -> cave front) used by the rover_follow event. */
  private track: Vec3[] = [];

  constructor(scene: SceneLayout) {
    this.scene = scene;
  }

  bind(colony: ColonyBuild, ground: (x: number, z: number) => number): void {
    this.colony = colony;
    this.ground = ground;
    this.crew.setEnvironment(ground, colony.modules);
    const cave = this.scene.terrain.cave_mouth;
    const face = dirFromLayoutAngle(cave.facing_deg);
    const front: Vec3 = [cave.position[0] + face[0] * 15, 0, cave.position[2] + face[2] * 15];
    const side: Vec3 = [cave.position[0] + face[0] * 12 + face[2] * 9, 0, cave.position[2] + face[2] * 12 - face[0] * 9];
    this.track = [[-62, 0, 58], [-90, 0, 62], [-112, 0, 64], front, side];
  }

  setWorld(w: WorldView): void {
    this.world = w;
    this.crew.setActors(w.actors);
  }

  get view(): WorldView { return this.world; }

  effects(route: RouteState | null): Effects {
    const routeEmergency = route?.emergency ?? false;
    const target = this.world.emergencyLights || routeEmergency ? 1 : 0;
    return {
      emergency: this.emergencyLevel,
      dimmed: route?.lightsDim ? 1 : 0,
      torch: route?.torch ?? false,
      dustGust: this.emergencyLevel * 0.8 + (target ? 0.2 : 0),
    };
  }

  /** Updates animation state; returns the effects for this frame. */
  update(s: PresentState): Effects {
    const want = this.world.emergencyLights || (s.route?.emergency ?? false) ? 1 : 0;
    // Emergency lights come on fast and fade out slower.
    this.emergencyLevel += (want - this.emergencyLevel) * (1 - Math.exp(-(want ? 6 : 2) * s.dt));
    if (s.cut) this.emergencyLevel = want;
    this.crew.update(s.dt, s.camPos);
    return this.effects(s.route);
  }

  /** Rover pose: parked, following the control route (rover_follow), or parked at the cave after the ride. */
  roverPose(route: RouteState | null): { pos: Vec3; yaw: number } {
    const c = this.colony!;
    const parked = { pos: c.rover.park, yaw: c.rover.rotY };
    if (!route) return parked;
    const seg = route.segment;
    if (route.roverFollow || seg === 'rover_ride') return this.alongTrack(route.roverPhase);
    if (seg === 'cave_descent') return this.alongTrack(1);
    return parked;
  }

  private alongTrack(phase: number): { pos: Vec3; yaw: number } {
    const pts = this.track;
    const lens: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = v3.dist(pts[i - 1], pts[i]); lens.push(l); total += l; }
    // Ease in/out; the rover stops just beside the cave mouth.
    const e = phase * phase * (3 - 2 * phase);
    let d = clamp(0.12 + e * 0.88, 0, 1) * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const a = pts[i], b = pts[i + 1];
        const k = clamp(d / lens[i], 0, 1);
        const pos: Vec3 = [a[0] + (b[0] - a[0]) * k, 0, a[2] + (b[2] - a[2]) * k];
        pos[1] = this.ground(pos[0], pos[2]);
        const dir = v3.norm(v3.sub(b, a));
        return { pos, yaw: Math.atan2(-dir[2], dir[0]) };
      }
      d -= lens[i];
    }
    return { pos: pts[pts.length - 1], yaw: 0 };
  }

  /** Fills module states and local lights into the frame uniforms. */
  lights(g: GpuScene, s: PresentState, fx: Effects): number {
    const c = this.colony!;
    const sealed = new Set(this.world.sealedZones);
    const alarmByZone = new Map<string, number>();
    for (const m of this.world.markers) {
      if (m.kind !== 'sensor' && m.kind !== 'zone') continue;
      const zone = nearestModule(c.modules, m.position);
      if (zone) alarmByZone.set(zone.zone, Math.max(alarmByZone.get(zone.zone) ?? 0, m.intensity));
    }
    const u = g.uniforms;
    for (let i = 0; i < Math.min(MAX_MODULES, c.modules.length); i++) {
      const m = c.modules[i];
      const glow = m.windowGlow * (1 - fx.dimmed * 0.85) * (1 - fx.emergency * 0.5);
      u.setModule(i, sealed.has(m.zone) ? 1 : 0, glow, alarmByZone.get(m.zone) ?? 0);
    }
    const candidates: (LightDesc & { score: number })[] = [];
    const add = (L: LightDesc, priority = 1) => {
      const d = Math.max(v3.dist(L.pos, s.camPos) - L.range, 0);
      candidates.push({ ...L, score: priority / (1 + d * d * 0.01) });
    };
    for (const lamp of c.lamps) {
      let k = LAMP_INTENSITY[lamp.kind];
      if (lamp.kind !== 'antenna') k *= 1 - fx.dimmed * 0.85;
      if (lamp.kind === 'mast') k *= 1 - fx.emergency * 0.6;
      if (lamp.module !== undefined && sealed.has(c.modules[lamp.module]?.zone)) k *= 0.25;
      if (k <= 0.01) continue;
      add({
        pos: lamp.pos, range: lamp.range, color: v3.scale(lamp.color, k),
        spot: lamp.dir && lamp.cone ? { dir: lamp.dir, outerDeg: lamp.cone, innerDeg: lamp.cone * 0.55 } : undefined,
      }, lamp.kind === 'mast' || lamp.kind === 'work' ? 2 : 1);
    }
    // Emergency: red rotating beacons double as flickering red point lights.
    if (fx.emergency > 0.01) {
      for (const b of c.beacons) add({ pos: b.pos, range: 18, color: [11 * fx.emergency, 0.4 * fx.emergency, 0.18 * fx.emergency], flicker: 0.9 }, 1.5);
    }
    // Sealed modules pulse their own beacons.
    for (const b of c.beacons) {
      const zone = b.module >= 0 ? c.modules[b.module]?.zone : undefined;
      if (zone && sealed.has(zone) && fx.emergency < 0.5) add({ pos: b.pos, range: 12, color: [4, 0.15, 0.08], flicker: 0.8 }, 1.4);
    }
    // Torch: spot light from the camera (cave descent).
    if (fx.torch) {
      const right = v3.norm(v3.cross(s.camFwd, [0, 1, 0]));
      const pos = v3.add(v3.madd(s.camPos, right, 0.25), [0, -0.2, 0]);
      add({ pos, range: 45, color: [38, 34, 28], spot: { dir: s.camFwd, outerDeg: 30, innerDeg: 16 } }, 100);
    }
    candidates.sort((a, b) => b.score - a.score);
    return u.setLights(candidates.slice(0, MAX_LIGHTS));
  }

  /** Dynamic instances (static colony batch, rover, beacons, details, crew). */
  instances(g: GpuScene, route: RouteState | null, t: number): void {
    const b = g.batch;
    b.begin();
    const identity = m4.identity();
    b.add(g.pool.get('colony_static'), [identity], { dust: 0.15 });
    // Rover body + six wheels on the terrain.
    const rp = this.roverPose(route);
    const fwd: Vec3 = [Math.cos(rp.yaw), 0, -Math.sin(rp.yaw)];
    const side: Vec3 = [Math.sin(rp.yaw), 0, Math.cos(rp.yaw)];
    const h = (o: Vec3) => this.ground(rp.pos[0] + o[0], rp.pos[2] + o[2]);
    const hf = h(v3.scale(fwd, 1.9)), hb = h(v3.scale(fwd, -1.9));
    const hl = h(v3.scale(side, 1.2)), hr = h(v3.scale(side, -1.2));
    const pitch = Math.atan2(hf - hb, 3.8);
    const roll = Math.atan2(hl - hr, 2.4);
    if (this.lastRover) this.roverDistance += v3.dist(this.lastRover, rp.pos);
    this.lastRover = rp.pos;
    const y = Math.max(hf, hb, hl, hr, rp.pos[1]) - 0.05;
    const body = m4.multiply(m4.translation(rp.pos[0], y, rp.pos[2]), m4.multiply(m4.rotationY(rp.yaw), m4.multiply(m4.rotationZ(pitch), m4.rotationX(-roll))));
    b.add(g.pool.get('rover_body'), [body], { dust: 0.6 });
    const wheels: Mat4[] = [];
    const spin = -this.roverDistance / 0.55;
    for (const x of [-1.9, 0, 1.9]) for (const z of [-1.3, 1.3]) {
      wheels.push(m4.multiply(body, m4.multiply(m4.translation(x, 0.55, z), m4.rotationZ(spin))));
    }
    b.add(g.pool.get('rover_wheel'), wheels, { dust: 0.9 });
    // Beacons (emissive sweep animated in the shader; module index drives sealed-zone pulses).
    const c = this.colony!;
    const beaconItems = c.beacons.map((bc, i) => ({ model: m4.translation(bc.pos[0], bc.pos[1], bc.pos[2]), params: { module: bc.module, phase: i * 1.7 } as InstanceParams }));
    b.addEach(g.pool.get('beacon'), beaconItems, 'opaque', false);
    // Biography details at anchors (pushed to the outside of their module so they stay visible).
    const details = this.detailPlacements();
    const byKind = new Map<string, Mat4[]>();
    const push = (kind: string, m: Mat4) => { const list = byKind.get(kind) ?? []; list.push(m); byKind.set(kind, list); };
    for (const d of details) {
      if (!g.detailMeshes[d.detail]) continue;
      const model = m4.multiply(m4.translation(d.pos[0], d.pos[1], d.pos[2]), m4.rotationY(d.yaw));
      push(d.detail, model);
      // Wall items are mounted on a small free-standing board post beside the module.
      if (d.pos[1] - this.ground(d.pos[0], d.pos[2]) > 0.5) push('stand', m4.multiply(m4.translation(d.pos[0], this.ground(d.pos[0], d.pos[2]), d.pos[2]), m4.rotationY(d.yaw)));
    }
    for (const [kind, models] of byKind) b.add(g.detailMeshes[kind], models, { dust: 0 }, 'opaque', false);
    this.crew.emit(b, g.crewMeshes, t);
  }

  private detailPlacements(): { detail: string; pos: Vec3; yaw: number }[] {
    const c = this.colony!;
    const out: { detail: string; pos: Vec3; yaw: number }[] = [];
    for (const bio of this.world.biography) {
      const p = placeBiography(this.scene, c.modules, bio);
      if (p) out.push({ detail: bio.detail_id, pos: [p.pos[0], this.ground(p.pos[0], p.pos[2]) + p.pos[1], p.pos[2]], yaw: p.yaw });
    }
    return out;
  }

  /** Glows, alarm pulses, sealed-zone barriers, biography glints, emergency beacon glows. */
  sprites(fxBuf: FxBuffer, fx: Effects, t: number): void {
    fxBuf.begin();
    const c = this.colony!;
    for (const lamp of c.lamps) {
      if (lamp.kind === 'interior') continue;
      const k = (lamp.kind === 'antenna' ? 1 : 1 - fx.dimmed * 0.85) * (lamp.kind === 'mast' ? 1 - fx.emergency * 0.6 : 1);
      const size = lamp.kind === 'mast' || lamp.kind === 'work' ? 0.45 : lamp.kind === 'string' ? 0.22 : 0.3;
      const pulse = lamp.kind === 'antenna' ? 0.5 + 0.5 * Math.max(0, Math.sin(t * 2.2)) : 1;
      const glow = lamp.kind === 'mast' || lamp.kind === 'work' ? 2.2 : lamp.kind === 'string' ? 2.5 : 1.4;
      fxBuf.push({ pos: lamp.pos, size, color: lamp.color, intensity: glow * k * pulse, kind: SPRITE_KIND.GLOW });
    }
    if (fx.emergency > 0.01) {
      c.beacons.forEach((bc, i) => {
        const sweep = Math.pow(Math.max(0, Math.cos(t * 5.2 + i * 1.7)), 4);
        fxBuf.push({ pos: v3.add(bc.pos, [0, 0.17, 0]), size: 1.8, color: [1, 0.06, 0.03], intensity: fx.emergency * (3 + 18 * sweep), kind: SPRITE_KIND.GLOW });
      });
    }
    for (const m of this.world.markers) this.markerSprite(fxBuf, m);
    const sealed = new Set(this.world.sealedZones);
    for (const m of c.modules) {
      if (!sealed.has(m.zone)) continue;
      const sp = this.scene.zone_stand_points[m.zone];
      const toward = sp ? v3.norm([sp[0] - m.position[0], 0, sp[2] - m.position[2]]) : [1, 0, 0] as Vec3;
      const r = Math.max(m.footprint.half[0], m.footprint.half[1]) + 0.6;
      const pos = v3.madd(m.position, toward, r);
      pos[1] = this.ground(pos[0], pos[2]);
      fxBuf.push({ pos, size: 1.8, color: [1, 0.2, 0.05], intensity: 4.5, kind: SPRITE_KIND.BARRIER, height: 2.6 });
    }
    for (const d of this.detailPlacements()) {
      fxBuf.push({ pos: v3.add(d.pos, [0, 0.12, 0]), size: 0.22, color: [1, 0.85, 0.55], intensity: 2.5, kind: SPRITE_KIND.GLINT, phase: d.pos[0] * 0.37 });
    }
  }

  private markerSprite(fxBuf: FxBuffer, m: MarkerView): void {
    const g = this.ground(m.position[0], m.position[2]);
    const base: Vec3 = [m.position[0], Math.max(m.position[1], g) + 0.05, m.position[2]];
    const i = clamp(m.intensity, 0, 1);
    if (m.kind === 'sensor' || m.kind === 'zone') {
      fxBuf.push({ pos: base, size: 1.3 + i, color: m.color, intensity: 1.5 + 6 * i, kind: SPRITE_KIND.RING, phase: base[0] * 0.13 });
      fxBuf.push({ pos: v3.add(base, [0, 1.2, 0]), size: 0.35, color: m.color, intensity: 2 + 6 * i, kind: SPRITE_KIND.GLOW });
    } else if (m.kind === 'task') {
      fxBuf.push({ pos: base, size: 0.18, color: m.color, intensity: 0.6 + 0.8 * i, kind: SPRITE_KIND.BEAM, height: 2.8, phase: base[2] });
      fxBuf.push({ pos: v3.add(base, [0, 2.4, 0]), size: 0.18, color: m.color, intensity: 1.2 + 1.5 * i, kind: SPRITE_KIND.DIAMOND });
    } else {
      fxBuf.push({ pos: v3.add(base, [0, 0.6, 0]), size: 0.25, color: m.color, intensity: 2 + 4 * i, kind: SPRITE_KIND.DIAMOND });
    }
  }
}

function nearestModule(modules: ModuleInfo[], p: Vec3): ModuleInfo | null {
  let best: ModuleInfo | null = null;
  let bd = 18;
  for (const m of modules) {
    const d = Math.hypot(m.position[0] - p[0], m.position[2] - p[2]);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

/**
 * Biography anchors in d0_layout.json are interior points (inside the module footprint). Interiors are not rendered
 * from outside, so the detail is shown on the module's outer wall on the side facing the zone stand point.
 * Returns position (y = height above ground) and yaw.
 */
export function placeBiography(scene: SceneLayout, modules: ModuleInfo[], bio: BiographyView): { pos: Vec3; yaw: number } | null {
  const anchor = scene.anchors[bio.anchor];
  if (!anchor) return null;
  const m = modules.find((x) => x.zone === bio.zone) ?? nearestModule(modules, anchor);
  if (!m) return { pos: [anchor[0], 0.9, anchor[2]], yaw: 0 };
  const sp = scene.zone_stand_points[m.zone] ?? anchor;
  let dir = v3.sub([sp[0], 0, sp[2]], [anchor[0], 0, anchor[2]]);
  if (v3.len(dir) < 0.2) dir = v3.sub([sp[0], 0, sp[2]], [m.position[0], 0, m.position[2]]);
  dir = v3.norm(dir);
  // March from the anchor outward until outside the footprint.
  const f = m.footprint;
  const inside = (x: number, z: number) => {
    const dx = x - f.center[0], dz = z - f.center[1];
    if (f.round) return Math.hypot(dx, dz) < f.half[0] + 0.05;
    const c = Math.cos(f.rotY), s = Math.sin(f.rotY);
    return Math.abs(dx * c - dz * s) < f.half[0] + 0.05 && Math.abs(dx * s + dz * c) < f.half[1] + 0.05;
  };
  let p: Vec3 = [anchor[0], 0, anchor[2]];
  for (let i = 0; i < 80 && inside(p[0], p[2]); i++) p = v3.madd(p, dir, 0.15);
  const kind = bio.detail_id;
  const height = kind === 'personal_item' || kind === 'moved_tool' || kind === 'old_sealant' ? 0.02 : 1.25;
  const out = kind === 'personal_item' || kind === 'moved_tool' || kind === 'old_sealant' ? 0.35 : 0.04;
  p = v3.madd(p, dir, out);
  const yaw = Math.atan2(dir[0], dir[2]);
  return { pos: [p[0], height, p[2]], yaw };
}
