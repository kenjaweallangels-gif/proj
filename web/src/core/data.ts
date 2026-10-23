// D0 data bundled into the page by esbuild's JSON loader: no network at runtime (the page also works as a sandboxed
// artifact). Same files and layout subset as core/cli/data_files.cpp and core/test_wasm_protocol.mjs.
import type { QualityProfile, SceneLayout, Vec3 } from '../contracts.ts';
import worldData from '../../../data/world/zero_echo_d0.json' with { type: 'json' };
import npcsData from '../../../data/npcs.json' with { type: 'json' };
import actionsData from '../../../data/actions.json' with { type: 'json' };
import profilesData from '../../../data/profiles.json' with { type: 'json' };
import speechData from '../../../data/speech_ru.json' with { type: 'json' };
import directorData from '../../../data/director_events.json' with { type: 'json' };
import biographyData from '../../../data/biography_details.json' with { type: 'json' };
import layoutData from '../../../data/scene/d0_layout.json' with { type: 'json' };

export interface NpcDef {
  id: string; name_ru: string; role_ru: string; role: string; zone: string; color: Vec3;
  persona: { values_ru: string; style_ru: string; boundaries_ru: string; speech_quirks_ru: string };
  skills: Record<string, number>; fatigue: number; trust_player: number;
}
export interface ActionDef {
  id: string; label_ru: string; description_ru: string;
  target: { kinds: string[]; required: boolean; zone_kinds?: string[]; item_kinds?: string[]; self_allowed?: boolean };
  companion: 'none' | 'optional' | string; approval: string; duration_s: number; consumes: Record<string, number>;
}
export interface FactDef { id: string; layer: string; protected: boolean; text_ru: string; about: string[] }
export interface WorldDef {
  title_ru: string;
  zones: { id: string; name_ru: string; kind: string; suit_required: boolean }[];
  doors: { id: string; a: string; b: string; state: string }[];
  resources: { id: string; name_ru: string; unit: string; amount: number; min_safe: number }[];
  items: { id: string; name_ru: string; zone: string; kind: string }[];
  sensors: { id: string; name_ru: string; zone: string; kind: string; unit: string }[];
  facts: FactDef[];
}
export interface BudgetRow { group: string; label_ru: string; ms: number }
export interface ProfilesDef {
  note_ru: string;
  frame_budget_ms: number;
  pause_threshold_ms: number;
  quality_profiles: QualityProfile[];
  ai_modes: { id: 'smooth' | 'live' | 'extended'; label_ru: string; gpu_llm_allowed: boolean; forbidden_during_emergency?: boolean }[];
  admission: { deadline_ms: Record<string, number>; max_queue_length: number; max_active_generations: number; gpu_gate: Record<string, number> };
  gpu_budget_n60_ms: BudgetRow[];
  vram_budget_gib: { columns: string[]; rows: { id: string; label_ru: string; values: number[] }[] };
  acceptance: Record<string, number | boolean>;
}

export const world = worldData as unknown as WorldDef;
export const npcs = (npcsData as unknown as { player: { id: string; name_ru: string }; npcs: NpcDef[] }).npcs;
export const player = (npcsData as unknown as { player: { id: string; name_ru: string; zone: string } }).player;
export const actions = (actionsData as unknown as { actions: ActionDef[]; styles: string[]; gestures: string[] }).actions;
export const profiles = profilesData as unknown as ProfilesDef;
export const scene = layoutData as unknown as SceneLayout;

export function buildInitData(): Record<string, unknown> {
  return {
    world: worldData,
    npcs: npcsData,
    actions: actionsData,
    profiles: profilesData,
    speech: speechData,
    director: directorData,
    biography: biographyData,
    layout: { anchors: scene.anchors, zone_stand_points: scene.zone_stand_points },
  };
}

// ---- Russian labels for ids shown in the UI (targets, zones, actions, facts)
const labelMap = new Map<string, string>();
for (const z of world.zones) labelMap.set(z.id, z.name_ru);
for (const s of world.sensors) labelMap.set(s.id, s.name_ru);
for (const i of world.items) labelMap.set(i.id, i.name_ru);
for (const r of world.resources) labelMap.set(r.id, r.name_ru);
for (const n of npcs) labelMap.set(n.id, n.name_ru);
labelMap.set(player.id, player.name_ru);

export function labelOf(id: string | null | undefined): string {
  if (!id) return '—';
  return labelMap.get(id) ?? id;
}

const actionLabels = new Map(actions.map((a) => [a.id, a.label_ru]));
actionLabels.set('acknowledge', 'ответить');
export function actionLabel(id: string | null | undefined): string {
  if (!id) return '—';
  return actionLabels.get(id) ?? id;
}

const facts = new Map(world.facts.map((f) => [f.id, f]));
export function factOf(id: string): FactDef | undefined {
  return facts.get(id);
}

export function npcOf(id: string): NpcDef | undefined {
  return npcs.find((n) => n.id === id);
}

export function zoneName(id: string | undefined): string {
  return id ? labelOf(id) : '—';
}
