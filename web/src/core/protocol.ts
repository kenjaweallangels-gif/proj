// Types of the Echo core JSON protocol as the web app uses it (docs/SPEC.md §1, core/README.md «Дополнения к SPEC»).
// The shapes mirror what core/src/engine.cpp and persist.cpp actually serialize; optional members are the ones the
// core omits in some states. Shared request/result contracts live in ../contracts.ts.
import type { AdmissionDecision, GatewayRequest, GpuGate, PercentileSet, Speech, Verdict } from '../contracts.ts';

export type EventSource = 'sim' | 'player' | 'agent_accepted' | 'director' | 'fallback';

export interface CoreEvent {
  seq: number;
  /** sim time, seconds */
  t: number;
  rev: number;
  type: string;
  actor: string | null;
  source: EventSource | string;
  payload: Record<string, unknown>;
  /** Ready-made Russian line for the journal (core addition to SPEC). */
  text_ru: string;
}

export interface Reading { value: number; trend: string }

export interface ResourceSnap { id: string; name_ru: string; amount: number; reserved: number; unit: string; min_safe?: number }
export interface ZoneSnap { id: string; name_ru: string; sealed: boolean }
export interface DoorSnap { id: string; a: string; b: string; state: 'open' | 'closed' | 'sealed' | string }
export interface ItemSnap { id: string; name_ru: string; zone: string; locked_by: string | null; preserved?: boolean }
export interface SensorSnap {
  id: string; name_ru: string; zone: string; unit: string;
  reading: Reading; fault: boolean;
  /** Physical truth — present only in `state{debug:true}`. */
  truth?: Reading; fault_id?: string; distortion?: string;
}
export interface ActorSnap {
  id: string; name_ru: string; is_player: boolean; zone: string; target_zone?: string; task_id?: string; plan_id?: string;
  activity: 'idle' | 'walking' | 'working' | 'resting' | 'talking' | string;
  fatigue: number; trust_player: number; gesture: string; style: string; busy: boolean;
}
export interface TaskSnap {
  id: string; action: string; actor: string; companion?: string; target?: string; proposer?: string;
  state: 'active' | 'done' | 'cancelled' | 'failed' | string; phase?: string; progress: number; source?: string;
}
export interface Proposal {
  action: string; target_id?: string | null; companion_id?: string | null; fact_ids?: string[]; style?: string; gesture?: string;
}
export interface PlanSnap {
  plan_id: string; actor: string; task_id: string; proposal: Proposal;
  state: 'awaiting_player' | 'accepted' | 'rejected' | 'replanned' | 'expired' | string; expires_s: number;
}
export interface QueueSnap {
  task_id: string; actor: string; kind: string; priority: number; state: 'queued' | 'active' | string;
  /** Absolute host time (now_ms scale) after which the core applies its fallback. */
  deadline_ms: number;
}
export interface BiographySnap { zone: string; anchor: string; detail_id: string; label_ru: string }
export interface DirectorSnap {
  tension: number; last_event: string | null; cooldowns: Record<string, number>; calm_remaining_s?: number; fired?: string[];
}
export interface AiConfig { mode: string; effective_mode: string; gpu_enabled: boolean; calibrated: boolean; privacy_profile: string; cpu_cores?: number; cpu_threads?: number; notes_ru?: string[] }

export interface Snapshot {
  sim_time_s: number;
  revision: number;
  hash: string | null;
  resources: ResourceSnap[];
  zones: ZoneSnap[];
  doors: DoorSnap[];
  items: ItemSnap[];
  sensors: SensorSnap[];
  actors: ActorSnap[];
  tasks: TaskSnap[];
  plans: PlanSnap[];
  queue: QueueSnap[];
  director: DirectorSnap;
  biography: BiographySnap[];
  emergency_lights: boolean;
  emergency: boolean;
  gate: GpuGate & { codes?: string[] };
  ai_config: AiConfig;
  last_event_seq: number;
}

/** Admission decision as the core serializes it (SPEC Decision + `code`). */
export interface CoreDecision extends AdmissionDecision { code: string }

/** Full verdict with the core additions: `steps[i].skipped` and the fallback trace. */
export interface CoreVerdict extends Verdict {
  steps: { step: number; name: string; ok: boolean; detail: string; skipped?: boolean }[];
  fallback?: { status: string; proposal: Proposal | null; steps: { step: number; name: string; ok: boolean; detail: string; skipped?: boolean }[] };
}

export interface MemoryEntry {
  id: string; kind: 'fact' | 'opinion' | 'promise' | 'episode'; text_ru: string; source: string;
  confidence?: number; importance: number; time_s: number; tags: string[];
}
export interface KnownFact { id: string; source: string; layer?: string; time_s?: number }

export type MaybeSet = PercentileSet | 'unavailable';

export interface FrameReportSection {
  count: number; frame_interval: MaybeSet; cpu: MaybeSet; gpu: MaybeSet; frame_ready: MaybeSet;
  missed_deadline_ratio: number | null; pauses_over_33ms: number; max_pause_ms: number | null;
}
export interface FrameReport extends FrameReportSection {
  cold: FrameReportSection; budget_ms: number; pause_threshold_ms: number; source: string; note_ru: string;
}
export interface AiReport {
  requests: { queued: number; dispatched: number; replaced: number; evicted: number; results: number; by_backend: Record<string, number>; by_kind: Record<string, number> };
  latency_ms: { first_token: MaybeSet; ready: MaybeSet; provider_total: MaybeSet; queue_wait: MaybeSet; note_ru: string };
  verdicts: Record<string, number>;
  fallback: { count: number; ratio_of_requests: number; by_reason: Record<string, number> };
  invalid_intents: number;
  violations_admitted: number;
  violation_log: unknown[];
  speech: { lines: number; repeated: number; repetition_rate: number; by_kind: Record<string, number> };
  tokens: { input: number; output: number; cached_input: number; reasoning: number; measured_results: number; estimated_results: number };
  cost: { total_usd: number | null; results_with_cost: number; fictional: boolean };
  models_seen: string[];
}

// ---- command responses (fields beyond `ok`; every response may also carry `events`, collected by EchoCore)
export interface InitResponse { revision: number; summary: Record<string, number | boolean>; seed: number; data_hash: string; hash: string }
export interface TickResponse { revision: number; expired: string[]; sim_time_s: number }
export interface SayResponse {
  queued: { task_id: string; kind: string; priority: number } | null;
  immediate: Speech | null;
  admission: CoreDecision;
  say_intent?: string;
}
export interface DecideResponse { verdict: CoreVerdict; speech?: Speech | null }
export interface DispatchResponse { request: GatewayRequest | null; decision: CoreDecision }
export interface SubmitResponse { verdict: CoreVerdict; speech: Speech | null }
export interface RulesProposeResponse { task_id: string; proposal_text: string; why_ru?: string; score?: number }
export interface MemoryResponse { npc_id: string; entries: MemoryEntry[]; known_facts: KnownFact[]; trust_player?: number; relationships?: Record<string, number> }
export interface MetricsResponse { frame: FrameReport; ai: AiReport }
export interface FrameStatsResponse { gate: GpuGate & { codes?: string[] }; advice?: { cancel_gpu?: boolean } }
export interface AiModeResponse { config: AiConfig }
export interface SaveResponse { save: Record<string, unknown> }
export interface LoadResponse { revision: number; hash?: string }
export interface VersionResponse { core_version: string; prompt_version: string; intent_schema_version: string; save_format: string }
