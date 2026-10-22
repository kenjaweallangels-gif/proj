// Gemini generateContent adapter against a fake server (loopback only).

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { toGeminiSubset } from '../src/adapters/gemini.ts';
import { buildIntentSchema } from '../../shared/prompt.ts';
import type { Gateway } from '../src/gateway.ts';
import type { Session } from '../src/sessions.ts';
import { FakeServer, GOOD_INTENT_TEXT, makeGateway, makeRequest, mockRoute, openSession, rawConfig, remoteRoute, runIntent } from './helpers.ts';

const KEY = 'AIzaTestKey_0123456789abcdefghij';
const MODEL = 'gemini-test-2026-01';

function candidate(text: string, finishReason = 'STOP', extra: Record<string, unknown> = {}) {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: 'размышление', thought: true }, { text }] }, finishReason, index: 0 }],
    usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 60, thoughtsTokenCount: 40, cachedContentTokenCount: 200, totalTokenCount: 900 },
    modelVersion: MODEL,
    responseId: 'resp-gem-1',
    ...extra,
  };
}

describe('gemini adapter (generateContent)', () => {
  let server: FakeServer;
  let gw: Gateway;
  let s: Session;

  before(async () => {
    server = await FakeServer.start([18730, 18739], () => ({ body: candidate(GOOD_INTENT_TEXT) }));
    ({ gw } = makeGateway(rawConfig([mockRoute(), remoteRoute('gemini', 'gemini', server.port, { model: MODEL }), remoteRoute('gemini2', 'gemini', server.port, { model: MODEL })]), {
      env: { ECHO_KEY_GEMINI: KEY, ECHO_KEY_GEMINI2: KEY },
    }));
    s = await openSession(gw, 'online');
  });
  after(async () => {
    gw.close();
    await server.close();
  });

  it('ok: responseMimeType + responseJsonSchema, key in header (never in URL), thoughts billed as output', async () => {
    server.handler = () => ({ body: candidate(GOOD_INTENT_TEXT) });
    const r = await runIntent(gw, s, makeRequest(), { route: 'gemini' });
    assert.equal(r.status, 'ok');
    assert.equal(r.proposal_text, GOOD_INTENT_TEXT, 'thought parts are excluded');
    assert.deepEqual(r.usage, { input_tokens: 800, output_tokens: 100, cached_input_tokens: 200, reasoning_tokens: 40, measured: true });
    assert.match(r.provider_revision ?? '', new RegExp(MODEL));
    const sent = server.requests.at(-1)!;
    assert.equal(sent.path, `/v1beta/models/${MODEL}:generateContent`);
    assert.equal(sent.headers['x-goog-api-key'], KEY);
    assert.ok(!sent.path.includes(KEY) && !sent.body.includes(KEY));
    const gc = sent.json.generationConfig;
    assert.equal(gc.responseMimeType, 'application/json');
    assert.deepEqual(gc.responseJsonSchema.properties.action.enum, ['inspect', 'prepare_isolation', 'refuse']);
    assert.equal(gc.maxOutputTokens, 160);
    assert.equal(gc.thinkingConfig, undefined, 'thinking budget is sent only when configured');
    assert.match(sent.json.systemInstruction.parts[0].text, /Ты — слой принятия решений/);
  });

  it('promptFeedback.blockReason → refused', async () => {
    server.handler = () => ({ body: { promptFeedback: { blockReason: 'SAFETY' }, usageMetadata: { promptTokenCount: 800 } } });
    const r = await runIntent(gw, s, makeRequest(), { route: 'gemini' });
    assert.equal(r.status, 'refused');
    assert.equal(r.finish_reason, 'blocked:SAFETY');
  });

  for (const reason of ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT']) {
    it(`finishReason ${reason} → refused`, async () => {
      server.handler = () => ({ body: candidate('', reason) });
      const r = await runIntent(gw, s, makeRequest(), { route: 'gemini' });
      assert.equal(r.status, 'refused');
      assert.equal(r.finish_reason, reason);
    });
  }

  it('finishReason MAX_TOKENS → invalid_output (truncated)', async () => {
    server.handler = () => ({ body: candidate('{"action":"in', 'MAX_TOKENS') });
    const r = await runIntent(gw, s, makeRequest(), { route: 'gemini' });
    assert.equal(r.status, 'invalid_output');
    assert.equal(r.error?.code, 'truncated');
  });

  it('429 RESOURCE_EXHAUSTED with RetryInfo beyond the deadline → rate_limited, retryDelay honored', async () => {
    server.handler = () => ({
      status: 429,
      body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '20s' }] } },
    });
    const r = await runIntent(gw, s, makeRequest(), { route: 'gemini' });
    assert.equal(r.status, 'rate_limited');
    assert.equal(r.attempts, 1);
    assert.equal(r.error?.retry_after_ms, 20_000);
  });

  it('endpoint rejecting responseJsonSchema → sticky downgrade to the responseSchema subset on the retry', async () => {
    server.handler = (req) =>
      req.json?.generationConfig?.responseJsonSchema
        ? { status: 400, body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received. Unknown name "responseJsonSchema"' } } }
        : { body: candidate(GOOD_INTENT_TEXT) };
    server.requests.length = 0;
    const r = await runIntent(gw, s, makeRequest(), { route: 'gemini2' });
    assert.equal(r.status, 'ok');
    assert.equal(r.attempts, 2);
    const second = server.requests[1].json.generationConfig;
    assert.equal(second.responseJsonSchema, undefined);
    assert.equal(second.responseSchema.properties.target_id.nullable, true);
    assert.deepEqual(second.responseSchema.properties.target_id.enum, ['sensor_a', 'niche_a']);
    assert.deepEqual(second.responseSchema.propertyOrdering, ['action', 'target_id', 'companion_id', 'fact_ids', 'style', 'gesture']);
    // Next request on the same route goes straight to the subset.
    await runIntent(gw, s, makeRequest(), { route: 'gemini2' });
    assert.equal(server.requests.at(-1)!.json.generationConfig.responseJsonSchema, undefined);
  });

  it('OpenAPI-subset conversion drops type unions and additionalProperties', () => {
    const sub = toGeminiSubset(buildIntentSchema(makeRequest({ allowed_actions: [{ id: 'refuse', label: 'отказаться', targets: [], companions: [], fact_ids_min: 0, fact_ids_max: 1 }] }), { strict: true }));
    assert.equal(sub.additionalProperties, undefined);
    const props = sub.properties as Record<string, Record<string, unknown>>;
    assert.equal(props.target_id.type, 'string');
    assert.equal(props.target_id.nullable, true);
    assert.equal(props.target_id.enum, undefined, 'a null-only field has no enum values left');
  });
});
