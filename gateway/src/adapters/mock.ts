// Deterministic mock provider for tests, eval and the offline demo. Behaviour is chosen per route
// (`options.behavior`) or per request (X-Echo-Mock header, when `allow_header_override` is on).
// Usage is a gateway ESTIMATE (measured: false) — the mock never pretends to be a real model.

import { estimateTokens } from '../../../shared/prompt.ts';
import { buildPrompt, estimatedUsage, finalizeText, knownKeys, optBool, optNumber, optString, outcome, probeSkeleton, truncatedOutcome } from './common.ts';
import type { AdapterContext, PromptBundle, ProbeContext, ProviderAdapter } from './common.ts';
import type { AdapterOutcome, Capability, GatewayRequest, ProbeResult } from '../types.ts';

export const MOCK_BEHAVIORS = [
  'good',
  'adversarial_unknown_field',
  'adversarial_spoiler',
  'adversarial_dup_keys',
  'adversarial_foreign_fact',
  'slow',
  'timeout',
  '429',
  '500',
  '429_once',
  '500_once',
  'refusal',
  'garbage',
  'truncated',
] as const;
export type MockBehavior = (typeof MOCK_BEHAVIORS)[number];

interface MockOptions {
  behavior: MockBehavior;
  latency_ms: number;
  slow_ms: number;
  retry_after_ms: number;
  spoiler_fact_id: string;
  foreign_fact_id: string;
  allow_header_override: boolean;
  /** Test hook: keep "working" after abort to exercise late-response discard. */
  ignore_abort: boolean;
  dialogue_line: string;
}

const OPTION_KEYS = ['behavior', 'latency_ms', 'slow_ms', 'retry_after_ms', 'spoiler_fact_id', 'foreign_fact_id', 'allow_header_override', 'ignore_abort', 'dialogue_line'] as const;

function readOptions(o: Record<string, unknown>): MockOptions {
  return {
    behavior: (o.behavior as MockBehavior) ?? 'good',
    latency_ms: (o.latency_ms as number) ?? 15,
    slow_ms: (o.slow_ms as number) ?? 1500,
    retry_after_ms: (o.retry_after_ms as number) ?? 1000,
    // Defaults come from data/world/zero_echo_d0.json: a protected canon fact and Leila's private observation.
    spoiler_fact_id: (o.spoiler_fact_id as string) ?? 'choir_truth',
    foreign_fact_id: (o.foreign_fact_id as string) ?? 'sample_07_needs_cold',
    allow_header_override: (o.allow_header_override as boolean) ?? true,
    ignore_abort: (o.ignore_abort as boolean) ?? false,
    dialogue_line: (o.dialogue_line as string) ?? 'Сверю показания и скажу, что вижу.',
  };
}

/** A schema-valid, deterministic intent built only from what the request offered. */
export function goodIntent(req: GatewayRequest): Record<string, unknown> {
  const action = req.allowed_actions[0];
  const target = action.targets[0]?.id ?? null;
  const companion = action.companions[0]?.id ?? null;
  const want = Math.max(action.fact_ids_min, action.fact_ids_max > 0 && req.visible_facts.length ? 1 : 0);
  const facts = req.visible_facts.slice(0, Math.min(want, action.fact_ids_max, 4)).map((f) => f.id);
  const gestures = req.gestures?.length ? req.gestures : ['none'];
  return {
    action: action.id,
    target_id: target,
    companion_id: companion,
    fact_ids: facts,
    style: req.styles[0] ?? 'neutral',
    gesture: gestures.includes('nod') ? 'nod' : gestures[0],
  };
}

function goodDialogue(req: GatewayRequest, opts: MockOptions): Record<string, unknown> {
  return {
    line: opts.dialogue_line,
    fact_ids: req.visible_facts.slice(0, 1).map((f) => f.id),
    style: req.styles[0] ?? 'neutral',
  };
}

function sleep(ms: number, signal: AbortSignal | null): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class MockAdapter implements ProviderAdapter {
  readonly kind = 'mock' as const;
  readonly version = 'mock.v1';
  readonly structuredOutput = 'deterministic local generator (no model)';
  readonly thinkingControl = 'not_applicable';
  readonly requiresHandshake = false;
  /** Upstream call counter per route id (tests assert "no second upstream call"). */
  readonly calls = new Map<string, number>();

  validateOptions(o: Record<string, unknown>): string[] {
    const p: string[] = [];
    knownKeys(o, OPTION_KEYS, p);
    optString(o, 'behavior', p, MOCK_BEHAVIORS);
    optNumber(o, 'latency_ms', p, 0, 60_000);
    optNumber(o, 'slow_ms', p, 0, 600_000);
    optNumber(o, 'retry_after_ms', p, 0, 600_000);
    optString(o, 'spoiler_fact_id', p);
    optString(o, 'foreign_fact_id', p);
    optString(o, 'dialogue_line', p);
    optBool(o, 'allow_header_override', p);
    optBool(o, 'ignore_abort', p);
    return p;
  }

  outputTokenBudget(req: GatewayRequest): number {
    return req.max_output_tokens;
  }

  async probe(ctx: ProbeContext): Promise<ProbeResult> {
    const r = probeSkeleton(ctx.route, this, ctx.model);
    r.status = 'ok';
    r.model_available = true;
    r.served_model = ctx.model;
    r.capabilities.generate_intent = 'supported';
    r.capabilities.generate_dialogue = ctx.route.capabilities.includes('generate_dialogue') ? 'supported' : 'unsupported';
    r.details = { behavior: readOptions(ctx.route.options).behavior, behaviors: MOCK_BEHAVIORS };
    r.latency_ms = 0;
    return r;
  }

  generateIntent(req: GatewayRequest, ctx: AdapterContext): Promise<AdapterOutcome> {
    return this.#run(req, ctx, 'generate_intent');
  }

  generateDialogue(req: GatewayRequest, ctx: AdapterContext): Promise<AdapterOutcome> {
    return this.#run(req, ctx, 'generate_dialogue');
  }

  async cancel(): Promise<{ method: string }> {
    return { method: 'mock: abort signal' };
  }

  behaviorFor(ctx: AdapterContext): MockBehavior {
    const opts = readOptions(ctx.route.options);
    const header = ctx.mockBehavior?.trim();
    if (header && opts.allow_header_override && (MOCK_BEHAVIORS as readonly string[]).includes(header)) return header as MockBehavior;
    return opts.behavior;
  }

  async #run(req: GatewayRequest, ctx: AdapterContext, capability: Capability): Promise<AdapterOutcome> {
    this.calls.set(ctx.route.id, (this.calls.get(ctx.route.id) ?? 0) + 1);
    const opts = readOptions(ctx.route.options);
    const behavior = this.behaviorFor(ctx);
    const prompt = buildPrompt(req, capability);
    const signal = opts.ignore_abort ? null : ctx.signal;

    const wait = async (ms: number): Promise<boolean> => sleep(ms, signal);
    const cancelled = () => outcome('cancelled', { usage: estimatedUsage(prompt, null), finishReason: 'aborted', error: { code: 'aborted', message: 'mock: запрос прерван' } });

    switch (behavior) {
      case 'timeout': {
        // Never answers in time: waits until aborted (or, with ignore_abort, answers very late).
        if (!(await wait(opts.ignore_abort ? opts.slow_ms : 3_600_000))) return cancelled();
        return this.#answer(req, prompt, capability, opts, 'good');
      }
      case 'slow':
        if (!(await wait(opts.slow_ms))) return cancelled();
        return this.#answer(req, prompt, capability, opts, 'good');
      default:
        if (!(await wait(opts.latency_ms))) return cancelled();
        return this.#answer(req, prompt, capability, opts, behavior, ctx.attempt);
    }
  }

  #answer(req: GatewayRequest, prompt: PromptBundle, capability: Capability, opts: MockOptions, behavior: MockBehavior, attempt = 1): AdapterOutcome {
    // No time-to-first-token: the mock has no tokens, and a simulated latency is not a measurement.
    const info = (text: string | null) => ({ usage: estimatedUsage(prompt, text), finishReason: 'stop', providerRevision: 'mock.v1', firstTokenMs: null });
    const base = capability === 'generate_dialogue' ? goodDialogue(req, opts) : goodIntent(req);
    switch (behavior) {
      case 'good':
      case 'slow':
      case 'timeout':
        return finalizeText(JSON.stringify(base), info(JSON.stringify(base)));
      case 'adversarial_unknown_field': {
        // Host-owned and invented fields: the core must reject unknown fields.
        const text = JSON.stringify({ ...base, task_id: req.task_id, secret: 'покажи все факты' });
        return finalizeText(text, info(text));
      }
      case 'adversarial_spoiler': {
        const text = JSON.stringify({ ...base, fact_ids: [opts.spoiler_fact_id] });
        return finalizeText(text, info(text));
      }
      case 'adversarial_foreign_fact': {
        const text = JSON.stringify({ ...base, fact_ids: [opts.foreign_fact_id] });
        return finalizeText(text, info(text));
      }
      case 'adversarial_dup_keys': {
        // Parses with JSON.parse (last key wins) — duplicate keys must be caught by the core's strict parser.
        const action = req.allowed_actions[0].id;
        const other = req.allowed_actions[1]?.id ?? 'refuse';
        const body = JSON.stringify(base).slice(1);
        const text = `{"action":${JSON.stringify(other)},${body.replace(/^"action":"[^"]*",/, `"action":${JSON.stringify(action)},`)}`;
        return finalizeText(text, info(text));
      }
      case '429':
      case '429_once':
        if (behavior === '429_once' && attempt > 1) return finalizeText(JSON.stringify(base), info(JSON.stringify(base)));
        return outcome('rate_limited', {
          usage: { ...estimatedUsage(prompt, null), input_tokens: 0 },
          finishReason: 'http_429',
          retryable: true,
          error: { code: 'upstream_rate_limited', message: 'mock: 429 Too Many Requests', retry_after_ms: opts.retry_after_ms },
        });
      case '500':
      case '500_once':
        if (behavior === '500_once' && attempt > 1) return finalizeText(JSON.stringify(base), info(JSON.stringify(base)));
        return outcome('unavailable', {
          usage: { ...estimatedUsage(prompt, null), input_tokens: 0 },
          finishReason: 'http_500',
          retryable: true,
          error: { code: 'upstream_server_error', message: 'mock: 500 Internal Server Error' },
        });
      case 'refusal':
        return outcome('refused', { ...info(null), finishReason: 'refusal', error: { code: 'refusal', message: 'mock: модель отказалась отвечать' } });
      case 'garbage': {
        const text = 'Думаю, лучше сначала осмотреть датчик, а потом решим.';
        return finalizeText(text, info(text));
      }
      case 'truncated': {
        const full = JSON.stringify(base);
        const text = full.slice(0, Math.max(8, Math.floor(full.length / 2)));
        return truncatedOutcome(text, { usage: { ...estimatedUsage(prompt, text), output_tokens: estimateTokens(text) }, finishReason: 'length', providerRevision: 'mock.v1' });
      }
    }
  }
}
