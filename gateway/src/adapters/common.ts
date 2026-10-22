// Shared adapter plumbing: prompt/schema bundle (from shared/prompt.ts — never forked), outcome
// normalization, HTTP and network error mapping, usage helpers, SSE parsing.

import {
  buildDialogueMessages,
  buildIntentMessages,
  buildIntentSchema,
  estimateTokens,
  extractJsonCandidate,
} from '../../../shared/prompt.ts';
import type { JsonSchema } from '../../../shared/prompt.ts';
import { NetError } from '../net.ts';
import type { PinnedHttpClient, HttpResponse } from '../net.ts';
import type { Clock } from '../policy.ts';
import { parseRetryAfterMs } from '../policy.ts';
import type { Logger } from '../log.ts';
import type {
  AdapterKind,
  AdapterOutcome,
  Capability,
  GatewayRequest,
  GatewayStatus,
  NormalizedUsage,
  ProbeResult,
  RouteConfig,
  UpstreamError,
} from '../types.ts';

/** Same limit as schemas/gateway_result.schema.json → proposal_text.maxLength. */
export const MAX_PROPOSAL_CHARS = 8192;

export interface PromptBundle {
  capability: Capability;
  system: string;
  user: string;
  /** Strict-dialect schema: every property required, optionals nullable, enums narrowed to this request. */
  schema: JsonSchema;
  /** Strict schema with array limits restored, for grammar-based engines (llama.cpp GBNF). */
  grammarSchema: JsonSchema;
  schemaName: string;
  estimatedInputTokens: number;
}

/** Narrowed schema for the experimental free-speech line (schemas/dialogue.schema.json). */
export function buildDialogueSchema(req: GatewayRequest, strict: boolean): JsonSchema {
  const facts = [...new Set(req.visible_facts.map((f) => f.id))];
  const styles = req.styles.length ? req.styles : ['neutral'];
  const line: JsonSchema = { type: 'string', description: 'одна короткая реплика по-русски' };
  const factIds: JsonSchema = { type: 'array', items: facts.length ? { type: 'string', enum: facts } : { type: 'string' } };
  if (!strict) {
    line.minLength = 1;
    line.maxLength = 280;
    factIds.maxItems = facts.length ? 3 : 0;
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: { line, fact_ids: factIds, style: { type: 'string', enum: styles } },
    required: strict ? ['line', 'fact_ids', 'style'] : ['line', 'fact_ids'],
  };
}

function withArrayLimits(strict: JsonSchema, loose: JsonSchema): JsonSchema {
  const out = structuredClone(strict);
  const sp = (out.properties ?? {}) as Record<string, JsonSchema>;
  const lp = (loose.properties ?? {}) as Record<string, JsonSchema>;
  for (const [k, v] of Object.entries(lp)) {
    if (sp[k] && typeof v.maxItems === 'number') sp[k].maxItems = v.maxItems;
    if (sp[k] && typeof v.maxLength === 'number') sp[k].maxLength = v.maxLength;
  }
  return out;
}

export function buildPrompt(req: GatewayRequest, capability: Capability): PromptBundle {
  if (capability === 'generate_dialogue') {
    const m = buildDialogueMessages(req);
    const schema = buildDialogueSchema(req, true);
    return {
      capability,
      system: m.system,
      user: m.user,
      schema,
      grammarSchema: withArrayLimits(schema, buildDialogueSchema(req, false)),
      schemaName: 'npc_dialogue_line',
      estimatedInputTokens: estimateTokens(m.system) + estimateTokens(m.user),
    };
  }
  const m = buildIntentMessages(req);
  const schema = buildIntentSchema(req, { strict: true });
  return {
    capability,
    system: m.system,
    user: m.user,
    schema,
    grammarSchema: withArrayLimits(schema, buildIntentSchema(req, { strict: false })),
    schemaName: 'npc_intent',
    estimatedInputTokens: estimateTokens(m.system) + estimateTokens(m.user),
  };
}

// ---------------------------------------------------------------- contexts

export interface AdapterContext {
  route: RouteConfig;
  /** Pinned client for the route endpoint (null for mock). */
  http: PinnedHttpClient | null;
  apiKey: string | null;
  /** Effective model id (a user-supplied endpoint carries its own pinned model). */
  model: string;
  signal: AbortSignal;
  /** Time left for this attempt (overall deadline minus margin). */
  timeoutMs: number;
  /** 1-based attempt number within the task. */
  attempt: number;
  clock: Clock;
  /** X-Echo-Mock behaviour override (mock adapter only). */
  mockBehavior: string | null;
  log: Logger;
  /** Capabilities the session declared for a user-supplied endpoint. */
  declaredCapabilities?: string[];
}

export interface ProbeContext {
  route: RouteConfig;
  http: PinnedHttpClient | null;
  apiKey: string | null;
  model: string;
  signal: AbortSignal;
  timeoutMs: number;
  /** Deep probe sends one tiny constrained generation (may cost money on paid APIs). */
  deep: boolean;
  clock: Clock;
  declaredCapabilities?: string[];
}

export interface ProviderAdapter {
  readonly kind: AdapterKind;
  readonly version: string;
  /** How structured output is requested (for the build manifest). */
  readonly structuredOutput: string;
  /** How thinking/reasoning is controlled (for the build manifest). */
  readonly thinkingControl: string;
  /** Requires a capability handshake (probe) before the first generation on a route. */
  readonly requiresHandshake: boolean;
  validateOptions(options: Record<string, unknown>): string[];
  /** Max output tokens actually requested from the provider (game budget + thinking/reasoning headroom). */
  outputTokenBudget(req: GatewayRequest, route: RouteConfig): number;
  probe(ctx: ProbeContext): Promise<ProbeResult>;
  generateIntent(req: GatewayRequest, ctx: AdapterContext): Promise<AdapterOutcome>;
  generateDialogue?(req: GatewayRequest, ctx: AdapterContext): Promise<AdapterOutcome>;
  /** Best effort: most providers stop only when the connection is dropped (which the gateway does). */
  cancel(taskId: string, ctx: { route: RouteConfig }): Promise<{ method: string }>;
}

// ---------------------------------------------------------------- usage

export function zeroUsage(measured: boolean): NormalizedUsage {
  return { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, reasoning_tokens: 0, measured };
}

export function estimatedUsage(prompt: PromptBundle, outputText: string | null): NormalizedUsage {
  return {
    input_tokens: prompt.estimatedInputTokens,
    output_tokens: outputText ? estimateTokens(outputText) : 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    reasoning_tokens: 0,
    measured: false,
  };
}

function nonNeg(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/** OpenAI-style chat completion usage (llama.cpp, vLLM, other compatible servers). */
export function chatCompletionUsage(u: unknown, cachedFallback = 0): NormalizedUsage | null {
  if (!u || typeof u !== 'object') return null;
  const o = u as Record<string, unknown>;
  const details = (o.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const outDetails = (o.completion_tokens_details ?? {}) as Record<string, unknown>;
  if (typeof o.prompt_tokens !== 'number' && typeof o.completion_tokens !== 'number') return null;
  return {
    input_tokens: nonNeg(o.prompt_tokens),
    output_tokens: nonNeg(o.completion_tokens),
    cached_input_tokens: nonNeg(details.cached_tokens) || nonNeg(cachedFallback),
    cache_write_input_tokens: 0,
    reasoning_tokens: nonNeg(outDetails.reasoning_tokens),
    measured: true,
  };
}

export { nonNeg };

// ---------------------------------------------------------------- outcomes

export function outcome(status: GatewayStatus, partial: Partial<AdapterOutcome> & { usage: NormalizedUsage; finishReason: string }): AdapterOutcome {
  return {
    status,
    text: partial.text ?? null,
    usage: partial.usage,
    finishReason: partial.finishReason,
    providerRevision: partial.providerRevision ?? null,
    firstTokenMs: partial.firstTokenMs ?? null,
    retryable: partial.retryable ?? false,
    error: partial.error ?? null,
  };
}

export function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * Turns a complete model answer into an outcome. Only SYNTAX is checked here (is it one JSON object at
 * all?); game validity — fields, enums, duplicate keys, facts — is the core's Intent Authority job, so
 * adversarial-but-parseable text is returned as `ok` with the raw text.
 */
export function finalizeText(
  raw: string | null | undefined,
  info: { usage: NormalizedUsage; finishReason: string; providerRevision?: string | null; firstTokenMs?: number | null },
): AdapterOutcome {
  if (raw === null || raw === undefined || !raw.trim()) {
    return outcome('invalid_output', { ...info, error: { code: 'empty_output', message: 'модель вернула пустой ответ' } });
  }
  const candidate = extractJsonCandidate(raw);
  if (candidate.length > MAX_PROPOSAL_CHARS) {
    return outcome('invalid_output', { ...info, error: { code: 'output_too_large', message: `ответ длиннее ${MAX_PROPOSAL_CHARS} символов` } });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return outcome('invalid_output', { ...info, text: candidate, error: { code: 'not_json', message: 'ответ модели не является JSON-объектом' } });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return outcome('invalid_output', { ...info, text: candidate, error: { code: 'not_object', message: 'ответ модели — не JSON-объект' } });
  }
  return outcome('ok', { ...info, text: candidate });
}

export function truncatedOutcome(raw: string | null, info: { usage: NormalizedUsage; finishReason: string; providerRevision?: string | null; firstTokenMs?: number | null }): AdapterOutcome {
  const text = raw ? raw.slice(0, MAX_PROPOSAL_CHARS) : null;
  return outcome('invalid_output', {
    ...info,
    text,
    error: { code: 'truncated', message: 'ответ обрезан по лимиту выходных токенов; частичный JSON не применяется' },
  });
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Generic mapping of a non-2xx provider response. Adapters refine provider-specific cases first. */
export function httpErrorOutcome(res: HttpResponse, wallNow: number, provider: { message?: string; code?: string }): AdapterOutcome {
  const usage = zeroUsage(true);
  const finishReason = `http_${res.status}`;
  const msg = truncate(provider.message ?? (res.text ? res.text : `HTTP ${res.status}`));
  const retryAfter = parseRetryAfterMs(res.headers['retry-after'], wallNow) ?? parseRetryAfterMs(msToSeconds(res.headers['retry-after-ms']), wallNow);
  const err = (code: string): UpstreamError => ({ code, message: msg, retry_after_ms: retryAfter });
  if (res.status === 429) return outcome('rate_limited', { usage, finishReason, retryable: true, error: err(provider.code ?? 'upstream_rate_limited') });
  if (res.status === 402) return outcome('budget_exceeded', { usage, finishReason, error: err(provider.code ?? 'upstream_billing') });
  if (res.status === 401 || res.status === 403) return outcome('unavailable', { usage, finishReason, error: err('auth_failed') });
  if (res.status === 404) return outcome('unavailable', { usage, finishReason, error: err('model_or_endpoint_not_found') });
  if (res.status === 408) return outcome('timeout', { usage, finishReason, retryable: true, error: err('upstream_timeout') });
  if (res.status >= 500) return outcome('unavailable', { usage, finishReason, retryable: true, error: err(provider.code ?? 'upstream_server_error') });
  return outcome('unavailable', { usage, finishReason, error: err(provider.code ?? 'bad_request') });
}

function msToSeconds(v: string | undefined): string | undefined {
  if (v === undefined || !/^\d+(\.\d+)?$/.test(v.trim())) return undefined;
  return String(Number(v) / 1000);
}

export function netErrorOutcome(e: unknown): AdapterOutcome {
  const usage = zeroUsage(true);
  if (e instanceof NetError) {
    switch (e.code) {
      case 'timeout':
        return outcome('timeout', { usage, finishReason: 'net_timeout', error: { code: 'timeout', message: e.message } });
      case 'aborted':
        return outcome('cancelled', { usage, finishReason: 'aborted', error: { code: 'aborted', message: e.message } });
      case 'blocked_address':
      case 'blocked_hostname':
      case 'origin_not_allowed':
      case 'insecure_scheme':
      case 'credentials_in_url':
      case 'invalid_url':
        return outcome('unavailable', { usage, finishReason: 'endpoint_blocked', error: { code: 'endpoint_blocked', message: e.message } });
      case 'redirect_blocked':
        return outcome('unavailable', { usage, finishReason: 'redirect_blocked', error: { code: 'redirect_blocked', message: e.message } });
      case 'response_too_large':
        return outcome('invalid_output', { usage, finishReason: 'response_too_large', error: { code: 'response_too_large', message: e.message } });
      case 'dns_failed':
      case 'connect_failed':
      case 'tls_error':
      case 'protocol_error':
        return outcome('unavailable', { usage, finishReason: 'network_error', retryable: e.code !== 'tls_error', error: { code: e.code, message: e.message } });
    }
  }
  return outcome('unavailable', { usage, finishReason: 'adapter_error', error: { code: 'adapter_error', message: truncate(String((e as Error)?.message ?? e)) } });
}

// ---------------------------------------------------------------- probe helpers

export function probeSkeleton(route: RouteConfig, adapter: ProviderAdapter, model: string): ProbeResult {
  return {
    route: route.id,
    adapter: adapter.kind,
    adapter_version: adapter.version,
    status: 'unavailable',
    model,
    model_available: null,
    served_model: null,
    capabilities: {
      generate_intent: 'unverified',
      generate_dialogue: route.capabilities.includes('generate_dialogue') ? 'unverified' : 'unsupported',
      structured_output: adapter.structuredOutput,
      thinking_control: adapter.thinkingControl,
    },
    details: {},
    checked_at: new Date().toISOString(),
    latency_ms: null,
    error: null,
  };
}

/** Tiny request used by deep probes: proves the endpoint actually honors a JSON schema. */
export const PROBE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
};
export const PROBE_SYSTEM = 'Ответь JSON-объектом {"ok": true}.';
export const PROBE_USER = 'Проверка связи.';

export function probeOutputOk(text: string | null | undefined): boolean {
  if (!text) return false;
  const v = safeJson(extractJsonCandidate(text));
  return !!v && typeof v === 'object' && (v as { ok?: unknown }).ok === true;
}

// ---------------------------------------------------------------- SSE

/** Incremental parser for text/event-stream bodies; yields the `data:` payload of each event. */
export class SseParser {
  #buf = '';
  readonly #onData: (data: string) => void;

  constructor(onData: (data: string) => void) {
    this.#onData = onData;
  }

  push(chunk: string): void {
    this.#buf += chunk;
    let idx: number;
    while ((idx = this.#buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = this.#buf.slice(0, idx);
      const sep = /\r?\n\r?\n/.exec(this.#buf.slice(idx));
      this.#buf = this.#buf.slice(idx + (sep ? sep[0].length : 2));
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) this.#onData(data);
    }
  }

  /** Flushes a final event that was not terminated by a blank line. */
  end(): void {
    if (this.#buf.trim()) this.push('\n\n');
  }
}

// ---------------------------------------------------------------- option helpers

export function optString(o: Record<string, unknown>, key: string, problems: string[], allowed?: readonly string[]): void {
  const v = o[key];
  if (v === undefined) return;
  if (typeof v !== 'string' || (allowed && !allowed.includes(v))) {
    problems.push(`${key}: ожидается ${allowed ? allowed.join(' | ') : 'строка'}`);
  }
}

export function optNumber(o: Record<string, unknown>, key: string, problems: string[], min: number, max: number): void {
  const v = o[key];
  if (v === undefined) return;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) problems.push(`${key}: ожидается число в [${min}, ${max}]`);
}

export function optBool(o: Record<string, unknown>, key: string, problems: string[]): void {
  const v = o[key];
  if (v !== undefined && typeof v !== 'boolean') problems.push(`${key}: ожидается true/false`);
}

export function knownKeys(o: Record<string, unknown>, keys: readonly string[], problems: string[]): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) problems.push(`неизвестный параметр ${k}`);
}

export function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}
