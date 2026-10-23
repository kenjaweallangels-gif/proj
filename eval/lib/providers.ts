// Proposal sources for the eval: the core's own UtilityPolicy (rules), the Agent Gateway in-process
// (mock behaviours or any configured route) and a running gateway over HTTP. Every provider returns a
// GatewayResult (schemas/gateway_result.schema.json) that goes into the core unchanged.

import path from 'node:path';
import type { GatewayRequest, GatewayResult } from '../../web/src/contracts.ts';
import type { EchoCore } from './core.ts';
import { REPO_ROOT } from './core.ts';

export type CoreBackend = 'rules' | 'cpu' | 'remote';
export type PrivacyProfile = 'offline' | 'hybrid' | 'online';

export interface ProviderInfo {
  spec: string;
  kind: 'rules' | 'mock' | 'route' | 'gateway';
  route: string | null;
  adapter: string | null;
  model: string | null;
  locality: 'local' | 'remote' | null;
  mock_behavior: string | null;
  core_backend: CoreBackend;
  privacy_profile: PrivacyProfile;
  /** false for rules and mock: no language model is involved at all. */
  is_language_model: boolean;
  endpoint: string | null;
  note_ru: string;
}

export interface ProposalCall {
  result: GatewayResult;
  /** Host wall time of the call (performance.now), milliseconds. */
  wallMs: number;
  /** Provider-specific notes (e.g. the policy's reason, a transport problem). */
  note?: string;
}

export interface Preflight {
  ok: boolean;
  reason_ru?: string;
  details?: unknown;
}

export interface Provider {
  readonly info: ProviderInfo;
  preflight(): Promise<Preflight>;
  propose(core: EchoCore, request: GatewayRequest): Promise<ProposalCall>;
  close(): Promise<void>;
  /** Diagnostics for the report (gateway warnings, HTTP failures). */
  diagnostics(): Record<string, unknown>;
}

export const DEFAULT_CONFIG = path.join(REPO_ROOT, 'data', 'providers.example.json');

// ------------------------------------------------------------------ rules

export class RulesProvider implements Provider {
  readonly info: ProviderInfo = {
    spec: 'rules',
    kind: 'rules',
    route: null,
    adapter: null,
    model: 'utility-policy',
    locality: 'local',
    mock_behavior: null,
    core_backend: 'rules',
    privacy_profile: 'offline',
    is_language_model: false,
    endpoint: null,
    note_ru: 'Обычный игровой ИИ ядра (UtilityPolicy, команда rules_propose). Модель не используется; задержка — время CPU этой машины.',
  };

  async preflight(): Promise<Preflight> {
    return { ok: true };
  }

  async propose(core: EchoCore, request: GatewayRequest): Promise<ProposalCall> {
    const t0 = performance.now();
    const p = core.must({ cmd: 'rules_propose', task_id: request.task_id });
    const wallMs = performance.now() - t0;
    return {
      wallMs,
      note: typeof p.why_ru === 'string' ? p.why_ru : undefined,
      result: {
        task_id: request.task_id,
        status: 'ok',
        proposal_text: String(p.proposal_text),
        usage: { input_tokens: 0, output_tokens: 0, measured: false },
        latency_ms: { total: wallMs, first_token: null },
        provider: 'rules',
        model: 'utility-policy',
        finish_reason: 'stop',
        attempts: 1,
      },
    };
  }

  async close(): Promise<void> {}

  diagnostics(): Record<string, unknown> {
    return {};
  }
}

// ------------------------------------------------------------------ gateway in-process

class MemorySink {
  readonly counts: Record<string, number> = {};
  readonly notable: string[] = [];

  write(line: string): void {
    try {
      const rec = JSON.parse(line) as { level?: string; event?: string };
      const level = rec.level ?? 'info';
      this.counts[level] = (this.counts[level] ?? 0) + 1;
      if ((level === 'warn' || level === 'error') && this.notable.length < 20) this.notable.push(line.trim());
    } catch {
      this.counts.unparsed = (this.counts.unparsed ?? 0) + 1;
    }
  }
}

type GatewayModule = typeof import('../../gateway/src/gateway.ts');
type ConfigModule = typeof import('../../gateway/src/config.ts');
type GatewayInstance = InstanceType<GatewayModule['Gateway']>;

/**
 * The Agent Gateway as a library (gateway/README: programmatic use). One session per scene: every fresh core
 * restarts its task ids at req-000001 and the gateway scopes task ids per session.
 * By default every scene also gets a fresh gateway instance, so circuit breakers and quotas opened by one
 * scene do not decide the next one (scenes are independent games). `shared: true` keeps one instance to
 * observe exactly those cross-request effects.
 */
export class InProcessGatewayProvider implements Provider {
  readonly info: ProviderInfo;
  readonly #configPath: string;
  readonly #shared: boolean;
  readonly #sink = new MemorySink();
  #gw: GatewayInstance | null = null;
  #gatewayClass: GatewayModule['Gateway'] | null = null;
  #loadConfig: ConfigModule['loadConfig'] | null = null;
  #sessions = 0;
  #instances = 0;
  #httpErrors: Record<string, number> = {};

  constructor(opts: { routeId: string; mockBehavior: string | null; configPath?: string; privacy?: PrivacyProfile | null; spec: string; shared?: boolean }) {
    this.#configPath = opts.configPath ?? DEFAULT_CONFIG;
    this.#shared = opts.shared ?? false;
    this.info = {
      spec: opts.spec,
      kind: opts.mockBehavior !== null ? 'mock' : 'route',
      route: opts.routeId,
      adapter: null,
      model: null,
      locality: null,
      mock_behavior: opts.mockBehavior,
      core_backend: 'cpu',
      privacy_profile: opts.privacy ?? 'offline',
      is_language_model: false,
      endpoint: null,
      note_ru: '',
    };
  }

  async #newGateway(): Promise<GatewayInstance> {
    if (!this.#gatewayClass || !this.#loadConfig) {
      const [g, c] = (await Promise.all([import('../../gateway/src/gateway.ts'), import('../../gateway/src/config.ts')])) as [GatewayModule, ConfigModule];
      this.#gatewayClass = g.Gateway;
      this.#loadConfig = c.loadConfig;
    }
    this.#instances++;
    return new this.#gatewayClass(this.#loadConfig(this.#configPath), { logSink: this.#sink });
  }

  async #gateway(): Promise<GatewayInstance> {
    this.#gw ??= await this.#newGateway();
    return this.#gw;
  }

  async preflight(): Promise<Preflight> {
    let gw: GatewayInstance;
    try {
      gw = await this.#gateway();
    } catch (e) {
      return { ok: false, reason_ru: `шлюз не создан из ${path.relative(REPO_ROOT, this.#configPath)}: ${(e as Error).message}` };
    }
    const route = gw.config.routes.find((r) => r.id === this.info.route);
    if (!route) return { ok: false, reason_ru: `в ${path.relative(REPO_ROOT, this.#configPath)} нет маршрута ${this.info.route}` };
    this.info.adapter = route.adapter;
    this.info.model = route.model ?? null;
    this.info.locality = route.locality;
    this.info.endpoint = route.endpoint ? new URL(route.endpoint).origin : null;
    this.info.is_language_model = route.adapter !== 'mock';
    if (route.locality === 'remote') {
      this.info.core_backend = 'remote';
      if (this.info.privacy_profile === 'offline') this.info.privacy_profile = 'online';
    }
    this.info.note_ru =
      route.adapter === 'mock'
        ? `Agent Gateway в процессе, маршрут ${route.id} (адаптер mock: детерминированный генератор БЕЗ модели), поведение «${this.info.mock_behavior ?? 'из конфигурации'}». Usage — оценка шлюза.`
        : `Agent Gateway в процессе, маршрут ${route.id} (адаптер ${route.adapter}, модель ${route.model}).`;
    const keyName = `ECHO_KEY_${route.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const needsKey = route.locality === 'remote' && !route.user_supplied_endpoint;
    const keyNote = needsKey ? (gw.secrets.has(route.id) ? `; ключ ${keyName} задан` : `; ключ ${keyName} не задан`) : '';
    if (!route.enabled) return { ok: false, reason_ru: `маршрут ${route.id} выключен в ${path.relative(REPO_ROOT, this.#configPath)} (enabled: false)${keyNote}` };
    if (this.info.mock_behavior !== null && route.adapter !== 'mock') return { ok: false, reason_ru: `маршрут ${route.id} не mock: поведение X-Echo-Mock неприменимо` };
    if (route.adapter === 'mock') return { ok: true };
    const created = await gw.createSession({ privacy_profile: this.info.privacy_profile, client: 'eval' });
    const token = (created.body as { session_token?: string }).session_token;
    if (created.httpStatus !== 200 || !token) return { ok: false, reason_ru: `сессия шлюза не создана: ${JSON.stringify(created.body)}` };
    const session = gw.sessions.authenticate(`Bearer ${token}`);
    const probe = await gw.providers(session, { refresh: true, deep: false });
    const entry = (probe.providers as { route: string; status: string; error?: { code?: string; message?: string } | null; note_ru?: string }[]).find((p) => p.route === route.id);
    if (!entry || (entry.status !== 'ok' && entry.status !== 'degraded')) {
      const why = entry?.error ? `${entry.error.code}: ${entry.error.message}` : entry?.note_ru ?? entry?.status ?? 'нет результата probe';
      return { ok: false, reason_ru: `probe маршрута ${route.id}: ${entry?.status ?? 'нет данных'} (${why})`, details: entry };
    }
    return { ok: true, details: entry };
  }

  async propose(_core: EchoCore, request: GatewayRequest): Promise<ProposalCall> {
    const gw = this.#shared ? await this.#gateway() : await this.#newGateway();
    try {
      return await this.#proposeWith(gw, request);
    } finally {
      if (!this.#shared) gw.close();
    }
  }

  async #proposeWith(gw: GatewayInstance, request: GatewayRequest): Promise<ProposalCall> {
    const created = await gw.createSession({ privacy_profile: this.info.privacy_profile, client: 'eval' });
    const token = (created.body as { session_token?: string }).session_token;
    const session = token ? gw.sessions.authenticate(`Bearer ${token}`) : null;
    if (!session) throw new Error(`шлюз не выдал сессию: ${JSON.stringify(created.body)}`);
    this.#sessions++;
    const t0 = performance.now();
    const r = await gw.handle(session, request, 'generate_intent', {
      receivedAt: gw.clock.now(),
      routeHeader: this.info.route ?? undefined,
      mockHeader: this.info.mock_behavior ?? undefined,
    });
    const wallMs = performance.now() - t0;
    if (r.httpStatus !== 200) {
      // A 4xx here means the core's request broke the gateway contract — an interface bug, not a model outcome.
      const code = (r.body as { error?: { code?: string } }).error?.code ?? `http_${r.httpStatus}`;
      this.#httpErrors[code] = (this.#httpErrors[code] ?? 0) + 1;
      throw new Error(`шлюз отклонил запрос ${request.task_id}: HTTP ${r.httpStatus} ${JSON.stringify(r.body).slice(0, 600)}`);
    }
    return { result: r.body as GatewayResult, wallMs };
  }

  async close(): Promise<void> {
    this.#gw?.close();
  }

  diagnostics(): Record<string, unknown> {
    return {
      gateway_mode: this.#shared ? 'shared' : 'fresh_per_scene',
      gateway_instances: this.#instances,
      gateway_sessions: this.#sessions,
      gateway_log_levels: this.#sink.counts,
      gateway_warnings: this.#sink.notable,
      gateway_http_errors: this.#httpErrors,
    };
  }
}

// ------------------------------------------------------------------ gateway over HTTP

export class HttpGatewayProvider implements Provider {
  readonly info: ProviderInfo;
  readonly #base: string;
  #transportErrors: Record<string, number> = {};
  #sessions = 0;

  constructor(opts: { baseUrl: string; routeId: string; mockBehavior: string | null; privacy?: PrivacyProfile | null; spec: string }) {
    this.#base = opts.baseUrl.replace(/\/+$/, '');
    this.info = {
      spec: opts.spec,
      kind: 'gateway',
      route: opts.routeId,
      adapter: null,
      model: null,
      locality: null,
      mock_behavior: opts.mockBehavior,
      core_backend: 'cpu',
      privacy_profile: opts.privacy ?? 'offline',
      is_language_model: false,
      endpoint: this.#base,
      note_ru: '',
    };
  }

  async #json(method: 'GET' | 'POST', url: string, body: unknown, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${this.#base}${url}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 400) };
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  async #session(): Promise<string> {
    const r = await this.#json('POST', '/v1/session', { privacy_profile: this.info.privacy_profile, client: 'eval' }, {}, 5000);
    if (r.status !== 200 || typeof r.body?.session_token !== 'string') throw new Error(`POST /v1/session → HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    this.#sessions++;
    return r.body.session_token as string;
  }

  async preflight(): Promise<Preflight> {
    try {
      const health = await this.#json('GET', '/v1/health', undefined, {}, 3000);
      if (health.status !== 200) return { ok: false, reason_ru: `шлюз ${this.#base} ответил HTTP ${health.status} на /v1/health` };
      const route = (health.body?.routes ?? []).find((r: { id: string }) => r.id === this.info.route);
      if (!route) return { ok: false, reason_ru: `на шлюзе ${this.#base} нет маршрута ${this.info.route}` };
      this.info.adapter = route.adapter ?? null;
      this.info.model = route.model ?? null;
      this.info.locality = route.locality ?? null;
      this.info.is_language_model = route.adapter !== 'mock';
      if (route.locality === 'remote') {
        this.info.core_backend = 'remote';
        if (this.info.privacy_profile === 'offline') this.info.privacy_profile = 'online';
      }
      this.info.note_ru = `Agent Gateway по HTTP (${this.#base}), маршрут ${route.id} (адаптер ${route.adapter}, модель ${route.model}).`;
      if (!route.enabled) return { ok: false, reason_ru: `маршрут ${route.id} выключен на шлюзе` };
      if (route.adapter === 'mock') return { ok: true };
      const token = await this.#session();
      const probe = await this.#json('GET', '/v1/providers?refresh=1', undefined, { authorization: `Bearer ${token}` }, 8000);
      const entry = (probe.body?.providers ?? []).find((p: { route: string }) => p.route === this.info.route);
      if (!entry || (entry.status !== 'ok' && entry.status !== 'degraded')) {
        return { ok: false, reason_ru: `probe маршрута ${this.info.route}: ${entry?.status ?? `HTTP ${probe.status}`} (${entry?.error?.code ?? entry?.note_ru ?? ''})`, details: entry ?? probe.body };
      }
      return { ok: true, details: entry };
    } catch (e) {
      return { ok: false, reason_ru: `шлюз ${this.#base} недоступен: ${(e as Error).message}` };
    }
  }

  async propose(_core: EchoCore, request: GatewayRequest): Promise<ProposalCall> {
    const t0 = performance.now();
    try {
      const token = await this.#session();
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (this.info.route) headers['x-echo-route'] = this.info.route;
      if (this.info.mock_behavior) headers['x-echo-mock'] = this.info.mock_behavior;
      const r = await this.#json('POST', '/v1/intent', request, headers, request.deadline_ms + 5000);
      const wallMs = performance.now() - t0;
      if (r.status !== 200) {
        const code = r.body?.error?.code ?? `http_${r.status}`;
        this.#transportErrors[code] = (this.#transportErrors[code] ?? 0) + 1;
        if (r.status >= 400 && r.status < 500) throw new Error(`шлюз отклонил запрос ${request.task_id}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 600)}`);
        return { wallMs, result: transportFailure(request, `eval_http_${r.status}`, `HTTP ${r.status}`, wallMs), note: `HTTP ${r.status}` };
      }
      return { wallMs, result: r.body as GatewayResult };
    } catch (e) {
      const wallMs = performance.now() - t0;
      const msg = (e as Error).message;
      if (msg.startsWith('шлюз отклонил')) throw e;
      this.#transportErrors.transport = (this.#transportErrors.transport ?? 0) + 1;
      // The game client would see a dead connection exactly like this: provider unavailable → the core falls back.
      return { wallMs, result: transportFailure(request, 'eval_transport', msg, wallMs), note: msg };
    }
  }

  async close(): Promise<void> {}

  diagnostics(): Record<string, unknown> {
    return { gateway_sessions: this.#sessions, transport_errors: this.#transportErrors };
  }
}

function transportFailure(request: GatewayRequest, code: string, message: string, wallMs: number): GatewayResult {
  return {
    task_id: request.task_id,
    status: 'unavailable',
    proposal_text: null,
    usage: { input_tokens: 0, output_tokens: 0, measured: false },
    latency_ms: { total: wallMs, first_token: null },
    provider: 'eval-http-client',
    model: 'none',
    finish_reason: 'transport_error',
    attempts: 0,
    error: { code, message: message.slice(0, 300) },
  };
}

// ------------------------------------------------------------------ spec parsing

export class ProviderSpecError extends Error {}

/**
 * rules | mock:<behaviour> | route:<route id> | gateway:<url>:<route id>
 * (the URL may itself contain ':' — the route id is the part after the last ':').
 */
export function createProvider(spec: string, opts: { configPath?: string; privacy?: PrivacyProfile | null; mockBehavior?: string | null; sharedGateway?: boolean } = {}): Provider {
  if (spec === 'rules') return new RulesProvider();
  if (spec.startsWith('mock:')) {
    const behavior = spec.slice(5);
    if (!/^[a-z0-9_]+$/.test(behavior)) throw new ProviderSpecError(`неверное поведение mock: «${behavior}»`);
    return new InProcessGatewayProvider({ spec, routeId: 'mock', mockBehavior: behavior, configPath: opts.configPath, privacy: opts.privacy, shared: opts.sharedGateway });
  }
  if (spec.startsWith('route:')) {
    const routeId = spec.slice(6);
    if (!/^[a-z0-9_]+$/.test(routeId)) throw new ProviderSpecError(`неверный id маршрута: «${routeId}»`);
    return new InProcessGatewayProvider({ spec, routeId, mockBehavior: null, configPath: opts.configPath, privacy: opts.privacy, shared: opts.sharedGateway });
  }
  if (spec.startsWith('gateway:')) {
    const rest = spec.slice(8);
    const cut = rest.lastIndexOf(':');
    const url = cut > 0 ? rest.slice(0, cut) : '';
    const routeId = cut > 0 ? rest.slice(cut + 1) : '';
    if (!/^https?:\/\/[^\s]+$/.test(url) || !/^[a-z0-9_]+$/.test(routeId)) {
      throw new ProviderSpecError('ожидалось gateway:<http(s)://хост:порт>:<маршрут>, например gateway:http://127.0.0.1:8787:local_llamacpp');
    }
    return new HttpGatewayProvider({ spec, baseUrl: url, routeId, mockBehavior: opts.mockBehavior ?? null, privacy: opts.privacy });
  }
  throw new ProviderSpecError(`неизвестный провайдер «${spec}»: rules | mock:<поведение> | route:<маршрут> | gateway:<url>:<маршрут>`);
}
