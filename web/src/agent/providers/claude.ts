// Claude through the hosting page's `sample` capability — available only when the app runs inside a Claude artifact
// viewer. The model only CHOOSES among host-offered actions/targets/facts (shared/prompt.ts); its raw text goes back to
// the core's Intent Authority. Usage policy: called only for requests caused by an explicit player action (or a queued
// initiative the player explicitly sent), never on its own from the simulation; rate limits back off, never loop.
import type { GatewayRequest, GatewayResult, GatewayStatus } from '../../contracts.ts';
import { buildIntentMessages, estimateTokens, extractJsonCandidate } from '../../../../shared/prompt.ts';
import {
  ABORT_DEADLINE, abortStatus, makeResult, StateHolder,
  type Provider, type ProviderContext, type ProviderState, type QueueCandidate,
} from './types.ts';

interface SampleError { code?: string; message?: string; text?: string }
interface SampleResult { text: string; truncated: boolean; modelTierApplied?: string }
type SampleFn = (input: string, options?: {
  modelTier?: 'quick' | 'default' | 'complex';
  cache?: boolean;
  signal?: AbortSignal;
  onText?: (u: { text: string; delta: string }) => void;
}) => Promise<SampleResult>;

interface ClaudeHost { use?: (name: string) => Promise<unknown> }

/** Codes after which the capability cannot work in this view: hide/disable it for the session. */
const PERMANENT = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'session_expired']);
const RATE_LIMIT_BACKOFF_MS = 60_000;

const PERMANENT_RU: Record<string, string> = {
  not_granted: 'доступ к Claude не разрешён для этой страницы',
  sampling_disabled: 'Claude недоступен для этого аккаунта или организации',
  not_declared: 'страница не объявляет возможность sample',
  capability_disabled: 'возможность sample отключена в этом просмотре',
  capability_removed: 'среда просмотра не поддерживает sample',
  session_expired: 'сессия истекла — войдите в Claude снова',
};

export class ClaudeProvider implements Provider {
  readonly id = 'claude' as const;
  readonly label = 'Claude (страница-хост)';
  readonly where = 'удалённо: модель Claude через страницу-хост artifact, на аккаунте зрителя';
  private sample: SampleFn | null = null;
  private probing = false;
  private backoffUntil = 0;
  private readonly st = new StateHolder({ state: 'checking', message: 'проверка доступности…' });

  constructor() {
    this.probe();
  }

  backend(): 'remote' { return 'remote'; }

  state(): ProviderState {
    const s = this.st.get();
    if (s.state === 'backoff' && performance.now() >= this.backoffUntil) {
      this.st.set({ state: 'ready', message: 'Claude доступен; модель quick' });
    }
    return this.st.get();
  }

  onState(fn: () => void): void { this.st.on(fn); }

  accepts(c: QueueCandidate): boolean {
    return this.state().state === 'ready' && c.playerCaused;
  }

  /** Resolves the capability without asking the viewer anything (no usage is spent by `use`). */
  private probe(): void {
    if (this.probing || this.sample) return;
    const host = (globalThis as { claude?: ClaudeHost }).claude;
    if (!host || typeof host.use !== 'function') {
      this.st.set({ state: 'unavailable', message: 'страница открыта не в просмотрщике Claude (нет window.claude) — провайдер недоступен' });
      return;
    }
    this.probing = true;
    this.st.set({ state: 'checking', message: 'запрос возможности sample у страницы-хоста (до ~10 с)…' });
    host.use('sample').then((fn) => {
      this.probing = false;
      if (typeof fn === 'function') {
        this.sample = fn as SampleFn;
        this.st.set({ state: 'ready', message: 'Claude доступен; модель quick. Первый вызов попросит разрешение зрителя' });
      } else {
        this.st.set({ state: 'unavailable', message: 'просмотрщик не предоставил возможность sample (не объявлена или не разрешена)' });
      }
    }, (e: unknown) => {
      this.probing = false;
      this.st.set({ state: 'unavailable', message: `ошибка claude.use("sample"): ${String((e as Error)?.message ?? e)}` });
    });
  }

  activate(): void {
    this.probe();
  }

  async generate(req: GatewayRequest, ctx: ProviderContext): Promise<GatewayResult> {
    const base = { provider: 'claude-artifact', model: 'claude:quick' };
    const sample = this.sample;
    if (!sample || this.state().state !== 'ready') {
      return makeResult(req, 'unavailable', { ...base, error: { code: 'unavailable', message: this.state().message } });
    }
    const m = buildIntentMessages(req);
    // The sample capability has no system role: system rules and the request go in one input string.
    const input = `${m.system}\n\n${m.user}`;
    const t0 = performance.now();
    let firstToken: number | null = null;
    try {
      const r = await sample(input, {
        modelTier: 'quick',
        cache: false,
        signal: ctx.signal,
        onText: () => { if (firstToken === null) firstToken = performance.now() - t0; },
      });
      const total = performance.now() - t0;
      return makeResult(req, 'ok', {
        provider: base.provider,
        model: `claude:${r.modelTierApplied ?? 'quick'}`,
        proposal_text: extractJsonCandidate(r.text),
        usage: { input_tokens: estimateTokens(input), output_tokens: estimateTokens(r.text), measured: false },
        latency_ms: { total: Math.round(total), first_token: firstToken === null ? null : Math.round(firstToken) },
        finish_reason: r.truncated ? 'length' : 'stop',
      });
    } catch (raw) {
      const e = (raw ?? {}) as SampleError;
      const code = typeof e.code === 'string' ? e.code : 'upstream_error';
      const total = Math.round(performance.now() - t0);
      let status: GatewayStatus;
      let message = e.message ?? code;
      if (code === 'cancelled' || ctx.signal.aborted) {
        status = ctx.signal.aborted ? abortStatus(ctx.signal) : 'cancelled';
        message = ctx.signal.reason === ABORT_DEADLINE ? 'истёк срок ответа: Claude не успел до дедлайна хоста' : 'запрос отменён';
      } else if (code === 'rate_limited') {
        status = 'rate_limited';
        this.backoffUntil = performance.now() + RATE_LIMIT_BACKOFF_MS;
        this.st.set({ state: 'backoff', message: 'лимит запросов Claude: пауза 60 с, отвечают правила (повторов нет)' });
      } else if (code === 'refused') {
        status = 'refused';
      } else if (code === 'empty_completion') {
        status = 'invalid_output';
      } else {
        status = 'unavailable';
        if (PERMANENT.has(code)) {
          this.sample = null;
          this.st.set({ state: 'unavailable', message: `${PERMANENT_RU[code] ?? code} — Claude выключен до перезагрузки страницы` });
        }
      }
      return makeResult(req, status, {
        ...base,
        latency_ms: { total, first_token: firstToken === null ? null : Math.round(firstToken) },
        usage: { input_tokens: firstToken === null ? 0 : estimateTokens(input), output_tokens: 0, measured: false },
        error: { code, message },
      });
    }
  }
}
