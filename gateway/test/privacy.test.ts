// Privacy profiles and fallbacks (Документ §11, §15, §17): offline sends nothing out, hybrid only to the
// explicit allowlist, no silent cross-provider fallback; a fallback runs only when configured AND permitted.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Gateway } from '../src/gateway.ts';
import type { MemorySink } from '../src/log.ts';
import { FakeServer, makeGateway, makeRequest, mockRoute, openSession, rawConfig, remoteRoute, runIntent } from './helpers.ts';

const OPENAI_KEY = 'sk-test-openai-privacy-000111';
const GEMINI_KEY = 'AIzaPrivacyTestKey_0123456789abcd';

const okResponses = (text: string) => ({
  status: 'completed',
  model: 'openai-test',
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 10, output_tokens: 10 },
});
const okGemini = (text: string) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } });
const INTENT = '{"action":"refuse","target_id":null,"companion_id":null,"fact_ids":[],"style":"firm","gesture":"none"}';

describe('privacy profiles and fallbacks', () => {
  let openai: FakeServer;
  let gemini: FakeServer;
  const env = { ECHO_KEY_OPENAI: OPENAI_KEY, ECHO_KEY_GEMINI: GEMINI_KEY, ECHO_KEY_OPENAI_FB_GEMINI: OPENAI_KEY, ECHO_KEY_OPENAI_FB_LOCAL: OPENAI_KEY };

  before(async () => {
    openai = await FakeServer.start([18780, 18784], () => ({ body: okResponses(INTENT) }));
    gemini = await FakeServer.start([18785, 18789], () => ({ body: okGemini(INTENT) }));
  });
  after(async () => {
    await openai.close();
    await gemini.close();
  });

  function make(privacy: Record<string, unknown>, openaiOver: Record<string, unknown> = {}): { gw: Gateway; sink: MemorySink } {
    openai.requests.length = 0;
    gemini.requests.length = 0;
    return makeGateway(
      rawConfig(
        [
          mockRoute(),
          mockRoute({ id: 'local_mock' }),
          remoteRoute('openai', 'openai', openai.port, openaiOver),
          remoteRoute('gemini', 'gemini', gemini.port),
          remoteRoute('openai_fb_gemini', 'openai', openai.port, { fallback_route: 'gemini' }),
          remoteRoute('openai_fb_local', 'openai', openai.port, { fallback_route: 'local_mock' }),
        ],
        { privacy },
      ),
      { env },
    );
  }

  it('offline: a remote route is refused before any network call', async () => {
    const { gw } = make({ hybrid_remote_allowlist: ['openai'] });
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest({ privacy_profile: 'offline' }), { route: 'openai' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.error?.code, 'privacy_blocked');
    assert.equal(r.attempts, 0);
    assert.equal(openai.requests.length, 0);
    gw.close();
  });

  it('the stricter profile wins: an online session sending an offline request stays local', async () => {
    const { gw } = make({});
    const s = await openSession(gw, 'online');
    const r = await runIntent(gw, s, makeRequest({ privacy_profile: 'offline' }), { route: 'openai' });
    assert.equal(r.error?.code, 'privacy_blocked');
    assert.equal(openai.requests.length, 0);
    gw.close();
  });

  it('hybrid: only the explicit allowlist of remote routes', async () => {
    const { gw } = make({ hybrid_remote_allowlist: ['openai'] });
    const s = await openSession(gw, 'hybrid');
    assert.equal((await runIntent(gw, s, makeRequest({ privacy_profile: 'hybrid' }), { route: 'openai' })).status, 'ok');
    const r = await runIntent(gw, s, makeRequest({ privacy_profile: 'hybrid' }), { route: 'gemini' });
    assert.equal(r.error?.code, 'privacy_blocked');
    assert.equal(gemini.requests.length, 0);
    gw.close();
  });

  it('online with an explicit online allowlist', async () => {
    const { gw } = make({ online_remote_allowlist: ['openai'] });
    const s = await openSession(gw, 'online');
    const r = await runIntent(gw, s, makeRequest(), { route: 'gemini' });
    assert.equal(r.error?.code, 'privacy_blocked');
    gw.close();
  });

  it('no silent cross-provider fallback: a failing provider without fallback_route stays failed', async () => {
    openai.handler = () => ({ status: 500, body: { error: { message: 'down' } } });
    const { gw } = make({});
    const s = await openSession(gw, 'online');
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai' });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.provider, 'openai');
    assert.equal(r.attempts, 2);
    assert.equal(gemini.requests.length, 0, 'the conversation was not sent to another provider');
    openai.handler = () => ({ body: okResponses(INTENT) });
    gw.close();
  });

  it('a configured remote fallback is NOT used when the profile does not permit it', async () => {
    openai.handler = () => ({ status: 500, body: { error: { message: 'down' } } });
    const { gw, sink } = make({ hybrid_remote_allowlist: ['openai_fb_gemini'] });
    const s = await openSession(gw, 'hybrid');
    const r = await runIntent(gw, s, makeRequest({ privacy_profile: 'hybrid' }), { route: 'openai_fb_gemini' });
    assert.equal(r.status, 'unavailable');
    assert.equal(gemini.requests.length, 0);
    assert.ok(sink.events().some((e) => e.event === 'fallback_not_permitted'));
    openai.handler = () => ({ body: okResponses(INTENT) });
    gw.close();
  });

  it('a configured AND permitted fallback is used as the single retry, and reported', async () => {
    openai.handler = () => ({ status: 500, body: { error: { message: 'down' } } });
    const { gw } = make({});
    const s = await openSession(gw, 'online');
    const res = await gw.handle(s, makeRequest(), 'generate_intent', { receivedAt: gw.clock.now(), routeHeader: 'openai_fb_gemini' });
    const r = res.body as { status: string; provider: string; attempts: number };
    assert.equal(r.status, 'ok');
    assert.equal(r.provider, 'gemini');
    assert.equal(r.attempts, 2);
    assert.equal(res.headers?.['x-echo-route-used'], 'gemini');
    assert.equal(gemini.requests.length, 1);
    assert.equal(gemini.requests[0].headers['x-goog-api-key'], GEMINI_KEY);
    assert.ok(!JSON.stringify(gemini.requests[0].headers).includes(OPENAI_KEY), 'the OpenAI key never reaches the Gemini host');
    openai.handler = () => ({ body: okResponses(INTENT) });
    gw.close();
  });

  it('remote → local fallback is allowed even in hybrid (data stays on the machine)', async () => {
    openai.handler = () => ({ status: 503, body: {} });
    const { gw } = make({ hybrid_remote_allowlist: ['openai_fb_local'] });
    const s = await openSession(gw, 'hybrid');
    const r = await runIntent(gw, s, makeRequest({ privacy_profile: 'hybrid' }), { route: 'openai_fb_local' });
    assert.equal(r.status, 'ok');
    assert.equal(r.provider, 'local_mock');
    openai.handler = () => ({ body: okResponses(INTENT) });
    gw.close();
  });

  it('a fallback also covers non-transient availability failures of the primary (401 → local)', async () => {
    openai.handler = () => ({ status: 401, body: { error: { message: 'bad key' } } });
    const { gw } = make({});
    const s = await openSession(gw, 'online');
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai_fb_local' });
    assert.equal(r.status, 'ok');
    assert.equal(r.provider, 'local_mock');
    assert.equal(r.attempts, 2);
    openai.handler = () => ({ body: okResponses(INTENT) });
    gw.close();
  });

  it('a refusal is never re-routed to the fallback (no hidden refusal fallback)', async () => {
    openai.handler = () => ({ body: { ...okResponses(''), output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'нет' }] }] } });
    const { gw } = make({});
    const s = await openSession(gw, 'online');
    const r = await runIntent(gw, s, makeRequest(), { route: 'openai_fb_local' });
    assert.equal(r.status, 'refused');
    assert.equal(r.provider, 'openai_fb_local');
    assert.equal(r.attempts, 1);
    assert.equal(gw.adapters.mock.calls.get('local_mock') ?? 0, 0);
    openai.handler = () => ({ body: okResponses(INTENT) });
    gw.close();
  });

  it('retry.attempt_timeout_ms caps a hanging primary so the single fallback still fits the deadline', async () => {
    openai.handler = () => ({ hang: true });
    const capped = makeGateway(
      rawConfig([mockRoute(), mockRoute({ id: 'local_mock' }), remoteRoute('openai_capped', 'openai', openai.port, { fallback_route: 'local_mock', retry: { max_attempts: 2, base_backoff_ms: 10, max_backoff_ms: 20, min_remaining_ms: 100, attempt_timeout_ms: 200 } })]),
      { env: { ECHO_KEY_OPENAI_CAPPED: OPENAI_KEY } },
    );
    const s = await openSession(capped.gw, 'online');
    const t0 = Date.now();
    const r = await runIntent(capped.gw, s, makeRequest({ deadline_ms: 1500 }), { route: 'openai_capped' });
    assert.equal(r.status, 'ok');
    assert.equal(r.provider, 'local_mock');
    assert.equal(r.attempts, 2);
    assert.ok(Date.now() - t0 < 700, 'did not wait for the whole deadline');
    openai.handler = () => ({ body: okResponses(INTENT) });
    capped.gw.close();
  });

  it('session route list shows only routes permitted by the profile', async () => {
    const { gw } = make({ hybrid_remote_allowlist: ['openai'] });
    const offline = await gw.createSession({ privacy_profile: 'offline', client: 'web' });
    const ids = (offline.body as { routes: { id: string }[] }).routes.map((r) => r.id);
    assert.deepEqual(ids.sort(), ['local_mock', 'mock']);
    const hybrid = await gw.createSession({ privacy_profile: 'hybrid', client: 'web' });
    assert.deepEqual((hybrid.body as { routes: { id: string }[] }).routes.map((r) => r.id).sort(), ['local_mock', 'mock', 'openai']);
    const denied = await gw.createSession({ privacy_profile: 'offline', client: 'web', route: 'openai' });
    assert.equal(denied.httpStatus, 403);
    gw.close();
  });

  it('offline sessions do not even probe remote providers', async () => {
    const { gw } = make({});
    const s = await openSession(gw, 'offline');
    const report = (await gw.providers(s, { refresh: true, deep: false })) as { providers: { route: string; status: string }[] };
    assert.equal(openai.requests.length, 0);
    assert.equal(gemini.requests.length, 0);
    assert.equal(report.providers.find((p) => p.route === 'openai')?.status, 'not_configured');
    gw.close();
  });
});
