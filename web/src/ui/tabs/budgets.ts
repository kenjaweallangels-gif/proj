// «Бюджеты»: GPU-time and VRAM budgets from data/profiles.json — planned figures for the RTX 3060 target, NOT
// measurements (Документ §5–§6). Measured per-pass GPU times, when timestamp-query works, are shown next to the plan.
import type { AppApi, Tab } from '../context.ts';
import { profiles } from '../../core/data.ts';
import { h, num, patch, sectionTitle, table } from '../dom.ts';

const COLUMN_RU: Record<string, string> = { llm_cpu: 'LLM на CPU', llm_gpu_small: 'малая LLM на GPU' };

export class BudgetsTab implements Tab {
  readonly id = 'budgets' as const;
  readonly label = 'Бюджеты';
  private readonly app: AppApi;
  private gpu!: HTMLElement;
  private profile!: HTMLElement;

  constructor(app: AppApi) { this.app = app; }

  mount(el: HTMLElement): void {
    const vram = profiles.vram_budget_gib;
    const totals = vram.columns.map((_, i) => vram.rows.reduce((a, r) => a + r.values[i], 0));
    this.gpu = h('div', { id: 'budget-gpu' });
    this.profile = h('div', { id: 'budget-profile' });
    el.append(
      h('div', { class: 'notice warn' }, h('span', { class: 'notice-text', text: `План, а не измерение. ${profiles.note_ru}` })),
      h('div', null, sectionTitle('Время GPU на кадр, профиль N60 (план)'), this.gpu),
      h('div', null, sectionTitle('VRAM, ГиБ — RTX 3060 12 GB (план)'),
        table(['Статья', ...vram.columns.map((c) => [COLUMN_RU[c] ?? c, 'num'] as [string, string])],
          vram.rows.map((r) => [r.label_ru, ...r.values.map((v) => num(v, 2))]),
          ['Итого', ...totals.map((t) => num(t, 2))])),
      h('p', { class: 'small muted', text: 'Свободную VRAM браузер не сообщает: GPU-гейт ядра считает её неизвестной и запрещает GPU-генерацию (Документ §7, §11).' }),
      h('div', null, sectionTitle('Параметры выбранного профиля'), this.profile),
    );
  }

  render(): void {
    const frames = this.app.host.frames;
    const measured = new Map<string, number[]>();
    for (const f of frames.slice(-120)) for (const [k, v] of Object.entries(f.passes ?? {})) {
      const list = measured.get(k) ?? [];
      list.push(v);
      measured.set(k, list);
    }
    const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const soft = this.app.adapter()?.isSoftware;
    const rows = profiles.gpu_budget_n60_ms;
    const total = rows.reduce((a, r) => a + r.ms, 0);
    patch(this.gpu, `${[...measured.keys()].join()}|${Math.floor(frames.length / 30)}|${soft}`, () => [
      table(['Группа проходов', ['План, мс', 'num'], ['Замер (медиана), мс', 'num']],
        rows.map((r) => {
          const m = measured.get(r.group);
          return [r.label_ru, num(r.ms, 1), m?.length ? `${num(median(m), 2)}${soft ? ' (не замер: CPU)' : ''}` : 'нет данных'];
        }),
        ['Итого (бюджет кадра 16,67 мс)', num(total, 1), '']),
      h('p', { class: 'small muted', text: soft ? 'Адаптер программный (SwiftShader): времена проходов показывают только, что timestamp-query работает.' : 'Замер — медиана по последним кадрам с timestamp-query; без него — «нет данных».' }),
    ]);
    const p = this.app.profile();
    patch(this.profile, p.id, () => [table(['Параметр', 'Значение'], [
      ['Профиль', p.label_ru],
      ['Вывод', `${p.output[0]}×${p.output[1]}`],
      ['Масштаб рендера', `${num(p.render_scale, 3)}${p.dynamic_resolution ? ` (динамически ${p.dynamic_resolution.min_scale}…${p.dynamic_resolution.max_scale})` : ''}`],
      ['Цель', `${p.target_fps} FPS`],
      ['LLM по умолчанию', p.llm_default],
      ...Object.entries(p.render).map(([k, v]) => [k, String(v)] as [string, string]),
    ])]);
  }
}
