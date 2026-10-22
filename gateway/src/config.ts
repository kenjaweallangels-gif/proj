// Loading and validation of the gateway config (data/providers.example.json format).
// Errors are collected and reported together with Russian messages; a config with any error is refused.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { checkEndpointUrl, NetError, routeEndpointRules } from './net.ts';
import { validateAdapterOptions } from './adapters/index.ts';
import { ADAPTER_KINDS } from './types.ts';
import type { AdapterKind, Capability, GatewayConfig, Quotas, RouteConfig } from './types.ts';

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`конфигурация шлюза отклонена:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const ROUTE_ID = /^[a-z][a-z0-9_]{0,31}$/;
const FLOATING_ALIASES = new Set(['', 'latest', 'default', 'auto', '*', 'current', 'stable', 'newest']);

/** "latest"-style aliases make runs irreproducible (Документ §16): pin an exact model/snapshot instead. */
export function isFloatingModelAlias(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (FLOATING_ALIASES.has(m)) return true;
  return /(^|[^a-z0-9])latest($|[^a-z0-9])/.test(m);
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number, name: string, problems: string[], min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    problems.push(`${name}: ожидается число в диапазоне [${min}, ${max}], получено ${JSON.stringify(v)}`);
    return fallback;
  }
  return v;
}

function bool(v: unknown, fallback: boolean, name: string, problems: string[]): boolean {
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') {
    problems.push(`${name}: ожидается true/false`);
    return fallback;
  }
  return v;
}

function strList(v: unknown, name: string, problems: string[]): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    problems.push(`${name}: ожидается массив строк`);
    return [];
  }
  return v as string[];
}

const DEFAULT_QUOTAS: Quotas = { requests_per_min: 30, tokens_per_hour: 200_000, cost_cap_usd: 1.0 };

function parseQuotas(raw: unknown, problems: string[], name: string): Quotas {
  const q = isObj(raw) ? raw : {};
  if (raw !== undefined && !isObj(raw)) problems.push(`${name}: ожидается объект`);
  return {
    requests_per_min: num(q.requests_per_min, DEFAULT_QUOTAS.requests_per_min, `${name}.requests_per_min`, problems, 0, 100_000),
    tokens_per_hour: num(q.tokens_per_hour, DEFAULT_QUOTAS.tokens_per_hour, `${name}.tokens_per_hour`, problems, 0, 1e10),
    cost_cap_usd: num(q.cost_cap_usd, DEFAULT_QUOTAS.cost_cap_usd, `${name}.cost_cap_usd`, problems, 0, 1e6),
  };
}

function parseRoute(raw: unknown, index: number, problems: string[]): RouteConfig | null {
  const at = `routes[${index}]`;
  if (!isObj(raw)) {
    problems.push(`${at}: ожидается объект`);
    return null;
  }
  const id = raw.id;
  if (typeof id !== 'string' || !ROUTE_ID.test(id)) {
    problems.push(`${at}.id: ожидается идентификатор [a-z][a-z0-9_]{0,31}`);
    return null;
  }
  const name = `маршрут ${id}`;
  const adapter = raw.adapter as AdapterKind;
  if (!ADAPTER_KINDS.includes(adapter)) {
    problems.push(`${name}: неизвестный адаптер ${JSON.stringify(raw.adapter)} (допустимы: ${ADAPTER_KINDS.join(', ')})`);
    return null;
  }
  const userSupplied = bool(raw.user_supplied_endpoint, false, `${name}.user_supplied_endpoint`, problems);
  const locality = raw.locality ?? (adapter === 'mock' ? 'local' : 'remote');
  if (locality !== 'local' && locality !== 'remote') problems.push(`${name}.locality: ожидается "local" или "remote"`);
  if (locality === 'local' && (adapter === 'openai' || adapter === 'anthropic' || adapter === 'gemini')) {
    problems.push(`${name}: адаптер ${adapter} — внешний API и не может быть локальным маршрутом`);
  }
  if (adapter === 'mock' && locality !== 'local') problems.push(`${name}: mock — всегда локальный маршрут`);

  let model = raw.model;
  if (model === undefined && userSupplied) model = 'session_supplied';
  if (typeof model !== 'string' || !model.trim()) {
    problems.push(`${name}.model: требуется закреплённый идентификатор модели`);
    model = 'invalid';
  } else if (isFloatingModelAlias(model)) {
    problems.push(`${name}.model: «${model}» — плавающий алиас (latest/default/auto) запрещён; укажите закреплённую версию модели (Документ §16: воспроизводимость, build manifest)`);
  }

  const networkRaw = isObj(raw.network) ? raw.network : {};
  const network = {
    allow_private_network: bool(networkRaw.allow_private_network, false, `${name}.network.allow_private_network`, problems),
    allow_insecure_http: bool(networkRaw.allow_insecure_http, false, `${name}.network.allow_insecure_http`, problems),
  };
  if (userSupplied) {
    if (adapter !== 'openai_compat') problems.push(`${name}: пользовательский endpoint поддерживается только адаптером openai_compat`);
    if (network.allow_private_network || network.allow_insecure_http) {
      problems.push(`${name}: для пользовательского endpoint нельзя разрешать частные сети или http — только https на публичные адреса`);
    }
    if (locality !== 'remote') problems.push(`${name}: пользовательский endpoint всегда считается удалённым`);
  }

  let endpoint: string | null = null;
  if (adapter !== 'mock' && !userSupplied) {
    if (typeof raw.endpoint !== 'string') {
      problems.push(`${name}.endpoint: требуется базовый URL`);
    } else {
      try {
        const rules = routeEndpointRules({ locality: locality as 'local' | 'remote', user_supplied_endpoint: false, network });
        endpoint = checkEndpointUrl(raw.endpoint, rules).href.replace(/\/+$/, '');
      } catch (e) {
        problems.push(`${name}.endpoint: ${e instanceof NetError ? e.message : String(e)}`);
      }
    }
  } else if (raw.endpoint !== undefined && raw.endpoint !== null) {
    problems.push(`${name}.endpoint: для ${userSupplied ? 'пользовательского endpoint адрес задаёт сессия' : 'mock адрес не нужен'}`);
  }

  const capabilities = strList(raw.capabilities ?? ['generate_intent'], `${name}.capabilities`, problems) as Capability[];
  for (const c of capabilities) {
    if (c !== 'generate_intent' && c !== 'generate_dialogue') problems.push(`${name}.capabilities: неизвестная возможность ${c}`);
  }

  const retryRaw = isObj(raw.retry) ? raw.retry : {};
  const maxAttempts = num(retryRaw.max_attempts, 2, `${name}.retry.max_attempts`, problems, 1, 2);
  const breakerRaw = isObj(raw.breaker) ? raw.breaker : {};

  const route: RouteConfig = {
    id,
    adapter,
    enabled: bool(raw.enabled, false, `${name}.enabled`, problems),
    locality: locality as 'local' | 'remote',
    endpoint,
    model: model as string,
    model_revision: typeof raw.model_revision === 'string' ? raw.model_revision : null,
    capabilities: capabilities.length ? capabilities : ['generate_intent'],
    concurrency: num(raw.concurrency, adapter === 'llamacpp' ? 1 : 4, `${name}.concurrency`, problems, 1, 256),
    max_queue: num(raw.max_queue, 4, `${name}.max_queue`, problems, 0, 1024),
    retry: {
      max_attempts: (Math.round(maxAttempts) === 1 ? 1 : 2) as 1 | 2,
      base_backoff_ms: num(retryRaw.base_backoff_ms, 150, `${name}.retry.base_backoff_ms`, problems, 0, 10_000),
      max_backoff_ms: num(retryRaw.max_backoff_ms, 1000, `${name}.retry.max_backoff_ms`, problems, 0, 30_000),
      min_remaining_ms: num(retryRaw.min_remaining_ms, 400, `${name}.retry.min_remaining_ms`, problems, 0, 60_000),
      attempt_timeout_ms: retryRaw.attempt_timeout_ms === undefined || retryRaw.attempt_timeout_ms === null ? null : num(retryRaw.attempt_timeout_ms, 0, `${name}.retry.attempt_timeout_ms`, problems, 50, 60_000),
    },
    breaker: {
      failure_threshold: num(breakerRaw.failure_threshold, 3, `${name}.breaker.failure_threshold`, problems, 1, 1000),
      cooldown_ms: num(breakerRaw.cooldown_ms, 15_000, `${name}.breaker.cooldown_ms`, problems, 1, 3_600_000),
      max_cooldown_ms: num(breakerRaw.max_cooldown_ms, 120_000, `${name}.breaker.max_cooldown_ms`, problems, 1, 86_400_000),
    },
    network,
    fallback_route: typeof raw.fallback_route === 'string' ? raw.fallback_route : null,
    user_supplied_endpoint: userSupplied,
    options: isObj(raw.options) ? raw.options : {},
    note_ru: typeof raw.note_ru === 'string' ? raw.note_ru : null,
  };
  if (raw.options !== undefined && !isObj(raw.options)) problems.push(`${name}.options: ожидается объект`);
  for (const p of validateAdapterOptions(route)) problems.push(`${name}.options: ${p}`);
  return route;
}

/** Validates an already-parsed config object. `configDir` resolves relative file paths. */
export function parseConfig(raw: unknown, configDir: string): GatewayConfig {
  const problems: string[] = [];
  if (!isObj(raw)) throw new ConfigError(['корень конфигурации должен быть объектом']);
  if (raw.format !== 'zero-echo.providers.v1') problems.push('format: ожидается "zero-echo.providers.v1"');

  const serverRaw = isObj(raw.server) ? raw.server : {};
  const origins = strList(serverRaw.allowed_origins, 'server.allowed_origins', problems);
  for (const o of origins) {
    try {
      if (new URL(o).origin !== o) problems.push(`server.allowed_origins: «${o}» — ожидается origin без пути (scheme://host[:port])`);
    } catch {
      problems.push(`server.allowed_origins: «${o}» — некорректный origin`);
    }
  }
  const limitsRaw = isObj(raw.limits) ? raw.limits : {};
  const privacyRaw = isObj(raw.privacy) ? raw.privacy : {};

  const routesRaw = Array.isArray(raw.routes) ? raw.routes : [];
  if (!routesRaw.length) problems.push('routes: нужен хотя бы один маршрут');
  const routes: RouteConfig[] = [];
  routesRaw.forEach((r, i) => {
    const route = parseRoute(r, i, problems);
    if (route) {
      if (routes.some((x) => x.id === route.id)) problems.push(`маршрут ${route.id}: повторяющийся id`);
      else routes.push(route);
    }
  });
  const byId = new Map(routes.map((r) => [r.id, r]));

  for (const r of routes) {
    if (r.fallback_route === null) continue;
    const fb = byId.get(r.fallback_route);
    if (!fb) problems.push(`маршрут ${r.id}.fallback_route: маршрут ${r.fallback_route} не существует`);
    else if (fb.id === r.id) problems.push(`маршрут ${r.id}.fallback_route: нельзя ссылаться на себя`);
    else if (fb.user_supplied_endpoint) problems.push(`маршрут ${r.id}.fallback_route: пользовательский endpoint не может быть запасным`);
  }

  const hybrid = strList(privacyRaw.hybrid_remote_allowlist, 'privacy.hybrid_remote_allowlist', problems);
  let online: string[] | 'all_enabled' = 'all_enabled';
  if (privacyRaw.online_remote_allowlist !== undefined && privacyRaw.online_remote_allowlist !== 'all_enabled') {
    online = strList(privacyRaw.online_remote_allowlist, 'privacy.online_remote_allowlist', problems);
  }
  for (const id of [...hybrid, ...(online === 'all_enabled' ? [] : online)]) {
    const r = byId.get(id);
    if (!r) problems.push(`privacy: маршрут ${id} не существует`);
    else if (r.locality !== 'remote') problems.push(`privacy: ${id} — локальный маршрут, в allowlist удалённых он не нужен`);
  }

  const defaultRoute = typeof raw.default_route === 'string' ? raw.default_route : 'mock';
  const dr = byId.get(defaultRoute);
  if (!dr) problems.push(`default_route: маршрут ${defaultRoute} не существует`);
  else if (!dr.enabled) problems.push(`default_route: маршрут ${defaultRoute} выключен`);
  else if (dr.locality !== 'local') problems.push(`default_route: маршрут по умолчанию должен быть локальным (без скрытой отправки разговоров наружу)`);

  const host = typeof serverRaw.host === 'string' ? serverRaw.host : '127.0.0.1';
  const pricing = typeof raw.pricing_file === 'string' ? resolve(configDir, raw.pricing_file) : null;
  const secrets = typeof raw.secrets_file === 'string' ? resolve(configDir, raw.secrets_file) : null;

  const config: GatewayConfig = {
    format: 'zero-echo.providers.v1',
    server: {
      host,
      port: num(serverRaw.port, 8787, 'server.port', problems, 0, 65535),
      max_body_bytes: num(serverRaw.max_body_bytes, 64 * 1024, 'server.max_body_bytes', problems, 1024, 4 * 1024 * 1024),
      allowed_origins: origins,
      session_ttl_s: num(serverRaw.session_ttl_s, 3600, 'server.session_ttl_s', problems, 10, 7 * 86400),
      max_sessions: num(serverRaw.max_sessions, 1000, 'server.max_sessions', problems, 1, 1_000_000),
    },
    limits: {
      global_concurrency: num(limitsRaw.global_concurrency, 8, 'limits.global_concurrency', problems, 1, 4096),
      global_max_queue: num(limitsRaw.global_max_queue, 32, 'limits.global_max_queue', problems, 0, 100_000),
      result_cache_ttl_s: num(limitsRaw.result_cache_ttl_s, 600, 'limits.result_cache_ttl_s', problems, 1, 86400),
      result_cache_max: num(limitsRaw.result_cache_max, 5000, 'limits.result_cache_max', problems, 1, 1_000_000),
      deadline_margin_ms: num(limitsRaw.deadline_margin_ms, 25, 'limits.deadline_margin_ms', problems, 0, 5000),
      max_response_bytes: num(limitsRaw.max_response_bytes, 1024 * 1024, 'limits.max_response_bytes', problems, 1024, 64 * 1024 * 1024),
    },
    default_quotas: parseQuotas(raw.default_quotas, problems, 'default_quotas'),
    privacy: { hybrid_remote_allowlist: hybrid, online_remote_allowlist: online },
    default_route: defaultRoute,
    pricing_file: pricing,
    secrets_file: secrets,
    routes,
    config_dir: configDir,
  };
  if (problems.length) throw new ConfigError(problems);
  return config;
}

export function loadConfig(path: string): GatewayConfig {
  const abs = resolve(path);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new ConfigError([`не удалось прочитать ${abs}: ${(e as Error).message}`]);
  }
  return parseConfig(raw, dirname(abs));
}
