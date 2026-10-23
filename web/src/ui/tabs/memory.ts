// «Память»: per-NPC memory from the core — facts with sources kept apart from opinions with confidence (Документ §10),
// promises and episodes, and the ids of known facts. Memory changes only by accepted/executed events.
import type { AppApi, Tab } from '../context.ts';
import type { MemoryEntry } from '../../core/protocol.ts';
import { factOf, labelOf, npcs } from '../../core/data.ts';
import { LAYER_RU } from '../labels.ts';
import { clock, h, num, patch, sectionTitle } from '../dom.ts';

export class MemoryTab implements Tab {
  readonly id = 'memory' as const;
  readonly label = 'Память';
  private readonly app: AppApi;
  private select!: HTMLSelectElement;
  private body!: HTMLElement;
  private lastFetch = 0;
  private lastNpc = '';

  constructor(app: AppApi) { this.app = app; }

  mount(el: HTMLElement): void {
    this.select = h('select', { id: 'sel-mem-npc', 'aria-label': 'Чья память' }, npcs.map((n) => h('option', { value: n.id, text: n.name_ru })));
    this.select.value = this.app.selectedNpc;
    this.select.addEventListener('change', () => { this.lastFetch = 0; this.render(); });
    this.body = h('div', { id: 'memory-body', class: 'stack' });
    el.append(
      h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', { text: 'Персонаж' }), this.select)),
      h('p', { class: 'note' }, 'Одна модель — шесть раздельных памятей: каждый знает только своё (с источником). Отвергнутое предложение память не меняет.'),
      this.body,
    );
  }

  render(): void {
    if (this.lastNpc !== this.app.selectedNpc) {
      this.lastNpc = this.app.selectedNpc;
      this.select.value = this.app.selectedNpc;
    }
    const now = performance.now();
    if (now - this.lastFetch < 700 && this.body.dataset.npc === this.select.value) return;
    this.lastFetch = now;
    const npc = this.select.value;
    this.body.dataset.npc = npc;
    const m = this.app.host.memory(npc);
    if (!m) return;
    const facts = m.entries.filter((e) => e.kind === 'fact');
    const opinions = m.entries.filter((e) => e.kind === 'opinion');
    const promises = m.entries.filter((e) => e.kind === 'promise');
    const episodes = m.entries.filter((e) => e.kind === 'episode');
    const sig = `${npc}|${m.entries.map((e) => e.id).join(',')}|${m.known_facts.map((f) => f.id).join(',')}`;
    const entry = (e: MemoryEntry) => h('div', { class: 'mem-item' },
      h('div', { text: e.text_ru }),
      h('div', { class: 'small faint' },
        `источник: ${e.source} · ${clock(Math.max(0, e.time_s))}${e.time_s < 0 ? ' (до начала смены)' : ''}`,
        e.confidence !== undefined ? ` · уверенность ${num(e.confidence, 2)}` : '',
        ` · важность ${num(e.importance, 2)}`));
    patch(this.body, sig, () => [
      h('div', { class: 'card' }, sectionTitle(`Известные факты (${m.known_facts.length})`),
        h('div', { class: 'fact-chips', id: 'memory-known-facts' }, m.known_facts.map((f) => h('span', {
          class: 'badge info', id: `known-${f.id}`, title: `${factOf(f.id)?.text_ru ?? ''} — ${f.source}`,
          text: f.id,
        }))),
        h('ul', { class: 'small' }, m.known_facts.map((f) => h('li', null,
          h('span', { class: 'mono', text: f.id }), ` — ${factOf(f.id)?.text_ru ?? ''} `,
          h('span', { class: 'faint', text: `(${f.source}; ${LAYER_RU[f.layer ?? ''] ?? f.layer ?? ''})` }))))),
      h('div', { class: 'mem-grid' },
        h('div', { class: 'card' }, sectionTitle(`Факты — с источником (${facts.length})`), facts.length ? facts.map(entry) : h('p', { class: 'small muted', text: 'нет' })),
        h('div', { class: 'card' }, sectionTitle(`Мнения — субъективно (${opinions.length})`), opinions.length ? opinions.map(entry) : h('p', { class: 'small muted', text: 'нет' }))),
      h('div', { class: 'mem-grid' },
        h('div', { class: 'card' }, sectionTitle(`Обещания (${promises.length})`), promises.length ? promises.map(entry) : h('p', { class: 'small muted', text: 'нет' })),
        h('div', { class: 'card' }, sectionTitle(`Эпизоды (${episodes.length})`), episodes.length ? episodes.slice(-12).map(entry) : h('p', { class: 'small muted', text: 'нет' }))),
      m.relationships ? h('p', { class: 'small muted' }, `Отношения: ${Object.entries(m.relationships).map(([k, v]) => `${labelOf(k)} ${num(v, 2)}`).join(' · ')}`) : null,
    ].filter(Boolean) as HTMLElement[]);
  }
}
