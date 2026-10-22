// Internal types of the Agent Gateway (docs/SPEC.md §7). Wire contracts with the game live in
// web/src/contracts.ts and schemas/*.json; this file only adds gateway-side structures.

import type { GatewayRequest, GatewayResult, GatewayStatus } from '../../web/src/contracts.ts';

export type { GatewayRequest, GatewayResult, GatewayStatus };

export type PrivacyProfile = 'offline' | 'hybrid' | 'online';
export type Capability = 'generate_intent' | 'generate_dialogue';
export type AdapterKind = 'mock' | 'llamacpp' | 'openai' | 'anthropic' | 'gemini' | 'openai_compat';
export type Locality = 'local' | 'remote';

export const ADAPTER_KINDS: readonly AdapterKind[] = ['mock', 'llamacpp', 'openai', 'anthropic', 'gemini', 'openai_compat'];
export const GATEWAY_VERSION = 'zero-echo.gateway.v0.1.0';

/** Provider usage normalized to one convention (see README «Учёт usage»). */
export interface NormalizedUsage {
  /** All prompt tokens, including cached ones. */
  input_tokens: number;
  /** All billed output tokens, including reasoning/thinking tokens. */
  output_tokens: number;
  /** Subset of input_tokens served from a prompt cache (cache-read price). */
  cached_input_tokens: number;
  /** Subset of input_tokens written to a prompt cache (Anthropic cache_creation; cache-write price). */
  cache_write_input_tokens: number;
  /** Subset of output_tokens spent on reasoning/thinking. */
  reasoning_tokens: number;
  /** true when the numbers come from the provider, false for gateway estimates. */
  measured: boolean;
}

export interface UpstreamError {
  code: string;
  message: string;
  retry_after_ms?: number | null;
}

/** One upstream attempt as seen by an adapter, before gateway policy (retry, deadline, cancel) applies. */
export interface AdapterOutcome {
  status: GatewayStatus;
  /** Raw model text (only fence-stripped via extractJsonCandidate); null when there is nothing usable. */
  text: string | null;
  usage: NormalizedUsage;
  finishReason: string;
  providerRevision: string | null;
  /** Time to first generated token, measured by the gateway (streaming only); null when not measured. */
  firstTokenMs: number | null;
  /** Transient failure (429/5xx/network) that a retry could fix. */
  retryable: boolean;
  error: UpstreamError | null;
}

export interface RetryConfig {
  /** 1 = no retry, 2 = at most one meaningful retry (Документ §17). */
  max_attempts: 1 | 2;
  base_backoff_ms: number;
  max_backoff_ms: number;
  /** A retry starts only when at least this much of the overall deadline is left after the backoff. */
  min_remaining_ms: number;
  /**
   * Optional cap for a non-final attempt, so a hanging provider leaves time for the single retry/fallback.
   * null = the attempt may use the whole remaining deadline.
   */
  attempt_timeout_ms: number | null;
}

export interface BreakerConfig {
  failure_threshold: number;
  cooldown_ms: number;
  max_cooldown_ms: number;
}

export interface NetworkConfig {
  /** Owner-only opt-in for self-hosted servers in a private network (never for user-supplied endpoints). */
  allow_private_network: boolean;
  /** Owner-only opt-in for plain http to a non-loopback host. */
  allow_insecure_http: boolean;
}

export interface RouteConfig {
  id: string;
  adapter: AdapterKind;
  enabled: boolean;
  locality: Locality;
  /** Base URL (scheme://host[:port][/prefix]); null for mock and for user-supplied endpoints. */
  endpoint: string | null;
  /** Pinned model id; floating aliases such as "latest" are rejected at config load. */
  model: string;
  model_revision: string | null;
  capabilities: Capability[];
  concurrency: number;
  max_queue: number;
  retry: RetryConfig;
  breaker: BreakerConfig;
  network: NetworkConfig;
  /** Explicit fallback route; used only when it is also permitted by the privacy profile. */
  fallback_route: string | null;
  /** Endpoint URL comes from the session (BYO endpoint); always validated as public https. */
  user_supplied_endpoint: boolean;
  /** Adapter-specific options, validated by the adapter. */
  options: Record<string, unknown>;
  note_ru: string | null;
}

export interface Quotas {
  requests_per_min: number;
  tokens_per_hour: number;
  cost_cap_usd: number;
}

export interface GatewayConfig {
  format: 'zero-echo.providers.v1';
  server: {
    host: string;
    port: number;
    max_body_bytes: number;
    allowed_origins: string[];
    session_ttl_s: number;
    max_sessions: number;
  };
  limits: {
    global_concurrency: number;
    global_max_queue: number;
    result_cache_ttl_s: number;
    result_cache_max: number;
    /** Reserved for serializing the answer: the upstream attempt gets deadline − margin. */
    deadline_margin_ms: number;
    max_response_bytes: number;
  };
  default_quotas: Quotas;
  privacy: {
    hybrid_remote_allowlist: string[];
    /** Remote routes allowed in the online profile; "all_enabled" = every enabled remote route. */
    online_remote_allowlist: string[] | 'all_enabled';
  };
  default_route: string;
  pricing_file: string | null;
  secrets_file: string | null;
  routes: RouteConfig[];
  /** Directory of the config file; relative paths resolve against it. */
  config_dir: string;
}

export type CapabilityState = 'supported' | 'declared' | 'unverified' | 'unsupported';

export interface ProbeResult {
  route: string;
  adapter: AdapterKind;
  adapter_version: string;
  status: 'ok' | 'degraded' | 'unavailable' | 'not_configured' | 'disabled';
  model: string;
  model_available: boolean | null;
  served_model: string | null;
  capabilities: {
    generate_intent: CapabilityState;
    generate_dialogue: CapabilityState;
    structured_output: string | null;
    thinking_control: string | null;
  };
  details: Record<string, unknown>;
  checked_at: string;
  latency_ms: number | null;
  error: UpstreamError | null;
}
