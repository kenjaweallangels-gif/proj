// OpenAI-compatible chat completions (vLLM on our server, or a user's own endpoint) — Документ §16.
// "OpenAI-compatible" in a server's name guarantees nothing: capabilities come from a handshake
// (GET /v1/models: the pinned model must be listed; capability fields are used when the server publishes
// them), from the OWNER's explicit declaration in config, or from a deep probe — never from the model name.
// An unsupported capability is reported by probe and refused at request time.

import { authHeaders, buildPrompt, knownKeys, netErrorOutcome, optBool, optNumber, outcome, probeOutputOk, probeSkeleton, PROBE_SCHEMA, PROBE_SYSTEM, PROBE_USER, safeJson, zeroUsage } from './common.ts';
import type { AdapterContext, ProbeContext, ProviderAdapter } from './common.ts';
import { callChatCompletions } from './chat.ts';
import type { AdapterOutcome, Capability, CapabilityState, GatewayRequest, ProbeResult, RouteConfig } from '../types.ts';

interface CompatOptions {
  stream: boolean;
  /** Capabilities the owner asserts for this server: "json_schema", "dialogue". */
  declared_capabilities: string[];
  chat_template_kwargs: Record<string, unknown> | null;
  extra_output_tokens: number;
  temperature: number | null;
}

const OPTION_KEYS = ['stream', 'declared_capabilities', 'chat_template_kwargs', 'extra_output_tokens', 'temperature'] as const;
const KNOWN_CAPS = ['json_schema', 'dialogue'];

function readOptions(o: Record<string, unknown>): CompatOptions {
  return {
    stream: (o.stream as boolean) ?? false,
    declared_capabilities: Array.isArray(o.declared_capabilities) ? (o.declared_capabilities as string[]) : [],
    chat_template_kwargs: o.chat_template_kwargs && typeof o.chat_template_kwargs === 'object' ? (o.chat_template_kwargs as Record<string, unknown>) : null,
    extra_output_tokens: typeof o.extra_output_tokens === 'number' ? o.extra_output_tokens : 0,
    temperature: typeof o.temperature === 'number' ? o.temperature : null,
  };
}

/** Reads capability hints a server may publish on its model card (non-standard; used only if present). */
function publishedCapabilities(model: Record<string, unknown>): Set<string> | null {
  const caps = model.capabilities ?? model.supported_features ?? model.supported_parameters;
  if (Array.isArray(caps)) return new Set(caps.filter((c): c is string => typeof c === 'string'));
  if (caps && typeof caps === 'object') {
    return new Set(Object.entries(caps as Record<string, unknown>).filter(([, v]) => v === true).map(([k]) => k));
  }
  return null;
}

export class OpenAICompatAdapter implements ProviderAdapter {
  readonly kind = 'openai_compat' as const;
  readonly version = 'openai-compat-chat.v1';
  readonly structuredOutput = 'chat.completions response_format {type: json_schema, strict: true}';
  readonly thinkingControl = 'chat_template_kwargs из конфигурации владельца (если сервер поддерживает)';
  readonly requiresHandshake = true;

  validateOptions(o: Record<string, unknown>): string[] {
    const p: string[] = [];
    knownKeys(o, OPTION_KEYS, p);
    optBool(o, 'stream', p);
    optNumber(o, 'extra_output_tokens', p, 0, 4096);
    optNumber(o, 'temperature', p, 0, 2);
    if (o.declared_capabilities !== undefined) {
      if (!Array.isArray(o.declared_capabilities) || !o.declared_capabilities.every((c) => typeof c === 'string' && KNOWN_CAPS.includes(c))) {
        p.push(`declared_capabilities: ожидается массив из ${KNOWN_CAPS.join(', ')}`);
      }
    }
    if (o.chat_template_kwargs !== undefined && (typeof o.chat_template_kwargs !== 'object' || o.chat_template_kwargs === null || Array.isArray(o.chat_template_kwargs))) {
      p.push('chat_template_kwargs: ожидается объект');
    }
    return p;
  }

  outputTokenBudget(req: GatewayRequest, route: RouteConfig): number {
    return req.max_output_tokens + readOptions(route.options).extra_output_tokens;
  }

  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const r = probeSkeleton(ctx.route, this, ctx.model);
    const http = ctx.http;
    if (!http) {
      r.status = 'not_configured';
      return r;
    }
    const o = readOptions(ctx.route.options);
    const declared = new Set([...o.declared_capabilities, ...(ctx.declaredCapabilities ?? [])]);
    const started = ctx.clock.now();
    try {
      const res = await http.request({ method: 'GET', url: http.url('/v1/models'), headers: authHeaders(ctx.apiKey), signal: ctx.signal, timeoutMs: ctx.timeoutMs });
      r.latency_ms = Math.round(ctx.clock.now() - started);
      if (res.status !== 200) {
        r.status = 'unavailable';
        r.error = { code: res.status === 401 || res.status === 403 ? 'auth_failed' : 'handshake_failed', message: `GET /v1/models → ${res.status}` };
        return r;
      }
      const list = ((safeJson(res.text) ?? {}) as { data?: Record<string, unknown>[] }).data ?? [];
      const ids = list.map((m) => m.id).filter((id): id is string => typeof id === 'string');
      r.details.served_ids = ids;
      const card = list.find((m) => m.id === ctx.model);
      r.model_available = !!card;
      if (!card) {
        r.status = 'unavailable';
        r.error = { code: 'model_not_found', message: `модель ${ctx.model} отсутствует в /v1/models (есть: ${ids.slice(0, 8).join(', ') || '—'})` };
        return r;
      }
      r.served_model = ctx.model;
      if (typeof card.max_model_len === 'number') r.details.max_model_len = card.max_model_len;
      if (typeof card.root === 'string') r.details.root = card.root;
      const published = publishedCapabilities(card);
      r.details.published_capabilities = published ? [...published] : null;
      const state = (cap: string): CapabilityState => {
        if (published) return published.has(cap) || (cap === 'json_schema' && (published.has('response_format') || published.has('structured_outputs'))) ? 'supported' : 'unsupported';
        return declared.has(cap) ? 'declared' : 'unverified';
      };
      let schemaState = state('json_schema');
      if (ctx.deep && schemaState !== 'unsupported') {
        const ok = await this.#deepProbe(ctx);
        r.details.deep_probe = ok ? 'json_schema_ok' : 'json_schema_failed';
        schemaState = ok ? 'supported' : 'unsupported';
      }
      const usable = schemaState === 'supported' || schemaState === 'declared';
      r.capabilities.generate_intent = usable ? schemaState : schemaState === 'unverified' ? 'unverified' : 'unsupported';
      const dialogueWanted = ctx.route.capabilities.includes('generate_dialogue');
      r.capabilities.generate_dialogue = !dialogueWanted ? 'unsupported' : usable && (declared.has('dialogue') || published?.has('dialogue')) ? schemaState : 'unsupported';
      r.status = usable ? 'ok' : 'degraded';
      if (!usable) r.error = { code: 'capability_unsupported', message: 'json_schema не подтверждён: объявите declared_capabilities ["json_schema"] или выполните deep probe' };
    } catch (e) {
      r.status = 'unavailable';
      r.error = netErrorOutcome(e).error;
    }
    return r;
  }

  async #deepProbe(ctx: ProbeContext): Promise<boolean> {
    if (!ctx.http) return false;
    try {
      const res = await ctx.http.request({
        method: 'POST',
        url: ctx.http.url('/v1/chat/completions'),
        headers: { 'content-type': 'application/json', ...authHeaders(ctx.apiKey) },
        body: JSON.stringify({
          model: ctx.model,
          messages: [
            { role: 'system', content: PROBE_SYSTEM },
            { role: 'user', content: PROBE_USER },
          ],
          max_tokens: 16,
          response_format: { type: 'json_schema', json_schema: { name: 'probe', schema: PROBE_SCHEMA, strict: true } },
        }),
        signal: ctx.signal,
        timeoutMs: ctx.timeoutMs,
      });
      const j = safeJson(res.text) as { choices?: { message?: { content?: string } }[] } | undefined;
      return res.status === 200 && probeOutputOk(j?.choices?.[0]?.message?.content);
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
    return { method: 'openai-compatible: разрыв соединения (vLLM прекращает генерацию при отключении клиента)' };
  }

  async #generate(req: GatewayRequest, ctx: AdapterContext, capability: Capability): Promise<AdapterOutcome> {
    const o = readOptions(ctx.route.options);
    const prompt = buildPrompt(req, capability);
    if (!ctx.http) return outcome('unavailable', { usage: zeroUsage(true), finishReason: 'no_endpoint', error: { code: 'no_endpoint', message: 'endpoint не задан' } });
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      max_tokens: req.max_output_tokens + o.extra_output_tokens,
      response_format: { type: 'json_schema', json_schema: { name: prompt.schemaName, schema: prompt.schema, strict: true } },
    };
    if (o.chat_template_kwargs) body.chat_template_kwargs = o.chat_template_kwargs;
    if (o.temperature !== null) body.temperature = o.temperature;
    return callChatCompletions(ctx, { path: '/v1/chat/completions', body, stream: o.stream, headers: authHeaders(ctx.apiKey), prompt });
  }
}
