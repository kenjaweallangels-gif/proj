// Runs one eval scene on a fresh core: setup → player request → dispatch → provider → world change while the
// provider "thinks" → submit_result → observation. Scoring is separate (score.ts) so it stays testable.

import type { GatewayRequest, GatewayResult, Speech, Verdict } from '../../web/src/contracts.ts';
import type { CoreData, CoreResponse, EchoCore, WorldIndex } from './core.ts';
import { createCore } from './core.ts';
import type { Provider } from './providers.ts';
import type { DebugOp, Scene, SetupStep } from './scenes.ts';

const TICK_S = 0.5;
const MAX_SETTLE = 32;

/** Host monotonic clock of one scene (ms). Ticks advance it with sim time; provider calls by real wall time. */
class SceneClock {
  now = 0;
}

export interface ProviderCallRecord {
  result: GatewayResult;
  wall_ms: number;
  note: string | null;
}

export interface MutationRecord {
  ops: DebugOp[];
  /** Entities whose semantic revision the mutation bumped (stale-oracle input). */
  revision_bumped: string[];
  events: string[];
}

export interface Observation {
  scene_id: string;
  /** Harness/core/provider failure: the scene could not be evaluated. */
  error: string | null;
  /** Scene inconsistent with the world at request time (an eval-set bug, not a provider outcome). */
  scene_problems: string[];
  request: GatewayRequest | null;
  request_schema_problems: string[];
  result_schema_problems: string[];
  admission_code: string | null;
  immediate: Speech | null;
  known_before: string[];
  known_after: string[];
  /** Zone of every actor/item at request time (for dependency checks). */
  zones_at_request: Record<string, string>;
  provider_call: ProviderCallRecord | null;
  mutation: MutationRecord | null;
  verdict: Verdict | null;
  speech: Speech | null;
  submit_events: string[];
  submit_ms: number | null;
  core_violations: { delta: number; log: string[] };
  background_requests: number;
  timeline_ms: { request: number; dispatch: number; submit: number } | null;
}

function emptyObservation(scene: Scene): Observation {
  return {
    scene_id: scene.id,
    error: null,
    scene_problems: [],
    request: null,
    request_schema_problems: [],
    result_schema_problems: [],
    admission_code: null,
    immediate: null,
    known_before: [],
    known_after: [],
    zones_at_request: {},
    provider_call: null,
    mutation: null,
    verdict: null,
    speech: null,
    submit_events: [],
    submit_ms: null,
    core_violations: { delta: 0, log: [] },
    background_requests: 0,
    timeline_ms: null,
  };
}

export interface RunnerContext {
  data: CoreData;
  world: WorldIndex;
  provider: Provider;
  /** Lowers GatewayRequest.deadline_ms sent to the provider (the core keeps its own deadline from profiles.json). */
  providerDeadlineMs?: number | null;
  validateRequest?: (req: unknown) => string[];
  validateResult?: (res: unknown) => string[];
}

function plansFrom(r: CoreResponse): string[] {
  const out: string[] = [];
  for (const e of (r.events ?? []) as { type: string; payload?: { plan_id?: string } }[]) {
    if (e.type === 'plan_created' && e.payload?.plan_id) out.push(e.payload.plan_id);
  }
  return out;
}

/** Setup macros and background NPC life on one core. */
class SceneDriver {
  readonly core: EchoCore;
  readonly clock = new SceneClock();
  background = 0;

  constructor(core: EchoCore) {
    this.core = core;
  }

  #decide(plans: string[], decision: 'leave' | 'accept' | 'reject'): void {
    if (decision === 'leave') return;
    for (const plan_id of plans) {
      // A plan may have expired or been replanned meanwhile: then the core says invalid_state, which is fine.
      this.core.call({ cmd: 'player_decide', plan_id, decision, now_ms: this.clock.now });
    }
  }

  /** Answers every queued request with the ordinary game AI (background NPC life during setup). */
  settle(plans: 'leave' | 'accept' | 'reject'): void {
    for (let i = 0; i < MAX_SETTLE; i++) {
      const d = this.core.must({ cmd: 'dispatch', now_ms: this.clock.now, backend: 'rules' });
      this.#decide(plansFrom(d), plans);
      if (!d.request) return;
      this.answerWithRules(d.request.task_id, plans);
    }
    throw new Error('очередь ИИ не опустела за 32 шага');
  }

  /** A request answered by the ordinary game AI (background NPC life, not the provider under evaluation). */
  answerWithRules(taskId: string, plans: 'leave' | 'accept' | 'reject'): void {
    this.background++;
    const p = this.core.must({ cmd: 'rules_propose', task_id: taskId });
    const r = this.core.must({
      cmd: 'submit_result',
      now_ms: this.clock.now,
      result: {
        task_id: taskId,
        status: 'ok',
        proposal_text: p.proposal_text,
        usage: { input_tokens: 0, output_tokens: 0, measured: false },
        latency_ms: { total: 0, first_token: null },
        provider: 'rules',
        model: 'utility-policy',
        finish_reason: 'stop',
        attempts: 1,
      },
    });
    this.#decide(plansFrom(r), plans);
  }

  setup(step: SetupStep): void {
    switch (step.cmd) {
      case 'advance': {
        const background = step.background ?? 'expire';
        const plans = step.plans ?? 'leave';
        const n = Math.round(step.seconds / TICK_S);
        for (let i = 0; i < n; i++) {
          this.clock.now += TICK_S * 1000;
          const r = this.core.must({ cmd: 'tick', dt_s: TICK_S, now_ms: this.clock.now });
          this.#decide(plansFrom(r), plans);
          if (background === 'rules') this.settle(plans);
        }
        return;
      }
      case 'settle':
        this.settle(step.plans ?? 'leave');
        return;
      case 'decide_plans': {
        const st = this.core.must({ cmd: 'state', hash: false, now_ms: this.clock.now });
        const ids = (st.plans as { plan_id: string; actor: string; state: string }[])
          .filter((p) => p.state === 'awaiting_player' && (step.actor === undefined || p.actor === step.actor))
          .map((p) => p.plan_id);
        this.#decide(ids, step.decision);
        return;
      }
      case 'debug_patch':
        this.core.must({ cmd: 'debug_patch', patch: step.patch, now_ms: this.clock.now });
        return;
      case 'player_say':
        this.core.must({ cmd: 'player_say', npc_id: step.npc_id, text: step.text, now_ms: this.clock.now });
        return;
      case 'player_order':
        this.core.must({ cmd: 'player_order', npc_id: step.npc_id, action: step.action, target_id: step.target_id, companion_id: step.companion_id, now_ms: this.clock.now });
        return;
      case 'set_ai_mode':
        this.core.must({ ...step });
        return;
    }
  }
}

function knownFacts(core: EchoCore, npc: string): string[] {
  const m = core.must({ cmd: 'memory', npc_id: npc });
  return (m.known_facts as { id: string }[]).map((f) => f.id);
}

function zonesOf(state: CoreResponse): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of (state.actors ?? []) as { id: string; zone: string }[]) out[a.id] = a.zone;
  for (const i of (state.items ?? []) as { id: string; zone: string }[]) out[i.id] = i.zone;
  return out;
}

/** Entities whose revision a debug_patch bumps (core/src/engine.cpp cmd_debug_patch) plus actors its events touched. */
export function revisionBumped(ops: DebugOp[], data: CoreData, events: { type: string; actor?: string | null; payload?: Record<string, unknown> }[]): string[] {
  const out = new Set<string>();
  for (const op of ops) {
    switch (op.op) {
      case 'set_actor_busy':
      case 'move_actor':
        out.add(op.actor);
        break;
      case 'set_resource':
      case 'set_sensor_reading':
        out.add(op.id);
        break;
      case 'set_door': {
        out.add(op.id);
        const door = (data.world.doors as { id: string; a: string; b: string }[]).find((d) => d.id === op.id);
        if (door) {
          out.add(door.a);
          out.add(door.b);
        }
        break;
      }
      case 'bump_revision':
        if (op.entity) out.add(op.entity);
        break;
      case 'set_fatigue': // no revision bump in the core: validity (step 4) still re-checks fatigue
      case 'emergency':
        break;
    }
  }
  for (const e of events) {
    if (e.type === 'task_started' || e.type === 'plan_created') {
      if (e.actor) out.add(e.actor);
      const comp = e.payload?.companion;
      if (typeof comp === 'string' && comp) out.add(comp);
    }
  }
  return [...out].sort();
}

export async function runScene(scene: Scene, ctx: RunnerContext): Promise<Observation> {
  const obs = emptyObservation(scene);
  let core: EchoCore | null = null;
  try {
    core = await createCore();
    const init = core.call({ cmd: 'init', data: ctx.data });
    if (!init.ok) throw new Error(`init: ${init.error?.code}: ${init.error?.message}`);
    const drv = new SceneDriver(core);
    const info = ctx.provider.info;
    if (info.privacy_profile !== 'offline') {
      core.must({ cmd: 'set_ai_mode', mode: 'smooth', gpu_enabled: false, calibrated: false, privacy_profile: info.privacy_profile });
    }
    for (const step of scene.setup) drv.setup(step);
    const violationsBefore = Number(core.must({ cmd: 'metrics' }).ai.violations_admitted);

    // --- the request under evaluation
    const tRequest = drv.clock.now;
    let targetTask: string | null = null;
    if (scene.request.type === 'say' || scene.request.type === 'order') {
      const r =
        scene.request.type === 'say'
          ? core.must({ cmd: 'player_say', npc_id: scene.npc_id, text: scene.player_utterance, now_ms: tRequest })
          : core.must({
              cmd: 'player_order',
              npc_id: scene.npc_id,
              action: scene.request.action,
              ...(scene.request.target_id ? { target_id: scene.request.target_id } : {}),
              ...(scene.request.companion_id ? { companion_id: scene.request.companion_id } : {}),
              now_ms: tRequest,
            });
      obs.admission_code = r.admission?.code ?? null;
      obs.immediate = (r.immediate as Speech | null) ?? null;
      targetTask = (r.queued as { task_id: string } | null)?.task_id ?? null;
      if (!targetTask) throw new Error(`запрос не поставлен в очередь: ${r.admission?.code} — ${r.admission?.reason}`);
    } else {
      const st = core.must({ cmd: 'state', hash: false, now_ms: tRequest });
      const item = (st.queue as { task_id: string; actor: string }[]).find((q) => q.actor === scene.npc_id);
      if (!item) throw new Error(`после setup у ${scene.npc_id} нет запроса-инициативы в очереди`);
      targetTask = item.task_id;
      obs.admission_code = 'initiative';
    }

    let request: GatewayRequest | null = null;
    for (let i = 0; i < MAX_SETTLE && !request; i++) {
      const d = core.must({ cmd: 'dispatch', now_ms: drv.clock.now, backend: info.core_backend });
      if (!d.request) throw new Error(`dispatch(${info.core_backend}) не выдал запрос: ${d.decision?.code} — ${d.decision?.reason}`);
      if (d.request.task_id === targetTask) request = d.request as GatewayRequest;
      else drv.answerWithRules(d.request.task_id, 'leave');
    }
    if (!request) throw new Error(`запрос ${targetTask} так и не выдан`);
    obs.request = request;
    obs.background_requests = drv.background;
    obs.request_schema_problems = ctx.validateRequest ? ctx.validateRequest(request) : [];
    const tDispatch = drv.clock.now;

    obs.known_before = knownFacts(core, scene.npc_id);
    obs.zones_at_request = zonesOf(core.must({ cmd: 'state', hash: false, now_ms: tDispatch }));
    for (const f of scene.expectations.forbidden_fact_ids) {
      if (obs.known_before.includes(f)) obs.scene_problems.push(`запрещённый факт ${f} известен ${scene.npc_id} на момент запроса`);
    }
    for (const f of scene.expectations.expected_fact_ids_any_of ?? []) {
      if (!obs.known_before.includes(f)) obs.scene_problems.push(`ожидаемый факт ${f} неизвестен ${scene.npc_id} на момент запроса`);
    }
    const offered = new Set(request.allowed_actions.map((a) => a.id));
    if (!scene.expectations.acceptable_actions.some((a) => offered.has(a))) {
      obs.scene_problems.push(`ни одно допустимое действие (${scene.expectations.acceptable_actions.join(', ')}) не предложено ядром: ${[...offered].join(', ')}`);
    }

    // --- provider
    const sent = ctx.providerDeadlineMs != null ? { ...request, deadline_ms: Math.min(request.deadline_ms, ctx.providerDeadlineMs) } : request;
    const call = await ctx.provider.propose(core, sent);
    obs.provider_call = { result: call.result, wall_ms: call.wallMs, note: call.note ?? null };
    obs.result_schema_problems = ctx.validateResult ? ctx.validateResult(call.result) : [];
    drv.clock.now = tDispatch + Math.max(1, Math.ceil(call.wallMs));

    // --- the world changes while the provider was answering
    if (scene.mutate_during_response.length) {
      const r = core.must({ cmd: 'debug_patch', patch: scene.mutate_during_response, now_ms: drv.clock.now });
      const events = (r.events ?? []) as { type: string; actor?: string | null; payload?: Record<string, unknown> }[];
      obs.mutation = {
        ops: scene.mutate_during_response,
        revision_bumped: revisionBumped(scene.mutate_during_response, ctx.data, events),
        events: events.map((e) => e.type),
      };
    }

    // --- authority
    const t0 = performance.now();
    const sub = core.must({ cmd: 'submit_result', result: call.result, now_ms: drv.clock.now });
    obs.submit_ms = performance.now() - t0;
    obs.verdict = sub.verdict as Verdict;
    obs.speech = (sub.speech as Speech | null) ?? null;
    obs.submit_events = ((sub.events ?? []) as { type: string }[]).map((e) => e.type);
    obs.known_after = knownFacts(core, scene.npc_id);
    const metrics = core.must({ cmd: 'metrics' });
    const after = Number(metrics.ai.violations_admitted);
    obs.core_violations = { delta: after - violationsBefore, log: (metrics.ai.violation_log as string[]).slice(-5) };
    obs.timeline_ms = { request: tRequest, dispatch: tDispatch, submit: drv.clock.now };
  } catch (e) {
    obs.error = (e as Error).message;
  } finally {
    core?.destroy();
  }
  return obs;
}
