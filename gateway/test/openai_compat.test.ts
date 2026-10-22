// OpenAI-compatible adapter (vLLM / user endpoint): capability handshake via /v1/models, refusing
// unconfirmed capabilities, request shape; BYO endpoint: SSRF validation at session creation and key isolation.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { outcome, zeroUsage } from '../src/adapters/common.ts';
import type { AdapterContext } from '../src/adapters/common.ts';
import type { Resolver } from '../src/net.ts';
import { FakeServer, GOOD_INTENT_TEXT, makeGateway, makeRequest, mockRoute, openSession, rawConfig, remoteRoute, runIntent } from './helpers.ts';
import type { FakeReply, RecordedRequest } from './helpers.ts';

const VLLM_KEY = 'vllm-owner-key-ABCDEF123456';
const MODEL = 'Qwen/Qwen3-4B-Instruct-2507';

function vllm(opts: { models?: Record<string, unknown>[]; chat?: (r: RecordedRequest) => FakeReply } = {}) {
  return (r: RecordedRequest): FakeReply => {
    if (r.path === '/v1/models') return { body: { object: 'list', data: opts.models ?? [{ id: MODEL, object: 'model', max_model_len: 8192, root: MODEL }] } };
    if (r.path === '/v1/chat/completions') {
      if (opts.chat) return opts.chat(r);
      return { body: { id: 'cmpl-1', model: MODEL, system_fingerprint: 'vllm-0.11', choices: [{ index: 0, message: { role: 'assistant', content: GOOD_INTENT_TEXT }, finish_reason: 'stop' }], usage: { prompt_tokens: 650, completion_tokens: 38, prompt_tokens_details: { cached_tokens: 128 } } } };
    }
    return { status: 404, body: {} };
  };
}

describe('openai_compat adapter (vLLM)', () => {
  let server: FakeServer;
  before(async () => {
    server = await FakeServer.start([18750, 18759], vllm());
  });
  after(async () => server.close());

  const gateway = (options: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    makeGateway(rawConfig([mockRoute(), remoteRoute('vllm_selfhost', 'openai_compat', server.port, { model: MODEL, options, ...extra })]), { env: { ECHO_KEY_VLLM_SELFHOST: VLLM_KEY } });

  it('handshake lists the pinned model; owner-declared json_schema → generation with strict response_format', async () => {
    server.handler = vllm();
    server.requests.length = 0;
    const { gw } = gateway({ declared_capabilities: ['json_schema'] });
    const s = await openSession(gw, 'online');
    const r = await runIntent(gw, s, makeRequest(), { route: 'vllm_selfhost' });
    assert.equal(r.status, 'ok');
    assert.equal(r.proposal_text, GOOD_INTENT_TEXT);
    assert.deepEqual(r.usage, { input_tokens: 650, output_tokens: 38, cached_input_tokens: 128, measured: true });
    assert.equal(r.provider_revision, `${MODEL} / vllm-0.11`);
    assert.deepEqual(server.requests.map((x) => x.path), ['/v1/models', '/v1/chat/completions']);
    const chat = server.requests[1];
    assert.equal(chat.headers.authorization, `Bearer ${VLLM_KEY}`);
    assert.equal(chat.json.response_format.type, 'json_schema');
    assert.equal(chat.json.response_format.json_schema.strict, true);
    assert.equal(chat.json.response_format.json_schema.name, 'npc_intent');
    assert.deepEqual(chat.json.response_format.json_schema.schema.properties.action.enum, ['inspect', 'prepare_isolation', 'refuse']);
    assert.equal(chat.json.max_tokens, 160);
    assert.equal(chat.json.stream, false);
    assert.equal(chat.json.chat_template_kwargs, undefined);
    gw.close();
  });

  it('json_schema neither published nor declared → capability refused, no generation request', async () => {
    server.handler = vllm();
    server.requests.length = 0;
    const { gw } = gateway({});
    const s = await openSession(gw, 'online');
    const r = await runIntent(gw, s, makeRequest(), { route: 'vllm_selfhost' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.error?.code, 'capability_unsupported');
    assert.deepEqual(server.requests.map((x) => x.path), ['/v1/models']);
    gw.close();
  });

  it('capabilities published by the server win over the name: unsupported → refused even if declared', async () => {
    server.handler = vllm({ models: [{ id: MODEL, capabilities: ['completion'] }] });
    const { gw } = gateway({ declared_capabilities: ['json_schema'] });
    const s = await openSession(gw, 'online');
    const r = await runIntent(gw, s, makeRequest(), { route: 'vllm_selfhost' });
    assert.equal(r.error?.code, 'capability_unsupported');
    gw.close();
  });

  it('pinned model missing from /v1/models → unavailable (model_not_found)', async () => {
    server.handler = vllm({ models: [{ id: 'Qwen/Qwen3-8B' }] });
    const { gw } = gateway({ declared_capabilities: ['json_schema'] });
    const s = await openSession(gw, 'online');
    const r = await runIntent(gw, s, makeRequest(), { route: 'vllm_selfhost' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.error?.code, 'model_not_found');
    gw.close();
  });

  it('dialogue not declared → generate_dialogue refused while intents work', async () => {
    server.handler = vllm();
    const { gw } = gateway({ declared_capabilities: ['json_schema'] });
    const s = await openSession(gw, 'online');
    const r = await runIntent(gw, s, makeRequest({ capability: 'generate_dialogue' }), { route: 'vllm_selfhost' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.error?.code, 'capability_unsupported');
    gw.close();
  });

  it('chat_template_kwargs only when the owner configures them; 500 → one retry → unavailable', async () => {
    server.handler = vllm({ chat: () => ({ status: 500, body: { error: { message: 'boom', type: 'InternalServerError' } } }) });
    server.requests.length = 0;
    const { gw } = gateway({ declared_capabilities: ['json_schema'], chat_template_kwargs: { enable_thinking: false } });
    const s = await openSession(gw, 'online');
    const r = await runIntent(gw, s, makeRequest(), { route: 'vllm_selfhost' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.attempts, 2);
    const chats = server.requests.filter((x) => x.path === '/v1/chat/completions');
    assert.equal(chats.length, 2);
    assert.deepEqual(chats[0].json.chat_template_kwargs, { enable_thinking: false });
    gw.close();
  });
});

describe('user-supplied endpoint (BYO) through the server', () => {
  const dns: Record<string, string> = { 'byo.example': '93.184.216.34', 'intranet.example': '192.168.0.5', 'meta.example': '169.254.169.254', 'cgnat.example': '100.64.1.1' };
  const resolver: Resolver = async (h) => {
    if (!dns[h]) throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
    return [{ address: dns[h], family: 4 }];
  };
  const byoRoute = { id: 'custom_endpoint', adapter: 'openai_compat', enabled: true, user_supplied_endpoint: true, capabilities: ['generate_intent'] };
  const OWNER_KEY = 'owner-secret-for-custom-route-XYZ987';
  const make = () => makeGateway(rawConfig([mockRoute(), byoRoute]), { resolver, env: { ECHO_KEY_CUSTOM_ENDPOINT: OWNER_KEY } });

  for (const [url, code] of [
    ['https://10.0.0.1/', 'blocked_address'],
    ['https://127.0.0.1:8443/', 'blocked_address'],
    ['https://[::1]/', 'blocked_address'],
    ['https://[fd00::5]/', 'blocked_address'],
    ['https://169.254.169.254/', 'blocked_address'],
    ['https://intranet.example/', 'blocked_address'],
    ['https://meta.example/', 'blocked_address'],
    ['https://cgnat.example/', 'blocked_address'],
    ['http://byo.example/', 'insecure_scheme'],
    ['https://user:pass@byo.example/', 'credentials_in_url'],
  ] as const) {
    it(`session creation rejects ${url} (${code})`, async () => {
      const { gw } = make();
      const r = await gw.createSession({ privacy_profile: 'online', client: 'web', custom_endpoint: { url, model: 'my-model-v1' } });
      assert.equal(r.httpStatus, 400);
      assert.equal((r.body as { error: { code: string } }).error.code, code);
      gw.close();
    });
  }

  it('offline profile cannot register a custom endpoint at all', async () => {
    const { gw } = make();
    const r = await gw.createSession({ privacy_profile: 'offline', client: 'web', custom_endpoint: { url: 'https://byo.example/', model: 'my-model-v1' } });
    assert.equal(r.httpStatus, 403);
    assert.equal((r.body as { error: { code: string } }).error.code, 'privacy_blocked');
    gw.close();
  });

  it('floating model alias is refused for a custom endpoint too', async () => {
    const { gw } = make();
    const r = await gw.createSession({ privacy_profile: 'online', client: 'web', custom_endpoint: { url: 'https://byo.example/', model: 'llama3:latest' } });
    assert.equal(r.httpStatus, 400);
    assert.equal((r.body as { error: { code: string } }).error.code, 'floating_model_alias');
    gw.close();
  });

  it('the owner key never goes to a user endpoint; only the session BYO key does, pinned to its origin', async () => {
    const { gw, sink } = make();
    const BYO_KEY = 'byo-user-key-0000111122223333';
    const s = await openSession(gw, 'online', { custom_endpoint: { url: 'https://byo.example/', model: 'my-model-v1', api_key: BYO_KEY, capabilities: ['json_schema'] } });
    let seen: AdapterContext | null = null;
    // Network to a public address is not available in tests: intercept at the adapter boundary.
    gw.adapters.openai_compat.probe = async (ctx) => ({
      route: ctx.route.id,
      adapter: 'openai_compat',
      adapter_version: 'test',
      status: 'ok',
      model: ctx.model,
      model_available: true,
      served_model: ctx.model,
      capabilities: { generate_intent: 'declared', generate_dialogue: 'unsupported', structured_output: null, thinking_control: null },
      details: {},
      checked_at: new Date().toISOString(),
      latency_ms: 0,
      error: null,
    });
    gw.adapters.openai_compat.generateIntent = async (_req, ctx) => {
      seen = ctx;
      return outcome('ok', { usage: zeroUsage(true), finishReason: 'stop', text: GOOD_INTENT_TEXT });
    };
    const r = await runIntent(gw, s, makeRequest(), { route: 'custom_endpoint' });
    assert.equal(r.status, 'ok');
    assert.equal(r.model, 'my-model-v1');
    const ctx = seen as unknown as AdapterContext;
    assert.equal(ctx.apiKey, BYO_KEY);
    assert.notEqual(ctx.apiKey, OWNER_KEY);
    assert.equal(ctx.http?.origin, 'https://byo.example');
    assert.equal(ctx.http?.policy, 'public_only');
    assert.ok(!sink.text().includes(BYO_KEY), 'BYO key never logged');
    assert.ok(!JSON.stringify(gw.usage(s)).includes(BYO_KEY));
    gw.close();
  });
});
