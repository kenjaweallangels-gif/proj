// OpenAI-style /v1/chat/completions caller shared by the llama.cpp and OpenAI-compatible adapters.
// Streaming (SSE) is used to measure real time-to-first-token; the answer is still returned only when the
// stream completes — a partial stream is never applied (Документ §16).

import { NetError } from '../net.ts';
import { chatCompletionUsage, finalizeText, httpErrorOutcome, MAX_PROPOSAL_CHARS, netErrorOutcome, nonNeg, outcome, safeJson, SseParser, truncate, truncatedOutcome } from './common.ts';
import type { AdapterContext, PromptBundle } from './common.ts';
import { estimatedUsage } from './common.ts';
import type { AdapterOutcome, NormalizedUsage } from '../types.ts';

export interface ChatCallOptions {
  path: string;
  body: Record<string, unknown>;
  stream: boolean;
  headers: Record<string, string>;
  prompt: PromptBundle;
  /** Extracts cached prompt tokens from engine-specific fields (llama.cpp `timings.cache_n`). */
  cachedFromTimings?: boolean;
}

interface Accumulated {
  text: string;
  finishReason: string | null;
  usage: unknown;
  timings: Record<string, unknown> | null;
  model: string | null;
  fingerprint: string | null;
  firstTokenMs: number | null;
  streamError: { message: string; code: string } | null;
}

function readChoice(json: Record<string, unknown>, acc: Accumulated, streaming: boolean, now: () => number): void {
  if (typeof json.model === 'string') acc.model = json.model;
  if (typeof json.system_fingerprint === 'string') acc.fingerprint = json.system_fingerprint;
  if (json.usage) acc.usage = json.usage;
  if (json.timings && typeof json.timings === 'object') acc.timings = json.timings as Record<string, unknown>;
  if (json.error && typeof json.error === 'object') {
    const e = json.error as Record<string, unknown>;
    acc.streamError = { message: String(e.message ?? 'stream error'), code: String(e.code ?? e.type ?? 'stream_error') };
  }
  const choices = Array.isArray(json.choices) ? (json.choices as Record<string, unknown>[]) : [];
  const c = choices[0];
  if (!c) return;
  const part = (streaming ? c.delta : c.message) as Record<string, unknown> | undefined;
  const content = part && typeof part.content === 'string' ? part.content : '';
  if (content) {
    if (acc.firstTokenMs === null && streaming) acc.firstTokenMs = now();
    acc.text += content;
  }
  if (typeof c.finish_reason === 'string') acc.finishReason = c.finish_reason;
}

/** Performs one chat-completions call and normalizes the result. */
export async function callChatCompletions(ctx: AdapterContext, opts: ChatCallOptions): Promise<AdapterOutcome> {
  const http = ctx.http;
  if (!http) return outcome('unavailable', { usage: estimatedUsage(opts.prompt, null), finishReason: 'no_endpoint', error: { code: 'no_endpoint', message: 'endpoint не настроен' } });
  const started = ctx.clock.now();
  const acc: Accumulated = { text: '', finishReason: null, usage: null, timings: null, model: null, fingerprint: null, firstTokenMs: null, streamError: null };
  const elapsed = () => Math.round(ctx.clock.now() - started);
  const body = opts.stream ? { ...opts.body, stream: true, stream_options: { include_usage: true } } : { ...opts.body, stream: false };
  const parser = new SseParser((data) => {
    if (data.trim() === '[DONE]') return;
    const json = safeJson(data);
    if (json && typeof json === 'object') readChoice(json as Record<string, unknown>, acc, true, elapsed);
  });

  let res;
  try {
    res = await http.request({
      method: 'POST',
      url: http.url(opts.path),
      headers: { 'content-type': 'application/json', accept: opts.stream ? 'text/event-stream' : 'application/json', ...opts.headers },
      body: JSON.stringify(body),
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      onData: opts.stream ? (chunk) => parser.push(chunk) : undefined,
    });
  } catch (e) {
    const o = netErrorOutcome(e);
    // Partial streamed text is discarded on any failure.
    if (e instanceof NetError && (e.code === 'timeout' || e.code === 'aborted')) o.firstTokenMs = acc.firstTokenMs;
    return o;
  }

  if (res.status < 200 || res.status >= 300) {
    const err = safeJson(res.text) as { error?: { message?: string; code?: string | number; type?: string } } | undefined;
    const code = err?.error?.code ?? err?.error?.type;
    return httpErrorOutcome(res, ctx.clock.wallNow(), { message: err?.error?.message, code: code !== undefined ? String(code) : undefined });
  }

  const contentType = res.headers['content-type'] ?? '';
  if (opts.stream && contentType.includes('text/event-stream')) {
    parser.end();
  } else {
    const json = safeJson(res.text);
    if (!json || typeof json !== 'object') {
      return outcome('invalid_output', { usage: estimatedUsage(opts.prompt, null), finishReason: 'bad_response', error: { code: 'bad_response', message: 'ответ endpoint не является JSON' } });
    }
    readChoice(json as Record<string, unknown>, acc, false, elapsed);
  }

  const cachedFallback = opts.cachedFromTimings && acc.timings ? nonNeg(acc.timings.cache_n) : 0;
  const usage: NormalizedUsage = chatCompletionUsage(acc.usage, cachedFallback) ?? estimatedUsage(opts.prompt, acc.text);
  const revision = [acc.model, acc.fingerprint].filter(Boolean).join(' / ') || null;
  const info = { usage, finishReason: acc.finishReason ?? 'missing', providerRevision: revision, firstTokenMs: acc.firstTokenMs };

  if (acc.streamError) {
    return outcome('unavailable', { ...info, retryable: true, error: { code: acc.streamError.code, message: truncate(acc.streamError.message) } });
  }
  switch (acc.finishReason) {
    case 'stop':
    case 'eos':
      return finalizeText(acc.text, info);
    case 'length':
      return truncatedOutcome(acc.text.slice(0, MAX_PROPOSAL_CHARS), info);
    case 'content_filter':
      return outcome('refused', { ...info, error: { code: 'content_filter', message: 'ответ заблокирован фильтром содержимого провайдера' } });
    case 'tool_calls':
    case 'function_call':
      return outcome('invalid_output', { ...info, error: { code: 'unexpected_tool_call', message: 'модель вызвала инструмент, а не вернула JSON' } });
    case null:
      return outcome('invalid_output', { ...info, error: { code: 'stream_incomplete', message: 'поток завершился без finish_reason; частичный ответ не применяется' } });
    default:
      return finalizeText(acc.text, info);
  }
}
