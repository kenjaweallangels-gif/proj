// Network policy primitives (Документ §17): strict overall deadline, at most one meaningful retry with
// jitter/backoff honoring Retry-After, per-route circuit breaker, concurrency limits with bounded queues,
// and the task registry that gives idempotency by task_id plus cancellation with late-response discard.

import { performance } from 'node:perf_hooks';
import { setTimeout as sleepTimer } from 'node:timers/promises';
import type { BreakerConfig, GatewayResult, RetryConfig } from './types.ts';

// ---------------------------------------------------------------- time

export interface Clock {
  /** Monotonic milliseconds (deadlines, latency). */
  now(): number;
  /** Wall-clock epoch milliseconds (session expiry, Retry-After HTTP dates). */
  wallNow(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  wallNow: () => Date.now(),
  sleep: async (ms, signal) => {
    if (ms <= 0) return;
    await sleepTimer(ms, undefined, { signal });
  },
};

/** Overall deadline of one GatewayRequest, counted from receipt (queue time included). */
export class Deadline {
  readonly startedAt: number;
  readonly expiresAt: number;
  readonly #clock: Clock;

  constructor(clock: Clock, startedAt: number, budgetMs: number) {
    this.#clock = clock;
    this.startedAt = startedAt;
    this.expiresAt = startedAt + budgetMs;
  }

  remaining(): number {
    return Math.max(0, this.expiresAt - this.#clock.now());
  }

  elapsed(): number {
    return this.#clock.now() - this.startedAt;
  }

  expired(): boolean {
    return this.remaining() <= 0;
  }
}

// ---------------------------------------------------------------- retry

/** Parses Retry-After (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfterMs(value: string | null | undefined, wallNowMs: number): number | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const date = Date.parse(v);
  if (Number.isFinite(date)) return Math.max(0, date - wallNowMs);
  return null;
}

/** Parses protobuf-style durations used by Gemini RetryInfo ("12s", "0.5s", "1500ms"). */
export function parseDurationMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(value.trim());
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] === 's' ? 1000 : 1));
}

/**
 * Delay before retry number `attempt` (1 = first retry). Retry-After is honored as a minimum with a small
 * jitter; otherwise "full jitter" exponential backoff.
 */
export function backoffDelayMs(attempt: number, cfg: RetryConfig, rng: () => number, retryAfterMs?: number | null): number {
  if (retryAfterMs !== null && retryAfterMs !== undefined) {
    return Math.round(retryAfterMs + rng() * Math.min(100, cfg.base_backoff_ms));
  }
  const ceiling = Math.min(cfg.max_backoff_ms, cfg.base_backoff_ms * 2 ** Math.max(0, attempt - 1));
  return Math.round(rng() * ceiling);
}

// ---------------------------------------------------------------- circuit breaker

export type BreakerState = 'closed' | 'open' | 'half_open';

export type BreakerTicket = { allowed: true; probe: boolean } | { allowed: false; state: BreakerState; retryInMs: number };

export interface BreakerSnapshot {
  state: BreakerState;
  consecutive_failures: number;
  cooldown_ms: number;
  cooldown_remaining_ms: number;
  times_opened: number;
}

/**
 * closed → (failure_threshold consecutive failures) → open → (cooldown) → half_open: one probe request.
 * Probe success → closed; probe failure → open with doubled cooldown (≤ max_cooldown_ms).
 */
export class CircuitBreaker {
  readonly #cfg: BreakerConfig;
  readonly #clock: Clock;
  #state: BreakerState = 'closed';
  #failures = 0;
  #openedAt = 0;
  #cooldown: number;
  #probeInFlight = false;
  #timesOpened = 0;

  constructor(cfg: BreakerConfig, clock: Clock) {
    this.#cfg = cfg;
    this.#clock = clock;
    this.#cooldown = cfg.cooldown_ms;
  }

  get state(): BreakerState {
    return this.#state;
  }

  tryAcquire(): BreakerTicket {
    if (this.#state === 'closed') return { allowed: true, probe: false };
    if (this.#state === 'open') {
      const left = this.#openedAt + this.#cooldown - this.#clock.now();
      if (left > 0) return { allowed: false, state: 'open', retryInMs: Math.ceil(left) };
      this.#state = 'half_open';
      this.#probeInFlight = false;
    }
    // half_open: exactly one probe at a time
    if (this.#probeInFlight) return { allowed: false, state: 'half_open', retryInMs: 0 };
    this.#probeInFlight = true;
    return { allowed: true, probe: true };
  }

  onSuccess(probe: boolean): void {
    if (probe || this.#state === 'half_open') {
      this.#state = 'closed';
      this.#probeInFlight = false;
      this.#cooldown = this.#cfg.cooldown_ms;
    }
    if (this.#state === 'closed') this.#failures = 0;
  }

  onFailure(probe: boolean): void {
    if (probe || this.#state === 'half_open') {
      this.#probeInFlight = false;
      this.#cooldown = Math.min(this.#cfg.max_cooldown_ms, this.#cooldown * 2);
      this.#open();
      return;
    }
    if (this.#state !== 'closed') return; // a late failure of a request started before opening
    this.#failures++;
    if (this.#failures >= this.#cfg.failure_threshold) this.#open();
  }

  /** Outcome that says nothing about provider health (cancelled by the game). */
  onNeutral(probe: boolean): void {
    if (probe) this.#probeInFlight = false;
  }

  #open(): void {
    this.#state = 'open';
    this.#openedAt = this.#clock.now();
    this.#timesOpened++;
  }

  snapshot(): BreakerSnapshot {
    const left = this.#state === 'open' ? Math.max(0, Math.ceil(this.#openedAt + this.#cooldown - this.#clock.now())) : 0;
    return { state: this.#state, consecutive_failures: this.#failures, cooldown_ms: this.#cooldown, cooldown_remaining_ms: left, times_opened: this.#timesOpened };
  }
}

// ---------------------------------------------------------------- concurrency

export class LimitError extends Error {
  readonly code: 'queue_full' | 'queue_timeout' | 'aborted';
  constructor(code: 'queue_full' | 'queue_timeout' | 'aborted', message: string) {
    super(message);
    this.name = 'LimitError';
    this.code = code;
  }
}

interface Waiter {
  grant: () => void;
  fail: (e: LimitError) => void;
}

/** Counting semaphore with a bounded FIFO queue. */
export class Semaphore {
  readonly limit: number;
  readonly maxQueue: number;
  #active = 0;
  readonly #queue: Waiter[] = [];

  constructor(limit: number, maxQueue: number) {
    this.limit = limit;
    this.maxQueue = maxQueue;
  }

  get active(): number {
    return this.#active;
  }

  get queued(): number {
    return this.#queue.length;
  }

  /** Resolves with a release function; rejects with LimitError on full queue, timeout or abort. */
  acquire(signal: AbortSignal | undefined, timeoutMs: number): Promise<() => void> {
    const makeRelease = () => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        this.#active--;
        this.#dispatch();
      };
    };
    if (signal?.aborted) return Promise.reject(new LimitError('aborted', 'отменено до начала'));
    if (this.#active < this.limit && this.#queue.length === 0) {
      this.#active++;
      return Promise.resolve(makeRelease());
    }
    if (this.#queue.length >= this.maxQueue) {
      return Promise.reject(new LimitError('queue_full', `очередь заполнена (${this.maxQueue})`));
    }
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const i = this.#queue.indexOf(waiter);
        if (i >= 0) this.#queue.splice(i, 1);
      };
      const waiter: Waiter = {
        grant: () => {
          cleanup();
          this.#active++;
          resolve(makeRelease());
        },
        fail: (e) => {
          cleanup();
          reject(e);
        },
      };
      const onAbort = () => waiter.fail(new LimitError('aborted', 'отменено в очереди'));
      timer = setTimeout(() => waiter.fail(new LimitError('queue_timeout', 'срок истёк в очереди')), Math.max(0, timeoutMs));
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#queue.push(waiter);
    });
  }

  #dispatch(): void {
    while (this.#active < this.limit && this.#queue.length) {
      const next = this.#queue[0];
      next.grant();
    }
  }
}

// ---------------------------------------------------------------- idempotency + cancellation

export type TaskState = 'running' | 'done' | 'cancelled';

export interface TaskEntry {
  key: string;
  /** Hash of the request body; null for a cancellation registered before the request arrived. */
  bodyHash: string | null;
  state: TaskState;
  promise: Promise<GatewayResult> | null;
  result: GatewayResult | null;
  /** Aborted by /v1/cancel; the running attempt listens to it. */
  controller: AbortController;
  updatedAt: number;
}

export type CancelOutcome = { cancelled: boolean; state: 'running' | 'done' | 'cancelled' | 'pre_registered' };

/**
 * Remembers every task_id per session: a re-delivered task returns the cached (or in-flight) result
 * without a second upstream call; a cancelled task stays cancelled and its late answer is discarded.
 */
export class TaskRegistry {
  readonly #entries = new Map<string, TaskEntry>();
  readonly #clock: Clock;
  readonly #ttlMs: number;
  readonly #max: number;

  constructor(clock: Clock, ttlMs: number, maxEntries: number) {
    this.#clock = clock;
    this.#ttlMs = ttlMs;
    this.#max = maxEntries;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: string): TaskEntry | undefined {
    const e = this.#entries.get(key);
    if (e && e.state !== 'running' && this.#clock.now() - e.updatedAt > this.#ttlMs) {
      this.#entries.delete(key);
      return undefined;
    }
    return e;
  }

  start(key: string, bodyHash: string): TaskEntry {
    this.#evict();
    const entry: TaskEntry = { key, bodyHash, state: 'running', promise: null, result: null, controller: new AbortController(), updatedAt: this.#clock.now() };
    this.#entries.set(key, entry);
    return entry;
  }

  complete(key: string, result: GatewayResult): void {
    const e = this.#entries.get(key);
    if (!e) return;
    e.result = result;
    if (e.state === 'running') e.state = result.status === 'cancelled' ? 'cancelled' : 'done';
    e.updatedAt = this.#clock.now();
  }

  cancel(key: string): CancelOutcome {
    const e = this.get(key);
    if (!e) {
      this.#evict();
      const tomb: TaskEntry = { key, bodyHash: null, state: 'cancelled', promise: null, result: null, controller: new AbortController(), updatedAt: this.#clock.now() };
      tomb.controller.abort('cancelled');
      this.#entries.set(key, tomb);
      return { cancelled: true, state: 'pre_registered' };
    }
    if (e.state === 'done') return { cancelled: false, state: 'done' };
    if (e.state === 'cancelled') return { cancelled: true, state: 'cancelled' };
    e.state = 'cancelled';
    e.updatedAt = this.#clock.now();
    e.controller.abort('cancelled');
    return { cancelled: true, state: 'running' };
  }

  #evict(): void {
    const now = this.#clock.now();
    for (const [k, e] of this.#entries) {
      if (e.state !== 'running' && now - e.updatedAt > this.#ttlMs) this.#entries.delete(k);
    }
    if (this.#entries.size < this.#max) return;
    for (const [k, e] of this.#entries) {
      if (this.#entries.size < this.#max) break;
      if (e.state !== 'running') this.#entries.delete(k);
    }
  }
}
