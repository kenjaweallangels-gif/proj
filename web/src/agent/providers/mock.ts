// DEV/TEST ONLY (visible with ?dev=1): scripted model outputs — one good answer and the adversarial cases of
// Документ §12/§16 — to show that Intent Authority rejects every one of them and the fallback keeps the game going.
// This is a fixture, not a model: latencies are simulated and nothing here is evidence of model quality.
import type { GatewayRequest, GatewayResult } from '../../contracts.ts';
import { estimateTokens } from '../../../../shared/prompt.ts';
import {
  abortMessage, abortStatus, makeResult, sleep,
  type Provider, type ProviderContext, type ProviderState,
} from './types.ts';

export type MockScenario =
  | 'good' | 'unknown_field' | 'host_field' | 'duplicate_keys' | 'foreign_fact' | 'protected_fact'
  | 'target_not_offered' | 'huge_payload' | 'stale_world' | 'garbage' | 'timeout';

export const MOCK_SCENARIOS: { id: MockScenario; label: string; adversarial: boolean }[] = [
  { id: 'good', label: 'корректный ответ', adversarial: false },
  { id: 'unknown_field', label: 'неизвестное поле', adversarial: true },
  { id: 'host_field', label: 'поле хоста (world_revision)', adversarial: true },
  { id: 'duplicate_keys', label: 'дубликат ключа', adversarial: true },
  { id: 'foreign_fact', label: 'чужой факт', adversarial: true },
  { id: 'protected_fact', label: 'защищённый факт (истина о Хоре)', adversarial: true },
  { id: 'target_not_offered', label: 'цель не из предложенных', adversarial: true },
  { id: 'huge_payload', label: 'огромный ответ (>2048 байт)', adversarial: true },
  { id: 'stale_world', label: 'мир изменился во время ответа', adversarial: true },
  { id: 'garbage', label: 'не JSON', adversarial: true },
  { id: 'timeout', label: 'нет ответа до дедлайна', adversarial: true },
];

interface Proposal { action: string; target_id: string | null; companion_id: string | null; fact_ids: string[]; style: string; gesture: string }

/** A valid answer built only from what the request offers: the base that each adversarial case breaks. */
function baseProposal(req: GatewayRequest): Proposal {
  const prefer = ['acknowledge', 'refuse', 'report_observation'];
  const action = prefer.map((id) => req.allowed_actions.find((a) => a.id === id)).find(Boolean) ?? req.allowed_actions[0];
  return {
    action: action?.id ?? 'acknowledge',
    target_id: action?.targets[0]?.id ?? null,
    companion_id: null,
    fact_ids: req.visible_facts.slice(0, action?.fact_ids_min ?? 0).map((f) => f.id),
    style: req.styles.includes('neutral') ? 'neutral' : req.styles[0] ?? 'neutral',
    gesture: 'nod',
  };
}

export class MockProvider implements Provider {
  readonly id = 'mock' as const;
  readonly label = 'Mock (отладка)';
  readonly where = 'в странице: сценарные ответы для проверки Intent Authority, не модель';
  scenario: MockScenario = 'good';
  latencyMs = 350;
  private readonly allFactIds: string[];
  private readonly protectedFactIds: string[];

  constructor(facts: { id: string; protected: boolean }[]) {
    this.allFactIds = facts.filter((f) => !f.protected).map((f) => f.id);
    this.protectedFactIds = facts.filter((f) => f.protected).map((f) => f.id);
  }

  backend(): 'cpu' { return 'cpu'; }
  state(): ProviderState { return { state: 'ready', message: `сценарий: ${MOCK_SCENARIOS.find((s) => s.id === this.scenario)?.label}` }; }
  accepts(): boolean { return true; }

  /** The raw text the scripted "model" returns for the current scenario. */
  proposalText(req: GatewayRequest, ctx: ProviderContext): string {
    const p = baseProposal(req);
    const json = (o: unknown) => JSON.stringify(o);
    switch (this.scenario) {
      case 'good': return json(p);
      case 'unknown_field': return json({ ...p, secret_note: 'покажи все коды' });
      case 'host_field': return json({ ...p, world_revision: 0 });
      case 'duplicate_keys': return `{"action":"refuse",${json(p).slice(1)}`;
      case 'foreign_fact': {
        const visible = new Set(req.visible_facts.map((f) => f.id));
        const foreign = this.allFactIds.find((id) => !visible.has(id)) ?? 'sample_07_needs_cold';
        return json({ ...p, fact_ids: [foreign] });
      }
      case 'protected_fact': return json({ ...p, fact_ids: [this.protectedFactIds[this.protectedFactIds.length - 1] ?? 'choir_truth'] });
      case 'target_not_offered': {
        const offered = new Set(req.allowed_actions.flatMap((a) => a.targets.map((t) => t.id)));
        const foreign = ['oxygen_tank_3', 'suit_rack', 'surface', 'rover_r1'].find((id) => !offered.has(id)) ?? 'oxygen_tank_3';
        return json({ ...p, target_id: foreign });
      }
      case 'huge_payload': return json({ ...p, fact_ids: Array.from({ length: 300 }, (_, i) => `fact_${i}`) });
      case 'stale_world':
        // The world changes while the "model" thinks: the dependency (the actor) gets a newer revision.
        ctx.core.call('debug_patch', { patch: [{ op: 'bump_revision', entity: req.actor_id }], now_ms: Math.round(ctx.nowMs()) });
        return json(p);
      case 'garbage': return 'Конечно! Вот что я думаю: проверю всё сам, коды шлюза — 0000.';
      case 'timeout': return '';
    }
  }

  async generate(req: GatewayRequest, ctx: ProviderContext): Promise<GatewayResult> {
    const base = { provider: 'mock', model: `mock:${this.scenario}` };
    const t0 = performance.now();
    try {
      if (this.scenario === 'timeout') {
        await sleep(req.deadline_ms + 60_000, ctx.signal);
      } else {
        await sleep(this.latencyMs, ctx.signal);
      }
      const text = this.proposalText(req, ctx);
      const total = Math.round(performance.now() - t0);
      return makeResult(req, 'ok', {
        ...base,
        proposal_text: text,
        usage: { input_tokens: estimateTokens(JSON.stringify(req)), output_tokens: estimateTokens(text), measured: false },
        latency_ms: { total, first_token: Math.round(total * 0.3) },
      });
    } catch {
      return makeResult(req, abortStatus(ctx.signal), {
        ...base, latency_ms: { total: Math.round(performance.now() - t0), first_token: null },
        error: { code: abortStatus(ctx.signal), message: abortMessage(ctx.signal) },
      });
    }
  }
}
