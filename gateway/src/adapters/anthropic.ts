// Claude Messages API adapter via the official SDK (@anthropic-ai/sdk) — Документ §16, [S17].
//
// * Structured output: output_config.format {type: "json_schema", schema} (output_format is deprecated).
// * Latency: output_config.effort (default "low"); on claude-opus-5-5 thinking cannot be disabled, so
//   max_tokens = game budget + extra_output_tokens (thinking headroom). No temperature/top_p/top_k.
// * stop_reason is checked BEFORE content: "refusal" → refused (stop_details.category is informational),
//   "max_tokens" → invalid_output (partial JSON is never applied).
// * Server-side refusal fallback (`fallbacks: "default"`, beta server-side-fallback-2026-07-01) re-runs a
//   declined request on ANOTHER model. It is a per-route flag that defaults OFF here: the game forbids
//   silently routing conversations to a different model/provider without the owner's explicit choice.
// * The SDK runs with maxRetries 0 (the gateway owns retries and the deadline) and a pinned fetch
//   (SSRF policy, origin lock, size limit). baseURL comes from the route endpoint, so tests use a fake server.
// * The SDK is loaded lazily: the rest of the gateway works even before `npm ci --prefix gateway`.

import type Anthropic from '@anthropic-ai/sdk';
import { createPinnedFetch, NetError } from '../net.ts';
import type { PinnedHttpClient } from '../net.ts';
import { buildPrompt, finalizeText, knownKeys, netErrorOutcome, optBool, optNumber, optString, outcome, probeSkeleton, PROBE_SCHEMA, PROBE_SYSTEM, PROBE_USER, probeOutputOk, truncate, truncatedOutcome, zeroUsage } from './common.ts';
import type { AdapterContext, ProbeContext, ProviderAdapter } from './common.ts';
import { parseRetryAfterMs } from '../policy.ts';
import type { AdapterOutcome, Capability, GatewayRequest, NormalizedUsage, ProbeResult, RouteConfig } from '../types.ts';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type AnthropicClass = typeof Anthropic;

interface AnthropicOptions {
  effort: Effort;
  extra_output_tokens: number;
  server_side_refusal_fallback: boolean;
}

const OPTION_KEYS = ['effort', 'extra_output_tokens', 'server_side_refusal_fallback'] as const;
export const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let sdkPromise: Promise<AnthropicClass> | null = null;

/** Loads @anthropic-ai/sdk on first use; null when it is not installed. */
async function loadSdk(): Promise<AnthropicClass | null> {
  sdkPromise ??= import('@anthropic-ai/sdk').then((m) => m.default);
  try {
    return await sdkPromise;
  } catch {
    sdkPromise = null;
    return null;
  }
}

const SDK_MISSING = { code: 'sdk_missing', message: 'не установлен @anthropic-ai/sdk: выполните npm ci --prefix gateway' };

function readOptions(o: Record<string, unknown>): AnthropicOptions {
  return {
    effort: (o.effort as Effort) ?? 'low',
    extra_output_tokens: typeof o.extra_output_tokens === 'number' ? o.extra_output_tokens : 1024,
    server_side_refusal_fallback: (o.server_side_refusal_fallback as boolean) ?? false,
  };
}

/** Anthropic reports cache reads/writes separately from input_tokens; the gateway sums them. */
export function anthropicUsage(u: Partial<Anthropic.Usage> | null | undefined): NormalizedUsage {
  if (!u) return zeroUsage(false);
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  return {
    input_tokens: (u.input_tokens ?? 0) + read + write,
    output_tokens: u.output_tokens ?? 0,
    cached_input_tokens: read,
    cache_write_input_tokens: write,
    reasoning_tokens: u.output_tokens_details?.thinking_tokens ?? 0,
    measured: true,
  };
}

interface MessageLike {
  model: string;
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  content: { type: string; text?: string }[];
  usage: Partial<Anthropic.Usage> & { iterations?: { type?: string }[] | null };
}

function textOf(msg: MessageLike): string {
  return msg.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly kind = 'anthropic' as const;
  readonly version = 'anthropic-messages-sdk.v1';
  readonly structuredOutput = 'messages output_config.format {type: json_schema}';
  readonly thinkingControl = 'output_config.effort (на claude-opus-5-5 thinking не отключается)';
  readonly requiresHandshake = false;
  readonly #clients = new Map<string, { key: string; http: PinnedHttpClient; client: Anthropic }>();

  validateOptions(o: Record<string, unknown>): string[] {
    const p: string[] = [];
    knownKeys(o, OPTION_KEYS, p);
    optString(o, 'effort', p, ['low', 'medium', 'high', 'xhigh', 'max']);
    optNumber(o, 'extra_output_tokens', p, 0, 32_000);
    optBool(o, 'server_side_refusal_fallback', p);
    return p;
  }

  outputTokenBudget(req: GatewayRequest, route: RouteConfig): number {
    return req.max_output_tokens + readOptions(route.options).extra_output_tokens;
  }

  #client(Sdk: AnthropicClass, routeId: string, apiKey: string, http: PinnedHttpClient): Anthropic {
    const cached = this.#clients.get(routeId);
    if (cached && cached.key === apiKey && cached.http === http) return cached.client;
    const client = new Sdk({ apiKey, baseURL: http.baseUrl, fetch: createPinnedFetch(http), maxRetries: 0 });
    this.#clients.set(routeId, { key: apiKey, http, client });
    return client;
  }

  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const r = probeSkeleton(ctx.route, this, ctx.model);
    if (!ctx.http || !ctx.apiKey) {
      r.status = 'not_configured';
      r.error = { code: 'no_key', message: `нет ключа: задайте переменную окружения или файл секретов для маршрута ${ctx.route.id}` };
      return r;
    }
    const Sdk = await loadSdk();
    if (!Sdk) {
      r.status = 'not_configured';
      r.error = SDK_MISSING;
      return r;
    }
    const client = this.#client(Sdk, ctx.route.id, ctx.apiKey, ctx.http);
    const started = ctx.clock.now();
    try {
      const info = await client.models.retrieve(ctx.model, {}, { signal: ctx.signal, timeout: ctx.timeoutMs, maxRetries: 0 });
      r.latency_ms = Math.round(ctx.clock.now() - started);
      r.model_available = true;
      r.served_model = info.id;
      r.status = 'ok';
      r.details = { display_name: info.display_name, max_input_tokens: info.max_input_tokens ?? null, max_tokens: (info as { max_tokens?: number | null }).max_tokens ?? null, capabilities: info.capabilities ?? null };
      if (ctx.deep) {
        const o = readOptions(ctx.route.options);
        const msg = (await client.messages.create(
          {
            model: ctx.model,
            max_tokens: 64 + o.extra_output_tokens,
            system: PROBE_SYSTEM,
            messages: [{ role: 'user', content: PROBE_USER }],
            output_config: { effort: o.effort, format: { type: 'json_schema', schema: PROBE_SCHEMA } },
          },
          { signal: ctx.signal, timeout: ctx.timeoutMs, maxRetries: 0 },
        )) as unknown as MessageLike;
        const ok = msg.stop_reason !== 'refusal' && probeOutputOk(textOf(msg));
        r.details.deep_probe = ok ? 'json_schema_ok' : 'json_schema_failed';
        r.capabilities.generate_intent = ok ? 'supported' : 'unsupported';
        if (!ok) r.status = 'degraded';
      }
    } catch (e) {
      const o = this.#mapError(Sdk, e, ctx.clock.wallNow());
      r.status = 'unavailable';
      r.model_available = e instanceof Sdk.NotFoundError ? false : null;
      r.error = o.error;
    }
    return r;
  }

  generateIntent(req: GatewayRequest, ctx: AdapterContext): Promise<AdapterOutcome> {
    return this.#generate(req, ctx, 'generate_intent');
  }

  generateDialogue(req: GatewayRequest, ctx: AdapterContext): Promise<AdapterOutcome> {
    return this.#generate(req, ctx, 'generate_dialogue');
  }

  async cancel(): Promise<{ method: string }> {
    return { method: 'anthropic: AbortSignal SDK-запроса (разрыв соединения); счёт за уже начатую генерацию не обнуляется' };
  }

  async #generate(req: GatewayRequest, ctx: AdapterContext, capability: Capability): Promise<AdapterOutcome> {
    if (!ctx.http) return outcome('unavailable', { usage: zeroUsage(true), finishReason: 'no_endpoint', error: { code: 'no_endpoint', message: 'endpoint не задан' } });
    if (!ctx.apiKey) return outcome('unavailable', { usage: zeroUsage(true), finishReason: 'no_key', error: { code: 'no_key', message: 'нет ключа API для маршрута' } });
    const Sdk = await loadSdk();
    if (!Sdk) return outcome('unavailable', { usage: zeroUsage(true), finishReason: 'sdk_missing', error: SDK_MISSING });
    const o = readOptions(ctx.route.options);
    const prompt = buildPrompt(req, capability);
    const client = this.#client(Sdk, ctx.route.id, ctx.apiKey, ctx.http);
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: ctx.model,
      max_tokens: req.max_output_tokens + o.extra_output_tokens,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      output_config: { effort: o.effort, format: { type: 'json_schema', schema: prompt.schema } },
    };
    const requestOptions = { signal: ctx.signal, timeout: Math.max(1, Math.floor(ctx.timeoutMs)), maxRetries: 0 };

    let msg: MessageLike;
    try {
      if (o.server_side_refusal_fallback) {
        msg = (await client.beta.messages.create(
          { ...(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming), betas: [ANTHROPIC_FALLBACK_BETA], fallbacks: 'default' },
          requestOptions,
        )) as unknown as MessageLike;
      } else {
        msg = (await client.messages.create(params, requestOptions)) as unknown as MessageLike;
      }
    } catch (e) {
      return this.#mapError(Sdk, e, ctx.clock.wallNow());
    }

    const usage = anthropicUsage(msg.usage);
    const servedByFallback = (msg.usage.iterations ?? []).some((it) => it?.type === 'fallback_message');
    const revision = servedByFallback ? `${msg.model} (server-side fallback)` : msg.model;
    const info = { usage, finishReason: msg.stop_reason ?? 'missing', providerRevision: revision };
    // stop_reason first: a refusal may carry empty or partial content.
    switch (msg.stop_reason) {
      case 'refusal': {
        const category = msg.stop_details?.category ?? null;
        return outcome('refused', { ...info, error: { code: 'refusal', message: `модель отказалась (category=${category ?? 'null'})` } });
      }
      case 'max_tokens':
        return truncatedOutcome(textOf(msg) || null, info);
      case 'model_context_window_exceeded':
        return outcome('invalid_output', { ...info, error: { code: 'context_window_exceeded', message: 'превышено контекстное окно модели' } });
      case 'tool_use':
      case 'pause_turn':
        return outcome('invalid_output', { ...info, error: { code: 'unexpected_stop', message: `неожиданный stop_reason ${msg.stop_reason}` } });
      default:
        return finalizeText(textOf(msg), info);
    }
  }

  #mapError(Sdk: AnthropicClass, e: unknown, wallNow: number): AdapterOutcome {
    const usage = zeroUsage(true);
    // Most specific first (TS SDK: APIConnectionError and its subclasses extend APIError).
    if (e instanceof Sdk.APIUserAbortError) {
      return outcome('cancelled', { usage, finishReason: 'aborted', error: { code: 'aborted', message: 'запрос прерван' } });
    }
    if (e instanceof Sdk.APIConnectionTimeoutError) {
      return outcome('timeout', { usage, finishReason: 'net_timeout', error: { code: 'timeout', message: 'таймаут запроса к Messages API' } });
    }
    if (e instanceof Sdk.APIConnectionError) {
      const cause = (e as { cause?: unknown }).cause;
      if (cause instanceof NetError) return netErrorOutcome(cause);
      return outcome('unavailable', { usage, finishReason: 'network_error', retryable: true, error: { code: 'connect_failed', message: truncate(e.message) } });
    }
    if (e instanceof Sdk.RateLimitError) {
      const retry = parseRetryAfterMs(e.headers?.get('retry-after'), wallNow);
      return outcome('rate_limited', { usage, finishReason: 'http_429', retryable: true, error: { code: 'upstream_rate_limited', message: truncate(e.message), retry_after_ms: retry } });
    }
    if (e instanceof Sdk.AuthenticationError || e instanceof Sdk.PermissionDeniedError) {
      return outcome('unavailable', { usage, finishReason: `http_${e.status}`, error: { code: 'auth_failed', message: truncate(e.message) } });
    }
    if (e instanceof Sdk.NotFoundError) {
      return outcome('unavailable', { usage, finishReason: 'http_404', error: { code: 'model_or_endpoint_not_found', message: truncate(e.message) } });
    }
    if (e instanceof Sdk.BadRequestError) {
      return outcome('unavailable', { usage, finishReason: 'http_400', error: { code: 'bad_request', message: truncate(e.message) } });
    }
    if (e instanceof Sdk.InternalServerError) {
      // 500/529 overloaded: transient.
      const retry = parseRetryAfterMs(e.headers?.get('retry-after'), wallNow);
      return outcome('unavailable', { usage, finishReason: `http_${e.status}`, retryable: true, error: { code: e.status === 529 ? 'overloaded' : 'upstream_server_error', message: truncate(e.message), retry_after_ms: retry } });
    }
    if (e instanceof Sdk.APIError) {
      if (e.status === 402) return outcome('budget_exceeded', { usage, finishReason: 'http_402', error: { code: 'upstream_billing', message: truncate(e.message) } });
      return outcome('unavailable', { usage, finishReason: `http_${e.status ?? 'unknown'}`, error: { code: 'upstream_error', message: truncate(e.message) } });
    }
    return netErrorOutcome(e);
  }
}
