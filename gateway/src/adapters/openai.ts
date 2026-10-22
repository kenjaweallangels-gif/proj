// OpenAI Responses API adapter (Документ §16, [S16]): POST /v1/responses with
// text.format {type: "json_schema", name, schema, strict: true}. Handles status "incomplete"
// (incomplete_details.reason), refusal output items, usage details (cached / reasoning tokens) and
// 429 with Retry-After; "insufficient_quota" maps to budget_exceeded.

import { authHeaders, buildPrompt, finalizeText, httpErrorOutcome, knownKeys, netErrorOutcome, nonNeg, optBool, optNumber, optString, outcome, probeOutputOk, probeSkeleton, PROBE_SCHEMA, PROBE_SYSTEM, PROBE_USER, safeJson, truncate, truncatedOutcome, zeroUsage } from './common.ts';
import type { AdapterContext, ProbeContext, ProviderAdapter } from './common.ts';
import { parseDurationMs } from '../policy.ts';
import type { AdapterOutcome, Capability, GatewayRequest, NormalizedUsage, ProbeResult, RouteConfig } from '../types.ts';

interface OpenAIOptions {
  /** Sent only when set: reasoning support is a property of the pinned model, not guessed from its name. */
  reasoning_effort: string | null;
  extra_output_tokens: number;
  store: boolean;
  organization: string | null;
  project: string | null;
}

const OPTION_KEYS = ['reasoning_effort', 'extra_output_tokens', 'store', 'organization', 'project'] as const;

function readOptions(o: Record<string, unknown>): OpenAIOptions {
  return {
    reasoning_effort: typeof o.reasoning_effort === 'string' ? o.reasoning_effort : null,
    extra_output_tokens: typeof o.extra_output_tokens === 'number' ? o.extra_output_tokens : 0,
    store: (o.store as boolean) ?? false,
    organization: typeof o.organization === 'string' ? o.organization : null,
    project: typeof o.project === 'string' ? o.project : null,
  };
}

export function responsesUsage(u: unknown): NormalizedUsage | null {
  if (!u || typeof u !== 'object') return null;
  const o = u as Record<string, unknown>;
  const inDetails = (o.input_tokens_details ?? {}) as Record<string, unknown>;
  const outDetails = (o.output_tokens_details ?? {}) as Record<string, unknown>;
  return {
    input_tokens: nonNeg(o.input_tokens),
    output_tokens: nonNeg(o.output_tokens),
    cached_input_tokens: nonNeg(inDetails.cached_tokens),
    cache_write_input_tokens: 0,
    reasoning_tokens: nonNeg(outDetails.reasoning_tokens),
    measured: true,
  };
}

/** Collects output_text and refusal parts of message items (reasoning items are ignored). */
function readOutput(output: unknown): { text: string; refusal: string | null } {
  let text = '';
  let refusal: string | null = null;
  for (const item of Array.isArray(output) ? (output as Record<string, unknown>[]) : []) {
    if (item.type !== 'message') continue;
    for (const part of Array.isArray(item.content) ? (item.content as Record<string, unknown>[]) : []) {
      if (part.type === 'output_text' && typeof part.text === 'string') text += part.text;
      if (part.type === 'refusal') refusal = typeof part.refusal === 'string' ? part.refusal : 'refusal';
    }
  }
  return { text, refusal };
}

export class OpenAIResponsesAdapter implements ProviderAdapter {
  readonly kind = 'openai' as const;
  readonly version = 'openai-responses.v1';
  readonly structuredOutput = 'responses text.format {type: json_schema, strict: true}';
  readonly thinkingControl = 'reasoning.effort из конфигурации (отправляется только если задан)';
  readonly requiresHandshake = false;

  validateOptions(o: Record<string, unknown>): string[] {
    const p: string[] = [];
    knownKeys(o, OPTION_KEYS, p);
    optString(o, 'reasoning_effort', p, ['none', 'minimal', 'low', 'medium', 'high']);
    optNumber(o, 'extra_output_tokens', p, 0, 8192);
    optBool(o, 'store', p);
    optString(o, 'organization', p);
    optString(o, 'project', p);
    return p;
  }

  outputTokenBudget(req: GatewayRequest, route: RouteConfig): number {
    return req.max_output_tokens + readOptions(route.options).extra_output_tokens;
  }

  #headers(apiKey: string | null, o: OpenAIOptions): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...authHeaders(apiKey),
      ...(o.organization ? { 'openai-organization': o.organization } : {}),
      ...(o.project ? { 'openai-project': o.project } : {}),
    };
  }

  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const r = probeSkeleton(ctx.route, this, ctx.model);
    if (!ctx.http || !ctx.apiKey) {
      r.status = 'not_configured';
      r.error = { code: 'no_key', message: `нет ключа: задайте переменную окружения или файл секретов для маршрута ${ctx.route.id}` };
      return r;
    }
    const o = readOptions(ctx.route.options);
    const started = ctx.clock.now();
    try {
      const res = await ctx.http.request({ method: 'GET', url: ctx.http.url(`/v1/models/${encodeURIComponent(ctx.model)}`), headers: this.#headers(ctx.apiKey, o), signal: ctx.signal, timeoutMs: ctx.timeoutMs });
      r.latency_ms = Math.round(ctx.clock.now() - started);
      if (res.status === 200) {
        r.model_available = true;
        r.served_model = ((safeJson(res.text) ?? {}) as { id?: string }).id ?? ctx.model;
        r.status = 'ok';
      } else {
        r.model_available = res.status === 404 ? false : null;
        r.status = 'unavailable';
        r.error = { code: res.status === 404 ? 'model_not_found' : res.status === 401 ? 'auth_failed' : `http_${res.status}`, message: `GET /v1/models/${ctx.model} → ${res.status}` };
        return r;
      }
      if (ctx.deep) {
        const ok = await this.#deepProbe(ctx, o);
        r.details.deep_probe = ok ? 'json_schema_ok' : 'json_schema_failed';
        r.capabilities.generate_intent = ok ? 'supported' : 'unsupported';
        if (!ok) r.status = 'degraded';
      }
    } catch (e) {
      r.status = 'unavailable';
      r.error = netErrorOutcome(e).error;
    }
    return r;
  }

  async #deepProbe(ctx: ProbeContext, o: OpenAIOptions): Promise<boolean> {
    if (!ctx.http) return false;
    try {
      const res = await ctx.http.request({
        method: 'POST',
        url: ctx.http.url('/v1/responses'),
        headers: this.#headers(ctx.apiKey, o),
        body: JSON.stringify({
          model: ctx.model,
          instructions: PROBE_SYSTEM,
          input: PROBE_USER,
          text: { format: { type: 'json_schema', name: 'probe', schema: PROBE_SCHEMA, strict: true } },
          max_output_tokens: 64 + o.extra_output_tokens,
          store: false,
        }),
        signal: ctx.signal,
        timeoutMs: ctx.timeoutMs,
      });
      const j = safeJson(res.text) as { output?: unknown } | undefined;
      return res.status === 200 && probeOutputOk(readOutput(j?.output).text);
    } catch {
      return false;
    }
  }

  generateIntent(req: GatewayRequest, ctx: AdapterContext): Promise<AdapterOutcome> {
    return this.#generate(req, ctx, 'generate_intent');
  }

  generateDialogue(req: GatewayRequest, ctx: AdapterContext): Promise<AdapterOutcome> {
    return this.#generate(req, ctx, 'generate_dialogue');
  }

  async cancel(): Promise<{ method: string }> {
    // /v1/responses/{id}/cancel exists only for background responses; foreground calls stop on disconnect.
    return { method: 'openai: разрыв соединения (фоновый режим не используется)' };
  }

  async #generate(req: GatewayRequest, ctx: AdapterContext, capability: Capability): Promise<AdapterOutcome> {
    const http = ctx.http;
    if (!http) return outcome('unavailable', { usage: zeroUsage(true), finishReason: 'no_endpoint', error: { code: 'no_endpoint', message: 'endpoint не задан' } });
    if (!ctx.apiKey) return outcome('unavailable', { usage: zeroUsage(true), finishReason: 'no_key', error: { code: 'no_key', message: 'нет ключа API для маршрута' } });
    const o = readOptions(ctx.route.options);
    const prompt = buildPrompt(req, capability);
    const body: Record<string, unknown> = {
      model: ctx.model,
      instructions: prompt.system,
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt.user }] }],
      text: { format: { type: 'json_schema', name: prompt.schemaName, schema: prompt.schema, strict: true } },
      max_output_tokens: req.max_output_tokens + o.extra_output_tokens,
      store: o.store,
    };
    if (o.reasoning_effort) body.reasoning = { effort: o.reasoning_effort };

    let res;
    try {
      res = await http.request({ method: 'POST', url: http.url('/v1/responses'), headers: this.#headers(ctx.apiKey, o), body: JSON.stringify(body), signal: ctx.signal, timeoutMs: ctx.timeoutMs });
    } catch (e) {
      return netErrorOutcome(e);
    }
    const j = (safeJson(res.text) ?? {}) as Record<string, unknown>;
    if (res.status < 200 || res.status >= 300) {
      const err = (j.error ?? {}) as { message?: string; code?: string; type?: string };
      const code = err.code ?? err.type;
      if (res.status === 429 && (code === 'insufficient_quota' || err.type === 'insufficient_quota')) {
        return outcome('budget_exceeded', { usage: zeroUsage(true), finishReason: 'http_429', error: { code: 'upstream_insufficient_quota', message: truncate(err.message ?? 'insufficient_quota') } });
      }
      const mapped = httpErrorOutcome(res, ctx.clock.wallNow(), { message: err.message, code: code ?? undefined });
      if (mapped.status === 'rate_limited' && mapped.error && mapped.error.retry_after_ms == null) {
        mapped.error.retry_after_ms = parseDurationMs(res.headers['x-ratelimit-reset-requests']);
      }
      return mapped;
    }

    const usage = responsesUsage(j.usage) ?? zeroUsage(false);
    const revision = typeof j.model === 'string' ? j.model : null;
    const { text, refusal } = readOutput(j.output);
    const status = typeof j.status === 'string' ? j.status : 'completed';
    const info = { usage, finishReason: status, providerRevision: revision };
    if (refusal !== null) {
      return outcome('refused', { ...info, finishReason: 'refusal', error: { code: 'refusal', message: truncate(refusal) } });
    }
    if (status === 'incomplete') {
      const reason = ((j.incomplete_details ?? {}) as { reason?: string }).reason ?? 'unknown';
      if (reason === 'content_filter') {
        return outcome('refused', { ...info, finishReason: `incomplete:${reason}`, error: { code: 'content_filter', message: 'ответ остановлен фильтром содержимого' } });
      }
      return truncatedOutcome(text || null, { ...info, finishReason: `incomplete:${reason}` });
    }
    if (status === 'failed') {
      const err = (j.error ?? {}) as { message?: string; code?: string };
      return outcome('unavailable', { ...info, retryable: err.code === 'server_error', error: { code: err.code ?? 'response_failed', message: truncate(err.message ?? 'response failed') } });
    }
    if (status === 'cancelled') return outcome('cancelled', { ...info, error: { code: 'cancelled', message: 'ответ отменён провайдером' } });
    if (status !== 'completed') {
      return outcome('invalid_output', { ...info, error: { code: 'unexpected_status', message: `неожиданный статус ответа: ${status}` } });
    }
    return finalizeText(text, info);
  }
}
