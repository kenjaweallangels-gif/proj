// Adapter registry. One instance per adapter kind per gateway (adapters keep small per-route state,
// e.g. SDK clients and Gemini schema-mode downgrades).

import { AnthropicAdapter } from './anthropic.ts';
import { GeminiAdapter } from './gemini.ts';
import { LlamaCppAdapter } from './llamacpp.ts';
import { MockAdapter } from './mock.ts';
import { OpenAIResponsesAdapter } from './openai.ts';
import { OpenAICompatAdapter } from './openai_compat.ts';
import type { ProviderAdapter } from './common.ts';
import type { AdapterKind, RouteConfig } from '../types.ts';

export interface AdapterSet {
  mock: MockAdapter;
  llamacpp: LlamaCppAdapter;
  openai: OpenAIResponsesAdapter;
  anthropic: AnthropicAdapter;
  gemini: GeminiAdapter;
  openai_compat: OpenAICompatAdapter;
}

export function createAdapters(): AdapterSet {
  return {
    mock: new MockAdapter(),
    llamacpp: new LlamaCppAdapter(),
    openai: new OpenAIResponsesAdapter(),
    anthropic: new AnthropicAdapter(),
    gemini: new GeminiAdapter(),
    openai_compat: new OpenAICompatAdapter(),
  };
}

export function adapterFor(set: AdapterSet, kind: AdapterKind): ProviderAdapter {
  return set[kind];
}

const validators = createAdapters();

/** Adapter-specific validation of `route.options` (used by the config loader). */
export function validateAdapterOptions(route: RouteConfig): string[] {
  return validators[route.adapter].validateOptions(route.options);
}
