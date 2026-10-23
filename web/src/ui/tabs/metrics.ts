// «Метрики» (Документ §2, §19; SPEC §9): frame percentiles from the samples the host fed to the core, GPU timing
// availability, AI latency (first token vs ready), fallback rate by reason, invalid intents vs violations admitted,
// tokens and cost; the control route bench. Nothing here is a performance verdict on a software adapter.
import type { AppApi, Tab } from '../context.ts';
import type { MaybeSet, MetricsResponse } from '../../core/protocol.ts';
import { reasonRu } from '../labels.ts';
import { copyButton, h, ms, num, patch, pct, sectionTitle, table } from '../dom.ts';

function setRow(label: string, s: MaybeSet): (string | HTMLElement)[] {
  if (s === 'unavailable') return [label, h('span', { class: 'muted', text: 'недоступно' }), '', '', ''];
  const d = s.p99 >= 100 ? 0 : s.p99 >= 10 ? 1 : 2;
  return [label, num(s.p50, d), num(s.p95, d), num(s.p99, d), String(s.count)];
}

export class MetricsTab implements Tab {
  readonly id = 'metrics' as const;
  readonly label = 'Метрики';
  private readonly app: AppApi;
  private frame!: HTMLElement;
  private ai!: HTMLElement;
  private route!: HTMLElement;
  private routePre!: HTMLPreElement;
  private routeBtn!: HTMLButtonElement;
  private routeMode!: HTMLSelectElement;
  private last: MetricsResponse | null = null;
  private lastFetch = 0;

  constructor(app: AppApi) { this.app = app; }

  mount(el: HTMLElement): void {
    this.frame = h('div', { id: 'metrics-frame', class: 'stack' });
    this.ai = h('div', { id: 'metrics-ai', class: 'stack' });
    this.routeMode = h('select', { id: 'sel-route-mode', 'aria-label': 'Объём прогона' },
      h('option', { value: 'quick', text: 'короткий: 1 проход (на программном адаптере — 12 с)' }),
      h('option', { value: 'full', text: 'приёмка: 1 прогрев + 3 × 240 с' }));
    this.routeBtn = h('button', { class: 'btn btn-primary', type: 'button', id: 'btn-route', text: 'Контрольный маршрут' });
    this.routeBtn.addEventListener('click', () => this.app.runRoute(this.routeMode.value === 'full' ? 'full' : 'quick'));
    this.routePre = h('pre', { class: 'code', id: 'route-report', 'aria-label': 'Отчёт RouteReport (JSON)' });
    this.route = h('div', { id: 'route-status', class: 'small' });
    el.append(
      h('div', null, sectionTitle('Кадр'), this.frame),
      h('div', null, sectionTitle('ИИ и Intent Authority'), this.ai),
      h('div', { class: 'card stack' },
        sectionTitle('Контрольный маршрут (Документ §19)'),
        h('p', { class: 'small muted', text: 'Тёмный шлюз → долина → скалы → ровер → пещера → жилой модуль → разговор с Мирой → аварийный свет → горизонт. Камера и события фиксированы; на время прогона экипаж стоит в фиксированных точках (Мира у ниши A).' }),
        h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', { text: 'Объём' }), this.routeMode), this.routeBtn),
        this.route,
        h('div', { class: 'row' }, h('span', { class: 'small muted grow', text: 'RouteReport (JSON). Скачивание файлов в опубликованной странице заблокировано — скопируйте текст.' }),
          copyButton('btn-copy-route', () => this.routePre.textContent ?? '', () => this.routePre)),
        this.routePre),
    );
  }

  render(): void {
    const now = performance.now();
    if (!this.last || now - this.lastFetch > 900) {
      this.last = this.app.host.metrics();
      this.lastFetch = now;
    }
    const m = this.last;
    if (!m) return;
    const adapter = this.app.adapter();
    const mode = this.app.rendererMode();
    const frames = this.app.host.frames;
    const timed = frames.filter((f) => f.gpuMs !== null).length;
    const f = m.frame;
    patch(this.frame, JSON.stringify([f.count, f.cold.count, f.missed_deadline_ratio, f.pauses_over_33ms, f.max_pause_ms, timed > 0, mode, adapter?.isSoftware]), () => [
      adapter?.isSoftware ? h('div', { class: 'notice warn', id: 'metrics-software' }, h('span', { class: 'notice-text', text: 'Программный адаптер (SwiftShader/CPU): цифры ниже — проверка, что замер работает, а не замер производительности. 60 FPS доказывается только прогоном на целевой RTX 3060.' })) : null,
      mode === 'compat' ? h('p', { class: 'note warn', text: 'WebGPU недоступен: кадров 3D-рендера нет, метрики кадра не собираются.' }) : null,
      h('div', { class: 'stat-grid' },
        h('div', { class: 'stat' }, h('div', { class: 'label', text: 'Пропущенные сроки (>16,67 мс)' }), h('div', { class: 'value', text: pct(f.missed_deadline_ratio, 1) })),
        h('div', { class: 'stat' }, h('div', { class: 'label', text: 'Паузы >33,3 мс' }), h('div', { class: 'value', text: String(f.pauses_over_33ms) })),
        h('div', { class: 'stat' }, h('div', { class: 'label', text: 'Максимальная пауза' }), h('div', { class: 'value', text: ms(f.max_pause_ms) })),
        h('div', { class: 'stat' }, h('div', { class: 'label', text: 'GPU-время' }), h('div', { class: 'value', id: 'metric-gpu-timing', text: timed ? `timestamp-query: ${timed} кадров` : 'нет данных' }))),
      table(['Прогретые кадры, мс', ['p50', 'num'], ['p95', 'num'], ['p99', 'num'], ['n', 'num']], [
        setRow('Интервал кадра (rAF)', f.frame_interval),
        setRow('CPU кадра', f.cpu),
        setRow('GPU (timestamp)', f.gpu),
        setRow('Готовность кадра', f.frame_ready),
      ]),
      h('p', { class: 'small muted', text: `Кадры холодного старта учтены отдельно (n = ${f.cold.count}). Интервал rAF — ритм представления, не чистое GPU-время; GPU-время без timestamp-query не подменяется CPU-временем.` }),
    ].filter(Boolean) as HTMLElement[]);

    const ai = m.ai;
    const fbRows = Object.entries(ai.fallback.by_reason).sort((a, b) => b[1] - a[1]);
    const core = this.app.host.core;
    patch(this.ai, JSON.stringify([ai.requests, ai.verdicts, ai.fallback, ai.invalid_intents, ai.violations_admitted, ai.tokens, ai.cost, ai.latency_ms, ai.speech.repetition_rate]), () => [
      h('div', { class: 'stat-grid' },
        h('div', { class: `stat ${ai.violations_admitted === 0 ? 'good' : 'bad'}` },
          h('div', { class: 'label', text: 'Допущено нарушений (цель — 0)' }),
          h('div', { class: 'big-number', id: 'metric-violations', 'data-value': String(ai.violations_admitted), text: String(ai.violations_admitted) }),
          h('div', { class: 'small', text: `допущено нарушений: ${ai.violations_admitted}` })),
        h('div', { class: 'stat' }, h('div', { class: 'label', text: 'Неверных намерений (отклонено)' }), h('div', { class: 'big-number', id: 'metric-invalid', text: String(ai.invalid_intents) })),
        h('div', { class: 'stat' }, h('div', { class: 'label', text: 'Доля fallback' }), h('div', { class: 'value', text: `${pct(ai.fallback.ratio_of_requests, 0)} (${ai.fallback.count})` })),
        h('div', { class: 'stat' }, h('div', { class: 'label', text: 'Повтор реплик' }), h('div', { class: 'value', text: pct(ai.speech.repetition_rate, 1) }))),
      table(['Задержка ИИ, мс', ['p50', 'num'], ['p95', 'num'], ['p99', 'num'], ['n', 'num']], [
        setRow('Первый токен (от исполнителя)', ai.latency_ms.first_token),
        setRow('Готовый проверенный ответ', ai.latency_ms.ready),
        setRow('Исполнитель целиком', ai.latency_ms.provider_total),
        setRow('Ожидание в очереди', ai.latency_ms.queue_wait),
      ]),
      fbRows.length ? table(['Причина fallback', ['Число', 'num']], fbRows.map(([r, n]) => [reasonRu(r), String(n)])) : h('p', { class: 'small muted', text: 'Fallback ещё не было.' }),
      h('dl', { class: 'kv' },
        h('dt', { text: 'Запросы' }), h('dd', { text: `поставлено ${ai.requests.queued} · выдано ${ai.requests.dispatched} · ответов ${ai.requests.results} · заменено ${ai.requests.replaced} · вытеснено ${ai.requests.evicted}` }),
        h('dt', { text: 'По полосам' }), h('dd', { text: Object.entries(ai.requests.by_backend).map(([k, v]) => `${k} ${v}`).join(' · ') || '—' }),
        h('dt', { text: 'Вердикты' }), h('dd', { text: Object.entries(ai.verdicts).map(([k, v]) => `${k} ${v}`).join(' · ') || '—' }),
        h('dt', { text: 'Токены' }), h('dd', { text: `вход ${ai.tokens.input} · выход ${ai.tokens.output} · кэш ${ai.tokens.cached_input} · рассуждения ${ai.tokens.reasoning} (измерено у ${ai.tokens.measured_results}, оценка у ${ai.tokens.estimated_results})` }),
        h('dt', { text: 'Стоимость' }), h('dd', { text: ai.cost.total_usd === null ? 'нет данных (тарифы условные, считаются только в шлюзе)' : `$${num(ai.cost.total_usd, 4)}${ai.cost.fictional ? ' — тарифы условные' : ''}` }),
        h('dt', { text: 'Модели' }), h('dd', { text: ai.models_seen.join(', ') || '—' }),
        h('dt', { text: core.engine === 'js' ? 'Ядро (JS: WebAssembly запрещён страницей)' : 'Ядро (WASM)' }), h('dd', { text: `${core.calls} вызовов, ${num(core.callMs, 0)} мс CPU страницы суммарно` })),
      h('p', { class: 'note', text: 'Тарифы условные: стоимость считается по конфигурации шлюза с флагом fictional; в странице её нет. Токены Claude в странице — оценка, не измерение.' }),
    ]);

    const r = this.app.route;
    this.routeBtn.disabled = r.running || mode !== '3d';
    this.route.textContent = mode !== '3d' ? 'Маршрут доступен только с WebGPU-рендером.' : r.running ? `Идёт прогон: ${r.progress}` : r.error ? `Ошибка: ${r.error}` : r.report ? `Готово: статус ${r.report.status}${r.report.reason ? ` — ${r.report.reason}` : ''}` : 'Ещё не запускался.';
    const text = r.report ? JSON.stringify(r.report, null, 2) : '';
    if (this.routePre.textContent !== text) this.routePre.textContent = text;
    this.routePre.hidden = !text;
  }
}
