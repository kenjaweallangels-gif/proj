// EXPERIMENTAL in-page model on WebGPU (WebLLM, Документ §7, §10–§11). Off by default: the library and the weights are
// downloaded only after an explicit consent that states the size. The model shares the GPU with the renderer, so the
// core's GPU gate (calibration, fresh frame stats, VRAM reserve) decides whether a request may run at all.
// In this build environment CDNs are blocked: the provider reports itself unavailable — status not_run, nothing measured.
import type { GatewayRequest, GatewayResult } from '../../contracts.ts';
import { buildIntentMessages, extractJsonCandidate } from '../../../../shared/prompt.ts';
import {
  abortMessage, abortStatus, makeResult, StateHolder,
  type Provider, type ProviderContext, type ProviderState,
} from './types.ts';

/** Pinned library build (never `latest`, Документ §16) and the candidate model of Документ §10. */
export const WEBLLM_LIBRARY_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.84';
export const WEBLLM_MODEL = 'Qwen3-1.7B-q4f16_1-MLC';
/** Rough download estimate shown in the consent text (an estimate, not a measured size). */
export const WEBLLM_DOWNLOAD_RU = 'библиотека ≈6 МБ и веса модели ≈1–1,5 ГБ (оценка), с внешних серверов (CDN и хранилище моделей)';

interface ChatCompletion {
  choices: { message: { content: string | null }; finish_reason: string | null }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}
interface MlcEngine {
  chat: { completions: { create(req: Record<string, unknown>): Promise<ChatCompletion> } };
  interruptGenerate(): void;
}
interface WebLlmModule {
  CreateMLCEngine(model: string, opts: { initProgressCallback?: (p: { progress: number; text: string }) => void }): Promise<MlcEngine>;
}

export class WebLlmProvider implements Provider {
  readonly id = 'webllm' as const;
  readonly label = 'WebLLM (эксперимент)';
  readonly where = 'в странице на WebGPU — та же видеокарта, что и рендер';
  private engine: MlcEngine | null = null;
  private loading = false;
  private readonly st = new StateHolder({
    state: 'off',
    message: `выключено: нужна явная загрузка (${WEBLLM_DOWNLOAD_RU}); не проверено в этой среде (not_run)`,
  });

  backend(): 'gpu' { return 'gpu'; }
  state(): ProviderState { return this.st.get(); }
  onState(fn: () => void): void { this.st.on(fn); }
  accepts(): boolean { return this.st.get().state === 'ready'; }
  get ready(): boolean { return this.engine !== null; }

  /** Called only after the player confirmed the download in the UI. */
  async enable(): Promise<void> {
    if (this.engine || this.loading) return;
    if (!('gpu' in navigator)) {
      this.st.set({ state: 'unavailable', message: 'WebGPU недоступен в этом браузере — WebLLM не запустится' });
      return;
    }
    this.loading = true;
    this.st.set({ state: 'loading', message: `загрузка библиотеки ${WEBLLM_LIBRARY_URL}…` });
    try {
      const url = WEBLLM_LIBRARY_URL;
      const mod = await Promise.race([
        import(/* @vite-ignore */ url) as Promise<WebLlmModule>,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('таймаут 15 с')), 15000)),
      ]);
      if (typeof mod.CreateMLCEngine !== 'function') throw new Error('модуль не содержит CreateMLCEngine');
      this.st.set({ state: 'loading', message: `загрузка модели ${WEBLLM_MODEL}…` });
      this.engine = await mod.CreateMLCEngine(WEBLLM_MODEL, {
        initProgressCallback: (p) => this.st.set({ state: 'loading', message: `${WEBLLM_MODEL}: ${Math.round(p.progress * 100)}% — ${p.text}` }),
      });
      this.st.set({ state: 'ready', message: `${WEBLLM_MODEL} загружена; запросы допускает только GPU-гейт ядра` });
    } catch (e) {
      this.engine = null;
      this.st.set({
        state: 'unavailable',
        message: `WebLLM не загрузился: ${String((e as Error)?.message ?? e)} (сеть/CDN недоступны в этой среде — not_run)`,
      });
    } finally {
      this.loading = false;
    }
  }

  async generate(req: GatewayRequest, ctx: ProviderContext): Promise<GatewayResult> {
    const base = { provider: 'webllm', model: WEBLLM_MODEL };
    const engine = this.engine;
    if (!engine) return makeResult(req, 'unavailable', { ...base, error: { code: 'unavailable', message: this.st.get().message } });
    const m = buildIntentMessages(req);
    const t0 = performance.now();
    const onAbort = () => { try { engine.interruptGenerate(); } catch { /* best effort */ } };
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const r = await engine.chat.completions.create({
        messages: [{ role: 'system', content: m.system }, { role: 'user', content: m.user }],
        max_tokens: req.max_output_tokens,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });
      if (ctx.signal.aborted) throw ctx.signal.reason;
      const choice = r.choices[0];
      return makeResult(req, 'ok', {
        ...base,
        proposal_text: extractJsonCandidate(choice?.message.content ?? ''),
        usage: { input_tokens: r.usage?.prompt_tokens ?? 0, output_tokens: r.usage?.completion_tokens ?? 0, measured: Boolean(r.usage) },
        latency_ms: { total: Math.round(performance.now() - t0), first_token: null },
        finish_reason: choice?.finish_reason ?? 'stop',
      });
    } catch (e) {
      const total = Math.round(performance.now() - t0);
      if (ctx.signal.aborted) {
        return makeResult(req, abortStatus(ctx.signal), { ...base, latency_ms: { total, first_token: null }, error: { code: abortStatus(ctx.signal), message: abortMessage(ctx.signal) } });
      }
      return makeResult(req, 'unavailable', { ...base, latency_ms: { total, first_token: null }, error: { code: 'webllm_error', message: String((e as Error)?.message ?? e) } });
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  }
}
