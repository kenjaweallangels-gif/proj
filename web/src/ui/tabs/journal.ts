// «Журнал»: the core's event log (the source of truth for memory and saves) with source badges.
import type { AppApi, Tab } from '../context.ts';
import type { CoreEvent } from '../../core/protocol.ts';
import { clock, h, patch, sourceBadge, SOURCE_LABELS } from '../dom.ts';

const SOURCES = ['sim', 'player', 'agent_accepted', 'director', 'fallback'] as const;
const NOISY = new Set(['request_dispatched', 'debug_patch']);

export class JournalTab implements Tab {
  readonly id = 'journal' as const;
  readonly label = 'Журнал';
  private readonly app: AppApi;
  private list!: HTMLElement;
  private count!: HTMLElement;
  private readonly enabled = new Set<string>(SOURCES);
  private showService = false;

  constructor(app: AppApi) { this.app = app; }

  mount(el: HTMLElement): void {
    const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Источники событий' }, SOURCES.map((src) => {
      const b = h('button', { class: 'btn btn-sm', type: 'button', id: `jf-${src}`, 'aria-pressed': 'true', text: SOURCE_LABELS[src] });
      b.addEventListener('click', () => {
        if (this.enabled.has(src)) this.enabled.delete(src); else this.enabled.add(src);
        b.setAttribute('aria-pressed', String(this.enabled.has(src)));
        this.render();
      });
      return b;
    }));
    const service = h('input', { type: 'checkbox', id: 'chk-journal-service' });
    service.addEventListener('change', () => { this.showService = service.checked; this.render(); });
    this.count = h('span', { class: 'small muted', id: 'journal-count' });
    this.list = h('div', { class: 'journal-list', id: 'journal-list', role: 'log', 'aria-label': 'Журнал событий' });
    el.append(
      h('p', { class: 'note' }, 'Журнал подтверждённых событий ядра. Память NPC и сохранения строятся из него; сводки модели его не заменяют.'),
      filters,
      h('div', { class: 'row' }, h('label', { class: 'switch' }, service, 'служебные события очереди'), h('span', { class: 'grow' }), this.count),
      this.list,
    );
  }

  render(): void {
    const evs = this.app.host.events;
    const shown: CoreEvent[] = [];
    for (let i = evs.length - 1; i >= 0 && shown.length < 300; i--) {
      const e = evs[i];
      if (!this.enabled.has(String(e.source))) continue;
      if (!this.showService && NOISY.has(e.type)) continue;
      shown.push(e);
    }
    this.count.textContent = `событий в журнале: ${evs.length}`;
    const sig = `${[...this.enabled].join()}|${this.showService}|${shown[0]?.seq ?? 0}|${shown.length}`;
    patch(this.list, sig, () => shown.length ? shown.map((e) => h('div', { class: 'journal-item' },
      h('span', { class: 't', text: clock(e.t) }),
      sourceBadge(String(e.source)),
      h('span', { class: 'text', text: e.text_ru }))) : [h('p', { class: 'small muted', text: 'Нет событий для выбранных источников.' })]);
  }
}
