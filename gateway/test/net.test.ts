// SSRF defenses: address classification, endpoint rules, DNS validation + pinning, origin lock,
// redirects and response size limits (Документ §17).

import assert from 'node:assert/strict';
import { describe, it, after } from 'node:test';
import { checkEndpointUrl, classifyAddress, createPinnedFetch, NetError, PinnedHttpClient, resolvePinned, routeEndpointRules } from '../src/net.ts';
import type { Resolver } from '../src/net.ts';
import { FakeServer } from './helpers.ts';

const PORTS: [number, number] = [18700, 18709];

const fakeDns: Record<string, string[]> = {
  'public.example': ['93.184.216.34'],
  'evil-private.example': ['10.0.0.7'],
  'evil-rfc1918.example': ['192.168.1.20'],
  'evil-loopback.example': ['127.0.0.1'],
  'evil-mixed.example': ['93.184.216.34', '172.16.5.5'],
  'evil-v6.example': ['fd12:3456::1'],
  'evil-metadata.example': ['169.254.169.254'],
  'fake-provider.test': ['127.0.0.1'],
};
const resolver: Resolver = async (host) => {
  const addrs = fakeDns[host];
  if (!addrs) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  return addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

async function rejects(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => e instanceof NetError && e.code === code);
}

describe('address classification', () => {
  const cases: [string, string][] = [
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['172.32.0.1', 'public'],
    ['192.168.0.10', 'private'],
    ['127.0.0.1', 'loopback'],
    ['127.255.0.9', 'loopback'],
    ['169.254.169.254', 'metadata'],
    ['169.254.10.10', 'link_local'],
    ['100.64.0.1', 'cgnat'],
    ['100.127.255.254', 'cgnat'],
    ['100.100.100.200', 'metadata'],
    ['0.0.0.0', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'reserved'],
    ['8.8.8.8', 'public'],
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'ula'],
    ['fdff:ffff::1', 'ula'],
    ['fd00:ec2::254', 'metadata'],
    ['fe80::1', 'link_local'],
    ['febf::1', 'link_local'],
    ['ff02::1', 'multicast'],
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:169.254.169.254', 'metadata'],
    ['64:ff9b::a00:1', 'private'],
    ['2002:a00:1::1', 'private'],
    ['2001:db8::1', 'documentation'],
    ['2606:4700::1111', 'public'],
    ['[::1]', 'loopback'],
    ['not-an-ip', 'invalid'],
  ];
  for (const [ip, cls] of cases) {
    it(`${ip} → ${cls}`, () => assert.equal(classifyAddress(ip), cls));
  }
});

describe('endpoint URL rules (public policy)', () => {
  const pub = { policy: 'public_only' as const, allowHttp: false };
  it('accepts https on a public hostname', () => {
    assert.equal(checkEndpointUrl('https://api.example.com/', pub).origin, 'https://api.example.com');
  });
  const blocked: [string, string][] = [
    ['http://api.example.com', 'insecure_scheme'],
    ['ftp://api.example.com', 'insecure_scheme'],
    ['https://user:pw@api.example.com', 'credentials_in_url'],
    ['https://api.example.com/?key=1', 'invalid_url'],
    ['https://10.0.0.1/', 'blocked_address'],
    ['https://172.16.0.1/', 'blocked_address'],
    ['https://192.168.1.1/', 'blocked_address'],
    ['https://127.0.0.1/', 'blocked_address'],
    ['https://169.254.169.254/latest/meta-data', 'blocked_address'],
    ['https://[::1]/', 'blocked_address'],
    ['https://[fc00::1]/', 'blocked_address'],
    ['https://[fe80::1]/', 'blocked_address'],
    ['https://100.64.0.1/', 'blocked_address'],
    ['https://0.0.0.0/', 'blocked_address'],
    ['https://2130706433/', 'blocked_address'], // decimal form of 127.0.0.1, normalized by the URL parser
    ['https://0x7f.0.0.1/', 'blocked_address'], // hex form
    ['https://[::ffff:127.0.0.1]/', 'blocked_address'],
    ['https://metadata.google.internal/', 'blocked_hostname'],
    ['not a url', 'invalid_url'],
  ];
  for (const [url, code] of blocked) {
    it(`rejects ${url} (${code})`, () => assert.throws(() => checkEndpointUrl(url, pub), (e: unknown) => e instanceof NetError && e.code === code));
  }
  it('loopback policy allows http only to loopback', () => {
    const lo = { policy: 'loopback_only' as const, allowHttp: true };
    assert.equal(checkEndpointUrl('http://127.0.0.1:8080', lo).origin, 'http://127.0.0.1:8080');
    assert.throws(() => checkEndpointUrl('http://10.0.0.1:8080', lo), (e: unknown) => e instanceof NetError && e.code === 'blocked_address');
  });
  it('a user-supplied endpoint is always public https, whatever the network flags say', () => {
    const rules = routeEndpointRules({ locality: 'remote', user_supplied_endpoint: true, network: { allow_private_network: true, allow_insecure_http: true } });
    assert.deepEqual(rules, { policy: 'public_only', allowHttp: false });
  });
  it('metadata stays forbidden even when the owner allows private networks', () => {
    const priv = { policy: 'private_allowed' as const, allowHttp: true };
    assert.equal(checkEndpointUrl('http://10.0.0.5:8000', priv).host, '10.0.0.5:8000');
    assert.throws(() => checkEndpointUrl('http://169.254.169.254/', priv), (e: unknown) => e instanceof NetError && e.code === 'blocked_address');
  });
});

describe('DNS validation and pinning', () => {
  it('rejects hostnames resolving to private, loopback, ULA or metadata addresses', async () => {
    for (const host of ['evil-private.example', 'evil-rfc1918.example', 'evil-loopback.example', 'evil-v6.example', 'evil-metadata.example']) {
      await rejects(resolvePinned(host, 'public_only', resolver), 'blocked_address');
    }
  });
  it('rejects a hostname when ANY of its addresses is private (no mixed answers)', async () => {
    await rejects(resolvePinned('evil-mixed.example', 'public_only', resolver), 'blocked_address');
  });
  it('accepts a public hostname and returns the address to pin', async () => {
    assert.deepEqual(await resolvePinned('public.example', 'public_only', resolver), { address: '93.184.216.34', family: 4 });
  });
  it('real system DNS: localhost resolves to loopback and is refused for public endpoints', async () => {
    await rejects(resolvePinned('localhost', 'public_only', async (h) => (await import('node:dns/promises')).lookup(h, { all: true })), 'blocked_address');
  });
  it('dns failure maps to dns_failed', async () => {
    await rejects(resolvePinned('nope.example', 'public_only', resolver), 'dns_failed');
  });
});

describe('pinned HTTP client', () => {
  let server: FakeServer;
  after(async () => server?.close());

  it('connects to the validated, pinned address (the hostname is resolved only by our resolver)', async () => {
    server = await FakeServer.start(PORTS, (r) => (r.path === '/redirect' ? { status: 302, headers: { location: 'http://169.254.169.254/' } } : r.path === '/big' ? { body: 'x'.repeat(5000) } : { body: { ok: true, host: r.headers.host } }));
    const client = new PinnedHttpClient({ baseUrl: `http://fake-provider.test:${server.port}`, policy: 'private_allowed', allowHttp: true, resolver, maxResponseBytes: 2048 });
    const res = await client.request({ method: 'GET', url: client.url('/ping') });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.text).host, `fake-provider.test:${server.port}`, 'Host header keeps the hostname');
    client.close();
  });

  it('origin lock: a route client refuses URLs of any other origin', async () => {
    const client = new PinnedHttpClient({ baseUrl: `http://127.0.0.1:${server.port}`, policy: 'loopback_only', allowHttp: true });
    await rejects(client.request({ method: 'GET', url: 'http://127.0.0.2:9/' }), 'origin_not_allowed');
    client.close();
  });

  it('never follows redirects', async () => {
    const client = new PinnedHttpClient({ baseUrl: `http://127.0.0.1:${server.port}`, policy: 'loopback_only', allowHttp: true });
    await rejects(client.request({ method: 'GET', url: client.url('/redirect') }), 'redirect_blocked');
    client.close();
  });

  it('limits response size', async () => {
    const client = new PinnedHttpClient({ baseUrl: `http://127.0.0.1:${server.port}`, policy: 'loopback_only', allowHttp: true, maxResponseBytes: 1024 });
    await rejects(client.request({ method: 'GET', url: client.url('/big') }), 'response_too_large');
    client.close();
  });

  it('a loopback-only client refuses a hostname that resolves elsewhere', async () => {
    const client = new PinnedHttpClient({ baseUrl: 'http://public.example:80', policy: 'loopback_only', allowHttp: true, resolver });
    await rejects(client.request({ method: 'GET', url: client.url('/') }), 'blocked_address');
    client.close();
  });

  it('pinned fetch (used by the Anthropic SDK) inherits the origin lock', async () => {
    const client = new PinnedHttpClient({ baseUrl: `http://127.0.0.1:${server.port}`, policy: 'loopback_only', allowHttp: true });
    const f = createPinnedFetch(client);
    const ok = await f(client.url('/ping'));
    assert.equal(ok.status, 200);
    await assert.rejects(f('http://127.0.0.1:1/other'), (e: unknown) => e instanceof NetError && e.code === 'origin_not_allowed');
    client.close();
  });
});
