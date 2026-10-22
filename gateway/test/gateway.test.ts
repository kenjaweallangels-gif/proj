// Gateway policy end-to-end with the deterministic mock provider: normalized statuses, deadline,
// retry only when time remains, idempotent task_id, cancel + late-response discard, concurrency limits,
// session quotas, circuit breaker integration, dialogue capability.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertValidResult, delay, makeGateway, makePrices, makeRequest, mockRoute, openSession, rawConfig, runIntent } from './helpers.ts';

function mockGateway(routeOver: Record<string, unknown> = {}, cfgOver: Record<string, unknown> = {}) {
  return makeGateway(
    rawConfig(
      [
        mockRoute({
          retry: { max_attempts: 2, base_backoff_ms: 20, max_backoff_ms: 40, min_remaining_ms: 150 },
          breaker: { failure_threshold: 50, cooldown_ms: 1000, max_cooldown_ms: 2000 },
          ...routeOver,
          options: { latency_ms: 1, retry_after_ms: 30, slow_ms: 400, ...((routeOver.options as object) ?? {}) },
        }),
      ],
      cfgOver,
    ),
  );
}

describe('normalized statuses (mock behaviours)', () => {
  const cases: [string, string, Partial<{ attempts: number; text: RegExp | null }>][] = [
    ['good', 'ok', { attempts: 1, text: /"action":"inspect"/ }],
    ['adversarial_unknown_field', 'ok', { text: /"secret"/ }],
    ['adversarial_spoiler', 'ok', { text: /choir_truth/ }],
    ['adversarial_foreign_fact', 'ok', { text: /sample_07_needs_cold/ }],
    ['adversarial_dup_keys', 'ok', { text: /^\{"action":"prepare_isolation","action":"inspect"/ }],
    ['refusal', 'refused', { attempts: 1, text: null }],
    ['garbage', 'invalid_output', { attempts: 1, text: /Думаю/ }],
    ['truncated', 'invalid_output', { attempts: 1 }],
    ['500', 'unavailable', { attempts: 2, text: null }],
    ['429', 'rate_limited', { attempts: 2, text: null }],
  ];
  for (const [behavior, status, expect] of cases) {
    it(`${behavior} → ${status}`, async () => {
      const { gw } = mockGateway();
      const s = await openSession(gw, 'offline');
      const r = await runIntent(gw, s, makeRequest(), { mock: behavior });
      assert.equal(r.status, status);
      if (expect.attempts !== undefined) assert.equal(r.attempts, expect.attempts);
      if (expect.text === null) assert.equal(r.proposal_text, null);
      else if (expect.text) assert.match(r.proposal_text ?? '', expect.text);
      if (status === 'ok') assert.equal(r.error, null);
      else assert.ok(r.error?.code);
      assert.equal(r.usage.measured, false, 'mock usage is an estimate, never presented as measured');
      gw.close();
    });
  }

  it('adversarial output is passed RAW: the gateway does not judge game validity', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest(), { mock: 'adversarial_unknown_field' });
    const parsed = JSON.parse(r.proposal_text as string);
    assert.equal(parsed.task_id, r.task_id, 'host-owned field echoed by the model is left for the core to reject');
  });

  it('truncated output never returns as ok and is labeled truncated', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest(), { mock: 'truncated' });
    assert.equal(r.error?.code, 'truncated');
    assert.equal(r.finish_reason, 'length');
  });
});

describe('deadline and retry', () => {
  it('strict overall deadline: a hanging provider returns timeout within the deadline', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const t0 = Date.now();
    const r = await runIntent(gw, s, makeRequest({ deadline_ms: 200 }), { mock: 'timeout' });
    const took = Date.now() - t0;
    assert.equal(r.status, 'timeout');
    assert.equal(r.proposal_text, null);
    assert.ok(took < 400, `took ${took} ms`);
    assert.ok(r.latency_ms.total <= 260, `latency ${r.latency_ms.total}`);
  });

  it('one meaningful retry recovers a transient failure', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest(), { mock: '500_once' });
    assert.equal(r.status, 'ok');
    assert.equal(r.attempts, 2);
    assert.equal(gw.adapters.mock.calls.get('mock'), 2);
  });

  it('no retry when the remaining time is below min_remaining_ms; retry_after_ms reaches the game', async () => {
    const { gw, sink } = mockGateway({ options: { retry_after_ms: 1000 } });
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest({ deadline_ms: 1000 }), { mock: '429' });
    assert.equal(r.status, 'rate_limited');
    assert.equal(r.attempts, 1);
    assert.equal(r.error?.retry_after_ms, 1000);
    assert.ok(sink.events().some((e) => e.event === 'retry_skipped'));
  });

  it('never more than one retry (max_attempts ≤ 2)', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest({ deadline_ms: 5000 }), { mock: '500' });
    assert.equal(r.attempts, 2);
    assert.equal(gw.adapters.mock.calls.get('mock'), 2);
  });
});

describe('idempotency by task_id', () => {
  it('re-delivery returns the cached result without a second upstream call', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const req = makeRequest();
    const a = await gw.handle(s, req, 'generate_intent', { receivedAt: gw.clock.now() });
    const b = await gw.handle(s, structuredClone(req), 'generate_intent', { receivedAt: gw.clock.now() });
    assert.deepEqual(b.body, a.body);
    assert.equal(b.headers?.['x-echo-replay'], 'true');
    assert.equal(gw.adapters.mock.calls.get('mock'), 1);
  });

  it('concurrent duplicates share one in-flight call', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const req = makeRequest();
    const [a, b] = await Promise.all([runIntent(gw, s, req, { mock: 'slow' }), runIntent(gw, s, req, { mock: 'slow' })]);
    assert.deepEqual(a, b);
    assert.equal(gw.adapters.mock.calls.get('mock'), 1);
  });

  it('same task_id with different content is a conflict (409)', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const req = makeRequest();
    await runIntent(gw, s, req);
    const r = await gw.handle(s, { ...req, world_revision: 58 }, 'generate_intent', { receivedAt: gw.clock.now() });
    assert.equal(r.httpStatus, 409);
    assert.equal((r.body as { error: { code: string } }).error.code, 'task_id_conflict');
  });

  it('task ids are scoped per session', async () => {
    const { gw } = mockGateway();
    const s1 = await openSession(gw, 'offline');
    const s2 = await openSession(gw, 'offline');
    const req = makeRequest();
    await runIntent(gw, s1, req);
    await runIntent(gw, s2, req);
    assert.equal(gw.adapters.mock.calls.get('mock'), 2);
  });
});

describe('cancel and late-response discard', () => {
  it('cancel during an upstream call → cancelled; the late answer is discarded but its usage is accounted', async () => {
    const { gw, sink } = mockGateway({ options: { slow_ms: 250, ignore_abort: true } });
    const s = await openSession(gw, 'offline');
    const req = makeRequest();
    const pending = runIntent(gw, s, req, { mock: 'slow' });
    await delay(40);
    const c = gw.cancel(s, { task_id: req.task_id });
    assert.deepEqual((c.body as { cancelled: boolean }).cancelled, true);
    const r = await pending;
    assert.equal(r.status, 'cancelled');
    assert.equal(r.proposal_text, null);
    assert.ok(r.latency_ms.total < 200, 'the game is answered immediately, not when the provider finishes');
    await delay(300);
    const late = sink.events().find((e) => e.event === 'late_response_discarded');
    assert.ok(late, 'late answer logged as discarded');
    assert.equal(late.late_status, 'ok');
    const usage = gw.usage(s) as { aborted_unmeasured: { count: number }; totals: { upstream_attempts: number; output_tokens: number } };
    assert.equal(usage.aborted_unmeasured.count, 0, 'estimate replaced by the late usage');
    assert.equal(usage.totals.upstream_attempts, 1);
    assert.ok(usage.totals.output_tokens > 0);
    // Re-delivery of a cancelled task stays cancelled, no new upstream call.
    const again = await runIntent(gw, s, req, { mock: 'slow' });
    assert.equal(again.status, 'cancelled');
    assert.equal(gw.adapters.mock.calls.get('mock'), 1);
  });

  it('cancel before the request arrives → cancelled without any upstream call', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const req = makeRequest();
    const c = gw.cancel(s, { task_id: req.task_id });
    assert.equal((c.body as { state: string }).state, 'pre_registered');
    const r = await runIntent(gw, s, req);
    assert.equal(r.status, 'cancelled');
    assert.equal(r.attempts, 0);
    assert.equal(gw.adapters.mock.calls.get('mock') ?? 0, 0);
  });

  it('cancel after completion is reported as not cancelled', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const req = makeRequest();
    await runIntent(gw, s, req);
    const c = gw.cancel(s, { task_id: req.task_id });
    assert.deepEqual({ cancelled: (c.body as { cancelled: boolean }).cancelled, state: (c.body as { state: string }).state }, { cancelled: false, state: 'done' });
  });

  it('an aborted call with unknown usage keeps a worst-case estimate against the budget', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest({ deadline_ms: 150 }), { mock: 'timeout' });
    assert.equal(r.status, 'timeout');
    assert.equal(r.usage.measured, false);
    const usage = gw.usage(s) as { aborted_unmeasured: { count: number; est_output_tokens: number } };
    assert.equal(usage.aborted_unmeasured.count, 1);
    assert.equal(usage.aborted_unmeasured.est_output_tokens, 160);
  });
});

describe('concurrency limits', () => {
  it('per-route limit with a full queue → rate_limited (gateway_queue_full), no upstream call', async () => {
    const { gw } = mockGateway({ concurrency: 1, max_queue: 0 });
    const s = await openSession(gw, 'offline');
    const first = runIntent(gw, s, makeRequest(), { mock: 'slow' });
    await delay(20);
    const second = await runIntent(gw, s, makeRequest(), { mock: 'slow' });
    assert.equal(second.status, 'rate_limited');
    assert.equal(second.error?.code, 'gateway_queue_full');
    assert.equal(second.attempts, 0);
    assert.equal((await first).status, 'ok');
    assert.equal(gw.adapters.mock.calls.get('mock'), 1);
  });

  it('queue time counts against the deadline → timeout (queue_deadline)', async () => {
    const { gw } = mockGateway({ concurrency: 1, max_queue: 2 });
    const s = await openSession(gw, 'offline');
    const first = runIntent(gw, s, makeRequest(), { mock: 'slow' });
    await delay(20);
    const second = await runIntent(gw, s, makeRequest({ deadline_ms: 200 }), { mock: 'slow' });
    assert.equal(second.status, 'timeout');
    assert.equal(second.error?.code, 'queue_deadline');
    assert.ok((second.latency_ms.queue ?? 0) >= 150, `queue ${second.latency_ms.queue}`);
    await first;
  });

  it('global limit applies across routes', async () => {
    const { gw } = makeGateway(
      rawConfig([mockRoute({ options: { latency_ms: 1, slow_ms: 300 } }), mockRoute({ id: 'mock2', options: { latency_ms: 1, slow_ms: 300 } })], {
        limits: { global_concurrency: 1, global_max_queue: 0, deadline_margin_ms: 10 },
      }),
    );
    const s = await openSession(gw, 'offline');
    const first = runIntent(gw, s, makeRequest(), { mock: 'slow' });
    await delay(20);
    const second = await runIntent(gw, s, makeRequest(), { route: 'mock2' });
    assert.equal(second.status, 'rate_limited');
    await first;
  });
});

describe('session quotas', () => {
  it('requests per minute → rate_limited with retry_after_ms', async () => {
    const { gw } = mockGateway({}, { default_quotas: { requests_per_min: 2, tokens_per_hour: 1e7, cost_cap_usd: 100 } });
    const s = await openSession(gw, 'offline');
    await runIntent(gw, s, makeRequest());
    await runIntent(gw, s, makeRequest());
    const r = await runIntent(gw, s, makeRequest());
    assert.equal(r.status, 'rate_limited');
    assert.equal(r.error?.code, 'session_requests_per_min');
    assert.ok((r.error?.retry_after_ms ?? 0) > 0);
    assert.equal(r.attempts, 0);
    assert.equal(gw.adapters.mock.calls.get('mock'), 2);
  });

  it('tokens per hour → budget_exceeded', async () => {
    const { gw } = mockGateway({}, { default_quotas: { requests_per_min: 100, tokens_per_hour: 1500, cost_cap_usd: 100 } });
    const s = await openSession(gw, 'offline');
    assert.equal((await runIntent(gw, s, makeRequest())).status, 'ok');
    const r = await runIntent(gw, s, makeRequest());
    assert.equal(r.status, 'budget_exceeded');
    assert.equal(r.error?.code, 'session_tokens_per_hour');
  });

  it('cost cap (fictional prices) → budget_exceeded before any upstream call', async () => {
    const { gw } = makeGateway(rawConfig([mockRoute({ options: { latency_ms: 1 } })], { default_quotas: { requests_per_min: 100, tokens_per_hour: 1e7, cost_cap_usd: 0.002 } }), {
      prices: makePrices(['mock'], 1, 5),
    });
    const s = await openSession(gw, 'offline');
    const first = await runIntent(gw, s, makeRequest());
    assert.equal(first.status, 'ok');
    assert.ok((first.cost_usd ?? 0) > 0);
    assert.equal(first.cost_is_fictional, true);
    const second = await runIntent(gw, s, makeRequest());
    assert.equal(second.status, 'budget_exceeded');
    assert.equal(second.error?.code, 'session_cost_cap');
    assert.equal(gw.adapters.mock.calls.get('mock'), 1);
  });

  it('a client may lower but never raise its quotas', async () => {
    const { gw } = mockGateway({}, { default_quotas: { requests_per_min: 10, tokens_per_hour: 1000, cost_cap_usd: 1 } });
    const s = await openSession(gw, 'offline', { quotas: { requests_per_min: 5, tokens_per_hour: 1e9 } });
    assert.deepEqual(s.quotas, { requests_per_min: 5, tokens_per_hour: 1000, cost_cap_usd: 1 });
  });
});

describe('circuit breaker (integration)', () => {
  it('opens after failures, short-circuits without upstream calls, recovers via a half-open probe', async () => {
    const { gw } = mockGateway({ breaker: { failure_threshold: 2, cooldown_ms: 150, max_cooldown_ms: 1000 } });
    const s = await openSession(gw, 'offline');
    const r1 = await runIntent(gw, s, makeRequest(), { mock: '500' });
    assert.equal(r1.attempts, 2);
    const health = gw.health() as { routes: { id: string; breaker: { state: string } }[] };
    assert.equal(health.routes.find((r) => r.id === 'mock')?.breaker.state, 'open');
    const r2 = await runIntent(gw, s, makeRequest(), { mock: 'good' });
    assert.equal(r2.status, 'unavailable');
    assert.equal(r2.error?.code, 'circuit_open');
    assert.equal(r2.attempts, 0);
    assert.equal(gw.adapters.mock.calls.get('mock'), 2);
    await delay(170);
    const r3 = await runIntent(gw, s, makeRequest(), { mock: 'good' });
    assert.equal(r3.status, 'ok');
    assert.equal((gw.health() as { routes: { id: string; breaker: { state: string } }[] }).routes.find((r) => r.id === 'mock')?.breaker.state, 'closed');
  });
});

describe('request validation and capabilities', () => {
  it('rejects a request that violates gateway_request.schema.json (400 with details)', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const bad = { ...makeRequest(), task_id: 'oops', extra: true };
    const r = await gw.handle(s, bad, 'generate_intent', { receivedAt: gw.clock.now() });
    assert.equal(r.httpStatus, 400);
    const details = (r.body as { error: { details: string[] } }).error.details;
    assert.ok(details.some((d) => d.includes('task_id')));
    assert.ok(details.some((d) => d.includes('extra')));
  });

  it('prompt_version mismatch is refused (reproducibility)', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const r = await gw.handle(s, makeRequest({ prompt_version: 'zero-echo.prompt.ru.v0' }), 'generate_intent', { receivedAt: gw.clock.now() });
    assert.equal(r.httpStatus, 409);
  });

  it('generate_dialogue returns a dialogue-shaped JSON line', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest({ capability: 'generate_dialogue' }));
    assert.equal(r.status, 'ok');
    const line = JSON.parse(r.proposal_text as string);
    assert.equal(typeof line.line, 'string');
    assert.ok(Array.isArray(line.fact_ids));
  });

  it('capability not offered by the route → unavailable (capability_unsupported)', async () => {
    const { gw } = mockGateway({ capabilities: ['generate_intent'] });
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest({ capability: 'generate_dialogue' }));
    assert.equal(r.status, 'unavailable');
    assert.equal(r.error?.code, 'capability_unsupported');
  });

  it('X-Echo-Mock is ignored when the route forbids header overrides', async () => {
    const { gw } = mockGateway({ options: { allow_header_override: false } });
    const s = await openSession(gw, 'offline');
    const r = await runIntent(gw, s, makeRequest(), { mock: 'refusal' });
    assert.equal(r.status, 'ok');
  });

  it('every result validates against gateway_result.schema.json (spot check of usage report)', async () => {
    const { gw } = mockGateway();
    const s = await openSession(gw, 'offline');
    assertValidResult(await runIntent(gw, s, makeRequest()));
    const usage = gw.usage(s) as { totals: { requests: number; estimated_attempts: number } };
    assert.equal(usage.totals.requests, 1);
    assert.equal(usage.totals.estimated_attempts, 1);
  });
});
