// Common provider interface (docs/SPEC.md §7, Документ §15–§16). Every provider turns a GatewayRequest built by the
// core into a normalized GatewayResult. Providers never decide game validity: the core's Intent Authority checks the
// RAW proposal text. The host owns the deadline (AbortController); a provider must stop promptly on abort.
import type { GatewayRequest, GatewayResult, GatewayStatus } from '../../contracts.ts';
import type { CoreCaller } from '../../core/echo_core.ts';

export type ProviderId = 'rules' | 'claude' | 'gateway' | 'webllm' | 'mock';
/** Admission lane in the core (SPEC §3): rules has no lane; cpu/gpu are local; remote leaves the page. */
export type Backend = 'rules' | 'cpu' | 'gpu' | 'remote';
export type PrivacyProfile = 'offline' | 'hybrid' | 'online';

export interface ProviderState {
  /** ready: may answer; checking: probing availability; unavailable: cannot answer in this view; off: needs explicit
   *  enabling/consent; loading: downloading/initializing; backoff: temporarily paused (e.g. rate limit). */
  state: 'ready' | 'checking' | 'unavailable' | 'off' | 'loading' | 'backoff';
  message: string;
}

/** Abort reasons the host uses; providers map them to statuses. */
export const ABORT_DEADLINE = 'deadline';
export const ABORT_CANCEL = 'cancel';

export interface ProviderContext {
  signal: AbortSignal;
  core: CoreCaller;
  /** Host monotonic time (the core's now_ms scale). */
  nowMs: () => number;
}

export interface QueueCandidate {
  task_id: string;
  actor: string;
  kind: string;
  /** Created by an explicit player action (player_say / player_order / plan decision) or explicitly sent by the player. */
  playerCaused: boolean;
}

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  /** Short Russian description of where the computation happens (shown next to the selector). */
  readonly where: string;
  backend(privacy: PrivacyProfile): Backend;
  state(): ProviderState;
  /** Whether this provider should answer the candidate; otherwise the ordinary game AI (rules) answers it. */
  accepts(c: QueueCandidate): boolean;
  generate(req: GatewayRequest, ctx: ProviderContext): Promise<GatewayResult>;
  /** Called when the provider is selected (probe availability, open a session...). Never spends model usage. */
  activate?(privacy: PrivacyProfile): void;
  /** Subscribe to state changes (for the UI). */
  onState?(fn: () => void): void;
}

export function emptyUsage(measured = false): GatewayResult['usage'] {
  return { input_tokens: 0, output_tokens: 0, measured };
}

export function makeResult(
  req: Pick<GatewayRequest, 'task_id'>,
  status: GatewayStatus,
  fields: Partial<GatewayResult> & { provider: string; model: string },
): GatewayResult {
  return {
    task_id: req.task_id,
    status,
    proposal_text: null,
    usage: emptyUsage(),
    latency_ms: { total: 0, first_token: null },
    finish_reason: status === 'ok' ? 'stop' : status,
    attempts: 1,
    error: null,
    ...fields,
  };
}

/** Status for an aborted call: the host's deadline → timeout, anything else → cancelled. */
export function abortStatus(signal: AbortSignal): GatewayStatus {
  return signal.reason === ABORT_DEADLINE ? 'timeout' : 'cancelled';
}

export function abortMessage(signal: AbortSignal): string {
  return signal.reason === ABORT_DEADLINE ? 'истёк срок ответа (deadline хоста)' : 'запрос отменён';
}

/** Resolves after `ms` or rejects with the abort reason. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class StateHolder {
  private current: ProviderState;
  private readonly listeners: (() => void)[] = [];
  constructor(initial: ProviderState) { this.current = initial; }
  get(): ProviderState { return this.current; }
  set(s: ProviderState): void {
    if (s.state === this.current.state && s.message === this.current.message) return;
    this.current = s;
    for (const fn of this.listeners) { try { fn(); } catch (e) { console.error(e); } }
  }
  on(fn: () => void): void { this.listeners.push(fn); }
}
