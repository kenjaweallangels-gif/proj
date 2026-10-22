// Config validation (pinned models, network rules), secrets file permissions and redaction, pricing and
// the cost formula of Документ §18 (including the CLI).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ConfigError, isFloatingModelAlias, loadConfig, parseConfig } from '../src/config.ts';
import { formatUsd, PriceBook, PricingError, pricePerHour, usageCostUsd } from '../src/pricing.ts';
import { envVarName, SecretsError, SecretStore } from '../src/secrets.ts';
import { DATA_DIR, mockRoute, rawConfig } from './helpers.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

function problemsOf(raw: Record<string, unknown>): string[] {
  try {
    parseConfig(raw, DATA_DIR);
    return [];
  } catch (e) {
    assert.ok(e instanceof ConfigError, String(e));
    return e.problems;
  }
}

describe('config', () => {
  it('data/providers.example.json loads: remote routes disabled, mock default, models pinned', () => {
    const cfg = loadConfig(join(DATA_DIR, 'providers.example.json'));
    assert.equal(cfg.default_route, 'mock');
    const ids = cfg.routes.map((r) => r.id);
    for (const id of ['mock', 'local_llamacpp', 'openai', 'anthropic', 'gemini', 'vllm_selfhost', 'custom_endpoint']) assert.ok(ids.includes(id), id);
    for (const r of cfg.routes.filter((x) => x.locality === 'remote')) assert.equal(r.enabled, false, `${r.id} must be disabled until the owner supplies keys`);
    const llama = cfg.routes.find((r) => r.id === 'local_llamacpp');
    assert.equal(llama?.endpoint, 'http://127.0.0.1:8080');
    assert.equal(llama?.locality, 'local');
    assert.equal(cfg.routes.find((r) => r.id === 'anthropic')?.model, 'claude-opus-5-5');
    assert.equal((cfg.routes.find((r) => r.id === 'anthropic')?.options as { server_side_refusal_fallback?: boolean }).server_side_refusal_fallback, false);
  });

  it('rejects "latest" and other floating model aliases with a clear error', () => {
    for (const m of ['latest', 'gpt-4o-latest', 'claude-3-5-sonnet-latest', 'gemini-flash-latest', 'qwen3:latest', 'default', 'auto']) {
      assert.equal(isFloatingModelAlias(m), true, m);
    }
    for (const m of ['claude-opus-5-5', 'gpt-5-mini-2025-08-07', 'Qwen3-1.7B-Q4_K_M.gguf', 'latestness-v1x']) {
      assert.equal(isFloatingModelAlias(m), false, m);
    }
    const problems = problemsOf(rawConfig([mockRoute({ model: 'mock-latest' })]));
    assert.ok(problems.some((p) => p.includes('плавающий алиас')), problems.join('\n'));
  });

  it('local routes must point at loopback; external APIs cannot be local', () => {
    const p1 = problemsOf(rawConfig([mockRoute(), { id: 'llama', adapter: 'llamacpp', enabled: true, locality: 'local', endpoint: 'http://10.0.0.5:8080', model: 'x.gguf' }]));
    assert.ok(p1.some((p) => p.includes('10.0.0.5')), p1.join('\n'));
    const p2 = problemsOf(rawConfig([mockRoute(), { id: 'oa', adapter: 'openai', enabled: true, locality: 'local', endpoint: 'http://127.0.0.1:1', model: 'm-2026' }]));
    assert.ok(p2.some((p) => p.includes('не может быть локальным')), p2.join('\n'));
  });

  it('remote routes need https to public hosts unless the owner opts in explicitly', () => {
    const p = problemsOf(rawConfig([mockRoute(), { id: 'oa', adapter: 'openai', enabled: true, endpoint: 'http://api.example.com', model: 'm-2026' }]));
    assert.ok(p.some((x) => x.includes('https')), p.join('\n'));
    const p2 = problemsOf(rawConfig([mockRoute(), { id: 'oa', adapter: 'openai', enabled: true, endpoint: 'https://192.168.1.10', model: 'm-2026' }]));
    assert.ok(p2.some((x) => x.includes('192.168.1.10')), p2.join('\n'));
  });

  it('a user-supplied endpoint route can never allow private networks or http', () => {
    const p = problemsOf(rawConfig([mockRoute(), { id: 'byo', adapter: 'openai_compat', enabled: true, user_supplied_endpoint: true, network: { allow_private_network: true } }]));
    assert.ok(p.some((x) => x.includes('только https')), p.join('\n'));
  });

  it('default route must be local (no hidden sending of conversations); fallback must exist', () => {
    const p = problemsOf(rawConfig([mockRoute({ fallback_route: 'ghost' }), { id: 'oa', adapter: 'openai', enabled: true, endpoint: 'https://api.example.com', model: 'm-2026' }], { default_route: 'oa' }));
    assert.ok(p.some((x) => x.includes('default_route')), p.join('\n'));
    assert.ok(p.some((x) => x.includes('ghost')), p.join('\n'));
  });

  it('adapter options are validated (unknown keys, wrong enums)', () => {
    const p = problemsOf(rawConfig([mockRoute({ options: { behavior: 'teleport', bogus: 1 } })]));
    assert.ok(p.some((x) => x.includes('behavior')));
    assert.ok(p.some((x) => x.includes('bogus')));
  });

  it('retry is capped at one meaningful retry (max_attempts ≤ 2)', () => {
    const p = problemsOf(rawConfig([mockRoute({ retry: { max_attempts: 5 } })]));
    assert.ok(p.some((x) => x.includes('max_attempts')));
  });
});

describe('secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-gw-secrets-'));

  it('keys come from ECHO_KEY_<ROUTE> environment variables', () => {
    assert.equal(envVarName('vllm_selfhost'), 'ECHO_KEY_VLLM_SELFHOST');
    const s = SecretStore.load({ routeIds: ['openai'], env: { ECHO_KEY_OPENAI: 'sk-env-123456789' } });
    assert.equal(s.get('openai'), 'sk-env-123456789');
    assert.equal(s.source('openai'), 'env');
  });

  it('refuses a secrets file readable by group/others (must be 0600)', () => {
    const f = join(dir, 'secrets-open.json');
    writeFileSync(f, JSON.stringify({ keys: { openai: 'sk-file-abcdefgh' } }));
    chmodSync(f, 0o644);
    assert.throws(() => SecretStore.load({ routeIds: ['openai'], env: {}, file: f }), (e: unknown) => e instanceof SecretsError && e.message.includes('chmod 600'));
    chmodSync(f, 0o600);
    const s = SecretStore.load({ routeIds: ['openai'], env: {}, file: f });
    assert.equal(s.get('openai'), 'sk-file-abcdefgh');
    assert.equal(s.source('openai'), 'file');
  });

  it('a malformed secrets file error never echoes its content', () => {
    const f = join(dir, 'secrets-bad.json');
    writeFileSync(f, '{"keys": {"openai": "sk-leaky-0123456789"');
    chmodSync(f, 0o600);
    assert.throws(
      () => SecretStore.load({ routeIds: ['openai'], env: {}, file: f }),
      (e: unknown) => e instanceof SecretsError && !e.message.includes('sk-leaky'),
    );
  });

  it('redacts known keys, generic key shapes and auth headers; never serializes', () => {
    const s = SecretStore.load({ routeIds: ['anthropic'], env: { ECHO_KEY_ANTHROPIC: 'opaque-key-value-42' } });
    const text = 'bad key opaque-key-value-42; Authorization: Bearer abcdefghijk; x-api-key: sk-ant-api03-xyzxyzxyz; AIzaSyA1234567890123456789012';
    const red = s.redact(text);
    assert.ok(!red.includes('opaque-key-value-42'));
    assert.ok(!red.includes('abcdefghijk'));
    assert.ok(!red.includes('sk-ant-api03'));
    assert.ok(!red.includes('AIzaSyA'));
    assert.equal(JSON.stringify({ s }), '{"s":"[SecretStore: redacted]"}');
  });
});

describe('pricing and cost (Документ §18)', () => {
  it('150 req/h × (1200 in, 180 out) at $1/$5 per 1M = $0.315/h; 2160 req/h = $4.536/h', () => {
    assert.equal(formatUsd(pricePerHour({ requestsPerHour: 150, inputTokens: 1200, outputTokens: 180, pIn: 1, pOut: 5 })), '0.315');
    assert.equal(formatUsd(pricePerHour({ requestsPerHour: 2160, inputTokens: 1200, outputTokens: 180, pIn: 1, pOut: 5 })), '4.536');
  });

  it('CLI prints 0.315 USD/h and 4.536 USD/h', () => {
    const run = (rph: string) => execFileSync(process.execPath, ['gateway/src/cli.ts', 'cost', '--rph', rph, '--in', '1200', '--out', '180', '--pin', '1', '--pout', '5'], { cwd: REPO, encoding: 'utf8' });
    assert.match(run('150'), /^0\.315 USD\/h$/m);
    assert.match(run('2160'), /^4\.536 USD\/h$/m);
  });

  it('CLI can take the (fictional) tariff from the pricing file', () => {
    const out = execFileSync(process.execPath, ['gateway/src/cli.ts', 'cost', '--rph', '150', '--in', '1200', '--out', '180', '--route', 'anthropic'], { cwd: REPO, encoding: 'utf8' });
    assert.match(out, /^0\.315 USD\/h$/m);
    assert.match(out, /ВЫМЫШЛЕННЫЙ/);
  });

  it('every price in data/pricing.example.json is marked fictional', () => {
    const book = PriceBook.load(join(DATA_DIR, 'pricing.example.json'));
    assert.ok(book.entries.length >= 7);
    assert.ok(book.entries.every((e) => e.fictional === true));
  });

  it('a real (non-fictional) price must carry verified_on and source', () => {
    assert.throws(
      () => PriceBook.parse({ format: 'zero-echo.pricing.v1', currency: 'USD', prices: [{ route: 'x', model: '*', input_per_mtok: 1, output_per_mtok: 2, fictional: false }] }, 't'),
      (e: unknown) => e instanceof PricingError && e.message.includes('verified_on'),
    );
  });

  it('usage cost uses cached and cache-write prices; reasoning is part of output', () => {
    const p = { route: 'r', model: '*', input_per_mtok: 1, output_per_mtok: 5, cached_input_per_mtok: 0.1, cache_write_per_mtok: 1.25, fictional: true, verified_on: null, source: null, note_ru: null };
    const cost = usageCostUsd({ input_tokens: 1200, cached_input_tokens: 1000, cache_write_input_tokens: 100, output_tokens: 180, reasoning_tokens: 100, measured: true }, p);
    // 100 plain × 1 + 1000 × 0.1 + 100 × 1.25 + 180 × 5 = 100 + 100 + 125 + 900 = 1225 µ$
    assert.equal(formatUsd(cost), '0.001225');
  });
});
