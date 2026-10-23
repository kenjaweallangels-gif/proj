// Agent host: drives the Echo core from the page (docs/SPEC.md §1 «типичный цикл хоста», §3, Документ §8–§12).
//   tick at ~10 Hz scaled by sim speed → dispatch queued requests → selected provider (or the ordinary game AI)
//   → submit_result with real host time → speech, plans, verdicts; frame samples → frame_stats every ~0.5 s.
// The host never decides game validity: it only routes requests and shows what the core's Intent Authority decided.
import type { FrameSample, GatewayResult, Speech, WorldView } from '../contracts.ts';
import { EchoCore, EchoCoreError } from '../core/echo_core.ts';
import { world } from '../core/data.ts';
import type {
  CoreDecision, CoreEvent, CoreVerdict, DecideResponse, DispatchResponse, FrameStatsResponse, MemoryResponse,
  MetricsResponse, QueueSnap, SaveResponse, SayResponse, Snapshot, SubmitResponse,
} from '../core/protocol.ts';
import { ClaudeProvider } from './providers/claude.ts';
import { GatewayProvider } from './providers/gateway.ts';
import { MockProvider, MOCK_SCENARIOS, type MockScenario } from './providers/mock.ts';
import { RulesProvider } from './providers/rules.ts';
import {
  ABORT_CANCEL, ABORT_DEADLINE, makeResult,
  type Backend, type PrivacyProfile, type Provider, type ProviderId, type QueueCandidate,
} from './providers/types.ts';
import { WebLlmProvider } from './providers/webllm.ts';
import { buildWorldView, CrewKinematics } from './world_view.ts';

export type SimSpeed = 1 | 4;
export type AiMode = 'smooth' | 'live' | 'extended';

const TICK_MS = 100;
const FRAME_FLUSH_MS = 500;
const COLD_WINDOW_MS = 3000;
const SPEAKING_MS = 4500;
/** How long an NPC initiative waits for the player's «Спросить Claude» before the ordinary game AI answers it. */
const CLAUDE_HOLD_MS = 1500;
const MAX_EVENTS = 3000;
const MAX_CHAT = 200;
const MAX_VERDICTS = 300;
const SAVE_KEY = 'zero-echo.save.v1';
const PLAYER_KINDS = new Set(['direct_reply', 'order_response']);
const SOFT_DENY = new Set(['busy', 'idle']);

export interface AnswerInfo {
  taskId: string;
  provider: string;
  model: string;
  providerStatus: string;
  verdictStatus: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  latencyMs: number | null;
  note?: string;
}

export interface ChatEntry {
  seq: number;
  t: number;
  npc: string;
  from: 'player' | 'npc' | 'system';
  text: string;
  kind?: Speech['kind'] | 'order' | 'decision';
  style?: string;
  gesture?: string;
  source?: string;
  answer?: AnswerInfo;
}

export interface VerdictRecord {
  key: string;
  taskId: string;
  actor: string;
  simT: number;
  origin: 'submit' | 'decide' | 'core';
  status: string;
  action: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  verdict?: CoreVerdict;
  provider?: string;
  model?: string;
  providerStatus?: string;
  rawText?: string | null;
  latency?: GatewayResult['latency_ms'];
  error?: GatewayResult['error'];
  backend?: string;
  note?: string;
}

export interface InFlight {
  taskId: string;
  actor: string;
  kind: string;
  provider: ProviderId;
  backend: Backend;
  startedReal: number;
  deadlineReal: number;
  controller: AbortController;
}

export interface DispatchNote { at: number; simT: number; text: string; code: string; allowed: boolean; backend: string }

export interface SuiteRow {
  scenario: MockScenario;
  label: string;
  taskId: string | null;
  status: string;
  reasons: string[];
  fallbackUsed: boolean;
  fallbackStatus: string | null;
  providerStatus: string;
}

type Listener = () => void;

export interface HostOptions { dev: boolean }

export class AgentHost {
  readonly core: EchoCore;
  readonly dev: boolean;
  readonly providers: Record<ProviderId, Provider>;
  readonly rules: RulesProvider;
  readonly claude: ClaudeProvider;
  readonly gateway: GatewayProvider;
  readonly webllm: WebLlmProvider;
  readonly mock: MockProvider;
  readonly kin = new CrewKinematics();

  snapshot!: Snapshot;
  providerId: ProviderId = 'rules';
  privacy: PrivacyProfile = 'offline';
  aiMode: AiMode = 'smooth';
  /** Host multiplier for model deadlines (1 = 2.5 s direct reply, Документ §11); larger values only for remote APIs. */
  deadlineScale = 1;
  speed: SimSpeed = 1;
  /** Physical-truth debug layer in the world tab (never shown to NPCs). */
  debugTruth = false;
  /** Freeze the crew into the control-route fixture while the route bench runs. */
  routeFixture = false;

  readonly events: CoreEvent[] = [];
  readonly chats = new Map<string, ChatEntry[]>();
  readonly verdicts: VerdictRecord[] = [];
  readonly inflight = new Map<string, InFlight>();
  readonly dispatchLog: DispatchNote[] = [];
  lastDecision: CoreDecision | null = null;
  lastAdmission: CoreDecision | null = null;
  lastSubtitle: { npc: string; text: string; at: number; kind?: string } | null = null;
  suite: { running: boolean; rows: SuiteRow[] } = { running: false, rows: [] };
  lastError: string | null = null;

  private readonly playerCaused = new Set<string>();
  private readonly claudeAsked = new Set<string>();
  private readonly firstSeen = new Map<string, number>();
  private readonly speakingUntil = new Map<string, number>();
  /** Gesture of the latest validated line per NPC (shown while the NPC is speaking). */
  private readonly speechGesture = new Map<string, string>();
  private readonly listeners: Listener[] = [];
  private started = false;
  private userPaused = false;
  private hiddenPaused = false;
  private timer = 0;
  private lastReal = 0;
  // Host monotonic clock (now_ms for the core): advances only while the simulation runs.
  private clockBase = 0;
  private clockRunningSince = -1;
  private frameBuffer: FrameSample[] = [];
  private readonly recentFrames: FrameSample[] = [];
  private lastFrameFlush = 0;
  private coldUntil = 0;
  private annotation: AnswerInfo | null = null;
  private inPlayerAction = false;
  private recordCoreVerdicts = true;

  private constructor(core: EchoCore, opts: HostOptions) {
    this.core = core;
    this.dev = opts.dev;
    this.rules = new RulesProvider();
    this.claude = new ClaudeProvider();
    this.gateway = new GatewayProvider();
    this.webllm = new WebLlmProvider();
    this.mock = new MockProvider(world.facts);
    this.providers = { rules: this.rules, claude: this.claude, gateway: this.gateway, webllm: this.webllm, mock: this.mock };
    for (const p of Object.values(this.providers)) p.onState?.(() => this.notify());
    core.onEvents((evs) => this.absorb(evs));
  }

  static async create(opts: HostOptions): Promise<AgentHost> {
    const core = await EchoCore.create();
    const host = new AgentHost(core, opts);
    core.init();
    host.applyAiMode();
    host.refresh();
    return host;
  }

  // ------------------------------------------------------------------ clock & loop
  nowMs(): number {
    const running = this.clockRunningSince >= 0 ? performance.now() - this.clockRunningSince : 0;
    return Math.round(this.clockBase + running);
  }

  get running(): boolean { return this.started && !this.userPaused && !this.hiddenPaused; }
  get paused(): boolean { return this.userPaused; }
  get isStarted(): boolean { return this.started; }

  /** Starts the shift (called once the scene is ready, so the player does not miss the first events). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.updateClock();
    this.lastReal = performance.now();
    this.timer = window.setInterval(() => this.step(), TICK_MS);
    this.notify();
  }

  setPaused(paused: boolean): void {
    this.userPaused = paused;
    this.updateClock();
    this.notify();
  }

  /** Tab hidden: pause the simulation and keep a save (Документ §7 «Вкладка скрыта → пауза и сохранение»). */
  setHidden(hidden: boolean): string | null {
    this.hiddenPaused = hidden;
    this.updateClock();
    const msg = hidden ? this.saveToStorage() : null;
    this.notify();
    return msg;
  }

  setSpeed(s: SimSpeed): void {
    this.speed = s;
    this.notify();
  }

  private updateClock(): void {
    const shouldRun = this.running;
    if (shouldRun && this.clockRunningSince < 0) {
      this.clockRunningSince = performance.now();
      this.lastReal = performance.now();
    } else if (!shouldRun && this.clockRunningSince >= 0) {
      this.clockBase += performance.now() - this.clockRunningSince;
      this.clockRunningSince = -1;
    }
  }

  private step(): void {
    if (!this.running) { this.flushFrames(false); return; }
    const real = performance.now();
    const dtReal = Math.min(250, Math.max(0, real - this.lastReal));
    this.lastReal = real;
    const dt = Math.min(1, Math.round(dtReal * this.speed) / 1000);
    if (dt <= 0) return;
    try {
      this.recordCoreVerdicts = true;
      this.core.call('tick', { dt_s: dt, now_ms: this.nowMs() });
    } catch (e) {
      this.fail(e);
      return;
    }
    this.refresh();
    this.kin.update(this.snapshot, dt);
    this.pump();
    this.flushFrames(false);
    this.notify();
  }

  refresh(): void {
    this.snapshot = this.core.call<Snapshot>('state', { hash: false, debug: this.debugTruth });
    const now = performance.now();
    for (const q of this.snapshot.queue) if (!this.firstSeen.has(q.task_id)) this.firstSeen.set(q.task_id, now);
  }

  // ------------------------------------------------------------------ providers & AI mode
  get provider(): Provider { return this.providers[this.providerId]; }

  setProvider(id: ProviderId): void {
    if (id === 'mock' && !this.dev) id = 'rules';
    this.providerId = id;
    this.provider.activate?.(this.privacy);
    this.applyAiMode();
    this.notify();
  }

  setPrivacy(p: PrivacyProfile): void {
    this.privacy = p;
    this.provider.activate?.(p);
    this.applyAiMode();
    this.notify();
  }

  setAiMode(m: AiMode): void {
    this.aiMode = m;
    this.applyAiMode();
    this.notify();
  }

  setDeadlineScale(s: number): void {
    this.deadlineScale = Math.min(8, Math.max(1, s));
    this.applyAiMode();
    this.notify();
  }

  applyAiMode(): void {
    try {
      const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : undefined;
      this.core.call('set_ai_mode', {
        mode: this.aiMode,
        gpu_enabled: this.providerId === 'webllm' && this.webllm.ready,
        calibrated: false, // no joint render+model calibration exists in this prototype (Документ §11)
        privacy_profile: this.privacy,
        deadline_scale: this.deadlineScale,
        ...(cores ? { cpu_cores: cores } : {}),
      });
      if (this.snapshot) this.refresh();
    } catch (e) {
      this.fail(e);
    }
  }

  /** The player explicitly sends a queued NPC initiative to Claude. */
  askClaude(taskId: string): void {
    this.claudeAsked.add(taskId);
    this.pump();
    this.notify();
  }

  cancel(taskId: string): void {
    const f = this.inflight.get(taskId);
    if (f) { f.controller.abort(ABORT_CANCEL); return; }
    try {
      this.recordCoreVerdicts = true;
      this.core.call('cancel', { task_id: taskId, now_ms: this.nowMs() });
    } catch (e) { this.fail(e); }
    this.refresh();
    this.notify();
  }

  private candidateOf(q: QueueSnap): QueueCandidate {
    return {
      task_id: q.task_id, actor: q.actor, kind: q.kind,
      playerCaused: this.playerCaused.has(q.task_id) || PLAYER_KINDS.has(q.kind) || this.claudeAsked.has(q.task_id),
    };
  }

  /** The item the core will hand out next: highest priority, oldest first (queue order is creation order). */
  private topOfQueue(): QueueSnap | null {
    let best: QueueSnap | null = null;
    for (const q of this.snapshot.queue) if (!best || q.priority > best.priority) best = q;
    return best;
  }

  /** Initiative waiting for the player's «Спросить Claude» (shown in the queue tab). */
  heldForClaude(taskId: string): number {
    if (this.providerId !== 'claude' || this.claude.state().state !== 'ready') return 0;
    const seen = this.firstSeen.get(taskId);
    if (seen === undefined) return 0;
    return Math.max(0, CLAUDE_HOLD_MS - (performance.now() - seen));
  }

  pump(): void {
    for (let guard = 0; guard < 8; guard++) {
      const top = this.topOfQueue();
      if (!top) break;
      const cand = this.candidateOf(top);
      const provider = this.provider;
      const useProvider = provider.id !== 'rules' && provider.accepts(cand);
      if (!useProvider && provider.id === 'claude' && !cand.playerCaused && this.heldForClaude(top.task_id) > 0) break;
      const backend: Backend = useProvider ? provider.backend(this.privacy) : 'rules';
      let d: DispatchResponse;
      try {
        d = this.core.call<DispatchResponse>('dispatch', { now_ms: this.nowMs(), backend });
      } catch (e) { this.fail(e); break; }
      this.noteDecision(d.decision, backend);
      if (!d.request) {
        if (backend !== 'rules' && !SOFT_DENY.has(d.decision.code)) {
          // The selected executor is not admitted (privacy profile, GPU gate, CPU pool): the ordinary game AI answers
          // right away instead of letting the player wait for the deadline. Visible in the queue tab and the chat.
          const rd = this.core.call<DispatchResponse>('dispatch', { now_ms: this.nowMs(), backend: 'rules' });
          this.noteDecision(rd.decision, 'rules');
          if (rd.request) this.answerWithRules(rd.request.task_id, rd.request.actor_id, `${provider.label} не допущен: ${d.decision.reason}`);
          this.refresh();
          continue;
        }
        break;
      }
      if (backend === 'rules') {
        const note = provider.id !== 'rules'
          ? (provider.id === 'claude' && !cand.playerCaused ? 'инициатива NPC: Claude не вызывается без действия игрока' : `${provider.label}: ${provider.state().message}`)
          : undefined;
        this.answerWithRules(d.request.task_id, d.request.actor_id, note);
      } else {
        void this.runProvider(provider, d.request, backend);
      }
      this.refresh();
    }
  }

  private noteDecision(d: CoreDecision, backend: string): void {
    this.lastDecision = d;
    if (d.code === 'idle') return;
    const last = this.dispatchLog[0];
    if (last && last.code === d.code && last.text === d.reason) { last.at = performance.now(); return; }
    this.dispatchLog.unshift({ at: performance.now(), simT: this.snapshot?.sim_time_s ?? 0, text: d.reason, code: d.code, allowed: d.allowed, backend });
    if (this.dispatchLog.length > 60) this.dispatchLog.length = 60;
  }

  private answerWithRules(taskId: string, actor: string, note?: string): void {
    const result = this.rules.propose({ task_id: taskId }, { core: this.core });
    this.submit(result, actor, 'rules', note);
  }

  private async runProvider(provider: Provider, req: NonNullable<DispatchResponse['request']>, backend: Backend): Promise<void> {
    const controller = new AbortController();
    const startedReal = performance.now();
    const budget = Math.max(0, req.deadline_ms);
    const timer = window.setTimeout(() => controller.abort(ABORT_DEADLINE), budget);
    this.inflight.set(req.task_id, {
      taskId: req.task_id, actor: req.actor_id, kind: req.kind ?? 'direct_reply', provider: provider.id, backend,
      startedReal, deadlineReal: startedReal + budget, controller,
    });
    this.notify();
    let result: GatewayResult;
    try {
      result = await provider.generate(req, { signal: controller.signal, core: this.core, nowMs: () => this.nowMs() });
      if (result.task_id !== req.task_id) result = { ...result, task_id: req.task_id };
    } catch (e) {
      result = makeResult(req, 'unavailable', { provider: provider.id, model: 'unknown', error: { code: 'provider_error', message: String((e as Error)?.message ?? e) } });
    } finally {
      window.clearTimeout(timer);
      this.inflight.delete(req.task_id);
    }
    const queueWait = this.firstSeen.has(req.task_id) ? Math.round(startedReal - this.firstSeen.get(req.task_id)!) : undefined;
    if (queueWait !== undefined) result.latency_ms = { ...result.latency_ms, queue: queueWait };
    this.submit(result, req.actor_id, backend);
    this.pump();
    this.notify();
  }

  private submit(result: GatewayResult, actor: string, backend: string, note?: string): void {
    const info: AnswerInfo = {
      taskId: result.task_id, provider: result.provider, model: result.model, providerStatus: result.status,
      verdictStatus: '…', fallbackUsed: false, fallbackReason: null, latencyMs: result.latency_ms.total ?? null, note,
    };
    this.annotation = info;
    this.recordCoreVerdicts = false;
    let r: SubmitResponse | null = null;
    try {
      r = this.core.call<SubmitResponse>('submit_result', { result, now_ms: this.nowMs() });
    } catch (e) {
      this.fail(e);
    } finally {
      this.annotation = null;
      this.recordCoreVerdicts = true;
    }
    if (!r) return;
    const v = r.verdict;
    info.verdictStatus = v.status;
    info.fallbackUsed = v.fallback_used;
    info.fallbackReason = v.fallback_reason;
    if (!r.speech && (v.status === 'expired' || v.status === 'duplicate')) info.note = 'поздний или повторный ответ отброшен — fallback уже применён';
    this.pushVerdict({
      key: `${v.task_id}:submit:${this.verdicts.length}`, taskId: v.task_id, actor: v.actor || actor, simT: this.snapshot.sim_time_s,
      origin: 'submit', status: v.status, action: (v.proposal?.action as string) ?? null, fallbackUsed: v.fallback_used,
      fallbackReason: v.fallback_reason, verdict: v, provider: result.provider, model: result.model, providerStatus: result.status,
      rawText: result.proposal_text, latency: result.latency_ms, error: result.error ?? null, backend, note: info.note ?? note,
    });
    this.refresh();
  }

  private pushVerdict(v: VerdictRecord): void {
    this.verdicts.unshift(v);
    if (this.verdicts.length > MAX_VERDICTS) this.verdicts.length = MAX_VERDICTS;
  }

  // ------------------------------------------------------------------ player actions
  private playerAction<T>(cmd: string, args: Record<string, unknown>): T | null {
    this.inPlayerAction = true;
    this.recordCoreVerdicts = true;
    try {
      return this.core.call<T>(cmd, { ...args, now_ms: this.nowMs() });
    } catch (e) {
      this.fail(e);
      return null;
    } finally {
      this.inPlayerAction = false;
    }
  }

  say(npc: string, text: string): SayResponse | null {
    const r = this.playerAction<SayResponse>('player_say', { npc_id: npc, text });
    if (r) {
      this.lastAdmission = r.admission;
      if (r.queued) this.playerCaused.add(r.queued.task_id);
    }
    this.refresh();
    this.pump();
    this.notify();
    return r;
  }

  order(npc: string, action: string, targetId: string | null, companionId: string | null): SayResponse | null {
    const args: Record<string, unknown> = { npc_id: npc, action };
    if (targetId) args.target_id = targetId;
    if (companionId) args.companion_id = companionId;
    const r = this.playerAction<SayResponse>('player_order', args);
    if (r) {
      this.lastAdmission = r.admission;
      if (r.queued) this.playerCaused.add(r.queued.task_id);
    }
    this.refresh();
    this.pump();
    this.notify();
    return r;
  }

  decide(planId: string, decision: 'accept' | 'reject' | 'reassign' | 'ask_evidence', companionId?: string): DecideResponse | null {
    const plan = this.snapshot.plans.find((p) => p.plan_id === planId);
    const info: AnswerInfo = {
      taskId: plan?.task_id ?? planId, provider: 'игрок', model: `решение: ${decision}`, providerStatus: 'ok',
      verdictStatus: '…', fallbackUsed: false, fallbackReason: null, latencyMs: null,
    };
    this.annotation = info;
    this.recordCoreVerdicts = false;
    const args: Record<string, unknown> = { plan_id: planId, decision };
    if (companionId) args.companion_id = companionId;
    let r: DecideResponse | null = null;
    this.inPlayerAction = true;
    try {
      r = this.core.call<DecideResponse>('player_decide', { ...args, now_ms: this.nowMs() });
    } catch (e) {
      this.fail(e);
    } finally {
      this.inPlayerAction = false;
      this.annotation = null;
      this.recordCoreVerdicts = true;
    }
    if (r) {
      const v = r.verdict;
      info.verdictStatus = v.status;
      info.fallbackUsed = v.fallback_used;
      info.fallbackReason = v.fallback_reason;
      this.pushVerdict({
        key: `${v.task_id}:decide:${this.verdicts.length}`, taskId: v.task_id, actor: v.actor, simT: this.snapshot.sim_time_s,
        origin: 'decide', status: v.status, action: (v.proposal?.action as string) ?? null, fallbackUsed: v.fallback_used,
        fallbackReason: v.fallback_reason, verdict: v, provider: 'игрок', model: `решение: ${decision}`, providerStatus: 'ok',
        rawText: null, note: `решение Алекса по плану ${planId}: ${decision}`,
      });
    }
    this.refresh();
    this.pump();
    this.notify();
    return r;
  }

  // ------------------------------------------------------------------ events → journal, chats, verdict summaries
  private absorb(evs: CoreEvent[]): void {
    const fallbackReasonByActor = new Map<string, string>();
    for (const e of evs) {
      if (e.type === 'verdict' && e.actor && e.payload.fallback_used) fallbackReasonByActor.set(e.actor, String(e.payload.reason ?? 'fallback'));
    }
    const nowReal = performance.now();
    for (const e of evs) {
      this.events.push(e);
      switch (e.type) {
        case 'speech': {
          const p = e.payload as unknown as Speech;
          const npc = e.actor ?? p.actor;
          // Shared object: the host fills in the verdict status once the command returns.
          let answer = this.annotation ?? undefined;
          if (answer && p.kind === 'fallback') answer.fallbackUsed = true;
          if (!answer && e.source === 'fallback') {
            answer = {
              taskId: '', provider: 'rules', model: 'utility-policy', providerStatus: '—', verdictStatus: 'fallback',
              fallbackUsed: true, fallbackReason: fallbackReasonByActor.get(npc) ?? null, latencyMs: null,
            };
          }
          this.addChat(npc, {
            seq: e.seq, t: e.t, npc, from: 'npc', text: p.text, kind: p.kind, style: p.style, gesture: p.gesture,
            source: String(e.source), answer,
          });
          this.speakingUntil.set(npc, nowReal + SPEAKING_MS);
          if (p.gesture) this.speechGesture.set(npc, p.gesture);
          this.lastSubtitle = { npc, text: p.text, at: nowReal, kind: p.kind };
          break;
        }
        case 'player_said': {
          const npc = String(e.payload.npc ?? '');
          if (npc) this.addChat(npc, { seq: e.seq, t: e.t, npc, from: 'player', text: String(e.payload.text ?? ''), source: 'player' });
          break;
        }
        case 'player_ordered': {
          const npc = String(e.payload.npc ?? '');
          if (npc) this.addChat(npc, { seq: e.seq, t: e.t, npc, from: 'player', text: e.text_ru, kind: 'order', source: 'player' });
          break;
        }
        case 'plan_decided': {
          if (e.actor) this.addChat(e.actor, { seq: e.seq, t: e.t, npc: e.actor, from: 'system', text: e.text_ru, kind: 'decision', source: String(e.source) });
          break;
        }
        case 'request_queued': {
          const id = String(e.payload.task_id ?? '');
          if (id && this.inPlayerAction) this.playerCaused.add(id);
          if (id && !this.firstSeen.has(id)) this.firstSeen.set(id, nowReal);
          break;
        }
        case 'verdict': {
          if (!this.recordCoreVerdicts) break;
          const p = e.payload;
          this.pushVerdict({
            key: `${String(p.task_id)}:core:${e.seq}`, taskId: String(p.task_id ?? ''), actor: e.actor ?? '', simT: e.t, origin: 'core',
            status: String(p.status ?? ''), action: (p.action as string) ?? null, fallbackUsed: Boolean(p.fallback_used),
            fallbackReason: (p.reason as string) ?? null, provider: 'rules', model: 'utility-policy',
            note: 'fallback ядра без участия исполнителя (срок в очереди, отмена, вытеснение или авария)',
          });
          break;
        }
        default:
          break;
      }
    }
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  private addChat(npc: string, entry: ChatEntry): void {
    let list = this.chats.get(npc);
    if (!list) { list = []; this.chats.set(npc, list); }
    list.push(entry);
    if (list.length > MAX_CHAT) list.splice(0, list.length - MAX_CHAT);
  }

  // ------------------------------------------------------------------ frames → core frame stats / GPU gate
  addFrameSample(s: FrameSample): void {
    this.recentFrames.push(s);
    if (this.recentFrames.length > 600) this.recentFrames.splice(0, this.recentFrames.length - 600);
    if (s.intervalMs > 0) this.frameBuffer.push(s);
  }

  /** Marks the next seconds as cold (first frames after ready, profile switch, device recovery). */
  markCold(): void {
    this.coldUntil = performance.now() + COLD_WINDOW_MS;
  }

  get frames(): readonly FrameSample[] { return this.recentFrames; }

  private flushFrames(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastFrameFlush < FRAME_FLUSH_MS) return;
    this.lastFrameFlush = now;
    if (!this.frameBuffer.length) return;
    const samples = this.frameBuffer.map((s) => ({
      interval_ms: Math.round(s.intervalMs * 1000) / 1000,
      cpu_ms: Math.round(s.cpuMs * 1000) / 1000,
      gpu_ms: s.gpuMs === null ? null : Math.round(s.gpuMs * 1000) / 1000,
    }));
    this.frameBuffer = [];
    try {
      const r = this.core.call<FrameStatsResponse>('frame_stats', {
        samples, vram_free_gib: null, now_ms: this.nowMs(), phase: now < this.coldUntil ? 'cold' : 'warm',
      });
      if (r.advice?.cancel_gpu) {
        for (const f of this.inflight.values()) if (f.backend === 'gpu') f.controller.abort(ABORT_CANCEL);
      }
    } catch (e) {
      this.fail(e);
    }
  }

  // ------------------------------------------------------------------ queries for the UI
  worldView(): WorldView {
    const now = performance.now();
    const speaking = new Set<string>();
    const gestures = new Map<string, string>();
    for (const [id, until] of this.speakingUntil) {
      if (until <= now) continue;
      speaking.add(id);
      const g = this.speechGesture.get(id);
      if (g) gestures.set(id, g);
    }
    return buildWorldView(this.snapshot, this.kin, { speaking, gestures, routeFixture: this.routeFixture });
  }

  memory(npc: string): MemoryResponse | null {
    try { return this.core.call<MemoryResponse>('memory', { npc_id: npc }); } catch (e) { this.fail(e); return null; }
  }

  metrics(): MetricsResponse | null {
    try { return this.core.call<MetricsResponse>('metrics'); } catch (e) { this.fail(e); return null; }
  }

  setDebugTruth(on: boolean): void {
    this.debugTruth = on;
    this.refresh();
    this.notify();
  }

  // ------------------------------------------------------------------ save / load (UI-independent; storage may throw)
  saveToStorage(): string {
    try {
      const r = this.core.call<SaveResponse>('save');
      const payload = JSON.stringify({ format: 'zero-echo.web-save.v1', saved_at: new Date().toISOString(), host_now_ms: this.nowMs(), save: r.save });
      localStorage.setItem(SAVE_KEY, payload);
      return `сохранено (${Math.round(payload.length / 1024)} КиБ)`;
    } catch (e) {
      return `сохранение недоступно: ${String((e as Error)?.message ?? e)}`;
    }
  }

  savedAt(): string | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return (JSON.parse(raw) as { saved_at?: string }).saved_at ?? null;
    } catch {
      return null;
    }
  }

  loadFromStorage(): string {
    type StoredSave = { save?: Record<string, unknown>; host_now_ms?: number };
    let parsed: StoredSave | null = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return 'сохранения нет';
      parsed = JSON.parse(raw) as StoredSave;
    } catch (e) {
      return `хранилище недоступно: ${String((e as Error)?.message ?? e)}`;
    }
    if (!parsed?.save) return 'сохранение повреждено';
    for (const f of this.inflight.values()) f.controller.abort(ABORT_CANCEL);
    try {
      this.core.call('load', { save: parsed.save });
    } catch (e) {
      return e instanceof EchoCoreError ? `ядро отклонило сохранение: ${e.code} — ${e.message}` : String(e);
    }
    // Keep the host clock monotonic for the restored queue deadlines.
    const saved = Number(parsed.host_now_ms) || 0;
    if (saved > this.nowMs()) this.clockBase += saved - this.nowMs();
    this.resetDerived();
    this.applyAiMode();
    this.rebuildFromCoreLog();
    this.refresh();
    this.notify();
    return 'смена восстановлена из сохранения';
  }

  /** New shift from the D0 start (re-init of the same core). */
  restart(): void {
    for (const f of this.inflight.values()) f.controller.abort(ABORT_CANCEL);
    this.core.init();
    this.resetDerived();
    this.applyAiMode();
    this.refresh();
    this.notify();
  }

  private resetDerived(): void {
    this.events.length = 0;
    this.chats.clear();
    this.verdicts.length = 0;
    this.dispatchLog.length = 0;
    this.playerCaused.clear();
    this.claudeAsked.clear();
    this.firstSeen.clear();
    this.speakingUntil.clear();
    this.speechGesture.clear();
    this.kin.reset();
    this.lastSubtitle = null;
  }

  private rebuildFromCoreLog(): void {
    try {
      const r = this.core.call<{ events: CoreEvent[] }>('events', { since_seq: 0 });
      this.recordCoreVerdicts = true;
      this.absorb(r.events.slice(-MAX_EVENTS));
    } catch (e) {
      this.fail(e);
    }
    this.lastSubtitle = null;
    this.speakingUntil.clear();
  }

  // ------------------------------------------------------------------ dev: adversarial suite through the real path
  async runAdversarialSuite(npc: string, text: string): Promise<SuiteRow[]> {
    if (!this.dev || this.suite.running) return this.suite.rows;
    const prevProvider = this.providerId;
    const prevScenario = this.mock.scenario;
    this.setProvider('mock');
    this.suite = { running: true, rows: [] };
    this.notify();
    try {
      for (const sc of MOCK_SCENARIOS.filter((s) => s.adversarial)) {
        this.mock.scenario = sc.id;
        const said = this.say(npc, text);
        const taskId = said?.queued?.task_id ?? null;
        const rec = taskId ? await this.waitVerdict(taskId, 8000) : null;
        this.suite.rows.push({
          scenario: sc.id, label: sc.label, taskId,
          status: rec?.status ?? (taskId ? 'нет вердикта' : 'не поставлено в очередь'),
          reasons: rec?.verdict?.reasons ?? (rec?.fallbackReason ? [rec.fallbackReason] : []),
          fallbackUsed: rec?.fallbackUsed ?? false,
          fallbackStatus: rec?.verdict?.fallback?.status ?? null,
          providerStatus: rec?.providerStatus ?? '—',
        });
        this.notify();
      }
    } finally {
      this.mock.scenario = prevScenario;
      this.suite.running = false;
      this.setProvider(prevProvider);
    }
    return this.suite.rows;
  }

  private waitVerdict(taskId: string, timeoutMs: number): Promise<VerdictRecord | null> {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const check = () => {
        const v = this.verdicts.find((x) => x.taskId === taskId);
        if (v) { resolve(v); return; }
        if (performance.now() - t0 > timeoutMs) { resolve(null); return; }
        if (!this.running) this.pump();
        window.setTimeout(check, 50);
      };
      check();
    });
  }

  // ------------------------------------------------------------------ misc
  private fail(e: unknown): void {
    const msg = e instanceof EchoCoreError ? `${e.cmd}: ${e.code} — ${e.message}` : String((e as Error)?.message ?? e);
    this.lastError = msg;
    console.error('[host]', msg);
  }

  onChange(fn: Listener): void { this.listeners.push(fn); }

  notify(): void {
    for (const fn of this.listeners) { try { fn(); } catch (e) { console.error(e); } }
  }
}
