// Game-client sessions (Документ §17): the backend keeps provider keys and hands the client only a
// random session token with quotas: requests per minute (→ rate_limited), tokens per hour and a cost cap
// (→ budget_exceeded). Usage is accounted from MEASURED provider usage; in-flight requests hold a
// reservation (estimate) so concurrent requests cannot overshoot the budget.

import { createHash, randomBytes } from 'node:crypto';
import type { Clock } from './policy.ts';
import type { GatewayStatus, NormalizedUsage, PrivacyProfile, Quotas } from './types.ts';

export type ClientKind = 'web' | 'native' | 'eval';

export interface CustomEndpoint {
  url: string;
  model: string;
  /** BYO key for the user's own endpoint; kept in memory only, never logged or returned. */
  apiKey: string | null;
  declaredCapabilities: string[];
}

export interface RouteUsage {
  requests: number;
  upstream_attempts: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  reasoning_tokens: number;
  measured_attempts: number;
  estimated_attempts: number;
  cost_usd: number;
  cost_is_fictional: boolean | null;
}

export interface Session {
  /** Short public id used in logs (not the token). */
  id: string;
  tokenHash: string;
  privacy_profile: PrivacyProfile;
  client: ClientKind;
  route: string | null;
  created_at_ms: number;
  expires_at_ms: number;
  quotas: Quotas;
  customEndpoint: CustomEndpoint | null;
  // accounting
  requestTimes: number[];
  tokenEvents: { t: number; tokens: number }[];
  costUsd: number;
  reservedTokens: number;
  reservedCostUsd: number;
  abortedUnmeasured: { count: number; est_input_tokens: number; est_output_tokens: number; est_cost_usd: number };
  statuses: Partial<Record<GatewayStatus, number>>;
  byRoute: Map<string, RouteUsage>;
}

export type QuotaVerdict =
  | { ok: true }
  | { ok: false; status: 'rate_limited' | 'budget_exceeded'; code: string; message: string; retry_after_ms: number | null };

export interface Reservation {
  tokens: number;
  costUsd: number;
  settled: boolean;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function emptyRouteUsage(): RouteUsage {
  return {
    requests: 0,
    upstream_attempts: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    reasoning_tokens: 0,
    measured_attempts: 0,
    estimated_attempts: 0,
    cost_usd: 0,
    cost_is_fictional: null,
  };
}

export class SessionLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionLimitError';
  }
}

export interface SessionStoreOptions {
  clock: Clock;
  ttlMs: number;
  maxSessions: number;
  defaultQuotas: Quotas;
}

export class SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #opts: SessionStoreOptions;
  /** Called when a session disappears (e.g. to forget its BYO key in the redactor). */
  onDispose: ((s: Session) => void) | null = null;

  constructor(opts: SessionStoreOptions) {
    this.#opts = opts;
  }

  get size(): number {
    return this.#sessions.size;
  }

  create(input: { privacy_profile: PrivacyProfile; client: ClientKind; route?: string | null; quotas?: Partial<Quotas>; customEndpoint?: CustomEndpoint | null }): { session: Session; token: string } {
    this.sweep();
    if (this.#sessions.size >= this.#opts.maxSessions) throw new SessionLimitError('слишком много активных сессий');
    const token = `zes_${randomBytes(32).toString('base64url')}`;
    const now = this.#opts.clock.wallNow();
    const d = this.#opts.defaultQuotas;
    // A client may ask for LOWER quotas than the server default, never higher.
    const q = input.quotas ?? {};
    const quotas: Quotas = {
      requests_per_min: Math.min(d.requests_per_min, q.requests_per_min ?? d.requests_per_min),
      tokens_per_hour: Math.min(d.tokens_per_hour, q.tokens_per_hour ?? d.tokens_per_hour),
      cost_cap_usd: Math.min(d.cost_cap_usd, q.cost_cap_usd ?? d.cost_cap_usd),
    };
    const session: Session = {
      id: `s_${randomBytes(6).toString('hex')}`,
      tokenHash: hashToken(token),
      privacy_profile: input.privacy_profile,
      client: input.client,
      route: input.route ?? null,
      created_at_ms: now,
      expires_at_ms: now + this.#opts.ttlMs,
      quotas,
      customEndpoint: input.customEndpoint ?? null,
      requestTimes: [],
      tokenEvents: [],
      costUsd: 0,
      reservedTokens: 0,
      reservedCostUsd: 0,
      abortedUnmeasured: { count: 0, est_input_tokens: 0, est_output_tokens: 0, est_cost_usd: 0 },
      statuses: {},
      byRoute: new Map(),
    };
    this.#sessions.set(session.tokenHash, session);
    return { session, token };
  }

  /** Looks up "Bearer <token>"; expired sessions are removed. */
  authenticate(authorization: string | undefined): Session | null {
    if (!authorization) return null;
    const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (!m) return null;
    const s = this.#sessions.get(hashToken(m[1]));
    if (!s) return null;
    if (this.#opts.clock.wallNow() >= s.expires_at_ms) {
      this.#dispose(s);
      return null;
    }
    return s;
  }

  sweep(): void {
    const now = this.#opts.clock.wallNow();
    for (const s of this.#sessions.values()) if (now >= s.expires_at_ms) this.#dispose(s);
  }

  #dispose(s: Session): void {
    this.#sessions.delete(s.tokenHash);
    this.onDispose?.(s);
  }

  #prune(s: Session): void {
    const now = this.#opts.clock.now();
    while (s.requestTimes.length && now - s.requestTimes[0] >= MINUTE) s.requestTimes.shift();
    while (s.tokenEvents.length && now - s.tokenEvents[0].t >= HOUR) s.tokenEvents.shift();
  }

  tokensLastHour(s: Session): number {
    this.#prune(s);
    return s.tokenEvents.reduce((a, e) => a + e.tokens, 0);
  }

  /** Checks quotas for a request that will cost at most `est` (tokens and USD). */
  check(s: Session, est: { tokens: number; costUsd: number }): QuotaVerdict {
    this.#prune(s);
    const now = this.#opts.clock.now();
    const committedCost = s.costUsd + s.abortedUnmeasured.est_cost_usd + s.reservedCostUsd;
    if (committedCost + est.costUsd > s.quotas.cost_cap_usd + 1e-12) {
      return {
        ok: false,
        status: 'budget_exceeded',
        code: 'session_cost_cap',
        message: `лимит стоимости сессии ${s.quotas.cost_cap_usd} USD исчерпан (учтено ${committedCost.toFixed(6)} USD, запрос до ${est.costUsd.toFixed(6)} USD)`,
        retry_after_ms: null,
      };
    }
    const used = this.tokensLastHour(s) + s.reservedTokens;
    if (used + est.tokens > s.quotas.tokens_per_hour) {
      const retry = s.tokenEvents.length ? Math.max(0, Math.ceil(s.tokenEvents[0].t + HOUR - now)) : null;
      return {
        ok: false,
        status: 'budget_exceeded',
        code: 'session_tokens_per_hour',
        message: `лимит токенов в час (${s.quotas.tokens_per_hour}) исчерпан: учтено ${used}, запрос до ${est.tokens}`,
        retry_after_ms: retry,
      };
    }
    if (s.requestTimes.length >= s.quotas.requests_per_min) {
      const retry = s.requestTimes.length ? Math.max(0, Math.ceil(s.requestTimes[0] + MINUTE - now)) : MINUTE;
      return {
        ok: false,
        status: 'rate_limited',
        code: 'session_requests_per_min',
        message: `лимит запросов в минуту (${s.quotas.requests_per_min}) исчерпан`,
        retry_after_ms: retry,
      };
    }
    return { ok: true };
  }

  /** Counts a request against requests/min and reserves its worst-case tokens and cost. */
  admit(s: Session, routeId: string, est: { tokens: number; costUsd: number }): Reservation {
    s.requestTimes.push(this.#opts.clock.now());
    s.reservedTokens += est.tokens;
    s.reservedCostUsd += est.costUsd;
    this.#route(s, routeId).requests++;
    return { tokens: est.tokens, costUsd: est.costUsd, settled: false };
  }

  release(s: Session, r: Reservation): void {
    if (r.settled) return;
    r.settled = true;
    s.reservedTokens = Math.max(0, s.reservedTokens - r.tokens);
    s.reservedCostUsd = Math.max(0, s.reservedCostUsd - r.costUsd);
  }

  /** Records one upstream attempt's usage (measured or estimated) and its cost. */
  recordAttempt(s: Session, routeId: string, usage: NormalizedUsage, costUsd: number | null, fictional: boolean | null): void {
    const r = this.#route(s, routeId);
    r.upstream_attempts++;
    r.input_tokens += usage.input_tokens;
    r.output_tokens += usage.output_tokens;
    r.cached_input_tokens += usage.cached_input_tokens;
    r.reasoning_tokens += usage.reasoning_tokens;
    if (usage.measured) r.measured_attempts++;
    else r.estimated_attempts++;
    if (costUsd !== null) {
      r.cost_usd += costUsd;
      s.costUsd += costUsd;
      r.cost_is_fictional = r.cost_is_fictional === false ? false : fictional;
    }
    const tokens = usage.input_tokens + usage.output_tokens;
    if (tokens > 0) s.tokenEvents.push({ t: this.#opts.clock.now(), tokens });
  }

  /**
   * An aborted call has no measured usage, but the provider may still bill it (Документ §16:
   * stopping the request does not stop the bill). The worst-case estimate stays counted against the cap.
   */
  recordAbortedEstimate(s: Session, estInput: number, estOutput: number, estCostUsd: number): void {
    s.abortedUnmeasured.count++;
    s.abortedUnmeasured.est_input_tokens += estInput;
    s.abortedUnmeasured.est_output_tokens += estOutput;
    s.abortedUnmeasured.est_cost_usd += estCostUsd;
    if (estInput + estOutput > 0) s.tokenEvents.push({ t: this.#opts.clock.now(), tokens: estInput + estOutput });
  }

  /** A late answer arrived for an aborted call: drop its worst-case estimate (the measured usage is recorded separately). */
  reconcileAborted(s: Session, estInput: number, estOutput: number, estCostUsd: number): void {
    const a = s.abortedUnmeasured;
    a.count = Math.max(0, a.count - 1);
    a.est_input_tokens = Math.max(0, a.est_input_tokens - estInput);
    a.est_output_tokens = Math.max(0, a.est_output_tokens - estOutput);
    a.est_cost_usd = Math.max(0, a.est_cost_usd - estCostUsd);
    if (estInput + estOutput > 0) s.tokenEvents.push({ t: this.#opts.clock.now(), tokens: -(estInput + estOutput) });
  }

  recordStatus(s: Session, status: GatewayStatus): void {
    s.statuses[status] = (s.statuses[status] ?? 0) + 1;
  }

  #route(s: Session, routeId: string): RouteUsage {
    let r = s.byRoute.get(routeId);
    if (!r) {
      r = emptyRouteUsage();
      s.byRoute.set(routeId, r);
    }
    return r;
  }

  report(s: Session): Record<string, unknown> {
    this.#prune(s);
    const routes = Object.fromEntries(s.byRoute);
    const totals = [...s.byRoute.values()].reduce(
      (a, r) => ({
        requests: a.requests + r.requests,
        upstream_attempts: a.upstream_attempts + r.upstream_attempts,
        input_tokens: a.input_tokens + r.input_tokens,
        output_tokens: a.output_tokens + r.output_tokens,
        cached_input_tokens: a.cached_input_tokens + r.cached_input_tokens,
        reasoning_tokens: a.reasoning_tokens + r.reasoning_tokens,
        measured_attempts: a.measured_attempts + r.measured_attempts,
        estimated_attempts: a.estimated_attempts + r.estimated_attempts,
      }),
      { requests: 0, upstream_attempts: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, reasoning_tokens: 0, measured_attempts: 0, estimated_attempts: 0 },
    );
    const fictionalFlags = [...s.byRoute.values()].map((r) => r.cost_is_fictional).filter((f) => f !== null);
    return {
      session_id: s.id,
      privacy_profile: s.privacy_profile,
      client: s.client,
      expires_at: new Date(s.expires_at_ms).toISOString(),
      totals: { ...totals, cost_usd: s.costUsd, cost_is_fictional: fictionalFlags.length ? fictionalFlags.some((f) => f) : null },
      aborted_unmeasured: s.abortedUnmeasured,
      statuses: s.statuses,
      by_route: routes,
      quotas: s.quotas,
      remaining: {
        requests_this_minute: Math.max(0, s.quotas.requests_per_min - s.requestTimes.length),
        tokens_this_hour: Math.max(0, s.quotas.tokens_per_hour - this.tokensLastHour(s) - s.reservedTokens),
        cost_usd: Math.max(0, s.quotas.cost_cap_usd - s.costUsd - s.abortedUnmeasured.est_cost_usd - s.reservedCostUsd),
      },
      note_ru: 'Токены — измеренные провайдером (measured_attempts) или оценка шлюза (estimated_attempts, mock). Стоимость рассчитана по тарифам из конфигурации; при cost_is_fictional=true тарифы вымышленные.',
    };
  }
}
