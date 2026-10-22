// API keys live only on the server (Документ §17): environment variables ECHO_KEY_<ROUTE> or a JSON
// secrets file readable by the owner only (mode 0600). Keys are never logged, never returned, and every
// string leaving the gateway (responses, logs, errors) passes through `redact`.

import { readFileSync, statSync } from 'node:fs';

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsError';
  }
}

export type SecretSource = 'env' | 'file' | 'session';

const REDACTED = '[REDACTED]';

/** Generic credential shapes scrubbed even when the exact value is unknown (e.g. echoed by a provider). */
const GENERIC_PATTERNS: RegExp[] = [
  /\b(sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, // OpenAI/Anthropic style keys (sk-..., sk-ant-...)
  /\bAIza[0-9A-Za-z_-]{20,}/g, // Google API keys
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /("?(?:x-api-key|x-goog-api-key|api[_-]?key|authorization)"?\s*[:=]\s*"?)[^"\s,}]{6,}/gi,
];

export function envVarName(routeId: string): string {
  return `ECHO_KEY_${routeId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

export interface SecretLoadOptions {
  routeIds: string[];
  env?: NodeJS.ProcessEnv;
  file?: string | null;
}

export class SecretStore {
  readonly #keys = new Map<string, { value: string; source: SecretSource }>();
  readonly #extra = new Set<string>();

  static load(opts: SecretLoadOptions): SecretStore {
    const store = new SecretStore();
    const env = opts.env ?? process.env;
    if (opts.file) {
      let st;
      try {
        st = statSync(opts.file);
      } catch {
        throw new SecretsError(`файл секретов не найден: ${opts.file}`);
      }
      if (process.platform !== 'win32') {
        if ((st.mode & 0o077) !== 0) {
          throw new SecretsError(
            `файл секретов ${opts.file} доступен группе/другим (права ${(st.mode & 0o777).toString(8)}); выполните chmod 600 — ключи не загружены`,
          );
        }
        if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
          throw new SecretsError(`файл секретов ${opts.file} принадлежит другому пользователю — ключи не загружены`);
        }
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(opts.file, 'utf8'));
      } catch {
        throw new SecretsError(`файл секретов ${opts.file}: некорректный JSON (содержимое не выводится)`);
      }
      const keys = (parsed as { keys?: unknown }).keys;
      if (!keys || typeof keys !== 'object') throw new SecretsError(`файл секретов ${opts.file}: ожидается объект {"keys": {"<route>": "<key>"}}`);
      for (const [route, value] of Object.entries(keys as Record<string, unknown>)) {
        if (typeof value === 'string' && value.length > 0) store.#keys.set(route, { value, source: 'file' });
      }
    }
    // Environment variables override the file.
    for (const id of opts.routeIds) {
      const v = env[envVarName(id)];
      if (typeof v === 'string' && v.length > 0) store.#keys.set(id, { value: v, source: 'env' });
    }
    return store;
  }

  get(routeId: string): string | null {
    return this.#keys.get(routeId)?.value ?? null;
  }

  has(routeId: string): boolean {
    return this.#keys.has(routeId);
  }

  source(routeId: string): SecretSource | null {
    return this.#keys.get(routeId)?.source ?? null;
  }

  /** Registers an additional secret (e.g. a session BYO key) so it is redacted everywhere. */
  registerExtra(value: string): void {
    if (value.length >= 4) this.#extra.add(value);
  }

  forgetExtra(value: string): void {
    this.#extra.delete(value);
  }

  redact(text: string): string {
    if (!text) return text;
    let out = text;
    const values = [...[...this.#keys.values()].map((k) => k.value), ...this.#extra].sort((a, b) => b.length - a.length);
    for (const v of values) {
      if (v.length >= 4 && out.includes(v)) out = out.split(v).join(REDACTED);
    }
    for (const re of GENERIC_PATTERNS) {
      out = out.replace(re, (_match, prefix: unknown) => (typeof prefix === 'string' && /[:=]/.test(prefix) ? `${prefix}${REDACTED}` : REDACTED));
    }
    return out;
  }

  /** Deep-redacts every string in a JSON-like value. */
  redactValue<T>(value: T): T {
    if (typeof value === 'string') return this.redact(value) as T;
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v)) as T;
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = this.redactValue(v);
      return out as T;
    }
    return value;
  }

  toJSON(): string {
    return '[SecretStore: redacted]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return 'SecretStore[redacted]';
  }
}
