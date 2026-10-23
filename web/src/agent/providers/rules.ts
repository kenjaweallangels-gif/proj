// Ordinary game AI (UtilityPolicy in the core, SPEC §5): deterministic, offline, no model at all. Its proposal goes
// through the same seven Intent Authority steps as any model answer.
import type { GatewayRequest, GatewayResult } from '../../contracts.ts';
import type { RulesProposeResponse } from '../../core/protocol.ts';
import { makeResult, type Provider, type ProviderContext, type ProviderState } from './types.ts';

export class RulesProvider implements Provider {
  readonly id = 'rules' as const;
  readonly label = 'Правила (обычный игровой ИИ)';
  readonly where = 'в странице, без модели и без сети';

  backend(): 'rules' { return 'rules'; }
  state(): ProviderState { return { state: 'ready', message: 'UtilityPolicy ядра: работает офлайн, мгновенно' }; }
  accepts(): boolean { return true; }

  async generate(req: GatewayRequest, ctx: ProviderContext): Promise<GatewayResult> {
    return this.propose(req, ctx);
  }

  /** Synchronous variant used by the host for requests that the selected provider does not take. */
  propose(req: Pick<GatewayRequest, 'task_id'>, ctx: Pick<ProviderContext, 'core'>): GatewayResult {
    const t0 = performance.now();
    const r = ctx.core.call<RulesProposeResponse>('rules_propose', { task_id: req.task_id });
    return makeResult(req, 'ok', {
      proposal_text: r.proposal_text,
      latency_ms: { total: Math.round((performance.now() - t0) * 100) / 100, first_token: null },
      provider: 'rules',
      model: 'utility-policy',
    });
  }
}
