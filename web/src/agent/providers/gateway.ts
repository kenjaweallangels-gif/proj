// Agent Gateway client (docs/SPEC.md §7): POST /v1/session → bearer token kept in memory only, POST /v1/intent with
// the core's GatewayRequest, best-effort POST /v1/cancel on abort. Keys never reach the page: the gateway holds them.
// In a sandboxed artifact the page's network is blocked — the provider then reports itself unavailable.
import type { GatewayRequest, GatewayResult } from '../../contracts.ts';
import {
  abortMessage, abortStatus, makeResult, StateHolder,
  type PrivacyProfile, type Provider, type ProviderContext, type ProviderState,
} from './types.ts';

export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:8787';

interface SessionInfo { session_token: string; expires_at?: string; default_route?: string; routes?: unknown[] }

export class GatewayProvider implements Provider {
  readonly id = 'gateway' as const;
  readonly label = 'Agent Gateway (HTTP)';
  readonly where = 'шлюз: локальные модели или внешние API по профилю приватности; ключи только на сервере';
  private base = DEFAULT_GATEWAY_URL;
  private token: string | null = null;
  private tokenPrivacy: PrivacyProfile | null = null;
  private privacy: PrivacyProfile = 'offline';
  private sessionPromise: Promise<string | null> | null = null;
  private readonly st = new StateHolder({ state: 'off', message: 'не подключён' });
  /** Route that answered the last request (X-Echo-Route-Used). */
  lastRoute: string | null = null;

  backend(privacy: PrivacyProfile): 'remote' | 'cpu' {
    // offline: the gateway may only use local routes (mock, llama.cpp on loopback) — the core's local lane.
    return privacy === 'offline' ? 'cpu' : 'remote';
  }

  state(): ProviderState { return this.st.get(); }
  onState(fn: () => void): void { this.st.on(fn); }
  accepts(): boolean { return this.st.get().state === 'ready'; }

  get url(): string { return this.base; }

  setUrl(url: string): void {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean === this.base) return;
    this.base = clean;
    this.token = null;
    this.activate(this.privacy);
  }

  activate(privacy: PrivacyProfile): void {
    this.privacy = privacy;
    if (this.token && this.tokenPrivacy === privacy) return;
    this.token = null;
    void this.ensureSession();
  }

  private ensureSession(): Promise<string | null> {
    if (this.token && this.tokenPrivacy === this.privacy) return Promise.resolve(this.token);
    if (this.sessionPromise) return this.sessionPromise;
    const privacy = this.privacy;
    this.st.set({ state: 'checking', message: `подключение к ${this.base}…` });
    this.sessionPromise = (async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(`${this.base}/v1/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ privacy_profile: privacy, client: 'web' }),
          signal: ctl.signal,
        }).finally(() => clearTimeout(t));
        const body = await res.json().catch(() => null) as (SessionInfo & { error?: { code: string; message: string } }) | null;
        if (!res.ok || !body?.session_token) {
          const code = body?.error?.code ?? `HTTP ${res.status}`;
          const hint = code === 'origin_not_allowed'
            ? ` — добавьте ${location.origin} в allowlist шлюза (--origin ${location.origin})` : '';
          this.st.set({ state: 'unavailable', message: `шлюз отказал в сессии: ${body?.error?.message ?? code}${hint}` });
          return null;
        }
        this.token = body.session_token;
        this.tokenPrivacy = privacy;
        this.st.set({ state: 'ready', message: `сессия открыта (${privacy}); маршрут по умолчанию: ${body.default_route ?? '—'}` });
        return this.token;
      } catch (e) {
        this.st.set({
          state: 'unavailable',
          message: `шлюз недоступен из этой страницы (${this.base}): ${String((e as Error)?.message ?? e)}. Запустите node gateway/src/server.ts --origin ${location.origin}`,
        });
        return null;
      } finally {
        this.sessionPromise = null;
      }
    })();
    return this.sessionPromise;
  }

  async generate(req: GatewayRequest, ctx: ProviderContext): Promise<GatewayResult> {
    const base = { provider: 'gateway', model: 'unknown' };
    const t0 = performance.now();
    const token = await this.ensureSession();
    if (!token) return makeResult(req, 'unavailable', { ...base, error: { code: 'unavailable', message: this.st.get().message } });
    try {
      const res = await fetch(`${this.base}/v1/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(req),
        signal: ctx.signal,
      });
      this.lastRoute = res.headers.get('x-echo-route-used');
      const body = await res.json().catch(() => null) as (GatewayResult & { error?: { code: string; message: string } }) | null;
      if (res.status === 401) {
        this.token = null;
        return makeResult(req, 'unavailable', { ...base, error: { code: 'unauthorized', message: 'сессия шлюза истекла' } });
      }
      if (!res.ok || !body || typeof body.status !== 'string' || body.task_id !== req.task_id) {
        return makeResult(req, 'unavailable', {
          ...base, latency_ms: { total: Math.round(performance.now() - t0), first_token: null },
          error: { code: body?.error?.code ?? `http_${res.status}`, message: body?.error?.message ?? 'некорректный ответ шлюза' },
        });
      }
      return body;
    } catch (e) {
      if (ctx.signal.aborted) {
        // Best effort: the gateway may already be computing; a late answer is discarded by task_id anyway.
        void fetch(`${this.base}/v1/cancel`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ task_id: req.task_id }),
        }).catch(() => undefined);
        return makeResult(req, abortStatus(ctx.signal), {
          ...base, latency_ms: { total: Math.round(performance.now() - t0), first_token: null },
          error: { code: abortStatus(ctx.signal), message: abortMessage(ctx.signal) },
        });
      }
      this.token = null;
      this.st.set({ state: 'unavailable', message: `шлюз недоступен из этой страницы: ${String((e as Error)?.message ?? e)}` });
      return makeResult(req, 'unavailable', { ...base, error: { code: 'network', message: String((e as Error)?.message ?? e) } });
    }
  }
}
