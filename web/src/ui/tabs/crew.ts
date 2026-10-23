// «Экипаж»: six NPC cards (role, zone, activity, fatigue, trust, current task); click → dialogue + camera close-up.
import type { AppApi, Tab } from '../context.ts';
import { actionLabel, labelOf, npcs, zoneName } from '../../core/data.ts';
import { ACTIVITY_RU, PHASE_RU } from '../labels.ts';
import { h, meter, num, patch } from '../dom.ts';

export class CrewTab implements Tab {
  readonly id = 'crew' as const;
  readonly label = 'Экипаж';
  private readonly app: AppApi;
  private grid!: HTMLElement;

  constructor(app: AppApi) { this.app = app; }

  mount(el: HTMLElement): void {
    this.grid = h('div', { class: 'crew-grid', id: 'crew-grid' });
    el.append(
      h('p', { class: 'note' }, 'Нажмите на карточку, чтобы открыть диалог и крупный план. Усталость и доверие считает игровая симуляция, а не модель.'),
      this.grid,
    );
  }

  render(): void {
    const s = this.app.host.snapshot;
    const tasks = new Map(s.tasks.map((t) => [t.id, t]));
    const plans = s.plans.filter((p) => p.state === 'awaiting_player');
    const rows = npcs.map((n) => {
      const a = s.actors.find((x) => x.id === n.id);
      const t = a?.task_id ? tasks.get(a.task_id) : undefined;
      return { n, a, t, plan: plans.find((p) => p.actor === n.id) };
    });
    const sig = JSON.stringify(rows.map((r) => [r.a?.zone, r.a?.target_zone, r.a?.activity, num(r.a?.fatigue, 2), num(r.a?.trust_player, 2),
      r.t?.id, r.t ? Math.round(r.t.progress * 50) : 0, r.t?.phase, r.plan?.plan_id])) + this.app.selectedNpc;
    patch(this.grid, sig, () => rows.map(({ n, a, t, plan }) => {
      const fatigue = a?.fatigue ?? 0;
      const zone = a?.target_zone && a.target_zone !== a.zone ? `${zoneName(a.zone)} → ${zoneName(a.target_zone)}` : zoneName(a?.zone);
      const taskLine = t
        ? `${actionLabel(t.action)}${t.target ? ` — ${labelOf(t.target)}` : ''}${t.companion && t.companion !== n.id ? ` · напарник: ${labelOf(t.companion)}` : t.companion === n.id ? ` · помогает: ${labelOf(t.actor)}` : ''} · ${PHASE_RU[t.phase ?? ''] ?? t.phase ?? ''}`
        : 'нет задачи';
      const card = h('button', {
        class: 'card crew-card', type: 'button', id: `crew-card-${n.id}`,
        'aria-current': this.app.selectedNpc === n.id ? 'true' : 'false',
        'aria-label': `${n.name_ru}, ${n.role_ru}: открыть диалог`,
      },
      h('div', { class: 'crew-head' },
        h('span', { class: 'npc-dot', vars: { '--npc': `rgb(${n.color.map((c) => Math.round(c * 255)).join(',')})` } }),
        h('span', { class: 'crew-name', text: n.name_ru }),
        plan ? h('span', { class: 'badge accent', text: 'ждёт решения' }) : null,
        a?.busy ? h('span', { class: 'badge', text: 'занят' }) : null),
      h('div', { class: 'crew-role', text: n.role_ru }),
      h('div', { class: 'crew-line' }, h('span', { class: 'muted', text: 'Где: ' }), zone),
      h('div', { class: 'crew-line' }, h('span', { class: 'muted', text: 'Сейчас: ' }), ACTIVITY_RU[a?.activity ?? 'idle'] ?? a?.activity ?? '—'),
      meter(fatigue, 'усталость', fatigue > 0.7 ? 'bad' : fatigue > 0.55 ? 'warn' : 'ok'),
      meter(a?.trust_player ?? 0, 'доверие', 'info'),
      h('div', { class: 'crew-line' }, h('span', { class: 'muted', text: 'Задача: ' }), taskLine),
      t ? meter(t.progress, 'ход', 'info') : null);
      card.addEventListener('click', () => this.app.selectNpc(n.id, { openDialogue: true, focusCamera: true }));
      return card;
    }));
  }
}
