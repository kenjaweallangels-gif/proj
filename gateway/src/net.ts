// Outbound network safety for provider calls (Документ §17, docs/SPEC.md §7).
//
// * Endpoint validation: http(s) only, no credentials/query in the base URL, https unless the route is
//   loopback-only or the owner explicitly allowed plain http.
// * Address policy: every address a hostname resolves to is classified; private, loopback, link-local,
//   metadata, CGNAT, ULA, multicast and reserved ranges are refused for public endpoints.
// * Pinning: the hostname is resolved ONCE per request, the result is validated, and the socket connects
//   to exactly that address (custom `lookup`), so DNS rebinding between check and connect is impossible.
//   TLS still verifies the certificate against the hostname (SNI = hostname).
// * Origin lock: a client only talks to the origin of its route; API keys therefore never reach another host.
// * No redirects are followed; responses are size-limited.

import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { performance } from 'node:perf_hooks';

export type EndpointPolicy = 'loopback_only' | 'public_only' | 'private_allowed';

export type AddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'cgnat'
  | 'ula'
  | 'link_local'
  | 'metadata'
  | 'unspecified'
  | 'multicast'
  | 'documentation'
  | 'reserved'
  | 'invalid';

export type NetErrorCode =
  | 'invalid_url'
  | 'insecure_scheme'
  | 'credentials_in_url'
  | 'blocked_hostname'
  | 'blocked_address'
  | 'dns_failed'
  | 'connect_failed'
  | 'tls_error'
  | 'timeout'
  | 'aborted'
  | 'redirect_blocked'
  | 'response_too_large'
  | 'origin_not_allowed'
  | 'protocol_error';

export class NetError extends Error {
  readonly code: NetErrorCode;
  constructor(code: NetErrorCode, message: string) {
    super(message);
    this.name = 'NetError';
    this.code = code;
  }
}

export interface ResolvedAddress {
  address: string;
  family: number;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = async (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

const ALLOWED_CLASSES: Record<EndpointPolicy, readonly AddressClass[]> = {
  loopback_only: ['loopback'],
  public_only: ['public'],
  // Owner-approved self-hosting. Metadata and link-local stay forbidden in every policy.
  private_allowed: ['public', 'loopback', 'private', 'cgnat', 'ula'],
};

/** Hostnames of cloud metadata services, refused before any DNS lookup (defense in depth). */
const BLOCKED_HOSTNAMES = new Set(['metadata', 'metadata.google.internal', 'metadata.goog', 'instance-data', 'instance-data.ec2.internal']);

/** Metadata endpoints that are not covered by link-local/ULA ranges or are worth naming explicitly. */
const METADATA_V4 = new Set(['169.254.169.254', '169.254.170.2', '169.254.169.123', '100.100.100.200', '168.63.129.16', '192.0.0.192']);

export function parseIPv4(s: string): number[] | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

/** Parses an IPv6 literal (optionally bracketed, with zone id or embedded IPv4) into 8 16-bit groups. */
export function parseIPv6(input: string): number[] | null {
  let s = input.trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(':');
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill('0'), ...rest];
  }
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function classifyV4(o: number[]): AddressClass {
  const [a, b, c] = o;
  if (METADATA_V4.has(o.join('.'))) return 'metadata';
  if (a === 0) return 'unspecified';
  if (a === 10) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link_local';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 0 && c === 0) return 'reserved';
  if (a === 192 && b === 0 && c === 2) return 'documentation';
  if (a === 192 && b === 88 && c === 99) return 'reserved';
  if (a === 192 && b === 168) return 'private';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';
  if (a === 198 && b === 51 && c === 100) return 'documentation';
  if (a === 203 && b === 0 && c === 113) return 'documentation';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  return 'public';
}

function embeddedV4(hi: number, lo: number): number[] {
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
}

function classifyV6(g: number[]): AddressClass {
  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (g.every((x) => x === 0)) return 'unspecified';
  if (zeroUpTo(7) && g[7] === 1) return 'loopback';
  // AWS IMDS over IPv6 (fd00:ec2::254) — also inside ULA, named explicitly.
  if (g[0] === 0xfd00 && g[1] === 0x0ec2 && g.slice(2, 7).every((x) => x === 0) && g[7] === 0x254) return 'metadata';
  if (zeroUpTo(5) && g[5] === 0xffff) return classifyV4(embeddedV4(g[6], g[7])); // IPv4-mapped
  if (zeroUpTo(6)) {
    // Deprecated IPv4-compatible form: never a legitimate public endpoint.
    const inner = classifyV4(embeddedV4(g[6], g[7]));
    return inner === 'public' ? 'reserved' : inner;
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return classifyV4(embeddedV4(g[6], g[7])); // NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return 'private'; // local-use NAT64
  if (g[0] === 0x2002) return classifyV4(embeddedV4(g[1], g[2])); // 6to4 embeds an IPv4 address
  if (g[0] === 0x2001 && g[1] === 0) return 'reserved'; // Teredo tunnels
  if (g[0] === 0x2001 && g[1] === 0x0db8) return 'documentation';
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return 'reserved'; // discard prefix
  if ((g[0] & 0xfe00) === 0xfc00) return 'ula';
  if ((g[0] & 0xffc0) === 0xfe80) return 'link_local';
  if ((g[0] & 0xffc0) === 0xfec0) return 'reserved'; // deprecated site-local
  if ((g[0] & 0xff00) === 0xff00) return 'multicast';
  if ((g[0] & 0xe000) === 0x2000) return 'public';
  return 'reserved';
}

export function classifyAddress(ip: string): AddressClass {
  const raw = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  const family = isIP(raw.split('%')[0]);
  if (family === 4) {
    const o = parseIPv4(raw);
    return o ? classifyV4(o) : 'invalid';
  }
  if (family === 6) {
    const g = parseIPv6(raw);
    return g ? classifyV6(g) : 'invalid';
  }
  return 'invalid';
}

export function isAddressAllowed(ip: string, policy: EndpointPolicy): { allowed: boolean; cls: AddressClass } {
  const cls = classifyAddress(ip);
  return { allowed: ALLOWED_CLASSES[policy].includes(cls), cls };
}

function bareHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

export interface EndpointRules {
  policy: EndpointPolicy;
  /** Allow plain http for non-loopback policies (owner opt-in). Loopback-only always allows http. */
  allowHttp: boolean;
}

/** Static checks of a base URL (no DNS). Returns the normalized URL without a trailing slash. */
export function checkEndpointUrl(raw: string, rules: EndpointRules): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NetError('invalid_url', `некорректный URL endpoint: ${JSON.stringify(String(raw).slice(0, 200))}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new NetError('insecure_scheme', `схема ${url.protocol} запрещена: разрешены только https (и http для loopback)`);
  }
  if (url.protocol === 'http:' && rules.policy !== 'loopback_only' && !rules.allowHttp) {
    throw new NetError('insecure_scheme', `endpoint ${url.host}: требуется https (http разрешён только для loopback или явной настройкой владельца)`);
  }
  if (url.username || url.password) {
    throw new NetError('credentials_in_url', 'учётные данные в URL endpoint запрещены; ключи хранятся только в секретах сервера');
  }
  if (url.search || url.hash) {
    throw new NetError('invalid_url', 'URL endpoint не должен содержать query или fragment');
  }
  const host = bareHostname(url.hostname).toLowerCase();
  if (!host) throw new NetError('invalid_url', 'в URL endpoint нет хоста');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.internal') && host.startsWith('metadata')) {
    throw new NetError('blocked_hostname', `хост ${host} запрещён (служба метаданных)`);
  }
  if (isIP(host)) {
    const { allowed, cls } = isAddressAllowed(host, rules.policy);
    if (!allowed) throw new NetError('blocked_address', `адрес ${host} (${cls}) запрещён политикой ${rules.policy}`);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

/** Resolves a hostname once and validates EVERY returned address; returns the address to pin. */
export async function resolvePinned(hostname: string, policy: EndpointPolicy, resolver: Resolver): Promise<ResolvedAddress> {
  const host = bareHostname(hostname);
  const literal = isIP(host);
  if (literal) {
    const { allowed, cls } = isAddressAllowed(host, policy);
    if (!allowed) throw new NetError('blocked_address', `адрес ${host} (${cls}) запрещён политикой ${policy}`);
    return { address: host, family: literal };
  }
  let addrs: ResolvedAddress[];
  try {
    addrs = await resolver(host);
  } catch (e) {
    throw new NetError('dns_failed', `DNS: не удалось разрешить ${host} (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
  }
  if (!addrs.length) throw new NetError('dns_failed', `DNS: нет адресов для ${host}`);
  for (const a of addrs) {
    const { allowed, cls } = isAddressAllowed(a.address, policy);
    if (!allowed) throw new NetError('blocked_address', `${host} разрешается в ${a.address} (${cls}) — запрещено политикой ${policy}`);
  }
  return addrs[0];
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'DELETE';
  /** Absolute URL; must belong to the client's origin. */
  url: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Called with each decoded body chunk (used for SSE streaming). */
  onData?: (chunk: string) => void;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  /** Milliseconds from request start to the first body byte (or headers when the body is empty). */
  firstByteMs: number;
  totalMs: number;
}

export interface PinnedClientOptions {
  baseUrl: string;
  policy: EndpointPolicy;
  allowHttp: boolean;
  resolver?: Resolver;
  maxResponseBytes?: number;
}

function mapSocketError(e: NodeJS.ErrnoException): NetError {
  const code = e.code ?? '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new NetError('dns_failed', `DNS: ${code}`);
  if (code.startsWith('CERT_') || code.startsWith('ERR_TLS') || code.includes('SSL') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return new NetError('tls_error', `TLS: ${code}`);
  }
  if (code === 'HPE_INVALID_CONSTANT' || code.startsWith('HPE_')) return new NetError('protocol_error', `HTTP: ${code}`);
  return new NetError('connect_failed', `соединение: ${code || e.message}`);
}

/**
 * HTTP client bound to one origin. Every request re-resolves the hostname, validates all addresses
 * against the policy and pins the connection to the validated address.
 */
export class PinnedHttpClient {
  readonly baseUrl: string;
  readonly origin: string;
  readonly policy: EndpointPolicy;
  readonly #resolver: Resolver;
  readonly #maxBytes: number;
  readonly #agent: http.Agent;

  constructor(opts: PinnedClientOptions) {
    const url = checkEndpointUrl(opts.baseUrl, { policy: opts.policy, allowHttp: opts.allowHttp });
    this.baseUrl = url.href.replace(/\/+$/, '');
    this.origin = url.origin;
    this.policy = opts.policy;
    this.#resolver = opts.resolver ?? systemResolver;
    this.#maxBytes = opts.maxResponseBytes ?? 1024 * 1024;
    this.#agent = url.protocol === 'https:' ? new https.Agent({ keepAlive: true, maxSockets: 32 }) : new http.Agent({ keepAlive: true, maxSockets: 32 });
  }

  /** Absolute URL for a path below the base URL. */
  url(path: string): string {
    return `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  close(): void {
    this.#agent.destroy();
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      throw new NetError('invalid_url', 'некорректный URL запроса');
    }
    if (url.origin !== this.origin) {
      throw new NetError('origin_not_allowed', `запрос к ${url.origin} запрещён: клиент маршрута привязан к ${this.origin}`);
    }
    if (req.signal?.aborted) throw new NetError('aborted', 'запрос отменён до отправки');
    const pinned = await resolvePinned(url.hostname, this.policy, this.#resolver);
    if (req.signal?.aborted) throw new NetError('aborted', 'запрос отменён до отправки');

    const lookup: LookupFunction = (_hostname, options, callback) => {
      if (options && (options as { all?: boolean }).all) {
        (callback as unknown as (err: null, addrs: ResolvedAddress[]) => void)(null, [pinned]);
      } else {
        callback(null, pinned.address, pinned.family);
      }
    };

    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const started = performance.now();
    const maxBytes = this.#maxBytes;

    return new Promise<HttpResponse>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (err: NetError | null, res?: HttpResponse) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        req.signal?.removeEventListener('abort', onAbort);
        if (err) reject(err);
        else resolve(res as HttpResponse);
      };
      const onAbort = () => {
        finish(new NetError('aborted', 'запрос отменён'));
        r.destroy();
      };

      const host = bareHostname(url.hostname);
      const r = mod.request(
        {
          protocol: url.protocol,
          hostname: host,
          port: url.port || (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: req.method,
          headers: { ...(req.headers ?? {}), ...(req.body !== undefined ? { 'content-length': String(Buffer.byteLength(req.body)) } : {}) },
          lookup,
          agent: this.#agent,
          ...(isHttps && !isIP(host) ? { servername: host } : {}),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && status !== 304) {
            res.resume();
            finish(new NetError('redirect_blocked', `редирект ${status} не выполняется (защита от SSRF)`));
            r.destroy();
            return;
          }
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
          }
          let firstByteMs = -1;
          let bytes = 0;
          const chunks: string[] = [];
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            if (settled) return;
            if (firstByteMs < 0) firstByteMs = performance.now() - started;
            bytes += Buffer.byteLength(chunk);
            if (bytes > maxBytes) {
              finish(new NetError('response_too_large', `ответ больше ${maxBytes} байт`));
              r.destroy();
              return;
            }
            chunks.push(chunk);
            req.onData?.(chunk);
          });
          res.on('end', () => {
            const total = performance.now() - started;
            finish(null, { status, headers, text: chunks.join(''), firstByteMs: firstByteMs < 0 ? total : firstByteMs, totalMs: total });
          });
          res.on('error', (e) => finish(mapSocketError(e as NodeJS.ErrnoException)));
          res.on('aborted', () => finish(new NetError('connect_failed', 'соединение оборвано во время ответа')));
        },
      );
      r.on('error', (e) => finish(mapSocketError(e as NodeJS.ErrnoException)));
      if (req.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          finish(new NetError('timeout', `таймаут ${Math.round(req.timeoutMs ?? 0)} мс`));
          r.destroy();
        }, Math.max(1, req.timeoutMs));
      }
      req.signal?.addEventListener('abort', onAbort, { once: true });
      if (req.body !== undefined) r.end(req.body);
      else r.end();
    });
  }
}

/**
 * A `fetch` implementation backed by a PinnedHttpClient, for SDKs that accept a custom fetch
 * (the Anthropic SDK). It inherits origin lock, address policy, pinning, size limit and no-redirects.
 */
export function createPinnedFetch(client: PinnedHttpClient): typeof fetch {
  const pinnedFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body = init?.body;
    let text: string | undefined;
    if (typeof body === 'string') text = body;
    else if (body instanceof Uint8Array) text = new TextDecoder().decode(body);
    else if (body instanceof ArrayBuffer) text = new TextDecoder().decode(new Uint8Array(body));
    else if (body !== undefined && body !== null) throw new NetError('protocol_error', 'pinned fetch: поддерживаются только строковые тела запросов');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') throw new NetError('protocol_error', `pinned fetch: метод ${method} не поддерживается`);
    const res = await client.request({
      method,
      url,
      headers: Object.fromEntries(headers.entries()),
      body: text,
      signal: init?.signal ?? undefined,
    });
    const nullBody = res.status === 204 || res.status === 205 || res.status === 304;
    return new Response(nullBody ? null : res.text, { status: res.status, headers: res.headers });
  };
  return pinnedFetch as typeof fetch;
}

/** Network policy for a route according to its config (see README «Модель безопасности»). */
export function routeEndpointRules(route: { locality: 'local' | 'remote'; user_supplied_endpoint: boolean; network: { allow_private_network: boolean; allow_insecure_http: boolean } }): EndpointRules {
  if (route.user_supplied_endpoint) return { policy: 'public_only', allowHttp: false };
  if (route.locality === 'local') return { policy: 'loopback_only', allowHttp: true };
  return {
    policy: route.network.allow_private_network ? 'private_allowed' : 'public_only',
    allowHttp: route.network.allow_insecure_http,
  };
}
