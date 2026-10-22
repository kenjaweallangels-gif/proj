// Agent Gateway HTTP server (docs/SPEC.md §7), node:http without frameworks.
//
//   node gateway/src/server.ts --config data/providers.example.json [--local-helper] [--allow-lan]
//        [--host 127.0.0.1] [--port 8787] [--origin http://127.0.0.1:8080]... [--secrets file]
//        [--log-file path] [--debug-content]
//
// Security model (README «Модель безопасности»): binds to loopback unless --allow-lan; Origin must be in
// the allowlist whenever a browser sends it (CORS answers only allowlisted origins); POST bodies must be
// application/json (no CSRF via simple requests); session token on every game endpoint. --local-helper
// additionally checks the Host header (DNS-rebinding defense) and requires the token on every endpoint.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigError, loadConfig } from './config.ts';
import { Gateway } from './gateway.ts';
import type { GatewayDeps, GatewayResponse } from './gateway.ts';
import { fileSink, stdoutSink } from './log.ts';
import { SecretsError, SecretStore } from './secrets.ts';
import { GATEWAY_VERSION } from './types.ts';
import type { Capability } from './types.ts';

export interface ServerOptions {
  gateway: Gateway;
  host: string;
  port: number;
  localHelper: boolean;
  allowLan: boolean;
  allowedOrigins: string[];
  maxBodyBytes: number;
}

export class BindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BindError';
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** Refuses to expose the gateway beyond loopback unless the owner explicitly passed --allow-lan. */
export function checkBindHost(host: string, opts: { localHelper: boolean; allowLan: boolean }): void {
  if (isLoopbackHost(host)) return;
  if (!opts.allowLan) {
    throw new BindError(
      `отказ привязки к ${host}: ${opts.localHelper ? 'локальный помощник' : 'шлюз'} слушает только loopback (127.0.0.1). ` +
        'Открыть доступ из сети можно лишь явным флагом --allow-lan (не рекомендуется).',
    );
  }
}

/** Host header check for --local-helper: only loopback names (blocks DNS-rebinding pages). */
function hostHeaderAllowed(hostHeader: string | undefined, port: number): boolean {
  if (!hostHeader) return false;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(hostHeader.trim().toLowerCase());
  if (!m) return false;
  const [, host, p] = m;
  if (!isLoopbackHost(host)) return false;
  return p === undefined ? port === 80 : Number(p) === port;
}

const SECURITY_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-echo-gateway-version': GATEWAY_VERSION,
};

const CORS_ALLOW_HEADERS = 'authorization, content-type, x-echo-route, x-echo-mock';

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function readJson(req: http.IncomingMessage, maxBytes: number): Promise<unknown> {
  const ctype = (req.headers['content-type'] ?? '').toLowerCase();
  if (!ctype.startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'тело запроса должно иметь Content-Type: application/json');
  }
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > maxBytes) throw new HttpError(413, 'payload_too_large', `тело больше ${maxBytes} байт`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new HttpError(413, 'payload_too_large', `тело больше ${maxBytes} байт`);
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'тело запроса — некорректный JSON');
  }
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  const payload = status === 204 ? '' : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(payload);
}

export function createHttpServer(opts: ServerOptions): http.Server {
  const { gateway } = opts;
  const allowed = new Set(opts.allowedOrigins);

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const receivedAt = gateway.clock.now();
    const url = new URL(req.url ?? '/', 'http://gateway.invalid');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const cors: Record<string, string> = {};

    if (opts.localHelper && !hostHeaderAllowed(req.headers.host, opts.port)) {
      gateway.log.warn('host_rejected', { path });
      return send(res, 403, { error: { code: 'host_not_allowed', message: 'локальный помощник принимает только Host 127.0.0.1/localhost (защита от DNS rebinding)' } });
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!allowed.has(origin)) {
        gateway.log.warn('origin_rejected', { path, origin: origin.slice(0, 200) });
        return send(res, 403, { error: { code: 'origin_not_allowed', message: 'Origin не входит в allowlist шлюза' } });
      }
      cors['access-control-allow-origin'] = origin;
      cors.vary = 'Origin';
      cors['access-control-expose-headers'] = 'x-echo-route-used, x-echo-replay, x-echo-gateway-version';
    }

    if (req.method === 'OPTIONS') {
      if (origin === undefined) return send(res, 204, null);
      cors['access-control-allow-methods'] = 'GET, POST, OPTIONS';
      cors['access-control-allow-headers'] = CORS_ALLOW_HEADERS;
      cors['access-control-max-age'] = '600';
      // Chrome Private Network Access: a public page asking for a loopback/private target.
      if (req.headers['access-control-request-private-network'] === 'true') cors['access-control-allow-private-network'] = 'true';
      return send(res, 204, null, cors);
    }

    const session = gateway.sessions.authenticate(req.headers.authorization);
    // Session creation is the only token-free call; local-helper mode also protects health/manifest.
    const needsToken = (p: string) => p !== '/v1/session' && (opts.localHelper || !['/v1/health', '/v1/manifest'].includes(p));
    const reply = (r: GatewayResponse) => send(res, r.httpStatus, r.body, { ...cors, ...(r.headers ?? {}) });

    try {
      const routes: Record<string, { method: 'GET' | 'POST'; run: () => Promise<GatewayResponse> | GatewayResponse }> = {
        '/v1/session': { method: 'POST', run: async () => gateway.createSession(await readJson(req, opts.maxBodyBytes)) },
        '/v1/intent': { method: 'POST', run: async () => intent('generate_intent') },
        '/v1/dialogue': { method: 'POST', run: async () => intent('generate_dialogue') },
        '/v1/cancel': { method: 'POST', run: async () => gateway.cancel(session!, await readJson(req, opts.maxBodyBytes)) },
        '/v1/health': { method: 'GET', run: () => ({ httpStatus: 200, body: gateway.health() }) },
        '/v1/providers': {
          method: 'GET',
          run: async () => ({ httpStatus: 200, body: await gateway.providers(session, { refresh: url.searchParams.get('refresh') === '1', deep: url.searchParams.get('deep') === '1' }) }),
        },
        '/v1/usage': { method: 'GET', run: () => ({ httpStatus: 200, body: gateway.usage(session!) }) },
        '/v1/manifest': { method: 'GET', run: () => ({ httpStatus: 200, body: gateway.manifest() }) },
      };
      const intent = async (capability: Capability): Promise<GatewayResponse> => {
        const body = await readJson(req, opts.maxBodyBytes);
        const routeHeader = req.headers['x-echo-route'];
        const mockHeader = req.headers['x-echo-mock'];
        return gateway.handle(session!, body, capability, {
          receivedAt,
          routeHeader: typeof routeHeader === 'string' ? routeHeader : undefined,
          mockHeader: typeof mockHeader === 'string' ? mockHeader : undefined,
        });
      };

      const route = routes[path];
      if (!route) return send(res, 404, { error: { code: 'not_found', message: `нет метода ${path}` } }, cors);
      if (req.method !== route.method) return send(res, 405, { error: { code: 'method_not_allowed', message: `${path}: ожидается ${route.method}` } }, { ...cors, allow: route.method });
      if (needsToken(path) && !session) {
        return send(res, 401, { error: { code: 'unauthorized', message: 'нужен заголовок Authorization: Bearer <session_token> (выдаётся POST /v1/session)' } }, { ...cors, 'www-authenticate': 'Bearer' });
      }
      return reply(await route.run());
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message } }, cors);
      gateway.log.error('http_handler_error', { path, message: String((e as Error)?.message ?? e) });
      return send(res, 500, { error: { code: 'internal_error', message: 'внутренняя ошибка шлюза' } }, cors);
    }
  };

  const server = http.createServer((req, res) => {
    handler(req, res).catch(() => send(res, 500, { error: { code: 'internal_error', message: 'внутренняя ошибка шлюза' } }));
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 120_000;
  return server;
}

export async function startServer(opts: ServerOptions): Promise<{ server: http.Server; url: string; port: number; close: () => Promise<void> }> {
  checkBindHost(opts.host, opts);
  const server = createHttpServer(opts);
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => resolveListen());
  });
  const port = (server.address() as AddressInfo).port;
  // The Host check needs the real port when an ephemeral port (0) was requested.
  if (opts.port === 0) opts.port = port;
  const hostForUrl = opts.host.includes(':') && !opts.host.startsWith('[') ? `[${opts.host}]` : opts.host;
  return {
    server,
    url: `http://${hostForUrl}:${port}`,
    port,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}

// ---------------------------------------------------------------- CLI entry

interface Args {
  config: string;
  host: string | null;
  port: number | null;
  localHelper: boolean;
  allowLan: boolean;
  debugContent: boolean;
  logFile: string | null;
  secrets: string | null;
  origins: string[];
}

export function parseServerArgs(argv: string[]): Args {
  const a: Args = { config: 'data/providers.example.json', host: null, port: null, localHelper: false, allowLan: false, debugContent: false, logFile: null, secrets: null, origins: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`флаг ${k} требует значение`);
      return v;
    };
    switch (k) {
      case '--config':
        a.config = next();
        break;
      case '--host':
        a.host = next();
        break;
      case '--port':
        a.port = Number(next());
        break;
      case '--local-helper':
        a.localHelper = true;
        break;
      case '--allow-lan':
        a.allowLan = true;
        break;
      case '--debug-content':
        a.debugContent = true;
        break;
      case '--log-file':
        a.logFile = next();
        break;
      case '--secrets':
        a.secrets = next();
        break;
      case '--origin':
        a.origins.push(next());
        break;
      default:
        throw new Error(`неизвестный флаг ${k}`);
    }
  }
  return a;
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseServerArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(2);
  }
  try {
    const config = loadConfig(resolve(args.config));
    if (args.secrets) config.secrets_file = resolve(args.secrets);
    const secrets = SecretStore.load({ routeIds: config.routes.map((r) => r.id), env: process.env, file: config.secrets_file });
    const deps: GatewayDeps = { secrets, logSink: args.logFile ? fileSink(args.logFile) : stdoutSink(), debugContent: args.debugContent };
    const gateway = new Gateway(config, deps);
    const host = args.host ?? config.server.host;
    const port = args.port ?? config.server.port;
    if (args.debugContent) gateway.log.warn('debug_content_enabled', { note: 'в журнал пишется содержимое разговоров — только для отладки' });
    if (args.allowLan && !isLoopbackHost(host)) gateway.log.warn('lan_exposed', { host, note: 'шлюз доступен из сети по явному --allow-lan' });
    const started = await startServer({
      gateway,
      host,
      port,
      localHelper: args.localHelper,
      allowLan: args.allowLan,
      allowedOrigins: [...config.server.allowed_origins, ...args.origins],
      maxBodyBytes: config.server.max_body_bytes,
    });
    gateway.log.info('listening', { url: started.url, local_helper: args.localHelper, routes: config.routes.filter((r) => r.enabled).map((r) => r.id) });
    const stop = async () => {
      await started.close();
      gateway.close();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (e) {
    if (e instanceof ConfigError || e instanceof SecretsError || e instanceof BindError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`шлюз не запущен: ${(e as Error).message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main();
}
