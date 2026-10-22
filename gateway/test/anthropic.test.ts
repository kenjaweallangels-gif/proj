// Claude Messages API adapter: the official SDK (@anthropic-ai/sdk) pointed at a fake baseURL on loopback.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Gateway } from '../src/gateway.ts';
import type { MemorySink } from '../src/log.ts';
import type { Session } from '../src/sessions.ts';
import { FakeServer, GOOD_INTENT_TEXT, makeGateway, makeRequest, mockRoute, openSession, rawConfig, remoteRoute, runIntent } from './helpers.ts';

const KEY = 'sk-ant-test-KEY-9988776655';
const MODEL = 'claude-opus-5-5';

function message(over: Record<string, unknown> = {}) {
  return {
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: GOOD_INTENT_TEXT },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 300, output_tokens: 210, cache_read_input_tokens: 600, cache_creation_input_tokens: 100, output_tokens_details: { thinking_tokens: 150 } },
    ...over,
  };
}

function apiError(status: number, type: string, msg: string, headers: Record<string, string> = {}) {
  return { status, headers: { 'request-id': 'req_test', ...headers }, body: { type: 'error', error: { type, message: msg } } };
}

describe('anthropic adapter (Messages API via SDK)', () => {
  let server: FakeServer;
  let gw: Gateway;
  let sink: MemorySink;
  let s: Session;

  before(async () => {
    server = await FakeServer.start([18720, 18729], () => ({ body: message() }));
    ({ gw, sink } = makeGateway(
      rawConfig([
        mockRoute(),
        remoteRoute('anthropic', 'anthropic', server.port, { model: MODEL }),
        remoteRoute('anthropic_fb', 'anthropic', server.port, { model: MODEL, options: { server_side_refusal_fallback: true } }),
      ]),
      { env: { ECHO_KEY_ANTHROPIC: KEY, ECHO_KEY_ANTHROPIC_FB: KEY } },
    ));
    s = await openSession(gw, 'online');
  });
  after(async () => {
    gw.close();
    await server.close();
  });

  it('ok: output_config.format json_schema + effort, thinking headroom, no sampling params, usage incl. cache', async () => {
    server.handler = () => ({ body: message() });
    const r = await runIntent(gw, s, makeRequest(), { route: 'anthropic' });
    assert.equal(r.status, 'ok');
    assert.equal(r.proposal_text, GOOD_INTENT_TEXT, 'thinking blocks are ignored, only text is the proposal');
    assert.deepEqual(r.usage, { input_tokens: 1000, output_tokens: 210, cached_input_tokens: 600, reasoning_tokens: 150, measured: true });
    // 300 plain × 1 + 600 cached × 0.1 + 100 cache-write × 1 (no write price in test book) + 210 × 5 = 1510 µ$
    assert.equal(r.cost_usd, 0.00151);
    assert.equal(r.provider_revision, MODEL);

    const sent = server.requests.at(-1)!;
    assert.match(sent.path, /^\/v1\/messages/);
    assert.equal(sent.headers['x-api-key'], KEY);
    assert.ok(sent.headers['anthropic-version']);
    assert.equal(sent.headers['anthropic-beta'], undefined, 'no beta header unless the route opts into fallbacks');
    assert.ok(!sent.body.includes(KEY));
    assert.equal(sent.json.model, MODEL);
    assert.equal(sent.json.output_config.format.type, 'json_schema');
    assert.deepEqual(sent.json.output_config.format.schema.properties.action.enum, ['inspect', 'prepare_isolation', 'refuse']);
    assert.equal(sent.json.output_config.effort, 'low');
    assert.equal(sent.json.max_tokens, 160 + 1024);
    assert.equal(sent.json.output_format, undefined, 'deprecated output_format is not used');
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'fallbacks']) assert.equal(sent.json[k], undefined, k);
    assert.equal(sent.json.messages.length, 1, 'no assistant prefill');
    assert.equal(sent.json.messages[0].role, 'user');
    assert.match(sent.json.system, /Ты — слой принятия решений/);
  });

  it('stop_reason refusal is checked before content → refused (category reported)', async () => {
    server.handler = () => ({ body: message({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } }) });
    const r = await runIntent(gw, s, makeRequest(), { route: 'anthropic' });
    assert.equal(r.status, 'refused');
    assert.equal(r.attempts, 1);
    assert.match(r.error?.message ?? '', /category=cyber/);
    assert.equal(r.proposal_text, null);
  });

  it('stop_reason max_tokens → invalid_output (truncated)', async () => {
    server.handler = () => ({ body: message({ content: [{ type: 'text', text: '{"action":"ins' }], stop_reason: 'max_tokens' }) });
    const r = await runIntent(gw, s, makeRequest(), { route: 'anthropic' });
    assert.equal(r.status, 'invalid_output');
    assert.equal(r.error?.code, 'truncated');
  });

  it('429 rate_limit_error with long retry-after → rate_limited, SDK retries disabled', async () => {
    server.handler = () => apiError(429, 'rate_limit_error', 'Number of requests has exceeded your rate limit', { 'retry-after': '30' });
    server.requests.length = 0;
    const r = await runIntent(gw, s, makeRequest(), { route: 'anthropic' });
    assert.equal(r.status, 'rate_limited');
    assert.equal(r.error?.retry_after_ms, 30_000);
    assert.equal(server.requests.length, 1, 'neither the SDK nor the gateway retried');
  });

  it('529 overloaded twice → unavailable after one gateway retry', async () => {
    server.handler = () => apiError(529, 'overloaded_error', 'Overloaded');
    server.requests.length = 0;
    const r = await runIntent(gw, s, makeRequest(), { route: 'anthropic' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.error?.code, 'overloaded');
    assert.equal(r.attempts, 2);
    assert.equal(server.requests.length, 2);
  });

  it('529 then success → ok on the retry', async () => {
    server.handler = (_r, n) => (n % 2 === 1 ? apiError(529, 'overloaded_error', 'Overloaded') : { body: message() });
    server.requests.length = 0;
    const r = await runIntent(gw, s, makeRequest(), { route: 'anthropic' });
    assert.equal(r.status, 'ok');
    assert.equal(r.attempts, 2);
  });

  it('401 echoing the key → unavailable (auth_failed), key redacted everywhere', async () => {
    server.handler = () => apiError(401, 'authentication_error', `invalid x-api-key ${KEY}`);
    const r = await runIntent(gw, s, makeRequest(), { route: 'anthropic' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.error?.code, 'auth_failed');
    assert.ok(!JSON.stringify(r).includes(KEY));
    assert.ok(!sink.text().includes(KEY));
  });

  it('hanging API → timeout at the deadline', async () => {
    server.handler = () => ({ hang: true });
    const r = await runIntent(gw, s, makeRequest({ deadline_ms: 300 }), { route: 'anthropic' });
    assert.equal(r.status, 'timeout');
    assert.ok(r.latency_ms.total < 400);
  });

  it('server-side refusal fallback only with the per-route flag: beta header + fallbacks "default"', async () => {
    server.handler = () => ({
      body: message({ model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 20, iterations: [{ type: 'message' }, { type: 'fallback_message' }] } }),
    });
    const r = await runIntent(gw, s, makeRequest(), { route: 'anthropic_fb' });
    assert.equal(r.status, 'ok');
    const sent = server.requests.at(-1)!;
    assert.equal(sent.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.equal(sent.json.fallbacks, 'default');
    assert.match(r.provider_revision ?? '', /server-side fallback/);
  });

  it('probe: models.retrieve(model) through the pinned fetch', async () => {
    server.handler = (req) =>
      req.method === 'GET'
        ? { body: { id: MODEL, type: 'model', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z', max_input_tokens: 1000000, max_tokens: 128000, capabilities: null } }
        : { body: message() };
    const report = (await gw.providers(s, { refresh: true, deep: false })) as { providers: { route: string; status: string; model_available: boolean; details: Record<string, unknown> }[] };
    const p = report.providers.find((x) => x.route === 'anthropic')!;
    assert.equal(p.status, 'ok');
    assert.equal(p.model_available, true);
    assert.equal(p.details.max_input_tokens, 1000000);
    assert.ok(server.requests.some((x) => x.method === 'GET' && x.path.startsWith(`/v1/models/${MODEL}`)));
  });
});
