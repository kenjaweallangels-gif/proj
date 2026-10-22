// Prices come ONLY from the pricing config (data/pricing.example.json); nothing is hard-coded in the game
// (Документ §18). Every example price is marked "fictional": true. A real price must carry
// "fictional": false plus "verified_on" and "source", checked by the owner on the release date.

import { readFileSync } from 'node:fs';
import type { NormalizedUsage } from './types.ts';

export interface PriceEntry {
  route: string;
  /** Exact pinned model id, or "*" for any model of the route. */
  model: string;
  input_per_mtok: number;
  output_per_mtok: number;
  cached_input_per_mtok: number | null;
  cache_write_per_mtok: number | null;
  fictional: boolean;
  verified_on: string | null;
  source: string | null;
  note_ru: string | null;
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

function price(v: unknown, name: string, problems: string[], optional = false): number | null {
  if (v === undefined || v === null) {
    if (!optional) problems.push(`${name}: требуется цена за 1M токенов`);
    return null;
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    problems.push(`${name}: ожидается неотрицательное число`);
    return null;
  }
  return v;
}

export class PriceBook {
  readonly entries: PriceEntry[];
  readonly source: string;

  constructor(entries: PriceEntry[], source: string) {
    this.entries = entries;
    this.source = source;
  }

  static empty(): PriceBook {
    return new PriceBook([], '(нет файла тарифов)');
  }

  static parse(raw: unknown, source: string): PriceBook {
    const problems: string[] = [];
    const obj = raw as { format?: unknown; currency?: unknown; prices?: unknown };
    if (!obj || typeof obj !== 'object') throw new PricingError(`${source}: ожидается объект`);
    if (obj.format !== 'zero-echo.pricing.v1') problems.push('format: ожидается "zero-echo.pricing.v1"');
    if (obj.currency !== 'USD') problems.push('currency: поддерживается только "USD"');
    if (!Array.isArray(obj.prices)) problems.push('prices: ожидается массив');
    const entries: PriceEntry[] = [];
    (Array.isArray(obj.prices) ? obj.prices : []).forEach((e: Record<string, unknown>, i: number) => {
      const at = `prices[${i}]`;
      if (typeof e?.route !== 'string' || typeof e?.model !== 'string') {
        problems.push(`${at}: нужны строковые route и model`);
        return;
      }
      if (typeof e.fictional !== 'boolean') problems.push(`${at}.fictional: обязательный флаг true/false`);
      const fictional = e.fictional !== false;
      if (!fictional) {
        if (typeof e.verified_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.verified_on)) problems.push(`${at}: реальный тариф требует verified_on (ГГГГ-ММ-ДД)`);
        if (typeof e.source !== 'string' || !e.source) problems.push(`${at}: реальный тариф требует source`);
      }
      entries.push({
        route: e.route,
        model: e.model,
        input_per_mtok: price(e.input_per_mtok, `${at}.input_per_mtok`, problems) ?? 0,
        output_per_mtok: price(e.output_per_mtok, `${at}.output_per_mtok`, problems) ?? 0,
        cached_input_per_mtok: price(e.cached_input_per_mtok, `${at}.cached_input_per_mtok`, problems, true),
        cache_write_per_mtok: price(e.cache_write_per_mtok, `${at}.cache_write_per_mtok`, problems, true),
        fictional,
        verified_on: typeof e.verified_on === 'string' ? e.verified_on : null,
        source: typeof e.source === 'string' ? e.source : null,
        note_ru: typeof e.note_ru === 'string' ? e.note_ru : null,
      });
    });
    if (problems.length) throw new PricingError(`тарифы ${source} отклонены:\n  - ${problems.join('\n  - ')}`);
    return new PriceBook(entries, source);
  }

  static load(path: string): PriceBook {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new PricingError(`не удалось прочитать тарифы ${path}: ${(e as Error).message}`);
    }
    return PriceBook.parse(raw, path);
  }

  lookup(route: string, model: string): PriceEntry | null {
    return this.entries.find((e) => e.route === route && e.model === model) ?? this.entries.find((e) => e.route === route && e.model === '*') ?? null;
  }
}

/** Cost of measured (or estimated) usage. Cached/cache-write tokens fall back to the input price. */
export function usageCostUsd(usage: NormalizedUsage, p: PriceEntry): number {
  const cached = Math.max(0, usage.cached_input_tokens);
  const written = Math.max(0, usage.cache_write_input_tokens);
  const plainIn = Math.max(0, usage.input_tokens - cached - written);
  const micro =
    plainIn * p.input_per_mtok +
    cached * (p.cached_input_per_mtok ?? p.input_per_mtok) +
    written * (p.cache_write_per_mtok ?? p.input_per_mtok) +
    Math.max(0, usage.output_tokens) * p.output_per_mtok;
  return micro / 1_000_000;
}

/** Worst-case cost of a request before it is sent (all input uncached, full output budget). */
export function maxRequestCostUsd(inputTokens: number, maxOutputTokens: number, p: PriceEntry): number {
  return (inputTokens * p.input_per_mtok + maxOutputTokens * p.output_per_mtok) / 1_000_000;
}

/**
 * Документ §18: price_per_hour = requests_per_hour × (input_tokens × P_in + output_tokens × P_out) / 1 000 000.
 * Reasoning tokens, when billed, belong in `outputTokens`.
 */
export function pricePerHour(args: { requestsPerHour: number; inputTokens: number; outputTokens: number; pIn: number; pOut: number }): number {
  return (args.requestsPerHour * (args.inputTokens * args.pIn + args.outputTokens * args.pOut)) / 1_000_000;
}

/** Fixed-point formatting without float noise: 0.315 → "0.315", 4.536 → "4.536", 1e-7 → "0.0000001". */
export function formatUsd(x: number, maxDecimals = 9): string {
  if (!Number.isFinite(x)) return String(x);
  const s = x.toFixed(maxDecimals).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
