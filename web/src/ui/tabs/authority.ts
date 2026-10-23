// «Intent Authority»: every verdict with its seven steps (format → pending → revision → validity → reserve → execute →
// record), the RAW proposal text exactly as the executor returned it, the provider status and the fallback trace.
import type { AppApi, Tab } from '../context.ts';
import type { VerdictRecord } from '../../agent/host.ts';
import type { CoreVerdict } from '../../core/protocol.ts';
import { actionLabel, labelOf } from '../../core/data.ts';
import { providerRu, reasonRu, STATUS_RU } from '../labels.ts';
import { clock, h, kv, patch, secs, table, verdictBadge } from '../dom.ts';

const STEP_RU: Record<string, string> = {
  format: 'формат', pending: 'ожидание', revision: 'ревизия', validity: 'допустимость', reserve: 'резерв', execute: 'исполнение', record: 'запись',
};

type Filter = 'all' | 'problems' | 'accepted';

export class AuthorityTab implements Tab {
  readonly id = 'authority' as const;
  readonly label = 'Intent Authority';
  private readonly app: AppApi;
  private list!: HTMLElement;
  private summary!: HTMLElement;
  private filter: Filter = 'all';
  private readonly open = new Set<string>();
  private filterBtns: HTMLButtonElement[] = [];

  constructor(app: AppApi) { this.app = app; }

  mount(el: HTMLElement): void {
    const mk = (id: Filter, text: string) => {
      const b = h('button', { class: 'btn btn-sm', type: 'button', id: `auth-filter-${id}`, 'aria-pressed': String(this.filter === id), text });
      b.addEventListener('click', () => { this.filter = id; for (const x of this.filterBtns) x.setAttribute('aria-pressed', String(x === b)); this.render(); });
      this.filterBtns.push(b);
      return b;
    };
    this.summary = h('div', { id: 'auth-summary', class: 'small' });
    this.list = h('div', { id: 'auth-list' });
    el.append(
      h('p', { class: 'note' }, 'Модель предлагает — игра проверяет — мир меняется только после принятия и фактического выполнения. Любой отказ сразу заменяется допустимым поведением обычного игрового ИИ (fallback).'),
      h('div', { class: 'filters' }, mk('all', 'Все'), mk('problems', 'Отказы и fallback'), mk('accepted', 'Принятые')),
      this.summary,
      this.list,
    );
  }

  private visible(): VerdictRecord[] {
    const all = this.app.host.verdicts;
    if (this.filter === 'accepted') return all.filter((v) => v.status === 'accepted' || v.status === 'awaiting_player');
    if (this.filter === 'problems') return all.filter((v) => v.fallbackUsed || !['accepted', 'awaiting_player'].includes(v.status));
    return all;
  }

  render(): void {
    const all = this.app.host.verdicts;
    const rejected = all.filter((v) => ['rejected', 'stale', 'expired', 'duplicate'].includes(v.status)).length;
    const fb = all.filter((v) => v.fallbackUsed).length;
    this.summary.textContent = `Вердиктов: ${all.length} · отклонено/устарело: ${rejected} · с fallback: ${fb}`;
    const items = this.visible().slice(0, 120);
    patch(this.list, `${this.filter}|${items.map((v) => v.key).join(',')}`, () => items.length
      ? items.map((v) => this.item(v))
      : [h('p', { class: 'muted small', text: 'Пока нет вердиктов: дождитесь инициативы экипажа или скажите что-нибудь в «Диалоге».' })]);
  }

  private item(v: VerdictRecord): HTMLElement {
    const d = h('details', { class: 'verdict', id: `verdict-${v.key.replace(/[^a-z0-9-]/gi, '_')}`, open: this.open.has(v.key) },
      h('summary', null,
        h('span', { class: 'faint mono', text: clock(v.simT) }),
        h('b', { text: labelOf(v.actor) }),
        verdictBadge(v.status),
        h('span', { text: v.action ? actionLabel(v.action) : '—' }),
        h('span', { class: 'faint small', text: `${providerRu(v.provider)}${v.origin === 'decide' ? '' : ` · ${v.taskId}`}` }),
        v.fallbackUsed ? h('span', { class: 'badge warn', text: `fallback: ${reasonRu(v.fallbackReason)}` }) : null),
      h('div', { class: 'body' }, this.body(v)));
    d.addEventListener('toggle', () => { if (d.open) this.open.add(v.key); else this.open.delete(v.key); });
    return d;
  }

  private body(v: VerdictRecord): HTMLElement[] {
    const out: HTMLElement[] = [];
    out.push(kv([
      ['Запрос', h('span', { class: 'mono', text: v.taskId || '—' })],
      ['Источник', v.origin === 'submit' ? 'ответ исполнителя' : v.origin === 'decide' ? 'решение Алекса по плану' : 'ядро (без исполнителя)'],
      ['Исполнитель', `${providerRu(v.provider)}${v.model ? ` · ${v.model}` : ''}${v.backend ? ` · полоса ${v.backend}` : ''}`],
      ['Статус исполнителя', v.providerStatus ? (STATUS_RU[v.providerStatus] ?? v.providerStatus) : '—'],
      ['Статус вердикта', verdictBadge(v.status)],
      ['Причина fallback', reasonRu(v.fallbackReason)],
      ['Задержка', v.latency ? `готово ${secs(v.latency.total)}${v.latency.first_token != null ? ` · первый токен ${secs(v.latency.first_token)}` : ''}${v.latency.queue != null ? ` · очередь ${secs(v.latency.queue)}` : ''}` : '—'],
      ['Ошибка', v.error ? `${v.error.code}: ${v.error.message}` : '—'],
      ['Примечание', v.note ?? '—'],
    ]));
    if (v.verdict) {
      out.push(this.steps(v.verdict.steps, 'Семь шагов проверки'));
      if (v.verdict.reasons.length) out.push(h('div', { class: 'small' }, h('span', { class: 'muted', text: 'Причины: ' }), h('span', { class: 'mono', text: v.verdict.reasons.join(', ') })));
      if (v.verdict.proposal) out.push(h('div', null, h('div', { class: 'small muted', text: 'Разобранное предложение (после шага 1)' }), h('pre', { class: 'code wrap', text: JSON.stringify(v.verdict.proposal, null, 1) })));
      if (v.verdict.fallback) out.push(this.fallback(v.verdict));
      if (v.verdict.plan_id || v.verdict.world_task_id) out.push(h('div', { class: 'small muted', text: `план: ${v.verdict.plan_id ?? '—'} · задача мира: ${v.verdict.world_task_id ?? '—'}` }));
    } else {
      out.push(h('p', { class: 'small muted', text: 'Ядро применило fallback само (срок в очереди, отмена, вытеснение или авария); исполнитель не вызывался, шаги см. в журнале.' }));
    }
    if (v.origin === 'submit') {
      out.push(h('div', null,
        h('div', { class: 'small muted', text: 'Сырой текст исполнителя (proposal_text) — проверяется ядром строго, без «ремонта»' }),
        h('pre', { class: 'code wrap', text: v.rawText === null || v.rawText === undefined ? '(нет текста)' : v.rawText.length > 4000 ? `${v.rawText.slice(0, 4000)}… (${v.rawText.length} символов)` : v.rawText })));
    }
    return out;
  }

  private steps(steps: CoreVerdict['steps'], title: string): HTMLElement {
    return h('div', null,
      h('div', { class: 'small muted', text: title }),
      table(['№', 'Шаг', 'Итог', 'Подробности'], steps.map((s) => [
        String(s.step),
        `${STEP_RU[s.name] ?? s.name}`,
        s.skipped ? h('span', { class: 'step-skip', text: 'пропущен' }) : s.ok ? h('span', { class: 'step-ok', text: 'пройден' }) : h('span', { class: 'step-fail', text: 'отказ' }),
        s.detail,
      ])));
  }

  private fallback(v: CoreVerdict): HTMLElement {
    const f = v.fallback!;
    return h('div', { class: 'card stack' },
      h('div', { class: 'row' }, h('b', { text: 'Fallback обычного игрового ИИ' }), verdictBadge(f.status),
        f.proposal ? h('span', { text: `${actionLabel(f.proposal.action)}${f.proposal.target_id ? ` — ${labelOf(f.proposal.target_id)}` : ''}` }) : null),
      this.steps(f.steps, 'Те же семь шагов для предложения fallback'));
  }
}
