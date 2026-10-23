// Crew figures for WorldView.actors (Документ §14: the game picks validated animation tags — the renderer plays
// prepared procedural clips, gaze and walking; text never turns into new skeleton motion).
// Stylised EVA-suited colonists built from rigid parts (no skinning): suit, helmet with visor, life-support pack,
// colour accents from ActorView.color. A tiny forward-kinematics rig drives walk/idle cycles, gestures
// (nod, point_at_target, look_at_player, pause, wary, shrug, check_device), head turn toward lookAt and walking
// toward the target.
import type { ActorView, Vec3 } from '../contracts.ts';
import { FLAG, MAT, MeshBuilder, type GeometryPool, type Material, type MeshRange } from './geometry.ts';
import { clamp, m4, v3, type Mat4 } from './math.ts';
import type { InstanceBatch } from './scene_draws.ts';
import type { ModuleInfo } from './colony.ts';

// ---------------------------------------------------------------- materials (sRGB)
const SUIT: Material = { id: MAT.FABRIC, color: [0.86, 0.84, 0.8], roughness: 0.86 };
const SUIT_SHADE: Material = { id: MAT.FABRIC, color: [0.7, 0.69, 0.66], roughness: 0.88 };
const JOINT: Material = { id: MAT.PAINT, color: [0.42, 0.43, 0.45], roughness: 0.55 };
const DARK: Material = { id: MAT.DARK, color: [0.09, 0.09, 0.1], roughness: 0.7 };
const GLOVE: Material = { id: MAT.DARK, color: [0.2, 0.2, 0.21], roughness: 0.75 };
const HELMET: Material = { id: MAT.PAINT, color: [0.9, 0.89, 0.86], roughness: 0.32 };
const VISOR: Material = { id: MAT.VISOR, color: [0.8, 0.6, 0.25], roughness: 0.06, metallic: 1, flags: FLAG.NO_DUST };
const ACCENT: Material = { id: MAT.PAINT, color: [1, 1, 1], roughness: 0.5, flags: FLAG.ACCENT };
const PACK: Material = { id: MAT.PAINT, color: [0.78, 0.77, 0.74], roughness: 0.45 };
const SCREEN: Material = { id: MAT.SCREEN, color: [0.25, 0.95, 0.6], roughness: 0.2, flags: FLAG.NO_DUST };
const LAMP: Material = { id: MAT.LAMP, color: [0.5, 0.48, 0.42], roughness: 0.3, flags: FLAG.NO_DUST };

// Rig dimensions (m). Actor local frame: origin at the feet, +Y up, facing +Z; +X is the actor's left.
const HIP_H = 0.93;
const WAIST = 0.08;
const NECK = 0.56;
const SHOULDER_X = 0.215;
const SHOULDER_Y = 0.46;
const UPPER_ARM = 0.29;
const FOREARM = 0.26;
const HIP_X = 0.1;
const THIGH = 0.44;
const SHIN = 0.42;
const WALK_SPEED = 1.25;
const STRIDE = 1.45;

type PartName = 'pelvis' | 'torso' | 'head' | 'upperArm' | 'forearm' | 'hand' | 'device' | 'thigh' | 'shin' | 'boot';
const PARTS: PartName[] = ['pelvis', 'torso', 'head', 'upperArm', 'forearm', 'hand', 'device', 'thigh', 'shin', 'boot'];

export type CrewMeshes = Record<PartName, MeshRange>;

export function buildCrewMeshes(pool: GeometryPool): CrewMeshes {
  const out = {} as CrewMeshes;
  out.pelvis = pool.add('crew_pelvis', pelvisMesh());
  out.torso = pool.add('crew_torso', torsoMesh());
  out.head = pool.add('crew_head', headMesh());
  out.upperArm = pool.add('crew_upper_arm', limbMesh(0.07, UPPER_ARM, true));
  out.forearm = pool.add('crew_forearm', limbMesh(0.06, FOREARM, false));
  out.hand = pool.add('crew_hand', handMesh());
  out.device = pool.add('crew_device', deviceMesh());
  out.thigh = pool.add('crew_thigh', thighMesh());
  out.shin = pool.add('crew_shin', limbMesh(0.07, SHIN, false));
  out.boot = pool.add('crew_boot', bootMesh());
  return out;
}

function pelvisMesh(): MeshBuilder {
  const b = new MeshBuilder();
  b.set(SUIT_SHADE);
  b.push(m4.scaling(1, 1, 0.72));
  b.lathe([[0.001, -0.1], [0.12, -0.09], [0.165, -0.02], [0.17, 0.06], [0.16, 0.12]], 16, { capTop: true });
  b.pop();
  b.set(DARK);
  b.push(m4.scaling(1, 1, 0.74));
  b.lathe([[0.172, 0.04], [0.172, 0.1]], 16);
  b.pop();
  b.set(ACCENT);
  b.box([0, 0.07, 0.128], [0.07, 0.05, 0.02]);
  return b;
}

function torsoMesh(): MeshBuilder {
  const b = new MeshBuilder();
  b.set(SUIT);
  b.push(m4.scaling(1, 1, 0.7));
  b.lathe([[0.15, 0], [0.165, 0.1], [0.19, 0.26], [0.205, 0.4], [0.19, 0.5], [0.13, 0.55], [0.06, 0.575]], 18, { capTop: true, capBottom: true });
  // Accent band across the chest.
  b.set(ACCENT);
  b.lathe([[0.2, 0.3], [0.207, 0.36]], 18);
  b.pop();
  // Chest control unit with a small status screen.
  b.set(DARK);
  b.box([0, 0.36, 0.14], [0.13, 0.085, 0.04]);
  b.set(SCREEN);
  b.box([0.02, 0.365, 0.161], [0.06, 0.035, 0.004]);
  // Life-support pack: rounded elliptic shell with a lid band and an accent stripe.
  b.set(PACK);
  b.push(m4.multiply(m4.translation(0, 0.33, -0.205), m4.scaling(0.17, 1, 0.085)));
  b.lathe([[0.001, -0.24], [0.82, -0.24], [0.97, -0.21], [1, -0.16], [1, 0.17], [0.96, 0.22], [0.8, 0.245], [0.001, 0.245]], 20);
  b.pop();
  b.set(JOINT);
  b.push(m4.multiply(m4.translation(0, 0.5, -0.205), m4.scaling(0.172, 1, 0.087)));
  b.lathe([[1, 0], [1, 0.025]], 20);
  b.pop();
  b.set(ACCENT);
  b.push(m4.multiply(m4.translation(0, 0.16, -0.205), m4.scaling(0.172, 1, 0.087)));
  b.lathe([[1, 0], [1, 0.035]], 20);
  b.pop();
  // Neck ring.
  b.set(JOINT);
  b.push(m4.translation(0, NECK - 0.01, 0));
  b.torus(0.105, 0.026, 18, 6);
  b.pop();
  return b;
}

/** Spherical patch around +Z (azimuth/elevation ranges in radians) — helmet visor. */
function spherePatch(b: MeshBuilder, c: Vec3, r: number, az: [number, number], el: [number, number], nAz: number, nEl: number): void {
  const grid: number[][] = [];
  for (let i = 0; i <= nEl; i++) {
    const e = el[0] + ((el[1] - el[0]) * i) / nEl;
    const row: number[] = [];
    for (let j = 0; j <= nAz; j++) {
      const a = az[0] + ((az[1] - az[0]) * j) / nAz;
      const n: Vec3 = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
      row.push(b.vertex(v3.madd(c, n, r), n));
    }
    grid.push(row);
  }
  for (let i = 0; i < nEl; i++) for (let j = 0; j < nAz; j++) b.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
}

function headMesh(): MeshBuilder {
  const b = new MeshBuilder();
  const R = 0.172;
  const c: Vec3 = [0, 0.165, 0.015];
  b.set(HELMET);
  b.push(m4.translation(c[0], c[1], c[2]));
  b.sphere(R, 22, 14);
  b.pop();
  b.set(VISOR);
  spherePatch(b, c, R + 0.004, [-1.2, 1.2], [-0.55, 0.55], 16, 10);
  // Visor frame and the accent stripe over the crown.
  b.set(JOINT);
  b.push(m4.multiply(m4.translation(c[0], c[1], c[2]), m4.rotationX(Math.PI / 2 + 0.04)));
  b.torus(R + 0.002, 0.011, 24, 4);
  b.pop();
  b.set(ACCENT);
  b.push(m4.multiply(m4.translation(c[0], c[1], c[2]), m4.rotationZ(Math.PI / 2)));
  // After rotationZ(PI/2) the lathe angle a maps to (top: a = 0, front: a = PI/2); stop above the visor.
  b.lathe([[R + 0.0015, -0.02], [R + 0.0015, 0.02]], 22, { arc: [-Math.PI * 0.5, Math.PI * 0.3] });
  b.pop();
  // Small helmet lamps on both sides.
  for (const s of [-1, 1]) {
    b.set(JOINT);
    b.box([s * (R - 0.005), 0.225, 0.0], [0.03, 0.035, 0.07]);
    b.set(LAMP);
    b.box([s * (R - 0.005), 0.225, 0.036], [0.018, 0.018, 0.003]);
  }
  return b;
}

/** Limb segment hanging along -Y from the joint at the origin. */
function limbMesh(r: number, len: number, shoulder: boolean): MeshBuilder {
  const b = new MeshBuilder();
  b.set(SUIT);
  b.capsule(r, -len + r * 0.6, -r * 0.4, 12, 3);
  b.set(JOINT);
  b.push(m4.translation(0, -len + 0.02, 0));
  b.torus(r * 0.98, 0.014, 12, 4);
  b.pop();
  if (shoulder) {
    b.set(ACCENT);
    b.push(m4.translation(0, 0.005, 0));
    b.sphere(r * 1.22, 14, 7, -0.2, Math.PI / 2);
    b.pop();
  }
  return b;
}

function thighMesh(): MeshBuilder {
  const b = new MeshBuilder();
  b.set(SUIT_SHADE);
  b.capsule(0.092, -THIGH + 0.05, -0.02, 12, 3);
  b.set(JOINT);
  b.push(m4.translation(0, -THIGH, 0.012));
  b.sphere(0.072, 12, 6);
  b.pop();
  return b;
}

function handMesh(): MeshBuilder {
  const b = new MeshBuilder();
  b.set(GLOVE);
  b.box([0, -0.055, 0.005], [0.07, 0.1, 0.05]);
  b.box([0.03, -0.035, 0.025], [0.022, 0.05, 0.022]);
  b.set(JOINT);
  b.push(m4.translation(0, -0.004, 0));
  b.torus(0.052, 0.012, 12, 4);
  b.pop();
  return b;
}

function deviceMesh(): MeshBuilder {
  const b = new MeshBuilder();
  b.set(DARK);
  b.box([0.048, -FOREARM * 0.62, 0], [0.03, 0.085, 0.065]);
  b.set(SCREEN);
  b.box([0.064, -FOREARM * 0.62, 0], [0.003, 0.06, 0.048]);
  return b;
}

function bootMesh(): MeshBuilder {
  const b = new MeshBuilder();
  b.set(DARK);
  b.box([0, -0.055, 0.035], [0.12, 0.1, 0.27]);
  b.set(JOINT);
  b.box([0, -0.1, 0.035], [0.13, 0.025, 0.285]);
  b.set(SUIT_SHADE);
  b.box([0, 0.0, 0.0], [0.13, 0.06, 0.15]);
  return b;
}

// ---------------------------------------------------------------- animation
interface ActorState {
  id: string;
  pos: Vec3;
  yaw: number;
  speed: number;
  walkPhase: number;
  headYaw: number;
  headPitch: number;
  gesture: ActorView['gesture'];
  gestureT: number;
  /** Smoothed gesture weight per tag (blends when the tag changes). */
  weights: Record<string, number>;
  activity: ActorView['activity'];
  color: Vec3;
  speaking: number;
  seed: number;
  seen: boolean;
}

const GESTURES: ActorView['gesture'][] = ['nod', 'point_at_target', 'look_at_player', 'pause', 'wary', 'shrug', 'check_device'];

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function angleDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function approach(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

export type GroundFn = (x: number, z: number) => number;

/** CPU-side crew animation. Device-independent: survives device loss and profile changes. */
export class CrewAnimator {
  private readonly actors = new Map<string, ActorState>();
  private views: ActorView[] = [];
  private modules: ModuleInfo[] = [];
  private ground: GroundFn = () => 0;

  setEnvironment(ground: GroundFn, modules: ModuleInfo[]): void {
    this.ground = ground;
    this.modules = modules;
    for (const a of this.actors.values()) a.pos[1] = ground(a.pos[0], a.pos[2]);
  }

  setActors(views: ActorView[]): void {
    this.views = views;
    for (const a of this.actors.values()) a.seen = false;
    for (const v of views) {
      let a = this.actors.get(v.id);
      const p: Vec3 = [v.position[0], this.ground(v.position[0], v.position[2]), v.position[2]];
      if (!a) {
        let seed = 0;
        for (let i = 0; i < v.id.length; i++) seed = (seed * 31 + v.id.charCodeAt(i)) >>> 0;
        const goal = v.target ?? v.lookAt;
        const yaw = goal ? Math.atan2(goal[0] - p[0], goal[2] - p[2]) : (seed % 628) / 100;
        a = {
          id: v.id, pos: p, yaw, speed: 0, walkPhase: 0, headYaw: 0, headPitch: 0, gesture: v.gesture, gestureT: 0,
          weights: {}, activity: v.activity, color: [0, 0, 0], speaking: 0, seed, seen: true,
        };
        this.actors.set(v.id, a);
      } else if (v3.dist(a.pos, p) > 8) {
        a.pos = p; // teleport (zone change) instead of a long walk through modules
      }
      a.seen = true;
      if (a.gesture !== v.gesture) { a.gesture = v.gesture; a.gestureT = 0; }
      a.activity = v.activity;
      a.color = [srgbToLinear(v.color[0]), srgbToLinear(v.color[1]), srgbToLinear(v.color[2])];
    }
    for (const [id, a] of this.actors) if (!a.seen) this.actors.delete(id);
  }

  /** Head (helmet centre) position for camera focus. */
  headPosition(id: string): Vec3 | null {
    const a = this.actors.get(id);
    if (!a) return null;
    return [a.pos[0], a.pos[1] + 1.66, a.pos[2]];
  }

  position(id: string): Vec3 | null {
    return this.actors.get(id)?.pos ?? null;
  }

  get count(): number { return this.actors.size; }

  update(dt: number, cam: Vec3): void {
    const step = clamp(dt, 0, 0.1);
    for (const v of this.views) {
      const a = this.actors.get(v.id);
      if (!a) continue;
      a.gestureT += step;
      a.speaking = approach(a.speaking, v.speaking ? 1 : 0, 6, step);
      for (const g of GESTURES) a.weights[g] = approach(a.weights[g] ?? 0, a.gesture === g ? 1 : 0, 5, step);
      // ---- locomotion toward the target (or the reported position)
      const goal = v.target ?? v.position;
      const dx = goal[0] - a.pos[0], dz = goal[2] - a.pos[2];
      const dist = Math.hypot(dx, dz);
      const wantSpeed = dist > 0.25 ? Math.min(WALK_SPEED, dist * 1.5) : 0;
      a.speed = approach(a.speed, wantSpeed, 4, step);
      if (a.speed > 0.02 && dist > 1e-3) {
        const move = Math.min(dist, a.speed * step);
        a.pos[0] += (dx / dist) * move;
        a.pos[2] += (dz / dist) * move;
        a.yaw += angleDelta(a.yaw, Math.atan2(dx, dz)) * (1 - Math.exp(-6 * step));
      } else {
        // Standing: turn the body slowly toward what the actor attends to.
        const focus = this.attention(v, a, cam);
        if (focus) {
          const want = Math.atan2(focus[0] - a.pos[0], focus[2] - a.pos[2]);
          const d = angleDelta(a.yaw, want);
          if (Math.abs(d) > 0.9) a.yaw += d * (1 - Math.exp(-1.5 * step));
        }
      }
      a.walkPhase = (a.walkPhase + (a.speed * step / STRIDE) * Math.PI * 2) % (Math.PI * 2);
      this.pushOut(a);
      a.pos[1] = this.ground(a.pos[0], a.pos[2]);
      // ---- gaze
      const focus = this.attention(v, a, cam);
      let wantYaw = 0, wantPitch = 0;
      if (focus) {
        const eye: Vec3 = [a.pos[0], a.pos[1] + 1.65, a.pos[2]];
        const d = v3.sub(focus, eye);
        wantYaw = clamp(angleDelta(a.yaw, Math.atan2(d[0], d[2])), -1.2, 1.2);
        wantPitch = clamp(-Math.atan2(d[1], Math.hypot(d[0], d[2])), -0.6, 0.7);
      }
      a.headYaw = approach(a.headYaw, wantYaw, 5, step);
      a.headPitch = approach(a.headPitch, wantPitch, 5, step);
    }
  }

  private attention(v: ActorView, a: ActorState, cam: Vec3): Vec3 | null {
    if (v.gesture === 'look_at_player') return cam;
    if (v.gesture === 'point_at_target' && (v.lookAt || v.target)) return v.lookAt ?? v.target ?? null;
    if (v.lookAt) return v.lookAt;
    if (a.speed > 0.1 && v.target) return [v.target[0], a.pos[1] + 1.6, v.target[2]];
    return null;
  }

  private pushOut(a: ActorState): void {
    for (const m of this.modules) {
      const f = m.footprint;
      const dx = a.pos[0] - f.center[0], dz = a.pos[2] - f.center[1];
      if (f.round) {
        const r = f.half[0] + 0.35;
        const d = Math.hypot(dx, dz);
        if (d < r && d > 1e-4) { a.pos[0] = f.center[0] + (dx / d) * r; a.pos[2] = f.center[1] + (dz / d) * r; }
        continue;
      }
      // Oriented rectangle: local x along (cos, -sin), local z along (sin, cos).
      const c = Math.cos(f.rotY), s = Math.sin(f.rotY);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const hx = f.half[0] + 0.3, hz = f.half[1] + 0.3;
      if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
        let nx = lx, nz = lz;
        if (hx - Math.abs(lx) < hz - Math.abs(lz)) nx = Math.sign(lx || 1) * hx; else nz = Math.sign(lz || 1) * hz;
        a.pos[0] = f.center[0] + nx * c + nz * s;
        a.pos[2] = f.center[1] - nx * s + nz * c;
      }
    }
  }

  /** Emits the crew body-part instances (one instanced draw per part type). */
  emit(batch: InstanceBatch, meshes: CrewMeshes, t: number): void {
    const lists: Record<PartName, { model: Mat4; params: { tint: [number, number, number, number]; highlight: number; dust: number } }[]> =
      Object.fromEntries(PARTS.map((p) => [p, []])) as never;
    for (const v of this.views) {
      const a = this.actors.get(v.id);
      if (!a) continue;
      const params = { tint: [a.color[0], a.color[1], a.color[2], 0] as [number, number, number, number], highlight: a.speaking, dust: 0.25 };
      const pose = this.pose(a, v, t);
      for (const [part, model] of pose) lists[part].push({ model, params });
    }
    for (const p of PARTS) if (lists[p].length) batch.addEach(meshes[p], lists[p], 'character', true);
  }

  /** Forward kinematics for one actor; returns world matrices per rigid part. */
  private pose(a: ActorState, v: ActorView, t: number): [PartName, Mat4][] {
    const w = a.weights;
    const tt = t + (a.seed % 1000) * 0.013;
    const walk = clamp(a.speed / WALK_SPEED, 0, 1);
    const ph = a.walkPhase;
    const sinP = Math.sin(ph), cosP = Math.cos(ph);
    const breath = Math.sin(tt * 1.7) * 0.012;
    const idleSway = Math.sin(tt * 0.45) * 0.025 * (1 - walk);

    // ---- gesture envelopes
    const cycle = (period: number, dur: number) => { const x = (a.gestureT % period) / dur; return x < 1 ? Math.sin(Math.PI * x) : 0; };
    const nod = (w.nod ?? 0) * Math.sin(a.gestureT * 9) * 0.22 * (a.gestureT % 3 < 1.1 ? 1 : 0);
    const shrug = (w.shrug ?? 0) * cycle(2.6, 1.3);
    const wary = w.wary ?? 0;
    const pause = w.pause ?? 0;
    const check = w.check_device ?? 0;
    const point = w.point_at_target ?? 0;
    const working = v.activity === 'working' ? 1 : 0;
    const resting = v.activity === 'resting' ? 1 : 0;
    const talking = v.activity === 'talking' || v.speaking ? 1 : 0;

    // ---- body
    const crouch = resting * 0.32;
    const bob = walk * 0.035 * Math.abs(cosP) - crouch;
    const torsoPitch = 0.06 * walk + breath - wary * 0.1 + pause * 0.05 + working * 0.14 + resting * 0.18;
    const torsoTwist = walk * 0.12 * sinP + idleSway;
    const base = m4.multiply(m4.translation(a.pos[0], a.pos[1], a.pos[2]), m4.rotationY(a.yaw));
    const pelvis = m4.multiply(base, m4.multiply(m4.translation(0, HIP_H + bob, 0), m4.rotationY(-torsoTwist * 0.5)));
    const torso = m4.multiply(pelvis, m4.multiply(m4.translation(0, WAIST, 0), m4.multiply(m4.rotationX(torsoPitch), m4.rotationY(torsoTwist))));

    // ---- head: gaze + gesture offsets
    let headYaw = a.headYaw - torsoTwist * 1.5;
    let headPitch = a.headPitch - torsoPitch + nod + pause * 0.18 + check * 0.5;
    headYaw += wary * Math.sin(tt * 0.8) * 0.45 + check * 0.25;
    headPitch = clamp(headPitch, -0.7, 0.8);
    headYaw = clamp(headYaw, -1.3, 1.3);
    const head = m4.multiply(torso, m4.multiply(m4.translation(0, NECK, 0), m4.multiply(m4.rotationY(headYaw), m4.rotationX(headPitch))));

    // ---- arms: [abduction, forward pitch, twist, elbow]
    const armSwing = walk * 0.42 * sinP;
    const arm = (side: 1 | -1) => {
      let abd = 0.12 + shrug * 0.35 + wary * 0.15;
      let pitch = -side * armSwing + working * 0.75 + wary * 0.45 + talking * 0.1;
      let yaw = 0;
      let elbow = 0.2 + walk * 0.25 + working * (1.0 + 0.2 * Math.sin(tt * 3 + side)) + shrug * 1.25 + wary * 1.0 + talking * 0.35 * (0.6 + 0.4 * Math.sin(tt * 2.2 + side * 1.7));
      if (side === 1 && check > 0) {
        // Left forearm raised in front of the chest to read the wrist device.
        pitch = pitch * (1 - check) + 0.85 * check;
        abd = abd * (1 - check) - 0.25 * check;
        yaw = -0.35 * check;
        elbow = elbow * (1 - check) + 1.75 * check;
      }
      if (side === -1 && point > 0) {
        const target = v.lookAt ?? v.target;
        let pp = 1.45, py = 0;
        if (target) {
          // Direction to the target in the actor frame from the right shoulder.
          const c = Math.cos(a.yaw), s = Math.sin(a.yaw);
          const sh: Vec3 = [a.pos[0] - c * SHOULDER_X, a.pos[1] + HIP_H + WAIST + SHOULDER_Y, a.pos[2] + s * SHOULDER_X];
          const d = v3.sub(target, sh);
          const lx = d[0] * c - d[2] * s, lz = d[0] * s + d[2] * c;
          const horiz = Math.hypot(lx, lz);
          pp = clamp(Math.PI / 2 + Math.atan2(d[1], horiz), 0.6, 2.3);
          py = clamp(Math.atan2(lx, lz), -1.2, 0.5);
        }
        pitch = pitch * (1 - point) + pp * point;
        yaw = yaw * (1 - point) + py * point;
        abd = abd * (1 - point) + 0.05 * point;
        elbow = elbow * (1 - point) + 0.08 * point;
      }
      const shoulder = m4.multiply(torso, m4.multiply(
        m4.translation(side * SHOULDER_X, SHOULDER_Y + shrug * 0.04, 0),
        m4.multiply(m4.rotationY(yaw), m4.multiply(m4.rotationZ(side * abd), m4.rotationX(-pitch)))));
      const fore = m4.multiply(shoulder, m4.multiply(m4.translation(0, -UPPER_ARM, 0), m4.multiply(m4.rotationY(side * shrug * 0.6), m4.rotationX(-elbow))));
      const hand = m4.multiply(fore, m4.multiply(m4.translation(0, -FOREARM, 0), m4.rotationZ(-side * shrug * 0.5)));
      return { shoulder, fore, hand };
    };
    const L = arm(1), R = arm(-1);

    // ---- legs
    const leg = (side: 1 | -1) => {
      const s = side === 1 ? sinP : -sinP;
      const c = side === 1 ? cosP : -cosP;
      const hip = walk * 0.42 * s + resting * 1.2;
      const knee = walk * (0.15 + 0.55 * Math.max(0, c)) + resting * 2.0 + crouch * 0.4;
      const ankle = -walk * 0.2 * s - resting * 0.8;
      const thigh = m4.multiply(pelvis, m4.multiply(m4.translation(side * HIP_X, -0.04, 0), m4.multiply(m4.rotationZ(side * 0.03), m4.rotationX(-hip))));
      const shin = m4.multiply(thigh, m4.multiply(m4.translation(0, -THIGH, 0), m4.rotationX(knee)));
      const boot = m4.multiply(shin, m4.multiply(m4.translation(0, -SHIN, 0), m4.rotationX(ankle)));
      return { thigh, shin, boot };
    };
    const LL = leg(1), RL = leg(-1);

    return [
      ['pelvis', pelvis], ['torso', torso], ['head', head],
      ['upperArm', L.shoulder], ['upperArm', R.shoulder],
      ['forearm', L.fore], ['forearm', R.fore], ['device', L.fore],
      ['hand', L.hand], ['hand', R.hand],
      ['thigh', LL.thigh], ['thigh', RL.thigh],
      ['shin', LL.shin], ['shin', RL.shin],
      ['boot', LL.boot], ['boot', RL.boot],
    ];
  }
}
