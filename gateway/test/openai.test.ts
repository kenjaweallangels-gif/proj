// OpenAI Responses API adapter against a fake /v1/responses server (loopback only).

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Gateway } from '../src/gateway.ts';
import type { MemorySink } from '../src/log.ts';
import type { Session } from '../src/sessions.ts';
import { delay, FakeServer, GOOD_INTENT_TEXT, makeGateway, makeRequest, mockRoute, openSession, rawConfig, remoteRoute, runIntent } from './helpers.ts';

const KEY = 'sk-test-openai-KEY-000111222';
const MODEL = 'gpt-test-2026-01-01';

function completed(text: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'resp_1',
    object: 'response',
    status: 'completed',
    model: MODEL,
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] },
    ],
    usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 512 }, output_tokens: 120, output_tokens_details: { reasoning_tokens: 64 }, total_tokens: 1020 },
    ...extra,
  };
}

describe('openai adapter (Responses API)', () => {
  let server: FakeServer;
  let gw: Gateway;
  let sink: MemorySink;
  let s: Session;

  before(async () => {
    server = await FakeServer.start([18710, 18719], () => ({ body: completed(GOOD_INTENT_TEXT) }));
    ({ gw, sink } = makeGateway(rawConfig([mockRoute(), remoteRoute('openai', 'openai', server.port, { model: MODEL })]), { env: { ECHO_KEY_OPENAI: KEY } }));
    s = await openSession(gw, 'online');
  });
  after(async () => {
    gw.close();
    await server.close();
  });

  it('ok: request shape (strict json_schema, narrowed enums, max_output_tokens, store=false) and usage mapping', async () => {
    server.handler = () => ({ body: completed(GOOD_INTENT_TEXT) });
    const req = makeRequest();
    const r = await runIntent(gw, s, req, { route: 'openai' });
    assert.equal(r.status, 'ok');
    assert.equal(r.proposal_text, GOOD_INTENT_TEXT);
    assert.deepEqual(r.usage, { input_tokens: 900, output_tokens: 120, cached_input_tokens: 512, reasoning_tokens: 64, measured: true });
    assert.equal(r.provider, 'openai');
    assert.equal(r.provider_revision, MODEL);
    // (900-512)×1 + 512×0.1 + 120×5 = 1039.2 µ$ (fictional test prices)
    assert.equal(r.cost_usd, 0.0010392);
    assert.equal(r.cost_is_fictional, true);

    const sent = server.requests.at(-1)!;
    assert.equal(sent.method, 'POST');
    assert.equal(sent.path, '/v1/responses');
    assert.equal(sent.headers.authorization, `Bearer ${KEY}`);
    assert.ok(!sent.body.includes(KEY), 'key never travels in the body');
    const fmt = sent.json.text.format;
    assert.equal(fmt.type, 'json_schema');
    assert.equal(fmt.strict, true);
    assert.equal(fmt.name, 'npc_intent');
    assert.deepEqual(fmt.schema.properties.action.enum, ['inspect', 'prepare_isolation', 'refuse']);
    assert.deepEqual(fmt.schema.properties.target_id.enum, ['sensor_a', 'niche_a', null]);
    assert.deepEqual(fmt.schema.properties.companion_id.enum, ['nika', 'thomas', null]);
    assert.deepEqual(fmt.schema.properties.fact_ids.items.enum, ['pressure_disagreement', 'yun_sent_alone', 'mira_objected_solo']);
    assert.equal(fmt.schema.additionalProperties, false);
    assert.equal(sent.json.max_output_tokens, 160);
    assert.equal(sent.json.store, false);
    assert.equal(sent.json.model, MODEL);
    assert.match(sent.json.instructions, /Ты — слой принятия решений/);
    assert.match(sent.json.input[0].content[0].text, /Мира/);
    assert.equal(sent.json.reasoning, undefined, 'reasoning is never guessed from the model name');
  });

  it('refusal output item → refused', async () => {
    server.handler = () => ({
      body: { ...completed(''), output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Не могу помочь с этим.' }] }] },
    });
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai' });
    assert.equal(r.status, 'refused');
    assert.equal(r.proposal_text, null);
    assert.equal(r.attempts, 1);
  });

  it('status incomplete (max_output_tokens) → invalid_output, partial JSON not applied', async () => {
    server.handler = () => ({ body: completed('{"action":"insp', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) });
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai' });
    assert.equal(r.status, 'invalid_output');
    assert.equal(r.finish_reason, 'incomplete:max_output_tokens');
    assert.equal(r.error?.code, 'truncated');
  });

  it('status incomplete (content_filter) → refused', async () => {
    server.handler = () => ({ body: completed('', { status: 'incomplete', incomplete_details: { reason: 'content_filter' } }) });
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai' });
    assert.equal(r.status, 'refused');
  });

  it('fenced JSON is unwrapped with extractJsonCandidate; non-JSON prose → invalid_output', async () => {
    server.handler = () => ({ body: completed('```json\n' + GOOD_INTENT_TEXT + '\n```') });
    assert.equal((await runIntent(gw, s, makeRequest(), { route: 'openai' })).proposal_text, GOOD_INTENT_TEXT);
    server.handler = () => ({ body: completed('Я бы проверила датчик.') });
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai' });
    assert.equal(r.status, 'invalid_output');
    assert.equal(r.error?.code, 'not_json');
  });

  it('429 with a short Retry-After → one retry → ok', async () => {
    server.handler = (_r, n) => (n % 2 === 1 ? { status: 429, headers: { 'retry-after': '0' }, body: { error: { message: 'Rate limit reached', type: 'requests', code: 'rate_limit_exceeded' } } } : { body: completed(GOOD_INTENT_TEXT) });
    server.requests.length = 0;
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai' });
    assert.equal(r.status, 'ok');
    assert.equal(r.attempts, 2);
    assert.equal(server.requests.length, 2);
  });

  it('429 with Retry-After beyond the deadline → rate_limited, no retry, retry_after_ms reported', async () => {
    server.handler = () => ({ status: 429, headers: { 'retry-after': '30' }, body: { error: { message: 'slow down', code: 'rate_limit_exceeded' } } });
    server.requests.length = 0;
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai' });
    assert.equal(r.status, 'rate_limited');
    assert.equal(r.attempts, 1);
    assert.equal(r.error?.retry_after_ms, 30_000);
    assert.equal(server.requests.length, 1);
  });

  it('429 insufficient_quota → budget_exceeded (not retried)', async () => {
    server.handler = () => ({ status: 429, body: { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } } });
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai' });
    assert.equal(r.status, 'budget_exceeded');
    assert.equal(r.attempts, 1);
  });

  it('5xx twice → unavailable after exactly one retry', async () => {
    server.handler = () => ({ status: 503, body: { error: { message: 'overloaded', type: 'server_error' } } });
    server.requests.length = 0;
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.attempts, 2);
    assert.equal(server.requests.length, 2);
  });

  it('401 echoing the key → unavailable (auth_failed); the key is redacted from result and logs', async () => {
    server.handler = () => ({ status: 401, body: { error: { message: `Incorrect API key provided: ${KEY}. You can find your API key at ...`, code: 'invalid_api_key' } } });
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.error?.code, 'auth_failed');
    assert.equal(r.attempts, 1);
    assert.ok(!JSON.stringify(r).includes(KEY));
    assert.match(r.error?.message ?? '', /REDACTED/);
    assert.ok(!sink.text().includes(KEY), 'key never reaches the log');
  });

  it('hanging provider → timeout at the deadline; the connection is dropped', async () => {
    server.handler = () => ({ hang: true });
    const before = server.disconnects;
    const r = await runIntent(gw, s, makeRequest({ deadline_ms: 300 }), { route: 'openai' });
    assert.equal(r.status, 'timeout');
    await delay(50);
    assert.ok(server.disconnects > before, 'upstream connection closed on deadline');
  });

  it('cancel drops the upstream connection and returns cancelled', async () => {
    server.handler = () => ({ hang: true });
    const before = server.disconnects;
    const req = makeRequest({ deadline_ms: 5000 });
    const pending = runIntent(gw, s, req, { route: 'openai' });
    await delay(60);
    gw.cancel(s, { task_id: req.task_id });
    const r = await pending;
    assert.equal(r.status, 'cancelled');
    await delay(50);
    assert.ok(server.disconnects > before);
  });

  it('generate_dialogue uses the narrowed dialogue schema', async () => {
    server.handler = () => ({ body: completed('{"line":"Сверю показания.","fact_ids":["pressure_disagreement"],"style":"concerned"}') });
    const r = await runIntent(gw, s, makeRequest({ capability: 'generate_dialogue' }), { route: 'openai' });
    assert.equal(r.status, 'ok');
    const fmt = server.requests.at(-1)!.json.text.format;
    assert.equal(fmt.name, 'npc_dialogue_line');
    assert.deepEqual(Object.keys(fmt.schema.properties), ['line', 'fact_ids', 'style']);
  });

  it('probe: model lookup via GET /v1/models/{id}; deep probe sends one tiny strict request', async () => {
    server.handler = (r) => (r.method === 'GET' ? { body: { id: MODEL, object: 'model' } } : { body: completed('{"ok":true}') });
    const report = (await gw.providers(s, { refresh: true, deep: true, allowRemoteDeep: true })) as { providers: { route: string; status: string; model_available: boolean; capabilities: { generate_intent: string } }[] };
    const p = report.providers.find((x) => x.route === 'openai')!;
    assert.equal(p.status, 'ok');
    assert.equal(p.model_available, true);
    assert.equal(p.capabilities.generate_intent, 'supported');
    assert.ok(server.requests.some((x) => x.method === 'GET' && x.path === `/v1/models/${MODEL}`));
    assert.ok(!JSON.stringify(report).includes(KEY));
  });
});
