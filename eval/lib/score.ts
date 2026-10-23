// Scoring of one observed scene and aggregation over a run (Документ §19 «ИИ-метрики», docs/SPEC.md §9).
//
// Two kinds of checks, never mixed:
//   HARD — something the game must never admit whatever the provider says (forbidden/protected/unknown
//          facts, actions or combinations the rules forbid in this state, not-offered choices, a proposal
//          that depends on an entity changed while the provider was answering, model text leaking into
//          speech, core invariant breaches). Any hit is a "violation admitted"; the target is 0.
//   SOFT — quality of the behaviour: expected outcome, acceptable action, character-level discouraged
//          choices, expected evidence. Misses lower the expectation match rate; they are not violations.

import type { Speech, Verdict } from '../../web/src/contracts.ts';
import type { WorldIndex } from './core.ts';
import type { Observation } from './runner.ts';
import type { Outcome, ProposalLike, Scene } from './scenes.ts';
import { describePattern, matchesPattern } from './scenes.ts';

export interface Finding {
  type: string;
  detail: string;
  source?: 'model' | 'fallback' | 'speech' | 'memory' | 'core';
}

export interface AdmittedProposal {
  source: 'model' | 'fallback';
  status: string;
  proposal: ProposalLike;
}

export interface SceneScore {
  id: string;
  category: string;
  npc_id: string;
  register: string;
  request_type: string;
  state: 'ok' | 'error' | 'scene_invalid';
  error: string | null;
  scene_problems: string[];
  outcome: Outcome | null;
  verdict_status: string | null;
  fallback_used: boolean;
  fallback_reason: string | null;
  reasons: string[];
  provider_status: string | null;
  provider_error: string | null;
  model_proposal: ProposalLike | null;
  model_text: string | null;
  /** The provider's own explanation when it has one (rules: UtilityPolicy reason; HTTP: transport problem). */
  provider_note: string | null;
  admitted: AdmittedProposal[];
  final: ProposalLike | null;
  final_source: 'model' | 'fallback' | null;
  checks: { outcome_ok: boolean; action_ok: boolean; evidence_ok: boolean; soft_ok: boolean; hard_ok: boolean };
  match: boolean;
  model_choice: { parsed: boolean; acceptable: boolean | null; discouraged: boolean; forbidden: boolean };
  hard: Finding[];
  soft: Finding[];
  invalid_group: string | null;
  speech: Pick<Speech, 'text' | 'template_id' | 'kind' | 'style' | 'gesture' | 'fact_ids'> | null;
  immediate: string | null;
  latency: { provider_total_ms: number | null; first_token_ms: number | null; ready_ms: number | null; wall_ms: number | null };
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens: number; reasoning_tokens: number; measured: boolean; cost_usd: number | null; cost_is_fictional: boolean | null } | null;
  request: { task_id: string; world_revision: number; deadline_ms: number; offered: string[]; visible_facts: string[]; token_estimate_total: number | null } | null;
  mutation: { ops: unknown[]; revision_bumped: string[] } | null;
  contract_problems: string[];
}

const INTENT_FIELDS = new Set(['action', 'target_id', 'companion_id', 'fact_ids', 'style', 'gesture']);

/** Verdict status → the outcome vocabulary of the scenes. */
export function outcomeOf(v: Verdict): Outcome {
  switch (v.status) {
    case 'accepted':
      return 'accepted';
    case 'awaiting_player':
      return 'awaiting_player';
    case 'rejected':
      return 'rejected';
    case 'stale':
      return 'stale';
    default:
      return 'fallback'; // fallback | expired | duplicate
  }
}

/** Groups an authority rejection reason (verdict.reasons[0]) for the "invalid intents by reason" table. */
export function reasonGroup(reason: string): string {
  const k = reason.split(':')[0];
  if (['unknown_field', 'duplicate_key', 'bad_json', 'not_object', 'missing_field', 'wrong_type', 'bad_pattern', 'bad_style', 'bad_gesture', 'too_large', 'depth_exceeded', 'fact_ids_not_unique', 'fact_ids_too_many', 'fact_ids_too_few'].includes(k)) return `format:${k}`;
  if (k === 'fact_protected' || k === 'fact_unknown_to_actor' || k === 'fact_not_offered') return `knowledge:${k}`;
  if (k.endsWith('_not_offered')) return `offer:${k}`;
  if (k === 'stale') return 'stale';
  if (k === 'provider_status') return `provider:${reason.split(':')[1] ?? ''}`;
  if (k === 'deadline_passed') return 'deadline';
  return `rules:${k}`;
}

function asProposal(v: unknown): ProposalLike | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p.action !== 'string') return null;
  return {
    action: p.action,
    target_id: (p.target_id as string | null) ?? null,
    companion_id: (p.companion_id as string | null) ?? null,
    fact_ids: Array.isArray(p.fact_ids) ? (p.fact_ids as string[]) : [],
    style: p.style as string | undefined,
    gesture: p.gesture as string | undefined,
  };
}

/** Direct dependencies of a proposal — a subset of the core's step-3 dependency set (authority.cpp stale_dependencies). */
export function directDependencies(p: ProposalLike, actor: string, world: WorldIndex, zones: Record<string, string>, sensorZones: Map<string, string>): string[] {
  const deps = new Set<string>([actor]);
  const def = world.actions.get(p.action);
  const restLike = Boolean(def && (def.effects as string[]).includes('rest') && (def.target.kinds as string[]).includes('actor'));
  if (p.target_id) {
    deps.add(p.target_id);
    const remote = p.action === 'drone_survey';
    if (!remote && !restLike) {
      const kind = world.entityKind.get(p.target_id);
      const zone = kind === 'zone' ? p.target_id : kind === 'sensor' ? sensorZones.get(p.target_id) : zones[p.target_id];
      if (zone) deps.add(zone);
    }
  }
  if (p.companion_id) deps.add(p.companion_id);
  if (def) {
    for (const r of Object.keys(def.consumes ?? {})) deps.add(r);
    for (const t of (def.tools ?? []) as string[]) deps.add(t);
  }
  return [...deps];
}

export interface ScoreContext {
  world: WorldIndex;
  sensorZones: Map<string, string>;
}

export function scoreScene(scene: Scene, obs: Observation, ctx: ScoreContext): SceneScore {
  const { world } = ctx;
  const e = scene.expectations;
  const s: SceneScore = {
    id: scene.id,
    category: scene.category,
    npc_id: scene.npc_id,
    register: scene.register,
    request_type: scene.request.type,
    state: obs.error ? 'error' : obs.scene_problems.length ? 'scene_invalid' : 'ok',
    error: obs.error,
    scene_problems: obs.scene_problems,
    outcome: null,
    verdict_status: null,
    fallback_used: false,
    fallback_reason: null,
    reasons: [],
    provider_status: obs.provider_call?.result.status ?? null,
    provider_error: obs.provider_call?.result.error?.code ?? null,
    model_proposal: null,
    model_text: obs.provider_call?.result.proposal_text?.slice(0, 400) ?? null,
    provider_note: obs.provider_call?.note ?? null,
    admitted: [],
    final: null,
    final_source: null,
    checks: { outcome_ok: false, action_ok: false, evidence_ok: true, soft_ok: true, hard_ok: true },
    match: false,
    model_choice: { parsed: false, acceptable: null, discouraged: false, forbidden: false },
    hard: [],
    soft: [],
    invalid_group: null,
    speech: obs.speech ? { text: obs.speech.text, template_id: obs.speech.template_id, kind: obs.speech.kind, style: obs.speech.style, gesture: obs.speech.gesture, fact_ids: obs.speech.fact_ids } : null,
    immediate: obs.immediate?.text ?? null,
    latency: { provider_total_ms: null, first_token_ms: null, ready_ms: null, wall_ms: null },
    usage: null,
    request: obs.request
      ? {
          task_id: obs.request.task_id,
          world_revision: obs.request.world_revision,
          deadline_ms: obs.request.deadline_ms,
          offered: obs.request.allowed_actions.map((a) => a.id),
          visible_facts: obs.request.visible_facts.map((f) => f.id),
          token_estimate_total: (obs.request.token_estimate?.total as number | undefined) ?? null,
        }
      : null,
    mutation: obs.mutation ? { ops: obs.mutation.ops, revision_bumped: obs.mutation.revision_bumped } : null,
    contract_problems: [...obs.request_schema_problems.map((p) => `request: ${p}`), ...obs.result_schema_problems.map((p) => `result: ${p}`)],
  };
  const call = obs.provider_call;
  if (call) {
    const u = call.result.usage;
    s.usage = {
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cached_input_tokens: u.cached_input_tokens ?? 0,
      reasoning_tokens: u.reasoning_tokens ?? 0,
      measured: u.measured,
      cost_usd: typeof call.result.cost_usd === 'number' ? call.result.cost_usd : null,
      cost_is_fictional: call.result.cost_is_fictional ?? null,
    };
    s.latency = {
      provider_total_ms: call.result.latency_ms.total,
      first_token_ms: call.result.latency_ms.first_token ?? null,
      ready_ms: obs.submit_ms !== null ? call.wall_ms + obs.submit_ms : null,
      wall_ms: call.wall_ms,
    };
  }
  const v = obs.verdict;
  if (!v || s.state === 'error') return s;

  s.outcome = outcomeOf(v);
  s.verdict_status = v.status;
  s.fallback_used = v.fallback_used;
  s.fallback_reason = v.fallback_reason;
  s.reasons = v.reasons;
  s.model_proposal = asProposal(v.proposal);
  if ((v.status === 'rejected' || v.status === 'stale' || v.status === 'expired') && v.reasons.length) s.invalid_group = reasonGroup(v.reasons[0]);
  if (v.status === 'fallback' && v.fallback_reason) s.invalid_group = `provider:${v.fallback_reason}`;

  const forbiddenFacts = new Set([...e.forbidden_fact_ids, ...world.protectedFacts]);
  const known = new Set(obs.known_before);
  const req = obs.request;
  const hard = (f: Finding) => s.hard.push(f);

  const checkAdmitted = (a: AdmittedProposal) => {
    const p = a.proposal;
    if (e.forbidden_actions.includes(p.action)) hard({ type: 'forbidden_action', detail: p.action, source: a.source });
    for (const pat of e.forbidden_proposals ?? []) {
      if (matchesPattern(pat, p)) hard({ type: 'forbidden_proposal', detail: describePattern(pat), source: a.source });
    }
    for (const f of p.fact_ids ?? []) {
      if (world.protectedFacts.has(f)) hard({ type: 'protected_fact', detail: f, source: a.source });
      else if (forbiddenFacts.has(f)) hard({ type: 'forbidden_fact', detail: f, source: a.source });
      else if (!known.has(f)) hard({ type: 'unknown_fact', detail: f, source: a.source });
    }
    if (a.source === 'model' && req) {
      const offered = req.allowed_actions.find((x) => x.id === p.action);
      if (!offered) hard({ type: 'not_offered_action', detail: p.action, source: 'model' });
      else {
        if (p.target_id && !offered.targets.some((t) => t.id === p.target_id)) hard({ type: 'not_offered_target', detail: p.target_id, source: 'model' });
        if (p.companion_id && !offered.companions.some((c) => c.id === p.companion_id)) hard({ type: 'not_offered_companion', detail: p.companion_id, source: 'model' });
      }
      for (const f of p.fact_ids ?? []) {
        if (!req.visible_facts.some((x) => x.id === f)) hard({ type: 'not_offered_fact', detail: f, source: 'model' });
      }
      if (obs.mutation) {
        const deps = directDependencies(p, scene.npc_id, world, obs.zones_at_request, ctx.sensorZones);
        for (const d of deps) if (obs.mutation.revision_bumped.includes(d)) hard({ type: 'stale_admitted', detail: d, source: 'model' });
      }
      // The raw model text must have had exactly the intent fields; the core parser admitted it, so re-check.
      if (call?.result.proposal_text) {
        try {
          const raw = JSON.parse(call.result.proposal_text) as Record<string, unknown>;
          for (const k of Object.keys(raw)) if (!INTENT_FIELDS.has(k)) hard({ type: 'unknown_field_admitted', detail: k, source: 'model' });
        } catch {
          /* the core parsed it, JSON.parse may differ only on exotic input; the core is the authority here */
        }
      }
    }
  };

  const admittedStatus = (st: string) => st === 'accepted' || st === 'awaiting_player';
  if (admittedStatus(v.status) && s.model_proposal) s.admitted.push({ source: 'model', status: v.status, proposal: s.model_proposal });
  const fb = (v as Verdict & { fallback?: { status: string; proposal: unknown } }).fallback;
  if (fb && admittedStatus(fb.status)) {
    const p = asProposal(fb.proposal);
    if (p) s.admitted.push({ source: 'fallback', status: fb.status, proposal: p });
  }
  for (const a of s.admitted) checkAdmitted(a);

  // Speech: only templates + allowed facts; never raw model text, never protected or unknown facts.
  if (obs.speech) {
    const sp = obs.speech;
    if (sp.actor !== scene.npc_id) hard({ type: 'speech_wrong_actor', detail: sp.actor, source: 'speech' });
    for (const f of sp.fact_ids ?? []) {
      if (forbiddenFacts.has(f) || !known.has(f)) hard({ type: 'speech_fact', detail: f, source: 'speech' });
    }
    for (const f of world.protectedFacts) {
      const text = world.facts.get(f)?.text_ru;
      if (text && sp.text.includes(text)) hard({ type: 'speech_protected_text', detail: f, source: 'speech' });
    }
    if (/[{}]|"action"|fact_ids|target_id/.test(sp.text)) hard({ type: 'speech_raw_model_text', detail: sp.text.slice(0, 80), source: 'speech' });
  }
  // Knowledge: the NPC must not learn protected or forbidden facts from this exchange.
  for (const f of obs.known_after) {
    if (!known.has(f) && forbiddenFacts.has(f)) hard({ type: 'knowledge_leak', detail: f, source: 'memory' });
  }
  if (obs.core_violations.delta > 0) hard({ type: 'core_invariant', detail: obs.core_violations.log.join(' | ') || String(obs.core_violations.delta), source: 'core' });
  for (const p of s.contract_problems) hard({ type: 'contract', detail: p, source: 'core' });

  // Final behaviour = the admitted model proposal, else the core's fallback.
  const final = s.admitted.find((a) => a.source === 'model') ?? s.admitted.find((a) => a.source === 'fallback') ?? null;
  s.final = final?.proposal ?? null;
  s.final_source = final?.source ?? null;
  if (s.final) {
    for (const pat of e.discouraged_proposals ?? []) {
      if (matchesPattern(pat, s.final)) s.soft.push({ type: 'discouraged', detail: pat.note_ru ? `${describePattern(pat)} — ${pat.note_ru}` : describePattern(pat), source: s.final_source ?? undefined });
    }
  }
  s.checks.outcome_ok = s.outcome !== null && e.expected_outcome_any_of.includes(s.outcome);
  s.checks.action_ok = s.final !== null && e.acceptable_actions.includes(s.final.action);
  if (e.expected_fact_ids_any_of?.length) {
    const expected = e.expected_fact_ids_any_of;
    s.checks.evidence_ok = Boolean(s.final && (s.final.fact_ids ?? []).some((f) => expected.includes(f)));
    if (!s.checks.evidence_ok) {
      // Attribute the miss: the core's ContextBuilder may not have offered any of the expected facts at all.
      const offered = req ? expected.filter((f) => req.visible_facts.some((x) => x.id === f)) : [];
      s.soft.push(
        offered.length
          ? { type: 'missing_evidence', detail: `ожидался один из фактов: ${expected.join(', ')}` }
          : { type: 'context_gap', detail: `ядро не выдало в запросе ни одного из ожидаемых фактов (${expected.join(', ')}), хотя NPC их знает` },
      );
    }
  }
  s.checks.soft_ok = !s.soft.some((f) => f.type === 'discouraged');
  s.checks.hard_ok = s.hard.length === 0;
  s.match = s.state === 'ok' && s.checks.outcome_ok && s.checks.action_ok && s.checks.evidence_ok && s.checks.soft_ok && s.checks.hard_ok;

  // A world-change scene judges the behaviour after the change; the model chose before it, so its own
  // choice is not compared with acceptable_actions there.
  if (s.model_proposal && scene.category !== 'world_change') {
    s.model_choice.parsed = true;
    s.model_choice.acceptable = e.acceptable_actions.includes(s.model_proposal.action);
    s.model_choice.discouraged = (e.discouraged_proposals ?? []).some((pat) => matchesPattern(pat, s.model_proposal as ProposalLike));
    s.model_choice.forbidden =
      e.forbidden_actions.includes(s.model_proposal.action) ||
      (e.forbidden_proposals ?? []).some((pat) => matchesPattern(pat, s.model_proposal as ProposalLike)) ||
      (s.model_proposal.fact_ids ?? []).some((f) => forbiddenFacts.has(f) || !known.has(f));
  }
  return s;
}

// ------------------------------------------------------------------ aggregation

export interface PercentileSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
  mean: number | null;
}

/** Nearest-rank percentiles (same definition as the core's metrics). */
export function percentiles(values: number[]): PercentileSummary {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { count: 0, p50: null, p95: null, p99: null, max: null, mean: null };
  const at = (q: number) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { count: v.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(v[v.length - 1]), mean: round(v.reduce((a, b) => a + b, 0) / v.length) };
}

function ratio(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 10000) / 10000 : null;
}

function count<T>(xs: T[], key: (x: T) => string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) {
    const k = key(x);
    if (k !== null) out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

const WORD_RE = /[a-zа-яё0-9]+/giu;

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(WORD_RE) ?? []).filter((w) => w.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function speechMetrics(scores: SceneScore[], npcIds: string[]) {
  const lines = scores.filter((s) => s.speech).map((s) => ({ npc: s.npc_id, ...(s.speech as NonNullable<SceneScore['speech']>) }));
  const templates = count(lines, (l) => l.template_id);
  const texts = new Set(lines.map((l) => l.text));
  const persona = lines.filter((l) => l.template_id.split('.').some((seg) => npcIds.includes(seg))).length;
  const perNpc = new Map<string, Set<string>>();
  for (const l of lines) {
    const set = perNpc.get(l.npc) ?? new Set<string>();
    for (const w of words(l.text)) set.add(w);
    perNpc.set(l.npc, set);
  }
  const ids = [...perNpc.keys()].sort();
  const sims: number[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) sims.push(jaccard(perNpc.get(ids[i]) as Set<string>, perNpc.get(ids[j]) as Set<string>));
  const meanSim = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : null;
  const distinctTemplates = Object.keys(templates).length;
  return {
    lines: lines.length,
    distinct_templates: distinctTemplates,
    distinct_texts: texts.size,
    template_repetition_rate: lines.length ? ratio(lines.length - distinctTemplates, lines.length) : null,
    text_repetition_rate: lines.length ? ratio(lines.length - texts.size, lines.length) : null,
    top_templates: Object.entries(templates).slice(0, 8).map(([template_id, n]) => ({ template_id, count: n })),
    persona_template_share: ratio(persona, lines.length),
    npc_vocabulary_overlap_mean_jaccard: meanSim === null ? null : Math.round(meanSim * 10000) / 10000,
    npc_distinctness: meanSim === null ? null : Math.round((1 - meanSim) * 10000) / 10000,
    by_kind: count(lines, (l) => l.kind),
    note_ru:
      'Сцены идут на свежих ядрах, поэтому антиповтор внутри смены здесь не работает: повтор шаблона между сценами показывает ширину библиотеки реплик. Различимость = 1 − средний коэффициент Жаккара словарей реплик разных NPC.',
  };
}

export interface Pricing {
  route: string;
  input_per_mtok: number;
  output_per_mtok: number;
  fictional: boolean;
  source: string;
}

/** Документ §18: price_per_hour = requests_per_hour × (in × P_in + out × P_out) / 1e6. */
export function perHour(requestsPerHour: number, inTok: number, outTok: number, pIn: number, pOut: number): number {
  return Math.round(((requestsPerHour * (inTok * pIn + outTok * pOut)) / 1_000_000) * 1e6) / 1e6;
}

export function aggregate(scores: SceneScore[], opts: { npcIds: string[]; pricing: Pricing | null; isLanguageModel: boolean; isRules: boolean }) {
  const ok = scores.filter((s) => s.state === 'ok');
  const run = ok.length;
  const hard = ok.flatMap((s) => s.hard.map((f) => ({ scene: s.id, ...f })));
  const soft = ok.flatMap((s) => s.soft.filter((f) => f.type === 'discouraged').map((f) => ({ scene: s.id, ...f })));
  const validIntents = ok.filter((s) => s.verdict_status === 'accepted' || s.verdict_status === 'awaiting_player').length;
  const providerOk = ok.filter((s) => s.provider_status === 'ok');
  // An invalid intent = the provider answered, but the answer is not an admissible intent: rejected by the
  // core's Intent Authority, or already normalized to invalid_output by the gateway (not JSON, truncated).
  // A rule-level rejection in a world-change scene is caused by the change, not by the provider: counted apart.
  const changedUnder = (s: SceneScore) => s.category === 'world_change' && s.verdict_status === 'rejected' && (s.invalid_group ?? '').startsWith('rules:');
  const invalid = ok.filter((s) => ((s.provider_status === 'ok' && s.verdict_status === 'rejected') || s.provider_status === 'invalid_output') && !changedUnder(s));
  const stale = ok.filter((s) => s.verdict_status === 'stale');
  const fallback = ok.filter((s) => s.fallback_used);
  const matched = ok.filter((s) => s.match);
  const parsed = ok.filter((s) => s.model_choice.parsed);

  const breakdown = (key: (s: SceneScore) => string) => {
    const out: Record<string, { scenes: number; matched: number; match_rate: number | null; valid_intents: number; fallback: number; violations: number }> = {};
    for (const s of ok) {
      const k = key(s);
      const b = (out[k] ??= { scenes: 0, matched: 0, match_rate: null, valid_intents: 0, fallback: 0, violations: 0 });
      b.scenes++;
      if (s.match) b.matched++;
      if (s.verdict_status === 'accepted' || s.verdict_status === 'awaiting_player') b.valid_intents++;
      if (s.fallback_used) b.fallback++;
      b.violations += s.hard.length;
    }
    for (const b of Object.values(out)) b.match_rate = ratio(b.matched, b.scenes);
    return out;
  };

  const withUsage = ok.filter((s) => s.usage);
  const sum = (f: (s: SceneScore) => number) => withUsage.reduce((a, s) => a + f(s), 0);
  const inMean = withUsage.length ? sum((s) => s.usage?.input_tokens ?? 0) / withUsage.length : 0;
  const outMean = withUsage.length ? sum((s) => s.usage?.output_tokens ?? 0) / withUsage.length : 0;
  const costs = withUsage.map((s) => s.usage?.cost_usd).filter((c): c is number => typeof c === 'number');
  const rates = [150, 2160];
  const tokens = {
    requests: withUsage.length,
    input_total: sum((s) => s.usage?.input_tokens ?? 0),
    output_total: sum((s) => s.usage?.output_tokens ?? 0),
    cached_input_total: sum((s) => s.usage?.cached_input_tokens ?? 0),
    reasoning_total: sum((s) => s.usage?.reasoning_tokens ?? 0),
    input_mean: Math.round(inMean * 10) / 10,
    output_mean: Math.round(outMean * 10) / 10,
    measured_share: ratio(withUsage.filter((s) => s.usage?.measured).length, withUsage.length),
    note_ru: opts.isRules
      ? 'Правила не тратят токены: не применимо.'
      : withUsage.every((s) => !s.usage?.measured)
        ? 'Usage — ОЦЕНКА шлюза (measured: false), не измерение провайдера.'
        : 'Usage — по ответам провайдера (measured: true там, где провайдер его вернул).',
  };
  const cost = {
    total_usd: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 1e9) / 1e9 : null,
    results_with_cost: costs.length,
    pricing: opts.pricing,
    per_hour_usd: opts.pricing && !opts.isRules ? Object.fromEntries(rates.map((r) => [`${r}_requests`, perHour(r, inMean, outMean, (opts.pricing as Pricing).input_per_mtok, (opts.pricing as Pricing).output_per_mtok)])) : null,
    reference_fictional_1_5_per_hour_usd: opts.isRules ? null : Object.fromEntries(rates.map((r) => [`${r}_requests`, perHour(r, inMean, outMean, 1, 5)])),
    note_ru:
      'Все тарифы вымышленные (data/pricing.example.json, fictional: true). 150 запросов/час — событийный пример Документа §18, 2160 — шесть NPC раз в 10 с. Справочная строка $1/$5 за 1M — та же арифметика с условным тарифом Документа §18 при наблюдаемом среднем числе токенов; это не цена реального провайдера.',
  };

  return {
    scenes_total: scores.length,
    scenes_run: run,
    scenes_error: scores.filter((s) => s.state === 'error').length,
    scenes_invalid: scores.filter((s) => s.state === 'scene_invalid').length,
    // Scenes in which the game admitted something it must not (one admitted proposal may break several rules).
    violations_admitted: ok.filter((s) => s.hard.length > 0).length,
    violation_findings: hard.length,
    violations_by_type: count(hard, (h) => h.type),
    violations: hard.slice(0, 50),
    soft_violations_admitted: soft.length,
    context_gaps: ok.filter((s) => s.soft.some((f) => f.type === 'context_gap')).map((s) => s.id),
    soft_violations: soft.slice(0, 50),
    valid_intent_rate: ratio(validIntents, run),
    valid_intents: validIntents,
    provider_ok: providerOk.length,
    invalid_intents: invalid.length,
    invalid_intents_by_reason: count(invalid, (s) => (s.provider_status === 'invalid_output' ? `gateway:${s.provider_error ?? 'invalid_output'}` : s.invalid_group)),
    invalid_intent_reasons_detail: count(invalid, (s) => (s.provider_status === 'invalid_output' ? `gateway:${s.provider_error ?? 'invalid_output'}` : (s.reasons[0] ?? null))),
    stale_verdicts: stale.length,
    rejected_after_world_change: ok.filter(changedUnder).length,
    expectation_match_rate: ratio(matched.length, run),
    expectation_matched: matched.length,
    model_choice_acceptable_rate: ratio(parsed.filter((s) => s.model_choice.acceptable).length, parsed.length),
    model_choice_forbidden: parsed.filter((s) => s.model_choice.forbidden).length,
    model_choice_discouraged: parsed.filter((s) => s.model_choice.discouraged).length,
    model_proposals_parsed: parsed.length,
    outcome_ok_rate: ratio(ok.filter((s) => s.checks.outcome_ok).length, run),
    action_ok_rate: ratio(ok.filter((s) => s.checks.action_ok).length, run),
    fallback_rate: ratio(fallback.length, run),
    fallback_by_reason: count(fallback, (s) => s.fallback_reason),
    outcomes: count(ok, (s) => s.outcome),
    provider_statuses: count(ok, (s) => s.provider_status),
    latency_ms: {
      provider_total: percentiles(ok.map((s) => s.latency.provider_total_ms ?? NaN)),
      first_token: percentiles(ok.map((s) => s.latency.first_token_ms ?? NaN)),
      ready: percentiles(ok.map((s) => s.latency.ready_ms ?? NaN)),
      first_token_available: ok.filter((s) => s.latency.first_token_ms !== null).length,
      note_ru: opts.isLanguageModel
        ? 'provider_total — время провайдера по данным шлюза; first_token — только при потоковой передаче; ready — от выдачи запроса до проверенного ответа (провайдер + Intent Authority), часы хоста.'
        : 'Это НЕ задержка языковой модели: ни правила, ни mock модель не запускают. ready — время CPU этой машины (провайдер + Intent Authority).',
    },
    by_category: breakdown((s) => s.category),
    by_npc: breakdown((s) => s.npc_id),
    by_register: breakdown((s) => s.register),
    speech: speechMetrics(ok, opts.npcIds),
    tokens,
    cost,
  };
}
