// Agent Gateway core (transport-agnostic): GatewayRequest → provider call → normalized GatewayResult.
// The gateway NEVER decides game validity; it enforces privacy, quotas, deadline, retry, circuit breaker,
// concurrency, idempotency and cancellation, and accounts measured usage and cost (docs/SPEC.md §7).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { INTENT_SCHEMA_VERSION, PROMPT_VERSION } from '../../shared/prompt.ts';
import { adapterFor, createAdapters } from './adapters/index.ts';
import type { AdapterSet } from './adapters/index.ts';
import { buildPrompt, netErrorOutcome, outcome, zeroUsage } from './adapters/common.ts';
import type { AdapterContext, ProviderAdapter } from './adapters/common.ts';
import { isFloatingModelAlias } from './config.ts';
import { loadRepoSchema, validate } from './jsonschema.ts';
import type { Schema } from './jsonschema.ts';
import { Logger, stdoutSink } from './log.ts';
import type { LogSink } from './log.ts';
import { checkEndpointUrl, NetError, PinnedHttpClient, resolvePinned, routeEndpointRules, systemResolver } from './net.ts';
import type { Resolver } from './net.ts';
import { backoffDelayMs, CircuitBreaker, Deadline, LimitError, Semaphore, systemClock, TaskRegistry } from './policy.ts';
import type { Clock, TaskEntry } from './policy.ts';
import { maxRequestCostUsd, PriceBook, usageCostUsd } from './pricing.ts';
import { findRoute, permittedFallback, requestedRouteId, routePermitted, routesForProfile, stricterProfile } from './router.ts';
import { SecretStore } from './secrets.ts';
import { SessionLimitError, SessionStore } from './sessions.ts';
import type { ClientKind, CustomEndpoint, Session } from './sessions.ts';
import { GATEWAY_VERSION } from './types.ts';
import type { AdapterOutcome, Capability, GatewayConfig, GatewayRequest, GatewayResult, GatewayStatus, NormalizedUsage, PrivacyProfile, ProbeResult, RouteConfig, UpstreamError } from './types.ts';

export interface GatewayDeps {
  clock?: Clock;
  rng?: () => number;
  resolver?: Resolver;
  secrets?: SecretStore;
  env?: NodeJS.ProcessEnv;
  logSink?: LogSink;
  debugContent?: boolean;
  prices?: PriceBook;
  /** How long a successful capability handshake (probe) stays valid. */
  handshakeTtlMs?: number;
}

export interface HandleOptions {
  /** Monotonic time when the HTTP request arrived; the deadline counts from here. */
  receivedAt: number;
  routeHeader?: string;
  mockHeader?: string;
}

export interface GatewayResponse {
  httpStatus: number;
  body: unknown;
  headers?: Record<string, string>;
}

function errorBody(code: string, message: string, details?: unknown): { error: Record<string, unknown> } {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

const PRIVACY: readonly PrivacyProfile[] = ['offline', 'hybrid', 'online'];
const CLIENTS: readonly ClientKind[] = ['web', 'native', 'eval'];
const HANDSHAKE_FAILURE_TTL_MS = 5_000;

/** Reads the git revision of the repository without spawning git (null when unavailable). */
export function gitRevision(): string | null {
  try {
    const gitDir = new URL('../../.git/', import.meta.url);
    const head = readFileSync(new URL('HEAD', gitDir), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    const ref = head.slice(5);
    try {
      return readFileSync(new URL(ref, gitDir), 'utf8').trim();
    } catch {
      const packed = readFileSync(new URL('packed-refs', gitDir), 'utf8');
      const line = packed.split('\n').find((l) => l.endsWith(` ${ref}`));
      return line ? line.split(' ')[0] : null;
    }
  } catch {
    return null;
  }
}

interface AttemptRecord {
  route: RouteConfig;
  outcome: AdapterOutcome;
}

export class Gateway {
  readonly config: GatewayConfig;
  readonly adapters: AdapterSet;
  readonly sessions: SessionStore;
  readonly secrets: SecretStore;
  readonly prices: PriceBook;
  readonly tasks: TaskRegistry;
  readonly log: Logger;
  readonly clock: Clock;
  readonly startedAtWall: number;
  readonly #rng: () => number;
  readonly #resolver: Resolver;
  readonly #requestSchema: Schema;
  readonly #breakers = new Map<string, CircuitBreaker>();
  readonly #routeSlots = new Map<string, Semaphore>();
  readonly #globalSlots: Semaphore;
  readonly #clients = new Map<string, PinnedHttpClient>();
  readonly #sessionClients = new Map<string, PinnedHttpClient>();
  readonly #handshakes = new Map<string, { result: ProbeResult; at: number }>();
  readonly #handshakeTtlMs: number;
  readonly #probeCache = new Map<string, ProbeResult>();

  constructor(config: GatewayConfig, deps: GatewayDeps = {}) {
    this.config = config;
    this.clock = deps.clock ?? systemClock;
    this.#rng = deps.rng ?? Math.random;
    this.#resolver = deps.resolver ?? systemResolver;
    this.secrets = deps.secrets ?? SecretStore.load({ routeIds: config.routes.map((r) => r.id), env: deps.env ?? process.env, file: config.secrets_file });
    this.log = new Logger({ sink: deps.logSink ?? stdoutSink(), redact: (s) => this.secrets.redact(s), debugContent: deps.debugContent ?? false, base: { component: 'gateway' } });
    this.prices = deps.prices ?? (config.pricing_file ? PriceBook.load(config.pricing_file) : PriceBook.empty());
    this.adapters = createAdapters();
    this.sessions = new SessionStore({ clock: this.clock, ttlMs: config.server.session_ttl_s * 1000, maxSessions: config.server.max_sessions, defaultQuotas: config.default_quotas });
    this.sessions.onDispose = (s) => {
      if (s.customEndpoint?.apiKey) this.secrets.forgetExtra(s.customEndpoint.apiKey);
      this.#sessionClients.get(s.id)?.close();
      this.#sessionClients.delete(s.id);
    };
    this.tasks = new TaskRegistry(this.clock, config.limits.result_cache_ttl_s * 1000, config.limits.result_cache_max);
    this.#requestSchema = loadRepoSchema('gateway_request');
    this.#globalSlots = new Semaphore(config.limits.global_concurrency, config.limits.global_max_queue);
    this.#handshakeTtlMs = deps.handshakeTtlMs ?? 300_000;
    this.startedAtWall = this.clock.wallNow();

    const problems: string[] = [];
    for (const r of config.routes) {
      this.#breakers.set(r.id, new CircuitBreaker(r.breaker, this.clock));
      this.#routeSlots.set(r.id, new Semaphore(r.concurrency, r.max_queue));
      if (r.enabled && r.locality === 'remote' && !this.prices.lookup(r.id, r.model)) {
        problems.push(`маршрут ${r.id} включён, но в тарифах нет цены для ${r.model}: лимит стоимости нельзя соблюсти`);
      }
      if (r.enabled && (r.adapter === 'openai' || r.adapter === 'anthropic' || r.adapter === 'gemini') && !this.secrets.has(r.id)) {
        this.log.warn('route_without_key', { route: r.id, note: 'маршрут включён, но ключ не найден — запросы получат unavailable/no_key' });
      }
    }
    if (problems.length) throw new Error(`шлюз не запущен:\n  - ${problems.join('\n  - ')}`);
  }

  close(): void {
    for (const c of this.#clients.values()) c.close();
    for (const c of this.#sessionClients.values()) c.close();
    this.#clients.clear();
    this.#sessionClients.clear();
  }

  // ------------------------------------------------------------ sessions

  async createSession(raw: unknown): Promise<GatewayResponse> {
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const profile = body.privacy_profile as PrivacyProfile;
    if (!PRIVACY.includes(profile)) return { httpStatus: 400, body: errorBody('invalid_request', 'privacy_profile: ожидается offline | hybrid | online') };
    const client = (body.client ?? 'web') as ClientKind;
    if (!CLIENTS.includes(client)) return { httpStatus: 400, body: errorBody('invalid_request', 'client: ожидается web | native | eval') };

    let custom: CustomEndpoint | null = null;
    if (body.custom_endpoint !== undefined) {
      const res = await this.#validateCustomEndpoint(body.custom_endpoint, profile);
      if ('error' in res) return { httpStatus: res.httpStatus, body: errorBody(res.code, res.error) };
      custom = res.endpoint;
    }

    let route: string | null = null;
    if (body.route !== undefined) {
      const r = typeof body.route === 'string' ? findRoute(this.config, body.route) : undefined;
      if (!r) return { httpStatus: 400, body: errorBody('unknown_route', `маршрут ${String(body.route)} не существует`) };
      const permitted = routePermitted(this.config, r, profile, custom ? ({ customEndpoint: custom } as Session) : null);
      if (!permitted.ok) return { httpStatus: 403, body: errorBody(permitted.code, permitted.message) };
      route = r.id;
    }

    const quotas: Record<string, number> = {};
    if (body.quotas !== undefined) {
      const q = body.quotas as Record<string, unknown>;
      for (const k of ['requests_per_min', 'tokens_per_hour', 'cost_cap_usd']) {
        if (q?.[k] === undefined) continue;
        if (typeof q[k] !== 'number' || (q[k] as number) < 0) return { httpStatus: 400, body: errorBody('invalid_request', `quotas.${k}: ожидается неотрицательное число`) };
        quotas[k] = q[k] as number;
      }
    }

    let created;
    try {
      created = this.sessions.create({ privacy_profile: profile, client, route, quotas, customEndpoint: custom });
    } catch (e) {
      if (e instanceof SessionLimitError) return { httpStatus: 503, body: errorBody('too_many_sessions', e.message) };
      throw e;
    }
    const { session, token } = created;
    if (custom?.apiKey) this.secrets.registerExtra(custom.apiKey);
    this.log.info('session_created', { session: session.id, privacy_profile: profile, client, custom_endpoint: custom ? new URL(custom.url).host : null });
    return {
      httpStatus: 200,
      body: {
        session_token: token,
        expires_at: new Date(session.expires_at_ms).toISOString(),
        quotas: session.quotas,
        privacy_profile: profile,
        default_route: route ?? this.config.default_route,
        routes: this.#routeList(session),
        schema_version: INTENT_SCHEMA_VERSION,
        prompt_version: PROMPT_VERSION,
      },
    };
  }

  async #validateCustomEndpoint(raw: unknown, profile: PrivacyProfile): Promise<{ endpoint: CustomEndpoint } | { error: string; code: string; httpStatus: number }> {
    const route = this.config.routes.find((r) => r.user_supplied_endpoint);
    if (!route || !route.enabled) return { error: 'собственный endpoint не разрешён владельцем сервера (маршрут выключен)', code: 'custom_endpoint_disabled', httpStatus: 403 };
    const permitted = routePermitted(this.config, route, profile);
    if (!permitted.ok) return { error: permitted.message, code: permitted.code, httpStatus: 403 };
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (typeof o.url !== 'string' || typeof o.model !== 'string' || !o.model.trim()) {
      return { error: 'custom_endpoint: требуются url и model', code: 'invalid_request', httpStatus: 400 };
    }
    if (isFloatingModelAlias(o.model)) return { error: `модель «${o.model}» — плавающий алиас; укажите закреплённую версию`, code: 'floating_model_alias', httpStatus: 400 };
    if (o.api_key !== undefined && (typeof o.api_key !== 'string' || o.api_key.length > 512)) return { error: 'custom_endpoint.api_key: ожидается строка', code: 'invalid_request', httpStatus: 400 };
    const caps = Array.isArray(o.capabilities) ? o.capabilities.filter((c): c is string => c === 'json_schema' || c === 'dialogue') : [];
    try {
      const rules = routeEndpointRules(route);
      const url = checkEndpointUrl(o.url, rules);
      // Resolve now as well, to fail fast; every request re-resolves and pins again.
      await resolvePinned(url.hostname, rules.policy, this.#resolver);
      return { endpoint: { url: url.href.replace(/\/+$/, ''), model: o.model, apiKey: typeof o.api_key === 'string' ? o.api_key : null, declaredCapabilities: caps } };
    } catch (e) {
      if (e instanceof NetError) {
        this.log.warn('custom_endpoint_rejected', { code: e.code });
        return { error: `endpoint отклонён: ${e.message}`, code: e.code, httpStatus: 400 };
      }
      throw e;
    }
  }

  #routeList(session: Session): Record<string, unknown>[] {
    const profile = session.privacy_profile;
    return routesForProfile(this.config, profile, session).map((r) => ({
      id: r.id,
      adapter: r.adapter,
      model: r.user_supplied_endpoint ? session.customEndpoint?.model ?? r.model : r.model,
      locality: r.locality,
      capabilities: r.capabilities,
      fallback_route: permittedFallback(this.config, r, profile, session)?.id ?? null,
      default: r.id === (session.route ?? this.config.default_route),
    }));
  }

  // ------------------------------------------------------------ intent / dialogue

  async handle(session: Session, raw: unknown, capability: Capability, opts: HandleOptions): Promise<GatewayResponse> {
    const problems = validate(this.#requestSchema, raw);
    if (problems.length) {
      return { httpStatus: 400, body: errorBody('invalid_request', 'запрос не соответствует schemas/gateway_request.schema.json', problems) };
    }
    const req = raw as GatewayRequest;
    if (req.capability !== capability) {
      return { httpStatus: 400, body: errorBody('capability_mismatch', `capability ${req.capability} не соответствует этому методу (${capability})`) };
    }
    if (req.prompt_version !== undefined && req.prompt_version !== PROMPT_VERSION) {
      return { httpStatus: 409, body: errorBody('prompt_version_mismatch', `клиент ожидает prompt_version ${req.prompt_version}, шлюз собран с ${PROMPT_VERSION}`) };
    }
    const routeId = requestedRouteId(this.config, session, opts.routeHeader);
    if (!findRoute(this.config, routeId)) {
      return { httpStatus: 400, body: errorBody('unknown_route', `маршрут ${routeId} не существует`) };
    }

    const key = `${session.id}:${req.task_id}`;
    const bodyHash = sha256(stableStringify({ req, route: routeId }));
    const existing = this.tasks.get(key);
    if (existing) {
      if (existing.bodyHash !== null && existing.bodyHash !== bodyHash) {
        return { httpStatus: 409, body: errorBody('task_id_conflict', `task_id ${req.task_id} уже использован в этой сессии с другим содержимым`) };
      }
      if (existing.result) return this.#reply(existing.result, existing.result.provider, true);
      if (existing.promise) {
        const shared = await existing.promise;
        return this.#reply(shared, shared.provider, true);
      }
      // Cancellation registered before the request arrived: no upstream call at all.
      existing.bodyHash = bodyHash;
      const route = findRoute(this.config, routeId) as RouteConfig;
      const result = this.#result(req, route, session, {
        status: 'cancelled',
        attempts: [],
        receivedAt: opts.receivedAt,
        queueMs: 0,
        finishReason: 'gateway:cancelled',
        error: { code: 'cancelled_before_start', message: 'задача отменена до начала обработки' },
      });
      this.tasks.complete(key, result);
      this.sessions.recordStatus(session, 'cancelled');
      return this.#reply(result, routeId, false);
    }

    const entry = this.tasks.start(key, bodyHash);
    const promise = this.#execute(session, req, entry, opts).catch((e: unknown) => {
      this.log.error('internal_error', { task_id: req.task_id, message: String((e as Error)?.message ?? e) });
      const route = findRoute(this.config, routeId) as RouteConfig;
      return this.#result(req, route, session, {
        status: 'unavailable',
        attempts: [],
        receivedAt: opts.receivedAt,
        queueMs: 0,
        finishReason: 'gateway:internal_error',
        error: { code: 'internal_error', message: 'внутренняя ошибка шлюза' },
      });
    });
    entry.promise = promise;
    const result = await promise;
    this.tasks.complete(key, result);
    return this.#reply(result, result.provider, false);
  }

  #reply(result: GatewayResult, routeUsed: string, replay: boolean): GatewayResponse {
    return { httpStatus: 200, body: result, headers: { 'x-echo-route-used': routeUsed, ...(replay ? { 'x-echo-replay': 'true' } : {}) } };
  }

  #estimate(req: GatewayRequest, routes: RouteConfig[], session: Session): { inputTokens: number; outputTokens: number; tokens: number; costUsd: number } {
    const inputTokens = buildPrompt(req, req.capability).estimatedInputTokens;
    let outputTokens = req.max_output_tokens;
    let costUsd = 0;
    for (const r of routes) {
      const out = adapterFor(this.adapters, r.adapter).outputTokenBudget(req, r);
      outputTokens = Math.max(outputTokens, out);
      const price = this.prices.lookup(r.id, this.#modelFor(r, session));
      if (price) costUsd = Math.max(costUsd, maxRequestCostUsd(inputTokens, out, price));
    }
    return { inputTokens, outputTokens, tokens: inputTokens + outputTokens, costUsd };
  }

  #modelFor(route: RouteConfig, session: Session): string {
    return route.user_supplied_endpoint ? session.customEndpoint?.model ?? route.model : route.model;
  }

  async #execute(session: Session, req: GatewayRequest, entry: TaskEntry, opts: HandleOptions): Promise<GatewayResult> {
    const profile = stricterProfile(session.privacy_profile, req.privacy_profile);
    const primary = findRoute(this.config, requestedRouteId(this.config, session, opts.routeHeader)) as RouteConfig;
    const base = { receivedAt: opts.receivedAt, queueMs: 0 };

    const permitted = routePermitted(this.config, primary, profile, session);
    if (!permitted.ok) {
      this.log.info('route_refused', { session: session.id, task_id: req.task_id, route: primary.id, code: permitted.code, profile });
      return this.#finish(session, req, primary, { ...base, status: 'unavailable', attempts: [], finishReason: `gateway:${permitted.code}`, error: { code: permitted.code, message: permitted.message } });
    }
    if (!primary.capabilities.includes(req.capability)) {
      return this.#finish(session, req, primary, {
        ...base,
        status: 'unavailable',
        attempts: [],
        finishReason: 'gateway:capability_unsupported',
        error: { code: 'capability_unsupported', message: `маршрут ${primary.id} не предоставляет ${req.capability}` },
      });
    }

    const fallback = permittedFallback(this.config, primary, profile, session);
    if (primary.fallback_route && !fallback) {
      this.log.info('fallback_not_permitted', { route: primary.id, fallback: primary.fallback_route, profile });
    }
    const est = this.#estimate(req, fallback ? [primary, fallback] : [primary], session);
    if (est.inputTokens > req.max_input_tokens) {
      // The core's ContextBuilder owns the budget; the gateway only reports the (heuristic) overrun.
      this.log.warn('input_budget_estimate_exceeded', { task_id: req.task_id, estimated_input_tokens: est.inputTokens, max_input_tokens: req.max_input_tokens });
    }
    const verdict = this.sessions.check(session, est);
    if (!verdict.ok) {
      return this.#finish(session, req, primary, {
        ...base,
        status: verdict.status,
        attempts: [],
        finishReason: 'gateway:quota',
        error: { code: verdict.code, message: verdict.message, retry_after_ms: verdict.retry_after_ms },
      });
    }
    const reservation = this.sessions.admit(session, primary.id, est);
    try {
      return await this.#attempts(session, req, entry, opts, primary, fallback, est);
    } finally {
      this.sessions.release(session, reservation);
    }
  }

  async #attempts(
    session: Session,
    req: GatewayRequest,
    entry: TaskEntry,
    opts: HandleOptions,
    primary: RouteConfig,
    fallback: RouteConfig | null,
    est: { inputTokens: number; outputTokens: number; costUsd: number },
  ): Promise<GatewayResult> {
    const deadline = new Deadline(this.clock, opts.receivedAt, req.deadline_ms);
    const cancelSignal = entry.controller.signal;
    const attempts: AttemptRecord[] = [];
    let queueMs = 0;
    let finalStatus: GatewayStatus | null = null;
    let finalError: UpstreamError | null = null;
    let finalFinish = '';
    let lastRoute = primary;
    const margin = this.config.limits.deadline_margin_ms;

    for (let n = 1; n <= primary.retry.max_attempts; n++) {
      if (cancelSignal.aborted) {
        [finalStatus, finalFinish, finalError] = ['cancelled', 'gateway:cancelled', { code: 'cancelled', message: 'задача отменена игрой' }];
        break;
      }
      if (deadline.remaining() <= margin) {
        [finalStatus, finalFinish, finalError] = ['timeout', 'gateway:deadline', { code: 'deadline', message: `общий срок ${req.deadline_ms} мс истёк` }];
        break;
      }

      // Retry target: the explicitly configured (and permitted) fallback, else the same route.
      let target = n === 1 ? primary : fallback ?? primary;
      let ticket = this.#breaker(target).tryAcquire();
      if (!ticket.allowed && n === 1 && fallback) {
        const t2 = this.#breaker(fallback).tryAcquire();
        if (t2.allowed) {
          this.log.info('fallback_on_open_circuit', { session: session.id, task_id: req.task_id, route: primary.id, fallback: fallback.id });
          target = fallback;
          ticket = t2;
        }
      }
      if (!ticket.allowed) {
        if (attempts.length) {
          // The retry is blocked; the game gets the real outcome of the attempt that ran.
          this.log.info('retry_skipped', { session: session.id, task_id: req.task_id, route: target.id, reason: 'circuit_open' });
          break;
        }
        lastRoute = target;
        [finalStatus, finalFinish, finalError] = [
          'unavailable',
          'gateway:circuit_open',
          { code: 'circuit_open', message: `маршрут ${target.id} временно исключён (circuit breaker: ${ticket.state})`, retry_after_ms: ticket.retryInMs },
        ];
        break;
      }

      const queueStart = this.clock.now();
      let release: (() => void) | null = null;
      try {
        release = await this.#acquireSlots(target, cancelSignal, deadline.remaining() - margin);
      } catch (e) {
        this.#breaker(target).onNeutral(ticket.probe);
        queueMs += this.clock.now() - queueStart;
        const code = e instanceof LimitError ? e.code : 'aborted';
        if (code === 'queue_full' && attempts.length) {
          this.log.info('retry_skipped', { session: session.id, task_id: req.task_id, route: target.id, reason: 'queue_full' });
          break;
        }
        lastRoute = target;
        if (code === 'queue_full') {
          [finalStatus, finalFinish, finalError] = ['rate_limited', 'gateway:queue_full', { code: 'gateway_queue_full', message: `очередь маршрута ${target.id} заполнена`, retry_after_ms: 250 }];
        } else if (code === 'queue_timeout') {
          [finalStatus, finalFinish, finalError] = ['timeout', 'gateway:queue_deadline', { code: 'queue_deadline', message: 'срок истёк в очереди (предел одновременных запросов)' }];
        } else {
          [finalStatus, finalFinish, finalError] = ['cancelled', 'gateway:cancelled', { code: 'cancelled', message: 'задача отменена в очереди' }];
        }
        break;
      }
      queueMs += this.clock.now() - queueStart;
      lastRoute = target;

      // A non-final attempt may be capped so a hanging provider leaves time for the one retry/fallback.
      const cap = n < primary.retry.max_attempts ? primary.retry.attempt_timeout_ms : null;
      let result: AdapterOutcome;
      try {
        result = await this.#attemptOnce(session, req, entry, target, n, deadline, opts, est, cap);
      } finally {
        release();
      }
      attempts.push({ route: target, outcome: result });

      const breaker = this.#breaker(target);
      if (result.status === 'ok' || result.status === 'refused' || result.status === 'invalid_output') breaker.onSuccess(ticket.probe);
      else if (result.status === 'cancelled' || result.status === 'budget_exceeded') breaker.onNeutral(ticket.probe);
      else breaker.onFailure(ticket.probe);

      // Retry only transient failures; an explicit fallback also covers availability failures of the
      // primary (auth, missing model, ...). Refusals and bad output are never re-routed to another model.
      const availabilityFailure = result.status === 'unavailable' || result.status === 'timeout' || result.status === 'rate_limited';
      const retryWorthy = result.retryable || (n === 1 && fallback !== null && target === primary && availabilityFailure);
      if (result.status === 'ok' || !retryWorthy || n >= primary.retry.max_attempts) break;
      if (cancelSignal.aborted) break;

      const delay = backoffDelayMs(n, target.retry, this.#rng, result.error?.retry_after_ms);
      if (deadline.remaining() - delay < primary.retry.min_remaining_ms) {
        this.log.info('retry_skipped', { session: session.id, task_id: req.task_id, route: target.id, remaining_ms: Math.round(deadline.remaining()), delay_ms: delay, reason: 'no_time' });
        break;
      }
      this.log.info('retry_scheduled', { session: session.id, task_id: req.task_id, route: target.id, next_route: (fallback ?? primary).id, delay_ms: delay, status: result.status });
      try {
        await this.clock.sleep(delay, cancelSignal);
      } catch {
        [finalStatus, finalFinish, finalError] = ['cancelled', 'gateway:cancelled', { code: 'cancelled', message: 'задача отменена игрой' }];
        break;
      }
    }

    if (finalStatus === null) {
      const last = attempts[attempts.length - 1]?.outcome;
      finalStatus = last?.status ?? 'unavailable';
      finalFinish = last?.finishReason ?? 'gateway:no_attempt';
      finalError = last?.error ?? null;
    }
    if (cancelSignal.aborted && finalStatus !== 'cancelled') {
      // Cancelled by the game: whatever arrived (even a complete answer) is discarded.
      finalStatus = 'cancelled';
      finalFinish = 'gateway:cancelled';
      finalError = { code: 'cancelled', message: 'задача отменена игрой; ответ отброшен' };
    }
    return this.#finish(session, req, lastRoute, { status: finalStatus, attempts, receivedAt: opts.receivedAt, queueMs, finishReason: finalFinish, error: finalError });
  }

  async #acquireSlots(route: RouteConfig, signal: AbortSignal, timeoutMs: number): Promise<() => void> {
    const routeSlots = this.#routeSlots.get(route.id) as Semaphore;
    const releaseRoute = await routeSlots.acquire(signal, timeoutMs);
    try {
      const releaseGlobal = await this.#globalSlots.acquire(signal, timeoutMs);
      return () => {
        releaseGlobal();
        releaseRoute();
      };
    } catch (e) {
      releaseRoute();
      throw e;
    }
  }

  #breaker(route: RouteConfig): CircuitBreaker {
    return this.#breakers.get(route.id) as CircuitBreaker;
  }

  #httpFor(route: RouteConfig, session: Session): PinnedHttpClient | null {
    if (route.adapter === 'mock') return null;
    if (route.user_supplied_endpoint) {
      const ep = session.customEndpoint;
      if (!ep) return null;
      let c = this.#sessionClients.get(session.id);
      if (!c) {
        c = new PinnedHttpClient({ baseUrl: ep.url, ...routeEndpointRules(route), resolver: this.#resolver, maxResponseBytes: this.config.limits.max_response_bytes });
        this.#sessionClients.set(session.id, c);
      }
      return c;
    }
    let c = this.#clients.get(route.id);
    if (!c && route.endpoint) {
      c = new PinnedHttpClient({ baseUrl: route.endpoint, ...routeEndpointRules(route), resolver: this.#resolver, maxResponseBytes: this.config.limits.max_response_bytes });
      this.#clients.set(route.id, c);
    }
    return c ?? null;
  }

  /** The owner's key never goes to a user-supplied endpoint; that route only uses the session's own key. */
  #apiKeyFor(route: RouteConfig, session: Session): string | null {
    if (route.user_supplied_endpoint) return session.customEndpoint?.apiKey ?? null;
    return this.secrets.get(route.id);
  }

  async #handshake(route: RouteConfig, session: Session, adapter: ProviderAdapter, http: PinnedHttpClient | null, signal: AbortSignal, timeoutMs: number): Promise<ProbeResult> {
    const key = route.user_supplied_endpoint ? `${route.id}:${session.id}` : route.id;
    const cached = this.#handshakes.get(key);
    const now = this.clock.now();
    if (cached) {
      const ok = cached.result.status === 'ok' || cached.result.status === 'degraded';
      if (now - cached.at < (ok ? this.#handshakeTtlMs : HANDSHAKE_FAILURE_TTL_MS)) return cached.result;
    }
    const result = await adapter.probe({
      route,
      http,
      apiKey: this.#apiKeyFor(route, session),
      model: this.#modelFor(route, session),
      signal,
      timeoutMs,
      deep: false,
      clock: this.clock,
      declaredCapabilities: session.customEndpoint?.declaredCapabilities,
    });
    // A handshake cut short by the request's own deadline/cancel says nothing about the endpoint.
    if (signal.aborted || result.error?.code === 'aborted' || result.error?.code === 'timeout') return result;
    this.#handshakes.set(key, { result, at: this.clock.now() });
    this.#probeCache.set(key, result);
    this.log.info('handshake', { route: route.id, status: result.status, model_available: result.model_available, error: result.error?.code ?? null });
    return result;
  }

  async #attemptOnce(
    session: Session,
    req: GatewayRequest,
    entry: TaskEntry,
    route: RouteConfig,
    attemptNo: number,
    deadline: Deadline,
    opts: HandleOptions,
    est: { inputTokens: number; outputTokens: number; costUsd: number },
    cap: number | null,
  ): Promise<AdapterOutcome> {
    const adapter = adapterFor(this.adapters, route.adapter);
    const overall = deadline.remaining() - this.config.limits.deadline_margin_ms;
    if (overall <= 0) return outcome('timeout', { usage: zeroUsage(true), finishReason: 'gateway:deadline', error: { code: 'deadline', message: 'срок истёк до вызова провайдера' } });
    const budget = cap !== null ? Math.min(overall, cap) : overall;
    const capped = budget < overall;
    let http: PinnedHttpClient | null;
    try {
      http = this.#httpFor(route, session);
    } catch (e) {
      return netErrorOutcome(e);
    }

    const ctl = new AbortController();
    const onCancel = () => ctl.abort('cancelled');
    if (entry.controller.signal.aborted) ctl.abort('cancelled');
    entry.controller.signal.addEventListener('abort', onCancel, { once: true });
    const timer = setTimeout(() => ctl.abort(capped ? 'attempt_cap' : 'deadline'), budget);
    const aborted = new Promise<null>((resolve) => {
      if (ctl.signal.aborted) resolve(null);
      ctl.signal.addEventListener('abort', () => resolve(null), { once: true });
    });

    const model = this.#modelFor(route, session);
    const run = async (): Promise<AdapterOutcome> => {
      if (adapter.requiresHandshake) {
        const hs = await this.#handshake(route, session, adapter, http, ctl.signal, Math.min(budget, 2000));
        const state = req.capability === 'generate_dialogue' ? hs.capabilities.generate_dialogue : hs.capabilities.generate_intent;
        if (hs.status === 'unavailable' || hs.status === 'not_configured') {
          const transient = hs.error?.code === 'connect_failed' || hs.error?.code === 'dns_failed' || hs.error?.code === 'model_loading' || hs.error?.code === 'timeout';
          return outcome('unavailable', { usage: zeroUsage(true), finishReason: 'gateway:handshake', retryable: transient, error: hs.error ?? { code: 'handshake_failed', message: 'capability handshake не прошёл' } });
        }
        if (state !== 'supported' && state !== 'declared') {
          return outcome('unavailable', {
            usage: zeroUsage(true),
            finishReason: 'gateway:capability_unsupported',
            error: { code: 'capability_unsupported', message: `endpoint маршрута ${route.id}: ${req.capability} — ${state} (по результату handshake)` },
          });
        }
      }
      const ctx: AdapterContext = {
        route,
        http,
        apiKey: this.#apiKeyFor(route, session),
        model,
        signal: ctl.signal,
        timeoutMs: budget,
        attempt: attemptNo,
        clock: this.clock,
        mockBehavior: opts.mockHeader ?? null,
        log: this.log.child({ route: route.id, task_id: req.task_id }),
        declaredCapabilities: session.customEndpoint?.declaredCapabilities,
      };
      if (req.capability === 'generate_dialogue') {
        if (!adapter.generateDialogue) {
          return outcome('unavailable', { usage: zeroUsage(true), finishReason: 'gateway:capability_unsupported', error: { code: 'capability_unsupported', message: 'адаптер не поддерживает generate_dialogue' } });
        }
        return adapter.generateDialogue(req, ctx);
      }
      return adapter.generateIntent(req, ctx);
    };

    const call = run().catch((e: unknown) => netErrorOutcome(e));
    const winner = await Promise.race([call, aborted]);
    clearTimeout(timer);
    entry.controller.signal.removeEventListener('abort', onCancel);

    if (winner !== null) {
      this.#account(session, route, model, winner.usage);
      return winner;
    }

    // Aborted (deadline or cancel). The provider may still finish and bill: keep a worst-case estimate
    // until (and unless) a late answer reports measured usage; the late answer itself is discarded.
    const reason = ctl.signal.reason === 'cancelled' ? 'cancelled' : 'timeout';
    const price = this.prices.lookup(route.id, model);
    const estOut = adapter.outputTokenBudget(req, route);
    const estCost = price ? maxRequestCostUsd(est.inputTokens, estOut, price) : 0;
    this.sessions.recordAbortedEstimate(session, est.inputTokens, estOut, estCost);
    void call.then((late) => {
      if (late.status === 'cancelled' || late.status === 'timeout') return; // the adapter honored the abort
      this.sessions.reconcileAborted(session, est.inputTokens, estOut, estCost);
      this.#account(session, route, model, late.usage);
      this.log.info('late_response_discarded', {
        session: session.id,
        task_id: req.task_id,
        route: route.id,
        late_status: late.status,
        reason,
        usage: late.usage,
        content: { proposal_text: late.text },
      });
    });
    const attemptCapped = ctl.signal.reason === 'attempt_cap';
    return outcome(reason, {
      usage: { ...zeroUsage(false) },
      finishReason: reason === 'cancelled' ? 'gateway:cancelled' : attemptCapped ? 'gateway:attempt_timeout' : 'gateway:deadline',
      // A capped attempt leaves time for the single retry/fallback.
      retryable: attemptCapped,
      error:
        reason === 'cancelled'
          ? { code: 'cancelled', message: 'задача отменена игрой; поздний ответ будет отброшен' }
          : attemptCapped
            ? { code: 'attempt_timeout', message: `попытка ограничена ${Math.round(budget)} мс (retry.attempt_timeout_ms); поздний ответ будет отброшен` }
            : { code: 'deadline', message: `общий срок ${req.deadline_ms} мс истёк; поздний ответ будет отброшен` },
    });
  }

  #account(session: Session, route: RouteConfig, model: string, usage: NormalizedUsage): void {
    const price = this.prices.lookup(route.id, model);
    const cost = price ? usageCostUsd(usage, price) : null;
    this.sessions.recordAttempt(session, route.id, usage, cost, price?.fictional ?? null);
  }

  #finish(
    session: Session,
    req: GatewayRequest,
    route: RouteConfig,
    p: { status: GatewayStatus; attempts: AttemptRecord[]; receivedAt: number; queueMs: number; finishReason: string; error: UpstreamError | null },
  ): GatewayResult {
    const result = this.#result(req, route, session, p);
    this.sessions.recordStatus(session, result.status);
    this.log.info('result', {
      session: session.id,
      task_id: req.task_id,
      actor: req.actor_id,
      capability: req.capability,
      route: result.provider,
      model: result.model,
      status: result.status,
      attempts: result.attempts,
      latency_ms: result.latency_ms,
      usage: result.usage,
      cost_usd: result.cost_usd ?? null,
      finish_reason: result.finish_reason,
      error: result.error?.code ?? null,
      content: { player_utterance: req.player_utterance ?? null, proposal_text: result.proposal_text },
    });
    return result;
  }

  #result(
    req: GatewayRequest,
    route: RouteConfig,
    session: Session,
    p: { status: GatewayStatus; attempts: AttemptRecord[]; receivedAt: number; queueMs: number; finishReason: string; error: UpstreamError | null },
  ): GatewayResult {
    const usage = p.attempts.reduce(
      (a, r) => ({
        input_tokens: a.input_tokens + r.outcome.usage.input_tokens,
        output_tokens: a.output_tokens + r.outcome.usage.output_tokens,
        cached_input_tokens: a.cached_input_tokens + r.outcome.usage.cached_input_tokens,
        reasoning_tokens: a.reasoning_tokens + r.outcome.usage.reasoning_tokens,
        measured: a.measured && r.outcome.usage.measured,
      }),
      { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, reasoning_tokens: 0, measured: true },
    );
    let cost: number | null = p.attempts.length ? 0 : null;
    let fictional: boolean | null = null;
    for (const a of p.attempts) {
      const price = this.prices.lookup(a.route.id, this.#modelFor(a.route, session));
      if (!price || cost === null) {
        cost = null;
        continue;
      }
      cost += usageCostUsd(a.outcome.usage, price);
      fictional = fictional === true || price.fictional;
    }
    const last = p.attempts[p.attempts.length - 1]?.outcome;
    // Only a complete answer is returned; invalid_output keeps the raw text for diagnostics.
    const text = p.status === 'ok' || p.status === 'invalid_output' ? last?.text ?? null : null;
    const firstToken = last?.firstTokenMs ?? null;
    const result: GatewayResult = {
      task_id: req.task_id,
      status: p.status,
      proposal_text: text,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        ...(usage.cached_input_tokens ? { cached_input_tokens: usage.cached_input_tokens } : {}),
        ...(usage.reasoning_tokens ? { reasoning_tokens: usage.reasoning_tokens } : {}),
        measured: usage.measured,
      },
      latency_ms: { total: Math.round(this.clock.now() - p.receivedAt), first_token: firstToken, queue: Math.round(p.queueMs) },
      provider: route.id,
      model: this.#modelFor(route, session),
      provider_revision: last?.providerRevision ?? null,
      finish_reason: p.finishReason,
      attempts: p.attempts.length,
      cost_usd: cost === null ? null : Number(cost.toFixed(9)),
      ...(fictional !== null ? { cost_is_fictional: fictional } : {}),
      error: p.status === 'ok' ? null : p.error ?? { code: p.status, message: p.status },
    };
    return this.secrets.redactValue(result);
  }

  // ------------------------------------------------------------ cancel / status endpoints

  cancel(session: Session, raw: unknown): GatewayResponse {
    const taskId = (raw as { task_id?: unknown } | null)?.task_id;
    if (typeof taskId !== 'string' || !/^req-[0-9]{6}$/.test(taskId)) {
      return { httpStatus: 400, body: errorBody('invalid_request', 'task_id: ожидается req-NNNNNN') };
    }
    const r = this.tasks.cancel(`${session.id}:${taskId}`);
    this.log.info('cancel', { session: session.id, task_id: taskId, cancelled: r.cancelled, state: r.state });
    return {
      httpStatus: 200,
      body: {
        task_id: taskId,
        cancelled: r.cancelled,
        state: r.state,
        note_ru: 'Отмена — best effort: соединение с провайдером разрывается, поздний ответ отбрасывается, но провайдер мог уже потратить токены.',
      },
    };
  }

  health(): Record<string, unknown> {
    return {
      status: 'ok',
      gateway_version: GATEWAY_VERSION,
      uptime_s: Math.round((this.clock.wallNow() - this.startedAtWall) / 1000),
      sessions: this.sessions.size,
      global: { active: this.#globalSlots.active, queued: this.#globalSlots.queued, limit: this.#globalSlots.limit },
      routes: this.config.routes.map((r) => {
        const slots = this.#routeSlots.get(r.id) as Semaphore;
        const hs = this.#handshakes.get(r.id);
        return {
          id: r.id,
          adapter: r.adapter,
          enabled: r.enabled,
          locality: r.locality,
          model: r.model,
          breaker: this.#breaker(r).snapshot(),
          active: slots.active,
          queued: slots.queued,
          concurrency: r.concurrency,
          handshake: hs ? { status: hs.result.status, checked_at: hs.result.checked_at, error: hs.result.error?.code ?? null } : null,
          key_configured: r.adapter === 'mock' || r.locality === 'local' || r.user_supplied_endpoint ? null : this.secrets.has(r.id),
        };
      }),
    };
  }

  /** Probe results without secrets. Only routes permitted for the session's privacy profile are contacted. */
  async providers(session: Session | null, opts: { refresh: boolean; deep: boolean; allowRemoteDeep?: boolean }): Promise<Record<string, unknown>> {
    const profile: PrivacyProfile = session?.privacy_profile ?? 'offline';
    const out = await Promise.all(
      this.config.routes.map(async (r) => {
        const key = r.user_supplied_endpoint && session ? `${r.id}:${session.id}` : r.id;
        const adapter = adapterFor(this.adapters, r.adapter);
        if (!r.enabled) return { ...this.#stubProbe(r, adapter, 'disabled'), note_ru: 'маршрут выключен в конфигурации' };
        const permitted = routePermitted(this.config, r, profile, session ?? null);
        if (!permitted.ok) return { ...this.#stubProbe(r, adapter, 'not_configured'), note_ru: `не опрашивался: ${permitted.message}` };
        const cached = this.#probeCache.get(key);
        if (cached && !opts.refresh) return cached;
        const deep = opts.deep && (r.locality === 'local' || opts.allowRemoteDeep === true);
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 5000);
        try {
          const http = session ? this.#httpFor(r, session) : r.user_supplied_endpoint ? null : this.#httpForConfigRoute(r);
          const result = await adapter.probe({
            route: r,
            http,
            apiKey: session ? this.#apiKeyFor(r, session) : r.user_supplied_endpoint ? null : this.secrets.get(r.id),
            model: session ? this.#modelFor(r, session) : r.model,
            signal: ctl.signal,
            timeoutMs: 5000,
            deep,
            clock: this.clock,
            declaredCapabilities: session?.customEndpoint?.declaredCapabilities,
          });
          this.#probeCache.set(key, result);
          return result;
        } catch (e) {
          return { ...this.#stubProbe(r, adapter, 'unavailable'), error: netErrorOutcome(e).error };
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    return this.secrets.redactValue({ privacy_profile: profile, providers: out, note_ru: 'probe проверяет доступность и заявленные возможности; это не измерение качества, задержки или надёжности.' });
  }

  #httpForConfigRoute(r: RouteConfig): PinnedHttpClient | null {
    if (r.adapter === 'mock' || !r.endpoint) return null;
    let c = this.#clients.get(r.id);
    if (!c) {
      c = new PinnedHttpClient({ baseUrl: r.endpoint, ...routeEndpointRules(r), resolver: this.#resolver, maxResponseBytes: this.config.limits.max_response_bytes });
      this.#clients.set(r.id, c);
    }
    return c;
  }

  #stubProbe(r: RouteConfig, adapter: ProviderAdapter, status: ProbeResult['status']): ProbeResult {
    return {
      route: r.id,
      adapter: r.adapter,
      adapter_version: adapter.version,
      status,
      model: r.model,
      model_available: null,
      served_model: null,
      capabilities: { generate_intent: 'unverified', generate_dialogue: 'unverified', structured_output: adapter.structuredOutput, thinking_control: adapter.thinkingControl },
      details: {},
      checked_at: new Date(this.clock.wallNow()).toISOString(),
      latency_ms: null,
      error: null,
    };
  }

  usage(session: Session): Record<string, unknown> {
    return this.secrets.redactValue(this.sessions.report(session));
  }

  manifest(): Record<string, unknown> {
    let promptSha: string | null = null;
    try {
      promptSha = sha256(readFileSync(new URL('../../shared/prompt.ts', import.meta.url), 'utf8'));
    } catch {
      promptSha = null;
    }
    return {
      kind: 'zero-echo.gateway.manifest.v1',
      gateway_version: GATEWAY_VERSION,
      schema_version: INTENT_SCHEMA_VERSION,
      request_schema: 'zero-echo.gateway.request.v1',
      result_schema: 'zero-echo.gateway.result.v1',
      dialogue_schema: 'zero-echo.dialogue.v1',
      prompt_version: PROMPT_VERSION,
      prompt_source_sha256: promptSha,
      git_revision: gitRevision(),
      node_version: process.version,
      pricing: { source: this.prices.source, all_fictional: this.prices.entries.every((e) => e.fictional) },
      routes: this.config.routes.map((r) => {
        const adapter = adapterFor(this.adapters, r.adapter);
        const price = this.prices.lookup(r.id, r.model);
        return {
          id: r.id,
          adapter: r.adapter,
          adapter_version: adapter.version,
          enabled: r.enabled,
          locality: r.locality,
          model: r.model,
          model_revision: r.model_revision,
          model_pinned: !isFloatingModelAlias(r.model),
          endpoint_origin: r.endpoint ? new URL(r.endpoint).origin : r.user_supplied_endpoint ? '(задаётся сессией, только https на публичные адреса)' : null,
          structured_output: adapter.structuredOutput,
          thinking_control: adapter.thinkingControl,
          capabilities: r.capabilities,
          fallback_route: r.fallback_route,
          retry_max_attempts: r.retry.max_attempts,
          price: price ? { input_per_mtok: price.input_per_mtok, output_per_mtok: price.output_per_mtok, fictional: price.fictional } : null,
        };
      }),
    };
  }
}
