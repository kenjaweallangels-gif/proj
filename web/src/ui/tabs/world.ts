// «Мир»: resources (amount/reserved), sensors with the three layers of Документ §13 (instrument reading, crew
// interpretation, physical truth — the last only in the debug view), doors and sealed zones, tasks, director, biography.
import type { AppApi, Tab } from '../context.ts';
import { actionLabel, factOf, labelOf, npcs, zoneName } from '../../core/data.ts';
import { DOOR_STATE_RU, LAYER_RU, PHASE_RU, TASK_STATE_RU } from '../labels.ts';
import { h, meter, num, patch, sectionTitle, table } from '../dom.ts';

export class WorldTab implements Tab {
  readonly id = 'world' as const;
  readonly label = 'Мир';
  private readonly app: AppApi;
  private resources!: HTMLElement;
  private sensors!: HTMLElement;
  private doors!: HTMLElement;
  private tasks!: HTMLElement;
  private director!: HTMLElement;
  private bio!: HTMLElement;
  private saveInfo!: HTMLElement;
  private interpretations = new Map<string, { npc: string; fact: string; source: string; layer: string }[]>();
  private lastInterp = 0;

  constructor(app: AppApi) { this.app = app; }

  mount(el: HTMLElement): void {
    const truth = h('input', { type: 'checkbox', id: 'chk-truth' });
    truth.addEventListener('change', () => { this.app.host.setDebugTruth(truth.checked); this.render(); });
    this.resources = h('div', { id: 'world-resources' });
    this.sensors = h('div', { id: 'world-sensors', class: 'stack' });
    this.doors = h('div', { id: 'world-doors' });
    this.tasks = h('div', { id: 'world-tasks' });
    this.director = h('div', { id: 'world-director' });
    this.bio = h('div', { id: 'world-bio' });
    this.saveInfo = h('span', { class: 'small muted', id: 'save-info' });
    const save = h('button', { class: 'btn btn-sm', type: 'button', id: 'btn-save', text: 'Сохранить смену' });
    save.addEventListener('click', () => { this.app.notice(`Сохранение: ${this.app.host.saveToStorage()}`, 'info'); this.render(); });
    const load = h('button', { class: 'btn btn-sm', type: 'button', id: 'btn-load', text: 'Загрузить сохранение' });
    load.addEventListener('click', () => { this.app.notice(`Загрузка: ${this.app.host.loadFromStorage()}`, 'info'); this.app.refresh(); });
    const restart = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', id: 'btn-restart', text: 'Начать смену заново' });
    restart.addEventListener('click', () => { this.app.host.restart(); this.app.notice('Смена D0 начата заново', 'info'); this.app.refresh(); });
    el.append(
      h('div', null, sectionTitle('Ресурсы колонии'), this.resources),
      h('div', null,
        sectionTitle('Датчики: три слоя'),
        h('label', { class: 'switch' }, truth, 'Отладка: показать физическую истину (игроку и NPC недоступна)'),
        h('p', { class: 'note' }, 'Прибор показывает то, что видят все; интерпретация — что знает экипаж (с источником); истина меняется только физикой мира, директор её не трогает.'),
        this.sensors),
      h('div', null, sectionTitle('Двери и загерметизированные зоны'), this.doors),
      h('div', null, sectionTitle('Задачи'), this.tasks),
      h('div', null, sectionTitle('Директор'), this.director),
      h('div', null, sectionTitle('Биография места'), this.bio),
      h('div', { class: 'card stack' }, sectionTitle('Сохранение'),
        h('p', { class: 'small muted', text: 'При скрытии вкладки смена ставится на паузу и сохраняется в браузере (если хранилище доступно). Сохраняются журнал событий, память с источниками, принятые намерения; не сохраняется KV-cache моделей.' }),
        h('div', { class: 'row' }, save, load, restart, this.saveInfo)),
    );
  }

  private refreshInterpretations(): void {
    const now = performance.now();
    if (now - this.lastInterp < 1000) return;
    this.lastInterp = now;
    const map = new Map<string, { npc: string; fact: string; source: string; layer: string }[]>();
    for (const n of npcs) {
      const m = this.app.host.memory(n.id);
      for (const f of m?.known_facts ?? []) {
        const def = factOf(f.id);
        if (!def) continue;
        for (const about of def.about) {
          let list = map.get(about);
          if (!list) { list = []; map.set(about, list); }
          list.push({ npc: n.id, fact: f.id, source: f.source, layer: def.layer });
        }
      }
    }
    this.interpretations = map;
  }

  render(): void {
    const host = this.app.host;
    const s = host.snapshot;
    patch(this.resources, JSON.stringify(s.resources.map((r) => [r.amount, r.reserved])), () => [table(
      ['Ресурс', ['Запас', 'num'], ['Резерв', 'num'], ['Доступно', 'num'], 'Ед.'],
      s.resources.map((r) => [r.name_ru, num(r.amount, 1), num(r.reserved, 1), num(r.amount - r.reserved, 1), r.unit]),
    )]);

    this.refreshInterpretations();
    const sensorSig = JSON.stringify(s.sensors) + host.debugTruth + [...this.interpretations.values()].reduce((a, l) => a + l.length, 0);
    patch(this.sensors, sensorSig, () => s.sensors.map((sn) => {
      const interp = (this.interpretations.get(sn.id) ?? []);
      const byFact = new Map<string, string[]>();
      for (const i of interp) {
        const list = byFact.get(i.fact) ?? [];
        list.push(labelOf(i.npc));
        byFact.set(i.fact, list);
      }
      const reading = `${num(sn.reading.value, 1)} ${sn.unit} · ${sn.reading.trend === 'falling' ? 'падает' : sn.reading.trend === 'rising' ? 'растёт' : sn.reading.trend === 'stable' ? 'стабильно' : sn.reading.trend}`;
      return h('div', { class: 'card', id: `sensor-${sn.id}` },
        h('div', { class: 'row' }, h('b', { text: sn.name_ru }), h('span', { class: 'muted small', text: zoneName(sn.zone) }),
          sn.fault ? h('span', { class: 'badge bad', text: 'тревога' }) : h('span', { class: 'badge ok', text: 'норма' })),
        h('div', { class: 'layers' },
          h('div', { class: 'layer' }, h('div', { class: 'layer-name', text: '1 · прибор' }), reading),
          h('div', { class: 'layer' }, h('div', { class: 'layer-name', text: '2 · интерпретация экипажа' }),
            byFact.size ? [...byFact.entries()].map(([fid, who]) => h('div', { class: 'small' },
              h('span', { text: factOf(fid)?.text_ru ?? fid }),
              h('span', { class: 'faint', text: ` — ${who.join(', ')} (${LAYER_RU[factOf(fid)?.layer ?? ''] ?? ''})` })))
              : h('span', { class: 'faint', text: 'ничего не известно' })),
          host.debugTruth
            ? h('div', { class: 'layer truth' }, h('div', { class: 'layer-name', text: '3 · физическая истина (отладка)' }),
              sn.truth ? `${num(sn.truth.value, 1)} ${sn.unit} · ${sn.truth.trend === 'stable' ? 'стабильно' : sn.truth.trend}` : '—',
              sn.fault_id ? h('div', { class: 'small faint', text: `неисправность: ${sn.fault_id}` }) : null,
              sn.distortion ? h('div', { class: 'small faint', text: `искажение директора: ${sn.distortion}` }) : null)
            : h('div', { class: 'layer truth' }, h('div', { class: 'layer-name', text: '3 · физическая истина' }), h('span', { class: 'faint', text: 'скрыта — включите отладку' }))));
    }));

    const sealed = s.zones.filter((z) => z.sealed);
    patch(this.doors, JSON.stringify(s.doors.map((d) => d.state)) + sealed.map((z) => z.id).join(), () => [
      sealed.length ? h('p', { class: 'small' }, h('span', { class: 'badge bad', text: 'загерметизировано' }), ' ', sealed.map((z) => z.name_ru).join(', '))
        : h('p', { class: 'small muted', text: 'Загерметизированных зон нет.' }),
      table(['Дверь', 'Между', 'Состояние'], s.doors.map((d) => [
        h('span', { class: 'mono', text: d.id }), `${zoneName(d.a)} ↔ ${zoneName(d.b)}`,
        h('span', { class: d.state === 'sealed' ? 'badge bad' : d.state === 'closed' ? 'badge warn' : 'badge', text: DOOR_STATE_RU[d.state] ?? d.state }),
      ])),
    ]);

    patch(this.tasks, JSON.stringify(s.tasks.map((t) => [t.id, t.state, t.phase, Math.round(t.progress * 40)])), () => s.tasks.length
      ? s.tasks.map((t) => h('div', { class: 'card', id: `task-${t.id}` },
        h('div', { class: 'row' }, h('b', { text: `${labelOf(t.actor)}: ${actionLabel(t.action)}${t.target ? ` — ${labelOf(t.target)}` : ''}` }),
          t.companion ? h('span', { class: 'small muted', text: `с ${labelOf(t.companion)}` }) : null,
          h('span', { class: t.state === 'active' ? 'badge info' : t.state === 'done' ? 'badge ok' : 'badge warn', text: TASK_STATE_RU[t.state] ?? t.state }),
          t.source ? h('span', { class: 'badge', text: t.source === 'fallback' ? 'fallback' : t.source === 'player' ? 'по решению игрока' : t.source === 'agent_accepted' ? 'агент' : t.source }) : null),
        t.state === 'active' ? meter(t.progress, PHASE_RU[t.phase ?? ''] ?? 'ход', 'info') : null))
      : [h('p', { class: 'small muted', text: 'Задач нет.' })]);

    const d = s.director;
    patch(this.director, `${num(d.tension, 2)}|${d.last_event}|${Math.round(d.calm_remaining_s ?? 0)}|${(d.fired ?? []).length}`, () => [
      meter(d.tension, 'напряжение', d.tension > 0.5 ? 'bad' : d.tension > 0.3 ? 'warn' : 'ok'),
      h('p', { class: 'small muted' },
        `Последнее событие: ${d.last_event ?? 'нет'}`,
        d.calm_remaining_s ? ` · спокойное окно ещё ${num(d.calm_remaining_s, 0)} с` : '',
        (d.fired ?? []).length ? ` · сработало: ${(d.fired ?? []).join(', ')}` : ''),
      h('p', { class: 'note', text: 'Директор меняет только звук, временные искажения приборов и интерпретации свидетелей. Физические запасы и истина ему недоступны.' }),
    ]);

    patch(this.bio, s.biography.map((b) => b.detail_id + b.anchor).join(), () => s.biography.length
      ? [h('ul', { class: 'small' }, s.biography.map((b) => h('li', null, h('b', { text: zoneName(b.zone) }), `: ${b.label_ru} `, h('span', { class: 'faint mono', text: b.anchor }))))]
      : [h('p', { class: 'small muted', text: 'Пока нет деталей: они появляются из журнала модулей после реальных событий.' })]);

    this.saveInfo.textContent = (() => { const at = host.savedAt(); return at ? `последнее сохранение: ${new Date(at).toLocaleString('ru-RU')}` : 'сохранений нет'; })();
  }
}
