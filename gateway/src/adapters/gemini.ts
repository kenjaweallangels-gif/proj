// Gemini API adapter (Документ §16, [S18]): models/{model}:generateContent with
// generationConfig.responseMimeType "application/json" + responseJsonSchema. If the endpoint rejects
// responseJsonSchema, the route switches (sticky) to responseSchema with the OpenAPI subset and the one
// allowed retry carries the converted schema. Handles promptFeedback.blockReason, finishReason
// SAFETY/MAX_TOKENS/RECITATION/..., usageMetadata (thoughts are billed output). The key is sent in the
// x-goog-api-key header, never in the URL.

import type { JsonSchema } from '../../../shared/prompt.ts';
import { buildPrompt, finalizeText, httpErrorOutcome, knownKeys, netErrorOutcome, nonNeg, optNumber, optString, outcome, probeOutputOk, probeSkeleton, PROBE_SCHEMA, PROBE_SYSTEM, PROBE_USER, safeJson, truncate, truncatedOutcome, zeroUsage } from './common.ts';
import type { AdapterContext, ProbeContext, ProviderAdapter } from './common.ts';
import { parseDurationMs } from '../policy.ts';
import type { AdapterOutcome, Capability, GatewayRequest, NormalizedUsage, ProbeResult, RouteConfig } from '../types.ts';

type SchemaMode = 'json_schema' | 'openapi_subset';

interface GeminiOptions {
  schema_mode: SchemaMode;
  thinking_budget: number | null;
  extra_output_tokens: number;
  api_version: string;
}

const OPTION_KEYS = ['schema_mode', 'thinking_budget', 'extra_output_tokens', 'api_version'] as const;

function readOptions(o: Record<string, unknown>): GeminiOptions {
  return {
    schema_mode: (o.schema_mode as SchemaMode) ?? 'json_schema',
    thinking_budget: typeof o.thinking_budget === 'number' ? o.thinking_budget : null,
    extra_output_tokens: typeof o.extra_output_tokens === 'number' ? o.extra_output_tokens : 0,
    api_version: typeof o.api_version === 'string' ? o.api_version : 'v1beta',
  };
}

/** Converts our JSON Schema into Gemini's OpenAPI-subset `responseSchema` (nullable instead of type unions). */
export function toGeminiSubset(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  let type = schema.type;
  let enumValues = Array.isArray(schema.enum) ? (schema.enum as unknown[]) : null;
  if (Array.isArray(type)) {
    const nonNull = (type as string[]).filter((t) => t !== 'null');
    if (nonNull.length !== (type as string[]).length) out.nullable = true;
    type = nonNull[0] ?? 'string';
  } else if (type === 'null') {
    out.nullable = true;
    type = 'string';
    enumValues = null;
  }
  if (type !== undefined) out.type = type;
  if (enumValues) {
    const kept = enumValues.filter((v) => v !== null);
    if (kept.length) out.enum = kept;
  }
  if (typeof schema.description === 'string') out.description = schema.description;
  if (typeof schema.maxItems === 'number') out.maxItems = schema.maxItems;
  if (schema.items && typeof schema.items === 'object') out.items = toGeminiSubset(schema.items as JsonSchema);
  if (schema.properties && typeof schema.properties === 'object') {
    const props: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(schema.properties as Record<string, JsonSchema>)) props[k] = toGeminiSubset(v);
    out.properties = props;
    out.propertyOrdering = Object.keys(props);
  }
  if (Array.isArray(schema.required)) out.required = schema.required;
  return out;
}

export function geminiUsage(u: unknown): NormalizedUsage | null {
  if (!u || typeof u !== 'object') return null;
  const o = u as Record<string, unknown>;
  const thoughts = nonNeg(o.thoughtsTokenCount);
  return {
    input_tokens: nonNeg(o.promptTokenCount),
    // candidatesTokenCount excludes thinking; thinking tokens are billed as output.
    output_tokens: nonNeg(o.candidatesTokenCount) + thoughts,
    cached_input_tokens: nonNeg(o.cachedContentTokenCount),
    cache_write_input_tokens: 0,
    reasoning_tokens: thoughts,
    measured: true,
  };
}

const REFUSAL_FINISH = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'LANGUAGE']);

export class GeminiAdapter implements ProviderAdapter {
  readonly kind = 'gemini' as const;
  readonly version = 'gemini-generatecontent.v1';
  readonly structuredOutput = 'generationConfig.responseMimeType=application/json + responseJsonSchema (fallback: responseSchema subset)';
  readonly thinkingControl = 'thinkingConfig.thinkingBudget из конфигурации (отправляется только если задан)';
  readonly requiresHandshake = false;
  /** Sticky per-route downgrade after the endpoint rejected responseJsonSchema. */
  readonly #schemaMode = new Map<string, SchemaMode>();

  validateOptions(o: Record<string, unknown>): string[] {
    const p: string[] = [];
    knownKeys(o, OPTION_KEYS, p);
    optString(o, 'schema_mode', p, ['json_schema', 'openapi_subset']);
    optNumber(o, 'thinking_budget', p, -1, 32768);
    optNumber(o, 'extra_output_tokens', p, 0, 8192);
    optString(o, 'api_version', p, ['v1beta', 'v1']);
    return p;
  }

  outputTokenBudget(req: GatewayRequest, route: RouteConfig): number {
    return req.max_output_tokens + readOptions(route.options).extra_output_tokens;
  }

  schemaModeFor(routeId: string, o: GeminiOptions): SchemaMode {
    return this.#schemaMode.get(routeId) ?? o.schema_mode;
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
      const res = await ctx.http.request({ method: 'GET', url: ctx.http.url(`/${o.api_version}/models/${encodeURIComponent(ctx.model)}`), headers: { 'x-goog-api-key': ctx.apiKey }, signal: ctx.signal, timeoutMs: ctx.timeoutMs });
      r.latency_ms = Math.round(ctx.clock.now() - started);
      if (res.status !== 200) {
        r.model_available = res.status === 404 ? false : null;
        r.status = 'unavailable';
        r.error = { code: res.status === 404 ? 'model_not_found' : `http_${res.status}`, message: `GET models/${ctx.model} → ${res.status}` };
        return r;
      }
      const m = (safeJson(res.text) ?? {}) as Record<string, unknown>;
      const methods = Array.isArray(m.supportedGenerationMethods) ? (m.supportedGenerationMethods as string[]) : [];
      r.model_available = true;
      r.served_model = typeof m.name === 'string' ? m.name : ctx.model;
      r.details = { supported_generation_methods: methods, input_token_limit: m.inputTokenLimit ?? null, output_token_limit: m.outputTokenLimit ?? null, thinking: m.thinking ?? null, version: m.version ?? null };
      if (!methods.includes('generateContent')) {
        r.status = 'unavailable';
        r.capabilities.generate_intent = 'unsupported';
        r.error = { code: 'capability_unsupported', message: 'модель не поддерживает generateContent' };
        return r;
      }
      r.status = 'ok';
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

  async #deepProbe(ctx: ProbeContext, o: GeminiOptions): Promise<boolean> {
    if (!ctx.http || !ctx.apiKey) return false;
    try {
      const res = await ctx.http.request({
        method: 'POST',
        url: ctx.http.url(`/${o.api_version}/models/${encodeURIComponent(ctx.model)}:generateContent`),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': ctx.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: PROBE_SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: PROBE_USER }] }],
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema: PROBE_SCHEMA, maxOutputTokens: 64 },
        }),
        signal: ctx.signal,
        timeoutMs: ctx.timeoutMs,
      });
      const j = safeJson(res.text) as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | undefined;
      return res.status === 200 && probeOutputOk(j?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join(''));
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
    return { method: 'gemini: разрыв соединения' };
  }

  async #generate(req: GatewayRequest, ctx: AdapterContext, capability: Capability): Promise<AdapterOutcome> {
    const http = ctx.http;
    if (!http) return outcome('unavailable', { usage: zeroUsage(true), finishReason: 'no_endpoint', error: { code: 'no_endpoint', message: 'endpoint не задан' } });
    if (!ctx.apiKey) return outcome('unavailable', { usage: zeroUsage(true), finishReason: 'no_key', error: { code: 'no_key', message: 'нет ключа API для маршрута' } });
    const o = readOptions(ctx.route.options);
    const prompt = buildPrompt(req, capability);
    const mode = this.schemaModeFor(ctx.route.id, o);
    const generationConfig: Record<string, unknown> = {
      responseMimeType: 'application/json',
      maxOutputTokens: req.max_output_tokens + o.extra_output_tokens,
    };
    if (mode === 'json_schema') generationConfig.responseJsonSchema = prompt.schema;
    else generationConfig.responseSchema = toGeminiSubset(prompt.grammarSchema);
    if (o.thinking_budget !== null) generationConfig.thinkingConfig = { thinkingBudget: o.thinking_budget };
    const body = {
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig,
    };

    let res;
    try {
      res = await http.request({
        method: 'POST',
        url: http.url(`/${o.api_version}/models/${encodeURIComponent(ctx.model)}:generateContent`),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': ctx.apiKey },
        body: JSON.stringify(body),
        signal: ctx.signal,
        timeoutMs: ctx.timeoutMs,
      });
    } catch (e) {
      return netErrorOutcome(e);
    }
    const j = (safeJson(res.text) ?? {}) as Record<string, unknown>;
    if (res.status < 200 || res.status >= 300) {
      const err = (j.error ?? {}) as { message?: string; status?: string; details?: Record<string, unknown>[] };
      const message = err.message ?? '';
      if (res.status === 400 && mode === 'json_schema' && /responseJsonSchema|response_json_schema/i.test(message)) {
        // The endpoint does not know responseJsonSchema: remember and let the single retry use the subset.
        this.#schemaMode.set(ctx.route.id, 'openapi_subset');
        ctx.log.warn('gemini_schema_downgrade', { route: ctx.route.id });
        return outcome('unavailable', { usage: zeroUsage(true), finishReason: 'http_400', retryable: true, error: { code: 'schema_field_unsupported', message: truncate(message) } });
      }
      const mapped = httpErrorOutcome(res, ctx.clock.wallNow(), { message, code: err.status });
      if (mapped.status === 'rate_limited' && mapped.error && mapped.error.retry_after_ms == null) {
        const info = (err.details ?? []).find((d) => typeof d['@type'] === 'string' && (d['@type'] as string).endsWith('RetryInfo'));
        mapped.error.retry_after_ms = parseDurationMs(info?.retryDelay);
      }
      return mapped;
    }

    const usage = geminiUsage(j.usageMetadata) ?? zeroUsage(false);
    const revision = [j.modelVersion, j.responseId].filter((x) => typeof x === 'string').join(' / ') || null;
    const feedback = (j.promptFeedback ?? {}) as { blockReason?: string };
    if (feedback.blockReason) {
      return outcome('refused', { usage, finishReason: `blocked:${feedback.blockReason}`, providerRevision: revision, error: { code: 'prompt_blocked', message: `запрос заблокирован: ${feedback.blockReason}` } });
    }
    const cand = (Array.isArray(j.candidates) ? j.candidates[0] : undefined) as Record<string, unknown> | undefined;
    if (!cand) return outcome('invalid_output', { usage, finishReason: 'no_candidates', providerRevision: revision, error: { code: 'empty_output', message: 'нет кандидатов в ответе' } });
    const finish = typeof cand.finishReason === 'string' ? cand.finishReason : 'FINISH_REASON_UNSPECIFIED';
    const parts = (((cand.content ?? {}) as { parts?: Record<string, unknown>[] }).parts ?? []).filter((p) => p.thought !== true && typeof p.text === 'string');
    const text = parts.map((p) => p.text as string).join('');
    const info = { usage, finishReason: finish, providerRevision: revision };
    if (finish === 'MAX_TOKENS') return truncatedOutcome(text || null, info);
    if (REFUSAL_FINISH.has(finish)) return outcome('refused', { ...info, error: { code: finish.toLowerCase(), message: `генерация остановлена: ${finish}` } });
    if (finish !== 'STOP') return outcome('invalid_output', { ...info, text: text || null, error: { code: 'unexpected_finish', message: `finishReason ${finish}` } });
    return finalizeText(text, info);
  }
}
