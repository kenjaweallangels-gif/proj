// Structured JSONL logging. By default NO conversation content is logged (prompts, player utterances,
// model text); only ids, statuses, timings, usage and cost. `--debug-content` adds a `content` field.
// Every line is passed through the secret redactor.

import { createWriteStream } from 'node:fs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogSink {
  write(line: string): void;
}

export interface LoggerOptions {
  sink: LogSink;
  redact: (s: string) => string;
  debugContent?: boolean;
  base?: Record<string, unknown>;
}

export class Logger {
  readonly debugContent: boolean;
  readonly #sink: LogSink;
  readonly #redact: (s: string) => string;
  readonly #base: Record<string, unknown>;

  constructor(opts: LoggerOptions) {
    this.#sink = opts.sink;
    this.#redact = opts.redact;
    this.debugContent = opts.debugContent ?? false;
    this.#base = opts.base ?? {};
  }

  child(fields: Record<string, unknown>): Logger {
    return new Logger({ sink: this.#sink, redact: this.#redact, debugContent: this.debugContent, base: { ...this.#base, ...fields } });
  }

  /**
   * Emits one JSON line. A `content` field (conversation text) is dropped unless debug-content is on.
   */
  log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    const { content, ...rest } = fields;
    const record: Record<string, unknown> = { ts: new Date().toISOString(), level, event, ...this.#base, ...rest };
    if (content !== undefined && this.debugContent) record.content = content;
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({ ts: record.ts, level, event, note: 'unserializable log fields' });
    }
    this.#sink.write(`${this.#redact(line)}\n`);
  }

  debug(event: string, fields?: Record<string, unknown>): void {
    this.log('debug', event, fields);
  }
  info(event: string, fields?: Record<string, unknown>): void {
    this.log('info', event, fields);
  }
  warn(event: string, fields?: Record<string, unknown>): void {
    this.log('warn', event, fields);
  }
  error(event: string, fields?: Record<string, unknown>): void {
    this.log('error', event, fields);
  }
}

export function stdoutSink(): LogSink {
  return { write: (line) => process.stdout.write(line) };
}

export function fileSink(path: string): LogSink {
  const stream = createWriteStream(path, { flags: 'a', mode: 0o600 });
  return { write: (line) => stream.write(line) };
}

/** In-memory sink used by tests to assert on emitted lines. */
export class MemorySink implements LogSink {
  readonly lines: string[] = [];
  write(line: string): void {
    this.lines.push(line);
  }
  text(): string {
    return this.lines.join('');
  }
  events(): Record<string, unknown>[] {
    return this.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  }
}

export const nullSink: LogSink = { write: () => {} };
