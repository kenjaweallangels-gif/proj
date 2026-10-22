// Test helpers: realistic GatewayRequest fixture, fake provider HTTP servers on loopback (ports 18700–18799),
// gateway factory with in-memory logs, and GatewayResult schema validation. No network beyond loopback.

import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../src/config.ts';
import { Gateway } from '../src/gateway.ts';
import type { GatewayDeps } from '../src/gateway.ts';
import { loadRepoSchema, validate } from '../src/jsonschema.ts';
import { MemorySink } from '../src/log.ts';
import type { Resolver } from '../src/net.ts';
import { PriceBook } from '../src/pricing.ts';
import type { Session } from '../src/sessions.ts';
import type { GatewayRequest, GatewayResult, PrivacyProfile } from '../src/types.ts';

export const DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));

// ------------------------------------------------------------ request fixture

let taskCounter = 0;
export function nextTaskId(): string {
  taskCounter++;
  return `req-${String(taskCounter).padStart(6, '0')}`;
}

/** Mira's initiative from Документ §9 (pressure alarm in niche A), shaped by schemas/gateway_request.schema.json. */
export function makeRequest(over: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    schema_version: 'zero-echo.intent.v1',
    task_id: nextTaskId(),
    actor_id: 'mira',
    kind: 'initiative',
    capability: 'generate_intent',
    world_revision: 57,
    locale: 'ru-RU',
    deadline_ms: 2500,
    max_input_tokens: 1800,
    max_output_tokens: 160,
    privacy_profile: 'online',
    persona: {
      name: 'Мира',
      role: 'инженер жизнеобеспечения',
      values: 'Безопасность экипажа важнее графика. Проверяет показания дважды.',
      style: 'Коротко, по делу, спокойно даже в тревоге.',
      boundaries: 'Не идёт в риск в одиночку и не отпускает других по одному после прошлого случая.',
    },
    situation: 'Датчик в нише A показывает падение давления, механический индикатор стабилен. Ника свободна, Томас в медблоке.',
    allowed_actions: [
      {
        id: 'inspect',
        label: 'осмотреть',
        description: 'Пойти и проверить датчик на месте.',
        targets: [
          { id: 'sensor_a', label: 'датчик давления в нише A' },
          { id: 'niche_a', label: 'ниша A' },
        ],
        target_required: true,
        companions: [
          { id: 'nika', label: 'Ника' },
          { id: 'thomas', label: 'Томас' },
        ],
        fact_ids_min: 0,
        fact_ids_max: 4,
      },
      { id: 'prepare_isolation', label: 'подготовить изоляцию', targets: [{ id: 'niche_a', label: 'ниша A' }], target_required: true, companions: [], fact_ids_min: 0, fact_ids_max: 4 },
      { id: 'refuse', label: 'отказаться', targets: [], companions: [], fact_ids_min: 0, fact_ids_max: 2 },
    ],
    visible_facts: [
      { id: 'pressure_disagreement', text: 'Датчик в нише A показывает падение давления, а механический индикатор стабилен.', source: 'observation:niche_a' },
      { id: 'yun_sent_alone', text: 'Алекс отправил Юна одного за контейнером.', source: 'event:hist_1' },
      { id: 'mira_objected_solo', text: 'Мира возражала против одиночной вылазки.', source: 'event:hist_1' },
    ],
    memory_excerpt: [
      { kind: 'fact', text: 'Алекс отправил Юна одного, хотя я возражала.', source: 'event:hist_1' },
      { kind: 'opinion', text: 'Алекс торопится с рискованными решениями.', source: 'event:hist_1', confidence: 0.6 },
    ],
    recent_events: ['Сработала тревога давления в нише A.'],
    player_utterance: null,
    styles: ['neutral', 'concerned', 'firm', 'warm', 'tense', 'dry', 'apologetic', 'curious'],
    gestures: ['none', 'nod', 'point_at_target', 'look_at_player', 'pause', 'wary', 'shrug', 'check_device'],
    prompt_version: 'zero-echo.prompt.ru.v1',
    ...over,
  };
}

/** A schema-valid intent built from the fixture, used by fake providers. */
export const GOOD_INTENT = { action: 'inspect', target_id: 'sensor_a', companion_id: 'nika', fact_ids: ['pressure_disagreement', 'yun_sent_alone'], style: 'concerned', gesture: 'point_at_target' };
export const GOOD_INTENT_TEXT = JSON.stringify(GOOD_INTENT);

// ------------------------------------------------------------ result validation

const resultSchema = loadRepoSchema('gateway_result');

export function assertValidResult(result: unknown): GatewayResult {
  const errors = validate(resultSchema, result);
  assert.deepEqual(errors, [], `GatewayResult violates schemas/gateway_result.schema.json: ${errors.join('; ')}`);
  return result as GatewayResult;
}

// ------------------------------------------------------------ fake provider servers

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: any;
}

export interface FakeReply {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delayMs?: number;
  /** Server-sent events: each string is sent as one `data:` event after intervalMs. */
  sse?: { events: string[]; intervalMs?: number; firstDelayMs?: number };
  /** Never answer (until the client disconnects). */
  hang?: boolean;
}

export type FakeHandler = (r: RecordedRequest, n: number) => FakeReply | Promise<FakeReply>;

export async function listenInRange(server: http.Server, from: number, to: number): Promise<number> {
  for (let port = from; port <= to; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const onError = () => resolve(false);
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError);
        resolve(true);
      });
    });
    if (ok) return port;
  }
  throw new Error(`no free port in ${from}-${to}`);
}

export class FakeServer {
  readonly requests: RecordedRequest[] = [];
  handler: FakeHandler;
  port = 0;
  /** Requests whose client disconnected before the reply was complete. */
  disconnects = 0;
  readonly #server: http.Server;

  private constructor(handler: FakeHandler) {
    this.handler = handler;
    this.#server = http.createServer((req, res) => void this.#handle(req, res));
  }

  static async start(range: [number, number], handler: FakeHandler): Promise<FakeServer> {
    const s = new FakeServer(handler);
    s.port = await listenInRange(s.#server, range[0], range[1]);
    return s;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async #handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    let json: unknown = undefined;
    try {
      json = body ? JSON.parse(body) : undefined;
    } catch {
      json = undefined;
    }
    const rec: RecordedRequest = { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers, body, json };
    this.requests.push(rec);
    let closed = false;
    res.on('close', () => {
      if (!res.writableFinished) {
        closed = true;
        this.disconnects++;
      }
    });
    const reply = await this.handler(rec, this.requests.length);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    if (reply.hang) return; // the client will time out / abort
    if (reply.delayMs) await wait(reply.delayMs);
    if (closed) return;
    if (reply.sse) {
      res.writeHead(reply.status ?? 200, { 'content-type': 'text/event-stream', ...(reply.headers ?? {}) });
      if (reply.sse.firstDelayMs) await wait(reply.sse.firstDelayMs);
      for (const ev of reply.sse.events) {
        if (closed) return;
        res.write(`data: ${ev}\n\n`);
        if (reply.sse.intervalMs) await wait(reply.sse.intervalMs);
      }
      res.end();
      return;
    }
    const payload = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {});
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...(reply.headers ?? {}) });
    res.end(payload);
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((r) => this.#server.close(() => r()));
  }
}

// ------------------------------------------------------------ gateway factory

export function mockRoute(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'mock',
    adapter: 'mock',
    enabled: true,
    locality: 'local',
    model: 'mock-intent-v1',
    capabilities: ['generate_intent', 'generate_dialogue'],
    options: { latency_ms: 1 },
    ...over,
  };
}

export function remoteRoute(id: string, adapter: string, port: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    adapter,
    enabled: true,
    locality: 'remote',
    endpoint: `http://127.0.0.1:${port}`,
    model: `${adapter}-test-model-2026-01-01`,
    capabilities: ['generate_intent', 'generate_dialogue'],
    // Fake providers run on loopback: an explicit owner opt-in, exactly what a real private self-host needs.
    network: { allow_private_network: true, allow_insecure_http: true },
    retry: { max_attempts: 2, base_backoff_ms: 20, max_backoff_ms: 50, min_remaining_ms: 200 },
    // Wire-format suites trigger many failures on purpose; breaker transitions have dedicated tests.
    breaker: { failure_threshold: 1000, cooldown_ms: 1000, max_cooldown_ms: 2000 },
    ...over,
  };
}

export function rawConfig(routes: Record<string, unknown>[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'zero-echo.providers.v1',
    server: { host: '127.0.0.1', port: 0, allowed_origins: ['http://127.0.0.1:18080'] },
    limits: { global_concurrency: 16, global_max_queue: 64, deadline_margin_ms: 10 },
    default_quotas: { requests_per_min: 1000, tokens_per_hour: 10_000_000, cost_cap_usd: 100 },
    privacy: { hybrid_remote_allowlist: [], online_remote_allowlist: 'all_enabled' },
    default_route: 'mock',
    routes,
    ...over,
  };
}

export function makePrices(routeIds: string[], pIn = 1, pOut = 5): PriceBook {
  return PriceBook.parse(
    {
      format: 'zero-echo.pricing.v1',
      currency: 'USD',
      prices: routeIds.map((route) => ({ route, model: '*', input_per_mtok: pIn, output_per_mtok: pOut, cached_input_per_mtok: pIn / 10, fictional: true })),
    },
    'test-prices',
  );
}

export interface TestGateway {
  gw: Gateway;
  sink: MemorySink;
}

export function makeGateway(raw: Record<string, unknown>, deps: Partial<GatewayDeps> & { resolver?: Resolver } = {}): TestGateway {
  const cfg = parseConfig(raw, DATA_DIR);
  const sink = new MemorySink();
  const gw = new Gateway(cfg, {
    env: {},
    logSink: sink,
    prices: makePrices(cfg.routes.map((r) => r.id)),
    rng: () => 0.5,
    ...deps,
  });
  return { gw, sink };
}

export async function openSession(gw: Gateway, profile: PrivacyProfile = 'online', extra: Record<string, unknown> = {}): Promise<Session> {
  const r = await gw.createSession({ privacy_profile: profile, client: 'eval', ...extra });
  assert.equal(r.httpStatus, 200, JSON.stringify(r.body));
  const token = (r.body as { session_token: string }).session_token;
  const s = gw.sessions.authenticate(`Bearer ${token}`);
  assert.ok(s);
  return s;
}

export async function runIntent(gw: Gateway, s: Session, req: GatewayRequest, opts: { route?: string; mock?: string } = {}): Promise<GatewayResult> {
  const r = await gw.handle(s, req, req.capability, { receivedAt: gw.clock.now(), routeHeader: opts.route, mockHeader: opts.mock });
  assert.equal(r.httpStatus, 200, JSON.stringify(r.body));
  return assertValidResult(r.body);
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Manual monotonic clock for deterministic breaker/quota tests. */
export class ManualClock {
  t = 1000;
  wall = Date.UTC(2026, 9, 22, 12, 0, 0);
  now = (): number => this.t;
  wallNow = (): number => this.wall;
  sleep = async (ms: number): Promise<void> => {
    this.advance(ms);
  };
  advance(ms: number): void {
    this.t += ms;
    this.wall += ms;
  }
}
