// Policy primitives: circuit breaker state machine, backoff/Retry-After, concurrency limits, task registry.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backoffDelayMs, CircuitBreaker, Deadline, LimitError, parseDurationMs, parseRetryAfterMs, Semaphore, TaskRegistry } from '../src/policy.ts';
import type { GatewayResult } from '../src/types.ts';
import { ManualClock } from './helpers.ts';

describe('circuit breaker', () => {
  const cfg = { failure_threshold: 3, cooldown_ms: 1000, max_cooldown_ms: 3000 };

  it('closed → open after N consecutive failures; success resets the count', () => {
    const clock = new ManualClock();
    const b = new CircuitBreaker(cfg, clock);
    b.onFailure(false);
    b.onFailure(false);
    b.onSuccess(false);
    assert.equal(b.snapshot().consecutive_failures, 0);
    for (let i = 0; i < 3; i++) {
      assert.equal(b.tryAcquire().allowed, true);
      b.onFailure(false);
    }
    assert.equal(b.state, 'open');
    const t = b.tryAcquire();
    assert.equal(t.allowed, false);
    if (!t.allowed) assert.ok(t.retryInMs > 0 && t.retryInMs <= 1000);
  });

  it('open → half-open after cooldown: exactly one probe; probe success → closed', () => {
    const clock = new ManualClock();
    const b = new CircuitBreaker(cfg, clock);
    for (let i = 0; i < 3; i++) b.onFailure(false);
    clock.advance(999);
    assert.equal(b.tryAcquire().allowed, false);
    clock.advance(1);
    const probe = b.tryAcquire();
    assert.deepEqual(probe, { allowed: true, probe: true });
    assert.equal(b.state, 'half_open');
    assert.equal(b.tryAcquire().allowed, false, 'second request while the probe is in flight is rejected');
    b.onSuccess(true);
    assert.equal(b.state, 'closed');
    assert.deepEqual(b.tryAcquire(), { allowed: true, probe: false });
  });

  it('probe failure → open again with doubled cooldown (capped)', () => {
    const clock = new ManualClock();
    const b = new CircuitBreaker(cfg, clock);
    for (let i = 0; i < 3; i++) b.onFailure(false);
    clock.advance(1000);
    b.tryAcquire();
    b.onFailure(true);
    assert.equal(b.state, 'open');
    assert.equal(b.snapshot().cooldown_ms, 2000);
    clock.advance(2000);
    b.tryAcquire();
    b.onFailure(true);
    assert.equal(b.snapshot().cooldown_ms, 3000, 'capped at max_cooldown_ms');
    assert.equal(b.snapshot().times_opened, 3);
  });

  it('a cancelled probe is neutral and frees the half-open slot', () => {
    const clock = new ManualClock();
    const b = new CircuitBreaker(cfg, clock);
    for (let i = 0; i < 3; i++) b.onFailure(false);
    clock.advance(1000);
    assert.equal(b.tryAcquire().allowed, true);
    b.onNeutral(true);
    assert.equal(b.state, 'half_open');
    assert.equal(b.tryAcquire().allowed, true);
  });
});

describe('backoff and Retry-After', () => {
  const retry = { max_attempts: 2 as const, base_backoff_ms: 200, max_backoff_ms: 1000, min_remaining_ms: 300, attempt_timeout_ms: null };
  it('full jitter within the exponential ceiling', () => {
    assert.equal(backoffDelayMs(1, retry, () => 0.5), 100);
    assert.equal(backoffDelayMs(3, retry, () => 0.999), 799);
    assert.equal(backoffDelayMs(10, retry, () => 1), 1000);
  });
  it('Retry-After is honored as a minimum (plus small jitter)', () => {
    const d = backoffDelayMs(1, retry, () => 0.5, 1500);
    assert.ok(d >= 1500 && d <= 1600);
  });
  it('parses delta-seconds, HTTP dates and protobuf durations', () => {
    const now = Date.UTC(2026, 9, 22, 12, 0, 0);
    assert.equal(parseRetryAfterMs('2', now), 2000);
    assert.equal(parseRetryAfterMs('0.5', now), 500);
    assert.equal(parseRetryAfterMs(new Date(now + 3000).toUTCString(), now), 3000);
    assert.equal(parseRetryAfterMs('soon', now), null);
    assert.equal(parseDurationMs('12s'), 12000);
    assert.equal(parseDurationMs('0.25s'), 250);
    assert.equal(parseDurationMs('1500ms'), 1500);
  });
  it('deadline counts from receipt, including queue time', () => {
    const clock = new ManualClock();
    const start = clock.now();
    clock.advance(400);
    const d = new Deadline(clock, start, 1000);
    assert.equal(d.remaining(), 600);
    clock.advance(700);
    assert.equal(d.expired(), true);
  });
});

describe('concurrency limits', () => {
  it('grants up to the limit, queues FIFO, rejects when the queue is full', async () => {
    const s = new Semaphore(1, 1);
    const r1 = await s.acquire(undefined, 1000);
    const p2 = s.acquire(undefined, 1000);
    await assert.rejects(s.acquire(undefined, 1000), (e: unknown) => e instanceof LimitError && e.code === 'queue_full');
    assert.equal(s.queued, 1);
    r1();
    const r2 = await p2;
    assert.equal(s.active, 1);
    r2();
    r2(); // idempotent release
    assert.equal(s.active, 0);
  });
  it('queue wait is bounded by the deadline and abortable', async () => {
    const s = new Semaphore(1, 4);
    const r1 = await s.acquire(undefined, 1000);
    await assert.rejects(s.acquire(undefined, 20), (e: unknown) => e instanceof LimitError && e.code === 'queue_timeout');
    const ctl = new AbortController();
    const p = s.acquire(ctl.signal, 1000);
    ctl.abort();
    await assert.rejects(p, (e: unknown) => e instanceof LimitError && e.code === 'aborted');
    assert.equal(s.queued, 0);
    r1();
  });
});

describe('task registry (idempotency + cancel)', () => {
  const result = (status: GatewayResult['status']): GatewayResult => ({
    task_id: 'req-000001',
    status,
    proposal_text: null,
    usage: { input_tokens: 0, output_tokens: 0, measured: true },
    latency_ms: { total: 1 },
    provider: 'mock',
    model: 'm',
    finish_reason: 'stop',
    attempts: 1,
  });
  it('cancel before arrival registers a tombstone; cancel after completion is refused', () => {
    const clock = new ManualClock();
    const reg = new TaskRegistry(clock, 60_000, 100);
    assert.deepEqual(reg.cancel('s:req-000001'), { cancelled: true, state: 'pre_registered' });
    assert.equal(reg.get('s:req-000001')?.state, 'cancelled');
    reg.start('s:req-000002', 'h');
    reg.complete('s:req-000002', result('ok'));
    assert.deepEqual(reg.cancel('s:req-000002'), { cancelled: false, state: 'done' });
  });
  it('cancelling a running task aborts its controller; entries expire after the TTL', () => {
    const clock = new ManualClock();
    const reg = new TaskRegistry(clock, 1000, 100);
    const e = reg.start('s:req-000003', 'h');
    assert.deepEqual(reg.cancel('s:req-000003'), { cancelled: true, state: 'running' });
    assert.equal(e.controller.signal.aborted, true);
    reg.complete('s:req-000003', result('cancelled'));
    clock.advance(1001);
    assert.equal(reg.get('s:req-000003'), undefined);
  });
});
