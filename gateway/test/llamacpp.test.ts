// llama-server adapter against a fake llama-server (loopback): capability handshake (/health, /props,
// /v1/models), chat completions with json_schema + enable_thinking=false, SSE streaming with real TTFT,
// /completion mode, model mismatch.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { FakeServer, GOOD_INTENT_TEXT, makeGateway, makePrices, makeRequest, mockRoute, openSession, rawConfig, runIntent } from './helpers.ts';
import type { FakeReply, RecordedRequest } from './helpers.ts';

const GGUF = 'Qwen3-1.7B-Q4_K_M.gguf';

function llamaRoute(port: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'local_llamacpp',
    adapter: 'llamacpp',
    enabled: true,
    locality: 'local',
    endpoint: `http://127.0.0.1:${port}`,
    model: GGUF,
    capabilities: ['generate_intent', 'generate_dialogue'],
    retry: { max_attempts: 1, base_backoff_ms: 20, max_backoff_ms: 40, min_remaining_ms: 200 },
    breaker: { failure_threshold: 1000, cooldown_ms: 1000, max_cooldown_ms: 2000 },
    ...over,
  };
}

interface LlamaBehaviour {
  modelPath?: string;
  health?: number;
  chat?: (r: RecordedRequest) => FakeReply;
}

function streamEvents(text: string, finish: string | null = 'stop'): string[] {
  const parts = [text.slice(0, 10), text.slice(10, 40), text.slice(40)];
  const ev = [JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: null } }], model: GGUF })];
  for (const p of parts) ev.push(JSON.stringify({ choices: [{ index: 0, delta: { content: p }, finish_reason: null }], model: GGUF }));
  if (finish) ev.push(JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }], model: GGUF }));
  ev.push(JSON.stringify({ choices: [], usage: { prompt_tokens: 700, completion_tokens: 40, total_tokens: 740 }, timings: { cache_n: 512, prompt_n: 188, prompt_ms: 120.5, predicted_n: 40, predicted_ms: 300.2 } }));
  ev.push('[DONE]');
  return ev;
}

function llamaServer(b: LlamaBehaviour) {
  return (r: RecordedRequest): FakeReply => {
    if (r.path === '/health') return b.health && b.health !== 200 ? { status: b.health, body: { error: { code: 503, message: 'Loading model' } } } : { body: { status: 'ok' } };
    if (r.path === '/props') {
      return {
        body: {
          model_path: b.modelPath ?? `/models/${GGUF}`,
          total_slots: 1,
          chat_template: '{%- if enable_thinking is defined and enable_thinking is false %}<think>\n\n</think>{%- endif %}',
          default_generation_settings: { n_ctx: 4096 },
          build_info: 'b9999-test',
        },
      };
    }
    if (r.path === '/v1/models') return { body: { object: 'list', data: [{ id: b.modelPath ? b.modelPath.split('/').pop() : GGUF, object: 'model' }] } };
    if (r.path === '/v1/chat/completions') {
      if (b.chat) return b.chat(r);
      if (r.json?.stream) return { sse: { events: streamEvents(GOOD_INTENT_TEXT), firstDelayMs: 80, intervalMs: 15 } };
      return { body: { choices: [{ index: 0, message: { role: 'assistant', content: GOOD_INTENT_TEXT }, finish_reason: 'stop' }], usage: { prompt_tokens: 700, completion_tokens: 40 }, model: GGUF } };
    }
    if (r.path === '/apply-template') return { body: { prompt: '<|im_start|>system\n...<|im_end|>' } };
    if (r.path === '/completion') {
      return { body: { content: GOOD_INTENT_TEXT, stop_type: 'eos', tokens_evaluated: 690, tokens_cached: 500, tokens_predicted: 41, truncated: false, model: GGUF } };
    }
    return { status: 404, body: { error: 'not found' } };
  };
}

describe('llamacpp adapter (llama-server)', () => {
  let server: FakeServer;
  before(async () => {
    server = await FakeServer.start([18740, 18749], llamaServer({}));
  });
  after(async () => server.close());

  it('offline session: handshake, then streamed chat completion with json_schema, thinking disabled, real TTFT', async () => {
    server.handler = llamaServer({});
    server.requests.length = 0;
    const { gw } = makeGateway(rawConfig([mockRoute(), llamaRoute(server.port)]), { prices: makePrices(['mock', 'local_llamacpp'], 0, 0) });
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest({ privacy_profile: 'offline' }), { route: 'local_llamacpp' });
    assert.equal(r.status, 'ok');
    assert.equal(r.proposal_text, GOOD_INTENT_TEXT);
    assert.deepEqual(r.usage, { input_tokens: 700, output_tokens: 40, cached_input_tokens: 512, measured: true });
    assert.ok(typeof r.latency_ms.first_token === 'number' && r.latency_ms.first_token >= 70, `first_token ${r.latency_ms.first_token}`);
    assert.ok((r.latency_ms.first_token as number) <= r.latency_ms.total);
    assert.equal(r.cost_usd, 0, 'local inference has no per-token price');

    const paths = server.requests.map((x) => x.path);
    assert.deepEqual(paths.slice(0, 3), ['/health', '/props', '/v1/models'], 'capability handshake first');
    const chat = server.requests.find((x) => x.path === '/v1/chat/completions')!;
    assert.equal(chat.json.stream, true);
    assert.deepEqual(chat.json.stream_options, { include_usage: true });
    assert.deepEqual(chat.json.chat_template_kwargs, { enable_thinking: false });
    assert.equal(chat.json.max_tokens, 160);
    assert.equal(chat.json.cache_prompt, true);
    assert.equal(chat.json.response_format.type, 'json_schema');
    const schema = chat.json.response_format.json_schema.schema;
    assert.deepEqual(schema.properties.action.enum, ['inspect', 'prepare_isolation', 'refuse']);
    assert.equal(schema.properties.fact_ids.maxItems, 4, 'grammar schema keeps array limits (bounded generation)');
    assert.equal(chat.headers.authorization, undefined, 'no keys are sent to a local server');

    // The handshake is cached: a second request goes straight to generation.
    server.requests.length = 0;
    await runIntent(gw, s, makeRequest({ privacy_profile: 'offline' }), { route: 'local_llamacpp' });
    assert.deepEqual(server.requests.map((x) => x.path), ['/v1/chat/completions']);
    gw.close();
  });

  it('finish_reason length → invalid_output; a stream cut without finish_reason → invalid_output', async () => {
    server.handler = llamaServer({ chat: () => ({ sse: { events: streamEvents('{"action":"inspect","target', 'length') } }) });
    const { gw } = makeGateway(rawConfig([mockRoute(), llamaRoute(server.port)]));
    const s = await openSession(gw, 'offline');
    const r1 = await runIntent(gw, s, makeRequest(), { route: 'local_llamacpp' });
    assert.equal(r1.status, 'invalid_output');
    assert.equal(r1.error?.code, 'truncated');
    server.handler = llamaServer({ chat: () => ({ sse: { events: streamEvents(GOOD_INTENT_TEXT, null).slice(0, 3) } }) });
    const r2 = await runIntent(gw, s, makeRequest(), { route: 'local_llamacpp' });
    assert.equal(r2.status, 'invalid_output');
    assert.equal(r2.error?.code, 'stream_incomplete');
    assert.equal(r2.proposal_text, null, 'partial stream is never returned');
    gw.close();
  });

  it('model mismatch in the handshake → unavailable, no generation request', async () => {
    server.handler = llamaServer({ modelPath: '/models/Llama-3.2-1B-Q8_0.gguf' });
    server.requests.length = 0;
    const { gw } = makeGateway(rawConfig([mockRoute(), llamaRoute(server.port)]));
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest(), { route: 'local_llamacpp' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.error?.code, 'model_mismatch');
    assert.ok(!server.requests.some((x) => x.path === '/v1/chat/completions'));
    gw.close();
  });

  it('model still loading (/health 503) → unavailable (model_loading)', async () => {
    server.handler = llamaServer({ health: 503 });
    const { gw } = makeGateway(rawConfig([mockRoute(), llamaRoute(server.port)]));
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest(), { route: 'local_llamacpp' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.error?.code, 'model_loading');
    gw.close();
  });

  it('non-streaming mode ignores reasoning_content and returns only the answer', async () => {
    server.handler = llamaServer({
      chat: () => ({ body: { choices: [{ index: 0, message: { role: 'assistant', reasoning_content: 'думаю…', content: GOOD_INTENT_TEXT }, finish_reason: 'stop' }], usage: { prompt_tokens: 700, completion_tokens: 40 } } }),
    });
    const { gw } = makeGateway(rawConfig([mockRoute(), llamaRoute(server.port, { options: { stream: false } })]));
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest(), { route: 'local_llamacpp' });
    assert.equal(r.status, 'ok');
    assert.equal(r.proposal_text, GOOD_INTENT_TEXT);
    assert.equal(r.latency_ms.first_token, null, 'without streaming TTFT is not measured (never faked)');
    gw.close();
  });

  it('completion mode: /apply-template with enable_thinking=false, then /completion with json_schema and n_predict', async () => {
    server.handler = llamaServer({});
    server.requests.length = 0;
    const { gw } = makeGateway(rawConfig([mockRoute(), llamaRoute(server.port, { options: { mode: 'completion' } })]));
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest(), { route: 'local_llamacpp' });
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.usage, { input_tokens: 690, output_tokens: 41, cached_input_tokens: 500, measured: true });
    const tpl = server.requests.find((x) => x.path === '/apply-template')!;
    assert.deepEqual(tpl.json.chat_template_kwargs, { enable_thinking: false });
    const comp = server.requests.find((x) => x.path === '/completion')!;
    assert.equal(comp.json.n_predict, 160);
    assert.deepEqual(comp.json.json_schema.properties.action.enum, ['inspect', 'prepare_isolation', 'refuse']);
    gw.close();
  });

  it('deep probe verifies json_schema with a tiny constrained generation', async () => {
    server.handler = llamaServer({ chat: () => ({ body: { choices: [{ index: 0, message: { content: '{"ok": true}' }, finish_reason: 'stop' }] } }) });
    const { gw } = makeGateway(rawConfig([mockRoute(), llamaRoute(server.port)]));
    const s = await openSession(gw, 'offline');
    const report = (await gw.providers(s, { refresh: true, deep: true })) as { providers: { route: string; status: string; capabilities: { generate_intent: string; thinking_control: string } }[] };
    const p = report.providers.find((x) => x.route === 'local_llamacpp')!;
    assert.equal(p.status, 'ok');
    assert.equal(p.capabilities.generate_intent, 'supported');
    assert.equal(p.capabilities.thinking_control, 'chat_template_kwargs.enable_thinking');
    gw.close();
  });
});
