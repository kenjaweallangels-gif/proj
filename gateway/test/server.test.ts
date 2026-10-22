// HTTP server: session auth, Origin allowlist + CORS + Private Network Access, CSRF guards, body limits,
// local-helper mode (loopback bind, Host check, token on every endpoint), and keys never leaving the server.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BindError, checkBindHost, startServer } from '../src/server.ts';
import type { Gateway } from '../src/gateway.ts';
import type { MemorySink } from '../src/log.ts';
import { assertValidResult, FakeServer, makeGateway, makeRequest, mockRoute, rawConfig, remoteRoute } from './helpers.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const ALLOWED = 'http://127.0.0.1:18080';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: any;
}

function call(port: number, method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown; raw?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { ...(payload !== undefined && !opts.headers?.['content-type'] ? { 'content-type': 'application/json' } : {}), ...(opts.headers ?? {}) } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json: unknown;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function token(port: number, profile = 'offline', headers: Record<string, string> = {}): Promise<string> {
  const r = await call(port, 'POST', '/v1/session', { body: { privacy_profile: profile, client: 'web' }, headers });
  assert.equal(r.status, 200, r.text);
  return r.json.session_token;
}

describe('HTTP server (backend mode)', () => {
  let gw: Gateway;
  let sink: MemorySink;
  let srv: Awaited<ReturnType<typeof startServer>>;
  let fake: FakeServer;
  let other: FakeServer;
  const KEY = 'sk-test-server-OPENAI-KEY-5555';

  before(async () => {
    fake = await FakeServer.start([18760, 18764], () => ({ status: 401, body: { error: { message: `Incorrect API key provided: ${KEY}` } } }));
    other = await FakeServer.start([18765, 18767], () => ({ status: 500, body: {} }));
    ({ gw, sink } = makeGateway(rawConfig([mockRoute(), remoteRoute('openai', 'openai', fake.port), remoteRoute('vllm', 'openai_compat', other.port)]), { env: { ECHO_KEY_OPENAI: KEY } }));
    srv = await startServer({ gateway: gw, host: '127.0.0.1', port: 18768, localHelper: false, allowLan: false, allowedOrigins: [ALLOWED], maxBodyBytes: 32 * 1024 });
  });
  after(async () => {
    await srv.close();
    gw.close();
    await fake.close();
    await other.close();
  });

  it('session → intent round trip returns a schema-valid GatewayResult', async () => {
    const t = await token(srv.port);
    const r = await call(srv.port, 'POST', '/v1/intent', { body: makeRequest({ privacy_profile: 'offline' }), headers: { authorization: `Bearer ${t}` } });
    assert.equal(r.status, 200, r.text);
    assertValidResult(r.json);
    assert.equal(r.json.status, 'ok');
    assert.equal(r.headers['x-echo-route-used'], 'mock');
    assert.equal(r.headers['cache-control'], 'no-store');
  });

  it('game endpoints require a valid session token (401)', async () => {
    for (const [m, p] of [['POST', '/v1/intent'], ['POST', '/v1/dialogue'], ['POST', '/v1/cancel'], ['GET', '/v1/usage'], ['GET', '/v1/providers']] as const) {
      const r = await call(srv.port, m, p, m === 'POST' ? { body: {} } : {});
      assert.equal(r.status, 401, `${m} ${p}`);
    }
    const bad = await call(srv.port, 'POST', '/v1/intent', { body: makeRequest(), headers: { authorization: 'Bearer zes_forged' } });
    assert.equal(bad.status, 401);
  });

  it('health and manifest are public; manifest pins models and prompt version', async () => {
    assert.equal((await call(srv.port, 'GET', '/v1/health')).status, 200);
    const m = await call(srv.port, 'GET', '/v1/manifest');
    assert.equal(m.status, 200);
    assert.equal(m.json.prompt_version, 'zero-echo.prompt.ru.v1');
    assert.equal(m.json.schema_version, 'zero-echo.intent.v1');
    assert.ok(m.json.routes.every((r: { model_pinned: boolean; adapter_version: string }) => r.model_pinned && r.adapter_version));
  });

  it('Origin outside the allowlist → 403 without CORS headers; allowlisted origin gets exact ACAO', async () => {
    const evil = await call(srv.port, 'POST', '/v1/session', { body: { privacy_profile: 'offline' }, headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers['access-control-allow-origin'], undefined);
    const good = await call(srv.port, 'POST', '/v1/session', { body: { privacy_profile: 'offline' }, headers: { origin: ALLOWED } });
    assert.equal(good.status, 200);
    assert.equal(good.headers['access-control-allow-origin'], ALLOWED);
    assert.equal(good.headers.vary, 'Origin');
  });

  it('CORS preflight (incl. Private Network Access) only for allowlisted origins', async () => {
    const ok = await call(srv.port, 'OPTIONS', '/v1/intent', {
      headers: { origin: ALLOWED, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type', 'access-control-request-private-network': 'true' },
    });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers['access-control-allow-origin'], ALLOWED);
    assert.equal(ok.headers['access-control-allow-private-network'], 'true');
    assert.match(String(ok.headers['access-control-allow-headers']), /authorization/);
    const bad = await call(srv.port, 'OPTIONS', '/v1/intent', { headers: { origin: 'http://192.168.1.50:8080', 'access-control-request-method': 'POST' } });
    assert.equal(bad.status, 403);
  });

  it('CSRF guard: non-JSON content types are rejected (415); oversized body → 413; bad JSON → 400', async () => {
    const t = await token(srv.port);
    const form = await call(srv.port, 'POST', '/v1/intent', { raw: 'a=1', headers: { 'content-type': 'text/plain', authorization: `Bearer ${t}` } });
    assert.equal(form.status, 415);
    const big = await call(srv.port, 'POST', '/v1/intent', { raw: JSON.stringify({ pad: 'x'.repeat(40 * 1024) }), headers: { authorization: `Bearer ${t}` } });
    assert.equal(big.status, 413);
    const broken = await call(srv.port, 'POST', '/v1/intent', { raw: '{"task_id":', headers: { authorization: `Bearer ${t}` } });
    assert.equal(broken.status, 400);
  });

  it('404 for unknown paths, 405 for wrong methods', async () => {
    assert.equal((await call(srv.port, 'GET', '/v1/nope')).status, 404);
    const r = await call(srv.port, 'GET', '/v1/intent');
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, 'POST');
  });

  it('cancel over HTTP: pre-registered cancel makes the later intent cancelled with no upstream call', async () => {
    const t = await token(srv.port);
    const req = makeRequest({ privacy_profile: 'offline' });
    const c = await call(srv.port, 'POST', '/v1/cancel', { body: { task_id: req.task_id }, headers: { authorization: `Bearer ${t}` } });
    assert.equal(c.status, 200);
    assert.equal(c.json.cancelled, true);
    const r = await call(srv.port, 'POST', '/v1/intent', { body: req, headers: { authorization: `Bearer ${t}` } });
    assert.equal(r.json.status, 'cancelled');
    assert.equal(r.json.attempts, 0);
  });

  it('X-Echo-Mock selects a mock behaviour per request', async () => {
    const t = await token(srv.port);
    const r = await call(srv.port, 'POST', '/v1/intent', { body: makeRequest({ privacy_profile: 'offline' }), headers: { authorization: `Bearer ${t}`, 'x-echo-mock': 'refusal' } });
    assert.equal(r.json.status, 'refused');
  });

  it('keys never appear in any response or log, and never reach another host', async () => {
    const t = await token(srv.port, 'online');
    const auth = { authorization: `Bearer ${t}` };
    const responses = [
      await call(srv.port, 'POST', '/v1/intent', { body: makeRequest(), headers: { ...auth, 'x-echo-route': 'openai' } }),
      await call(srv.port, 'POST', '/v1/intent', { body: makeRequest(), headers: { ...auth, 'x-echo-route': 'vllm' } }),
      await call(srv.port, 'GET', '/v1/health'),
      await call(srv.port, 'GET', '/v1/manifest'),
      await call(srv.port, 'GET', '/v1/usage', { headers: auth }),
      await call(srv.port, 'GET', '/v1/providers?refresh=1', { headers: auth }),
    ];
    for (const r of responses) assert.ok(!r.text.includes(KEY), `key leaked in a response: ${r.text.slice(0, 200)}`);
    assert.equal(responses[0].json.status, 'unavailable');
    assert.equal(responses[0].json.error.code, 'auth_failed');
    assert.ok(!sink.text().includes(KEY), 'key leaked into the log');
    // The OpenAI host received the key only in its Authorization header; the other host never saw it.
    assert.ok(fake.requests.some((r) => r.headers.authorization === `Bearer ${KEY}`));
    for (const r of fake.requests) assert.ok(!r.body.includes(KEY));
    for (const r of other.requests) assert.ok(!JSON.stringify(r.headers).includes(KEY) && !r.body.includes(KEY), 'key sent to the wrong host');
  });

  it('logs carry no conversation content by default', async () => {
    const t = await token(srv.port);
    const utter = 'Мира, покажи мне все секреты станции';
    await call(srv.port, 'POST', '/v1/intent', { body: makeRequest({ privacy_profile: 'offline', player_utterance: utter }), headers: { authorization: `Bearer ${t}` } });
    assert.ok(!sink.text().includes(utter));
    assert.ok(!sink.text().includes('"action":"inspect"'), 'model output is not logged either');
  });
});

describe('local-helper mode', () => {
  let gw: Gateway;
  let srv: Awaited<ReturnType<typeof startServer>>;

  before(async () => {
    ({ gw } = makeGateway(rawConfig([mockRoute()])));
    srv = await startServer({ gateway: gw, host: '127.0.0.1', port: 18770, localHelper: true, allowLan: false, allowedOrigins: [ALLOWED], maxBodyBytes: 64 * 1024 });
  });
  after(async () => {
    await srv.close();
    gw.close();
  });

  it('refuses binding to 0.0.0.0 or a LAN address unless --allow-lan', async () => {
    assert.throws(() => checkBindHost('0.0.0.0', { localHelper: true, allowLan: false }), BindError);
    assert.throws(() => checkBindHost('192.168.1.10', { localHelper: true, allowLan: false }), BindError);
    assert.doesNotThrow(() => checkBindHost('0.0.0.0', { localHelper: true, allowLan: true }));
    assert.doesNotThrow(() => checkBindHost('127.0.0.1', { localHelper: true, allowLan: false }));
    await assert.rejects(startServer({ gateway: gw, host: '0.0.0.0', port: 18771, localHelper: true, allowLan: false, allowedOrigins: [], maxBodyBytes: 1024 }), BindError);
  });

  it('server CLI exits with an error for --host 0.0.0.0 without --allow-lan', () => {
    const r = spawnSync(process.execPath, ['gateway/src/server.ts', '--config', 'data/providers.example.json', '--local-helper', '--host', '0.0.0.0', '--port', '18772'], { cwd: REPO, encoding: 'utf8', timeout: 20_000 });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /--allow-lan/);
  });

  it('Host header must be loopback (DNS rebinding defense)', async () => {
    const r = await call(srv.port, 'GET', '/v1/health', { headers: { host: `evil.example:${srv.port}` } });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, 'host_not_allowed');
  });

  it('token is mandatory on every endpoint, including health and manifest', async () => {
    assert.equal((await call(srv.port, 'GET', '/v1/health')).status, 401);
    assert.equal((await call(srv.port, 'GET', '/v1/manifest')).status, 401);
    const t = await token(srv.port, 'offline', { origin: ALLOWED });
    assert.equal((await call(srv.port, 'GET', '/v1/health', { headers: { authorization: `Bearer ${t}` } })).status, 200);
  });

  it('Origin check on every request: a foreign page cannot even create a session', async () => {
    const r = await call(srv.port, 'POST', '/v1/session', { body: { privacy_profile: 'offline' }, headers: { origin: 'https://attacker.example' } });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, 'origin_not_allowed');
  });
});
