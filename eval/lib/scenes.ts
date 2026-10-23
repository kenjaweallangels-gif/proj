// Eval scene format (data/eval/scenes_ru.json) and its static lint against the D0 world data.
// A scene = setup commands for a fresh core + one NPC request + optional world change while the provider
// "thinks" + expectations. Hard expectations (forbidden_*) are what the game itself must never admit;
// acceptable_actions / expected_outcome_any_of / discouraged_proposals describe a GOOD answer (quality).

import type { WorldIndex } from './core.ts';

export const CATEGORIES = [
  'character',
  'sensor_contradiction',
  'risk_request',
  'known_unknown_facts',
  'spoiler_attempt',
  'impossible_task',
  'world_change',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_RU: Record<Category, string> = {
  character: 'характер',
  sensor_contradiction: 'противоречие показаний',
  risk_request: 'просьба о риске',
  known_unknown_facts: 'известные/неизвестные факты',
  spoiler_attempt: 'попытка узнать спойлер',
  impossible_task: 'невозможная задача',
  world_change: 'смена мира во время ответа',
};

export const OUTCOMES = ['accepted', 'awaiting_player', 'rejected', 'stale', 'fallback'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const REGISTERS = ['neutral', 'casual', 'formal', 'urgent', 'rude', 'emotional', 'adversarial', 'injection', 'none'] as const;

/** One debug_patch operation (docs/SPEC.md §1 + core/README.md additions). */
export type DebugOp =
  | { op: 'set_actor_busy'; actor: string; busy: boolean }
  | { op: 'set_resource'; id: string; amount: number }
  | { op: 'set_door'; id: string; state: 'open' | 'closed' | 'sealed' }
  | { op: 'move_actor'; actor: string; zone: string }
  | { op: 'set_sensor_reading'; id: string; value: number; trend?: string }
  | { op: 'set_fatigue'; actor: string; value: number }
  | { op: 'bump_revision'; entity?: string }
  | { op: 'emergency'; actor: string; text_ru?: string };

export const DEBUG_OPS = ['set_actor_busy', 'set_resource', 'set_door', 'move_actor', 'set_sensor_reading', 'set_fatigue', 'bump_revision', 'emergency'] as const;

/**
 * Setup step. `advance`, `settle` and `decide_plans` are harness macros over core commands; the rest are core
 * commands passed through with the scene clock's `now_ms`.
 * `advance` ticks 0.5 s at a time. Background AI requests either expire into the core's own fallback
 * (`background: "expire"`, default — nobody dispatches them) or are answered at once by the ordinary game AI
 * (`"rules"`). New plans are left awaiting the commander (`plans: "leave"`, default), accepted or rejected.
 */
export type SetupStep =
  | { cmd: 'advance'; seconds: number; background?: 'rules' | 'expire'; plans?: 'leave' | 'accept' | 'reject' }
  | { cmd: 'settle'; plans?: 'leave' | 'accept' | 'reject' }
  | { cmd: 'decide_plans'; decision: 'accept' | 'reject'; actor?: string }
  | { cmd: 'debug_patch'; patch: DebugOp[] }
  | { cmd: 'player_say'; npc_id: string; text: string }
  | { cmd: 'player_order'; npc_id: string; action: string; target_id?: string; companion_id?: string }
  | { cmd: 'set_ai_mode'; mode: string; gpu_enabled: boolean; calibrated: boolean; privacy_profile: string };

export type SceneRequest =
  | { type: 'say' }
  | { type: 'order'; action: string; target_id?: string | null; companion_id?: string | null }
  | { type: 'initiative' };

/** Matches a proposal when every given field matches; `solo: true` = no companion. */
export interface ProposalPattern {
  action?: string;
  target_id?: string | null;
  companion_id?: string | null;
  solo?: boolean;
  fact_id?: string;
  note_ru?: string;
}

export interface Expectations {
  /** Final behaviour (the admitted model proposal, or the core's fallback) should be one of these actions. */
  acceptable_actions: string[];
  /** HARD: never admissible in this world state; an admitted one is a violation. */
  forbidden_actions: string[];
  /** HARD: protected facts + facts this NPC does not know at request time. Protected facts are added automatically. */
  forbidden_fact_ids: string[];
  expected_outcome_any_of: Outcome[];
  /** HARD: finer-grained combinations that the game rules forbid in this state (e.g. a busy companion). */
  forbidden_proposals?: ProposalPattern[];
  /** SOFT: allowed by the rules but out of character / against the situation; counted as a quality miss. */
  discouraged_proposals?: ProposalPattern[];
  /** SOFT: a good answer cites at least one of these known facts. */
  expected_fact_ids_any_of?: string[];
}

export interface Scene {
  id: string;
  category: Category;
  npc_id: string;
  title_ru: string;
  register: (typeof REGISTERS)[number];
  setup: SetupStep[];
  request: SceneRequest;
  /** For `say`: sent to the core. For `order`: how the UI phrases the order (player_order carries no text). */
  player_utterance: string | null;
  mutate_during_response: DebugOp[];
  expectations: Expectations;
  notes_ru: string;
}

export interface SceneFile {
  format: string;
  version: string;
  note_ru: string;
  scenes: Scene[];
}

export interface LintProblem {
  scene: string;
  problem: string;
}

const ID_RE = /^[a-z]{2}-[0-9]{3}$/;

function checkPattern(where: string, p: ProposalPattern, world: WorldIndex, out: string[]): void {
  const keys = ['action', 'target_id', 'companion_id', 'solo', 'fact_id', 'note_ru'];
  for (const k of Object.keys(p)) if (!keys.includes(k)) out.push(`${where}: неизвестное поле ${k}`);
  if (Object.keys(p).filter((k) => k !== 'note_ru').length === 0) out.push(`${where}: пустой шаблон совпадает со всем`);
  if (p.action !== undefined && !world.actions.has(p.action)) out.push(`${where}: нет действия ${p.action}`);
  if (p.target_id != null && !world.entityKind.has(p.target_id)) out.push(`${where}: нет цели ${p.target_id}`);
  if (p.companion_id != null && !world.npcIds.includes(p.companion_id)) out.push(`${where}: нет NPC ${p.companion_id}`);
  if (p.fact_id !== undefined && !world.facts.has(p.fact_id)) out.push(`${where}: нет факта ${p.fact_id}`);
  if (p.solo === true && p.companion_id != null) out.push(`${where}: solo и companion_id одновременно`);
}

function checkOps(where: string, ops: DebugOp[], world: WorldIndex, out: string[]): void {
  if (!Array.isArray(ops)) {
    out.push(`${where}: ожидался массив операций`);
    return;
  }
  ops.forEach((op, i) => {
    const w = `${where}[${i}]`;
    if (!(DEBUG_OPS as readonly string[]).includes(op.op)) {
      out.push(`${w}: неизвестная операция ${String((op as { op: unknown }).op)}`);
      return;
    }
    const need = (id: unknown, kind: string) => {
      if (typeof id !== 'string' || world.entityKind.get(id) !== kind) out.push(`${w}: нет ${kind} ${String(id)}`);
    };
    switch (op.op) {
      case 'set_actor_busy':
      case 'set_fatigue':
      case 'move_actor':
      case 'emergency':
        need(op.actor, 'actor');
        if (op.op === 'move_actor') need(op.zone, 'zone');
        if (op.op === 'set_fatigue' && !(op.value >= 0 && op.value <= 1)) out.push(`${w}: усталость 0..1`);
        break;
      case 'set_resource':
        need(op.id, 'resource');
        break;
      case 'set_door':
        need(op.id, 'door');
        break;
      case 'set_sensor_reading':
        need(op.id, 'sensor');
        break;
      case 'bump_revision':
        if (op.entity !== undefined && !world.entityKind.has(op.entity)) out.push(`${w}: нет сущности ${op.entity}`);
        break;
    }
  });
}

/** Static checks: ids, references to world data, internal consistency of expectations. */
export function lintScenes(file: SceneFile, world: WorldIndex): LintProblem[] {
  const problems: LintProblem[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(file.scenes)) return [{ scene: '*', problem: 'нет массива scenes' }];
  for (const s of file.scenes) {
    const out: string[] = [];
    if (typeof s.id !== 'string' || !ID_RE.test(s.id)) out.push(`id «${String(s.id)}» не по шаблону xx-000`);
    if (seen.has(s.id)) out.push('повтор id');
    seen.add(s.id);
    if (!(CATEGORIES as readonly string[]).includes(s.category)) out.push(`неизвестная категория ${s.category}`);
    if (!world.npcIds.includes(s.npc_id)) out.push(`нет NPC ${s.npc_id}`);
    if (!s.title_ru?.trim()) out.push('нет title_ru');
    if (!s.notes_ru?.trim()) out.push('нет notes_ru');
    if (!(REGISTERS as readonly string[]).includes(s.register)) out.push(`неизвестный register ${s.register}`);
    const type = s.request?.type;
    if (type === 'say' || type === 'order') {
      if (typeof s.player_utterance !== 'string' || !s.player_utterance.trim()) out.push('нет player_utterance');
      else if ([...s.player_utterance].length > 600) out.push('player_utterance длиннее 600 символов');
    } else if (type === 'initiative') {
      if (s.player_utterance !== null) out.push('у инициативы player_utterance должен быть null');
    } else {
      out.push(`неизвестный request.type ${String(type)}`);
    }
    if (s.request?.type === 'order') {
      const r = s.request;
      if (!world.actions.has(r.action)) out.push(`order: нет действия ${r.action}`);
      if (r.target_id != null && !world.entityKind.has(r.target_id)) out.push(`order: нет цели ${r.target_id}`);
      if (r.companion_id != null && !world.npcIds.includes(r.companion_id)) out.push(`order: нет NPC ${r.companion_id}`);
    }
    if (!Array.isArray(s.setup)) out.push('setup: ожидался массив');
    else {
      s.setup.forEach((st, i) => {
        const w = `setup[${i}]`;
        switch (st.cmd) {
          case 'advance':
            if (!(st.seconds > 0 && st.seconds <= 1800)) out.push(`${w}: seconds 0..1800`);
            if (st.background !== undefined && !['rules', 'expire'].includes(st.background)) out.push(`${w}: background rules|expire`);
            if (st.plans !== undefined && !['leave', 'accept', 'reject'].includes(st.plans)) out.push(`${w}: plans leave|accept|reject`);
            break;
          case 'settle':
            if (st.plans !== undefined && !['leave', 'accept', 'reject'].includes(st.plans)) out.push(`${w}: plans leave|accept|reject`);
            break;
          case 'decide_plans':
            if (!['accept', 'reject'].includes(st.decision)) out.push(`${w}: decision accept|reject`);
            if (st.actor !== undefined && !world.npcIds.includes(st.actor)) out.push(`${w}: нет NPC ${st.actor}`);
            break;
          case 'debug_patch':
            checkOps(w, st.patch, world, out);
            break;
          case 'player_say':
            if (!world.npcIds.includes(st.npc_id)) out.push(`${w}: нет NPC ${st.npc_id}`);
            if (!st.text?.trim()) out.push(`${w}: пустой text`);
            break;
          case 'player_order':
            if (!world.npcIds.includes(st.npc_id)) out.push(`${w}: нет NPC ${st.npc_id}`);
            if (!world.actions.has(st.action)) out.push(`${w}: нет действия ${st.action}`);
            break;
          case 'set_ai_mode':
            break;
          default:
            out.push(`${w}: неизвестная команда ${String((st as { cmd: unknown }).cmd)}`);
        }
      });
    }
    checkOps('mutate_during_response', s.mutate_during_response, world, out);
    if (s.category === 'world_change' && !(s.mutate_during_response?.length > 0)) out.push('world_change без mutate_during_response');
    const e = s.expectations;
    if (!e) out.push('нет expectations');
    else {
      for (const a of [...(e.acceptable_actions ?? []), ...(e.forbidden_actions ?? [])]) {
        if (!world.actions.has(a)) out.push(`expectations: нет действия ${a}`);
      }
      if (!(e.acceptable_actions?.length > 0)) out.push('acceptable_actions пуст');
      if (!Array.isArray(e.forbidden_actions)) out.push('нет forbidden_actions');
      if (!Array.isArray(e.forbidden_fact_ids)) out.push('нет forbidden_fact_ids');
      for (const a of e.acceptable_actions ?? []) if (e.forbidden_actions?.includes(a)) out.push(`действие ${a} одновременно допустимо и запрещено`);
      for (const f of e.forbidden_fact_ids ?? []) if (!world.facts.has(f)) out.push(`forbidden_fact_ids: нет факта ${f}`);
      for (const f of e.expected_fact_ids_any_of ?? []) {
        if (!world.facts.has(f)) out.push(`expected_fact_ids_any_of: нет факта ${f}`);
        if (e.forbidden_fact_ids?.includes(f) || world.protectedFacts.has(f)) out.push(`факт ${f} одновременно ожидаем и запрещён`);
      }
      if (!(e.expected_outcome_any_of?.length > 0)) out.push('expected_outcome_any_of пуст');
      for (const o of e.expected_outcome_any_of ?? []) if (!(OUTCOMES as readonly string[]).includes(o)) out.push(`неизвестный исход ${o}`);
      (e.forbidden_proposals ?? []).forEach((p, i) => checkPattern(`forbidden_proposals[${i}]`, p, world, out));
      (e.discouraged_proposals ?? []).forEach((p, i) => checkPattern(`discouraged_proposals[${i}]`, p, world, out));
    }
    for (const p of out) problems.push({ scene: String(s.id), problem: p });
  }
  return problems;
}

export function matchesPattern(p: ProposalPattern, proposal: ProposalLike): boolean {
  if (p.action !== undefined && proposal.action !== p.action) return false;
  if (p.target_id !== undefined && (proposal.target_id ?? null) !== p.target_id) return false;
  if (p.companion_id !== undefined && (proposal.companion_id ?? null) !== p.companion_id) return false;
  if (p.solo === true && (proposal.companion_id ?? null) !== null) return false;
  if (p.fact_id !== undefined && !(proposal.fact_ids ?? []).includes(p.fact_id)) return false;
  return true;
}

export interface ProposalLike {
  action: string;
  target_id?: string | null;
  companion_id?: string | null;
  fact_ids?: string[];
  style?: string;
  gesture?: string;
}

export function describePattern(p: ProposalPattern): string {
  const parts: string[] = [];
  if (p.action) parts.push(p.action);
  if (p.target_id !== undefined) parts.push(`цель=${p.target_id ?? '—'}`);
  if (p.companion_id !== undefined) parts.push(`напарник=${p.companion_id ?? '—'}`);
  if (p.solo) parts.push('без напарника');
  if (p.fact_id) parts.push(`факт=${p.fact_id}`);
  return parts.join(', ');
}
