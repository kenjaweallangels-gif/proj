// Core Snapshot → WorldView for the renderer and the 2D map (docs/SPEC.md §8). The core knows zones, not metres:
// positions come from data/scene/d0_layout.json zone_stand_points with a fixed small offset per actor, and a simple
// host-side walk moves each NPC toward its current target zone so that the renderer animates walking instead of
// teleporting. Gestures and activities are the validated ones from the core (never generated motion).
import type { ActorView, BiographyView, MarkerView, Vec3, WorldView } from '../contracts.ts';
import type { ActorSnap, Snapshot } from '../core/protocol.ts';
import { npcs, scene, world } from '../core/data.ts';

const WALK_SPEED_MPS = 1.35;
const OFFSET_RADIUS_M = 0.95;
const GESTURES: ActorView['gesture'][] = ['none', 'nod', 'point_at_target', 'look_at_player', 'pause', 'wary', 'shrug', 'check_device'];
const ACTIVITIES: ActorView['activity'][] = ['idle', 'walking', 'working', 'resting', 'talking'];

// Scene palette for 3D markers (renderer colour space, sRGB 0..1) — scene data, not UI theme colours.
const ALARM_COLOR: Vec3 = [1, 0.32, 0.12];
const DRIFT_COLOR: Vec3 = [1, 0.66, 0.24];
const TASK_COLOR: Vec3 = [0.42, 0.78, 1];

const crewIndex = new Map(npcs.map((n, i) => [n.id, i]));
const crewColor = new Map(npcs.map((n) => [n.id, n.color]));

export function standPoint(zone: string | undefined): Vec3 {
  const p = (zone && scene.zone_stand_points[zone]) || scene.zone_stand_points.hab_main || [0, 0, 0];
  return [p[0], 0, p[2]];
}

function moduleOf(zone: string): { position: Vec3 } | undefined {
  return scene.modules.find((m) => m.zone === zone);
}

/** A point between the zone stand point and its module: where an instrument/target of the zone is shown. */
export function zoneFeaturePoint(zone: string): Vec3 {
  const s = standPoint(zone);
  const m = moduleOf(zone);
  if (!m) return s;
  const k = 0.35;
  return [s[0] + (m.position[0] - s[0]) * k, 0, s[2] + (m.position[2] - s[2]) * k];
}

const sensorZone = new Map(world.sensors.map((s) => [s.id, s.zone]));
const itemZone = new Map(world.items.map((i) => [i.id, i.zone]));
const zoneIds = new Set(world.zones.map((z) => z.id));

/** World position of a target id (sensor, item, zone or actor). */
export function targetPoint(id: string | undefined | null, positions: Map<string, Vec3>): Vec3 | null {
  if (!id) return null;
  if (positions.has(id)) return positions.get(id)!;
  const z = sensorZone.get(id) ?? itemZone.get(id) ?? (zoneIds.has(id) ? id : undefined);
  return z ? zoneFeaturePoint(z) : null;
}

function offsetFor(id: string): [number, number] {
  const i = crewIndex.get(id) ?? 6;
  const a = (i / 7) * Math.PI * 2 + 0.4;
  return [Math.cos(a) * OFFSET_RADIUS_M, Math.sin(a) * OFFSET_RADIUS_M];
}

function goalOf(a: ActorSnap): Vec3 {
  const s = standPoint(a.target_zone ?? a.zone);
  const [ox, oz] = offsetFor(a.id);
  return [s[0] + ox, 0, s[2] + oz];
}

/** Host-side walk of every crew member toward the zone the core says they are in or heading to. */
export class CrewKinematics {
  readonly positions = new Map<string, Vec3>();
  readonly moving = new Set<string>();

  update(snap: Snapshot, dtSimS: number): void {
    for (const a of snap.actors) {
      if (a.is_player) continue;
      const goal = goalOf(a);
      let p = this.positions.get(a.id);
      if (!p) { p = [...goal]; this.positions.set(a.id, p); }
      const dx = goal[0] - p[0], dz = goal[2] - p[2];
      const dist = Math.hypot(dx, dz);
      const step = WALK_SPEED_MPS * Math.max(0, dtSimS);
      if (dist <= step || dist < 1e-3) {
        p[0] = goal[0]; p[2] = goal[2];
        this.moving.delete(a.id);
      } else {
        p[0] += (dx / dist) * step; p[2] += (dz / dist) * step;
        this.moving.add(a.id);
      }
    }
  }

  /** Snap everyone to their goals (after load / reset). */
  reset(): void {
    this.positions.clear();
    this.moving.clear();
  }
}

export interface WorldViewOptions {
  /** Actors who spoke recently (real-time window kept by the host). */
  speaking: Set<string>;
  /** Gesture of the latest validated line of each speaking NPC (overrides the snapshot gesture while speaking). */
  gestures?: Map<string, string>;
  /** Fixture for the control route bench: Mira stands at niche A, the spot the face_to_face segment films. */
  routeFixture?: boolean;
}

export function buildWorldView(snap: Snapshot, kin: CrewKinematics, opts: WorldViewOptions): WorldView {
  const tasks = new Map(snap.tasks.filter((t) => t.state === 'active').map((t) => [t.id, t]));
  const plans = new Map(snap.plans.filter((p) => p.state === 'awaiting_player').map((p) => [p.actor, p]));
  const actors: ActorView[] = [];
  for (const a of snap.actors) {
    if (a.is_player) continue;
    let pos = kin.positions.get(a.id) ?? goalOf(a);
    let target: Vec3 | undefined = [...pos];
    let activity = (ACTIVITIES.includes(a.activity as ActorView['activity']) ? a.activity : 'idle') as ActorView['activity'];
    if (kin.moving.has(a.id)) { activity = 'walking'; target = goalOf(a); }
    if (opts.routeFixture && a.id === 'mira') {
      pos = [...standPoint('niche_a')];
      target = [...pos];
      activity = 'talking';
    }
    const raw = opts.gestures?.get(a.id) ?? a.gesture;
    const gesture = (GESTURES.includes(raw as ActorView['gesture']) ? raw : 'none') as ActorView['gesture'];
    let lookAt: Vec3 | undefined;
    const task = a.task_id ? tasks.get(a.task_id) : undefined;
    const focusId = task?.target ?? plans.get(a.id)?.proposal.target_id ?? null;
    const focus = targetPoint(focusId, kin.positions);
    if (focus && (gesture === 'point_at_target' || gesture === 'check_device' || activity === 'working')) lookAt = [focus[0], 1.4, focus[2]];
    actors.push({
      id: a.id,
      name: a.name_ru,
      position: [pos[0], 0, pos[2]],
      target,
      lookAt,
      gesture,
      activity,
      color: crewColor.get(a.id) ?? [0.8, 0.8, 0.8],
      speaking: opts.speaking.has(a.id) || a.activity === 'talking',
    });
  }

  const markers: MarkerView[] = [];
  for (const s of snap.sensors) {
    const alarming = s.fault || s.reading.trend === 'falling' || s.reading.trend === 'rising';
    const drifting = Boolean(s.distortion) || s.reading.trend === 'unstable';
    if (!alarming && !drifting) continue;
    markers.push({
      id: s.id, kind: 'sensor', position: zoneFeaturePoint(s.zone),
      intensity: alarming ? (snap.emergency_lights ? 1 : 0.7) : 0.4,
      color: alarming ? ALARM_COLOR : DRIFT_COLOR,
    });
  }
  for (const t of tasks.values()) {
    const p = targetPoint(t.target, kin.positions);
    if (!p || t.action === 'propose_rest') continue;
    markers.push({ id: `task:${t.id}`, kind: 'task', position: p, intensity: 0.45 + 0.4 * (1 - t.progress), color: TASK_COLOR });
  }

  const biography: BiographyView[] = snap.biography.map((b) => ({ zone: b.zone, anchor: b.anchor, detail_id: b.detail_id }));
  return {
    simTimeS: snap.sim_time_s,
    emergencyLights: snap.emergency_lights,
    sealedZones: snap.zones.filter((z) => z.sealed).map((z) => z.id),
    actors,
    markers,
    biography,
  };
}
