// llama-server (llama.cpp) adapter — the local/offline executor (Документ §10, §16).
//
// Default mode "chat": POST /v1/chat/completions with response_format json_schema. Why this endpoint:
//  * the server applies the GGUF's OWN chat template (Jinja), so prompts are not re-templated by hand;
//  * thinking is disabled technically via chat_template_kwargs {enable_thinking:false} (Qwen3 templates),
//    not by asking the model "do not think" (Документ §10);
//  * json_schema is converted by the server into a GBNF grammar (subset of JSON Schema, [S11]);
//  * SSE streaming gives a real time-to-first-token in one round trip.
// Mode "completion" (/apply-template + /completion with json_schema and n_predict) is kept for servers
// started without --jinja; it costs a second local round trip.

import { buildPrompt, estimatedUsage, finalizeText, httpErrorOutcome, knownKeys, netErrorOutcome, nonNeg, optBool, optNumber, optString, outcome, probeOutputOk, probeSkeleton, PROBE_SCHEMA, PROBE_SYSTEM, PROBE_USER, safeJson, truncatedOutcome } from './common.ts';
import type { AdapterContext, ProbeContext, PromptBundle, ProviderAdapter } from './common.ts';
import { callChatCompletions } from './chat.ts';
import type { AdapterOutcome, Capability, GatewayRequest, NormalizedUsage, ProbeResult, RouteConfig } from '../types.ts';

interface LlamaOptions {
  mode: 'chat' | 'completion';
  stream: boolean;
  disable_thinking: boolean;
  cache_prompt: boolean;
  temperature: number | null;
  seed: number | null;
  extra_output_tokens: number;
}

const OPTION_KEYS = ['mode', 'stream', 'disable_thinking', 'cache_prompt', 'temperature', 'seed', 'extra_output_tokens'] as const;

function readOptions(o: Record<string, unknown>): LlamaOptions {
  return {
    mode: (o.mode as 'chat' | 'completion') ?? 'chat',
    stream: (o.stream as boolean) ?? true,
    disable_thinking: (o.disable_thinking as boolean) ?? true,
    cache_prompt: (o.cache_prompt as boolean) ?? true,
    temperature: typeof o.temperature === 'number' ? o.temperature : null,
    seed: typeof o.seed === 'number' ? o.seed : null,
    extra_output_tokens: typeof o.extra_output_tokens === 'number' ? o.extra_output_tokens : 0,
  };
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

/** The configured model matches when it equals the served model id or the GGUF file name. */
export function llamaModelMatches(configured: string, servedIds: string[]): boolean {
  const want = basename(configured).toLowerCase();
  return servedIds.some((id) => {
    const got = basename(id).toLowerCase();
    return got === want || got === `${want}.gguf` || `${got}.gguf` === want;
  });
}

export class LlamaCppAdapter implements ProviderAdapter {
  readonly kind = 'llamacpp' as const;
  readonly version = 'llamacpp.v1';
  readonly structuredOutput = 'chat: response_format json_schema → GBNF; completion: json_schema';
  readonly thinkingControl = 'chat_template_kwargs.enable_thinking=false (если шаблон поддерживает)';
  readonly requiresHandshake = true;

  validateOptions(o: Record<string, unknown>): string[] {
    const p: string[] = [];
    knownKeys(o, OPTION_KEYS, p);
    optString(o, 'mode', p, ['chat', 'completion']);
    optBool(o, 'stream', p);
    optBool(o, 'disable_thinking', p);
    optBool(o, 'cache_prompt', p);
    optNumber(o, 'temperature', p, 0, 2);
    optNumber(o, 'seed', p, -1, 2 ** 32);
    optNumber(o, 'extra_output_tokens', p, 0, 4096);
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
    const started = ctx.clock.now();
    const get = (path: string) => http.request({ method: 'GET', url: http.url(path), signal: ctx.signal, timeoutMs: ctx.timeoutMs });
    try {
      const health = await get('/health');
      r.details.health = health.status === 200 ? 'ok' : health.status === 503 ? 'loading' : `http_${health.status}`;
      if (health.status !== 200) {
        r.status = 'unavailable';
        r.error = { code: health.status === 503 ? 'model_loading' : 'health_failed', message: `llama-server /health → ${health.status}` };
        r.latency_ms = Math.round(ctx.clock.now() - started);
        return r;
      }
      const ids: string[] = [];
      const props = await get('/props');
      if (props.status === 200) {
        const pj = (safeJson(props.text) ?? {}) as Record<string, unknown>;
        if (typeof pj.model_path === 'string') ids.push(pj.model_path);
        const gen = (pj.default_generation_settings ?? {}) as Record<string, unknown>;
        r.details.n_ctx = gen.n_ctx ?? null;
        r.details.total_slots = pj.total_slots ?? null;
        r.details.build_info = pj.build_info ?? null;
        const template = typeof pj.chat_template === 'string' ? pj.chat_template : '';
        r.details.chat_template_has_thinking_switch = template.includes('enable_thinking');
        r.capabilities.thinking_control = template.includes('enable_thinking') ? 'chat_template_kwargs.enable_thinking' : 'not_applicable (шаблон без режима thinking)';
      }
      const models = await get('/v1/models');
      if (models.status === 200) {
        const mj = (safeJson(models.text) ?? {}) as { data?: { id?: string }[] };
        for (const m of mj.data ?? []) if (typeof m.id === 'string') ids.push(m.id);
      }
      r.served_model = ids[0] ?? null;
      r.details.served_ids = ids;
      r.model_available = ids.length ? llamaModelMatches(ctx.model, ids) : null;
      if (r.model_available === false) {
        r.status = 'unavailable';
        r.error = { code: 'model_mismatch', message: `llama-server обслуживает ${ids.join(', ')}, а в конфигурации закреплена ${ctx.model}` };
      } else {
        r.status = 'ok';
        // json_schema is a llama-server feature; only a deep probe proves this build honors it.
        r.capabilities.generate_intent = 'declared';
        if (ctx.route.capabilities.includes('generate_dialogue')) r.capabilities.generate_dialogue = 'declared';
        if (ctx.deep) {
          const ok = await this.#deepProbe(ctx);
          r.details.deep_probe = ok ? 'json_schema_ok' : 'json_schema_failed';
          r.capabilities.generate_intent = ok ? 'supported' : 'unsupported';
          if (!ok) r.status = 'degraded';
        }
      }
    } catch (e) {
      const o = netErrorOutcome(e);
      r.status = 'unavailable';
      r.error = o.error;
    }
    r.latency_ms = Math.round(ctx.clock.now() - started);
    return r;
  }

  async #deepProbe(ctx: ProbeContext): Promise<boolean> {
    if (!ctx.http) return false;
    try {
      const res = await ctx.http.request({
        method: 'POST',
        url: ctx.http.url('/v1/chat/completions'),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: ctx.model,
          messages: [
            { role: 'system', content: PROBE_SYSTEM },
            { role: 'user', content: PROBE_USER },
          ],
          max_tokens: 16,
          response_format: { type: 'json_schema', json_schema: { name: 'probe', schema: PROBE_SCHEMA } },
          chat_template_kwargs: { enable_thinking: false },
          stream: false,
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
    // llama-server stops a slot when the client connection closes; the gateway aborts the request.
    return { method: 'llama-server: разрыв соединения останавливает слот' };
  }

  #generate(req: GatewayRequest, ctx: AdapterContext, capability: Capability): Promise<AdapterOutcome> {
    const o = readOptions(ctx.route.options);
    const prompt = buildPrompt(req, capability);
    const maxTokens = req.max_output_tokens + o.extra_output_tokens;
    if (o.mode === 'completion') return this.#completion(ctx, prompt, o, maxTokens);
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      max_tokens: maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: prompt.schemaName, schema: prompt.grammarSchema } },
      cache_prompt: o.cache_prompt,
    };
    if (o.disable_thinking) body.chat_template_kwargs = { enable_thinking: false };
    if (o.temperature !== null) body.temperature = o.temperature;
    if (o.seed !== null) body.seed = o.seed;
    return callChatCompletions(ctx, { path: '/v1/chat/completions', body, stream: o.stream, headers: {}, prompt, cachedFromTimings: true });
  }

  async #completion(ctx: AdapterContext, prompt: PromptBundle, o: LlamaOptions, maxTokens: number): Promise<AdapterOutcome> {
    const http = ctx.http;
    if (!http) return outcome('unavailable', { usage: estimatedUsage(prompt, null), finishReason: 'no_endpoint', error: { code: 'no_endpoint', message: 'endpoint не настроен' } });
    const started = ctx.clock.now();
    try {
      const tpl = await http.request({
        method: 'POST',
        url: http.url('/apply-template'),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          ...(o.disable_thinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        }),
        signal: ctx.signal,
        timeoutMs: ctx.timeoutMs,
      });
      if (tpl.status !== 200) return httpErrorOutcome(tpl, ctx.clock.wallNow(), {});
      const templated = (safeJson(tpl.text) as { prompt?: string } | undefined)?.prompt;
      if (typeof templated !== 'string') {
        return outcome('unavailable', { usage: estimatedUsage(prompt, null), finishReason: 'bad_response', error: { code: 'apply_template_failed', message: '/apply-template не вернул prompt' } });
      }
      const remaining = Math.max(1, ctx.timeoutMs - (ctx.clock.now() - started));
      const res = await http.request({
        method: 'POST',
        url: http.url('/completion'),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: templated,
          n_predict: maxTokens,
          json_schema: prompt.grammarSchema,
          cache_prompt: o.cache_prompt,
          stream: false,
          ...(o.temperature !== null ? { temperature: o.temperature } : {}),
          ...(o.seed !== null ? { seed: o.seed } : {}),
        }),
        signal: ctx.signal,
        timeoutMs: remaining,
      });
      if (res.status !== 200) {
        const err = safeJson(res.text) as { error?: { message?: string } } | undefined;
        return httpErrorOutcome(res, ctx.clock.wallNow(), { message: err?.error?.message });
      }
      const j = (safeJson(res.text) ?? {}) as Record<string, unknown>;
      const usage: NormalizedUsage = {
        input_tokens: nonNeg(j.tokens_evaluated),
        output_tokens: nonNeg(j.tokens_predicted),
        cached_input_tokens: nonNeg(j.tokens_cached),
        cache_write_input_tokens: 0,
        reasoning_tokens: 0,
        measured: typeof j.tokens_predicted === 'number',
      };
      const stopType = typeof j.stop_type === 'string' ? j.stop_type : j.stopped_limit ? 'limit' : 'eos';
      const info = { usage, finishReason: `stop_type:${stopType}`, providerRevision: typeof j.model === 'string' ? j.model : null };
      const text = typeof j.content === 'string' ? j.content : null;
      if (stopType === 'limit' || j.truncated === true) return truncatedOutcome(text, info);
      return finalizeText(text, info);
    } catch (e) {
      return netErrorOutcome(e);
    }
  }
}
