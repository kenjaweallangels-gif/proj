// Typed wrapper over the Echo core WebAssembly module (docs/SPEC.md §1). One entry point: echo_call(core, json).
// Every response that carries `events` is forwarded to the event sink exactly once (the core hands each event out
// once, through whichever command response comes first), so the host keeps one ordered journal.
import createEchoCore, { type EchoCoreModule } from 'echo-core-wasm';
import type { CoreEvent, InitResponse } from './protocol.ts';
import { buildInitData } from './data.ts';

export class EchoCoreError extends Error {
  readonly code: string;
  readonly cmd: string;
  constructor(cmd: string, code: string, message: string) {
    super(`${cmd}: ${code} — ${message}`);
    this.name = 'EchoCoreError';
    this.code = code;
    this.cmd = cmd;
  }
}

export interface CoreCaller {
  call<T>(cmd: string, args?: Record<string, unknown>): T;
}

type EventSink = (events: CoreEvent[]) => void;

export class EchoCore implements CoreCaller {
  private readonly module: EchoCoreModule;
  private handle: number;
  private sink: EventSink | null = null;
  /** Wall time spent inside echo_call (ms), for the honest «стоимость ядра» line in the metrics tab. */
  callMs = 0;
  calls = 0;

  private constructor(module: EchoCoreModule) {
    this.module = module;
    this.handle = module._echo_create();
  }

  /** Instantiates the WASM module (inlined, no network) and an empty core. */
  static async create(): Promise<EchoCore> {
    const module = await createEchoCore();
    return new EchoCore(module);
  }

  /** Loads the D0 data and returns the init summary. */
  init(seed?: number): InitResponse {
    return this.call<InitResponse>('init', { data: buildInitData(), ...(seed !== undefined ? { seed } : {}) });
  }

  onEvents(sink: EventSink | null): void {
    this.sink = sink;
  }

  /** Raw call: returns the parsed response object, `ok:false` included. */
  raw(request: Record<string, unknown> | string): Record<string, unknown> {
    if (!this.handle) throw new EchoCoreError(typeof request === 'string' ? 'raw' : String(request.cmd), 'destroyed', 'ядро уничтожено');
    const text = typeof request === 'string' ? request : JSON.stringify(request);
    const m = this.module;
    const t0 = performance.now();
    const ptr = m.stringToNewUTF8(text);
    try {
      return JSON.parse(m.UTF8ToString(m._echo_call(this.handle, ptr))) as Record<string, unknown>;
    } finally {
      m._free(ptr);
      this.callMs += performance.now() - t0;
      this.calls++;
    }
  }

  /** Typed call: throws EchoCoreError on `ok:false`; forwards `events` to the sink. */
  call<T>(cmd: string, args: Record<string, unknown> = {}): T {
    const res = this.raw({ cmd, ...args });
    if (res.ok !== true) {
      const err = (res.error ?? {}) as { code?: string; message?: string };
      throw new EchoCoreError(cmd, err.code ?? 'unknown', err.message ?? 'нет описания ошибки');
    }
    if (cmd !== 'events' && Array.isArray(res.events) && res.events.length && this.sink) {
      try { this.sink(res.events as CoreEvent[]); } catch (e) { console.error('[core] event sink failed', e); }
    }
    return res as T;
  }

  destroy(): void {
    if (!this.handle) return;
    this.module._echo_destroy(this.handle);
    this.handle = 0;
  }
}
