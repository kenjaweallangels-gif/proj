// «Очередь ИИ»: AdmissionController (SPEC §3, Документ §11) — the queue with deadline countdowns, the active generation,
// the GPU gate with its reasons, the current backend and recent dispatch decisions; provider settings (gateway URL,
// WebLLM consent).
import type { AppApi, Tab } from '../context.ts';
import { labelOf } from '../../core/data.ts';
import { WEBLLM_DOWNLOAD_RU, WEBLLM_LIBRARY_URL, WEBLLM_MODEL } from '../../agent/providers/webllm.ts';
import { KIND_RU, PROVIDER_STATE_RU } from '../labels.ts';
import { clock, h, ms, num, patch, sectionTitle, secs, table } from '../dom.ts';

export class QueueTab implements Tab {
  readonly id = 'queue' as const;
  readonly label = 'Очередь ИИ';
  private readonly app: AppApi;
  private exec!: HTMLElement;
  private active!: HTMLElement;
  private queue!: HTMLElement;
  private gate!: HTMLElement;
  private log!: HTMLElement;
  private webllm!: HTMLElement;

  constructor(app: AppApi) { this.app = app; }

  badge(): number { return this.app.host.snapshot.queue.length + this.app.host.inflight.size; }

  mount(el: HTMLElement): void {
    this.exec = h('div', { id: 'queue-exec' });
    this.active = h('div', { id: 'queue-active' });
    this.queue = h('div', { id: 'queue-items' });
    this.gate = h('div', { id: 'queue-gate' });
    this.log = h('div', { id: 'queue-log' });
    this.webllm = h('div', { id: 'webllm-box' });
    const url = h('input', { type: 'url', id: 'inp-gateway-url', value: this.app.host.gateway.url, 'aria-label': 'Адрес Agent Gateway', spellcheck: 'false' });
    const connect = h('button', { class: 'btn btn-sm', type: 'button', id: 'btn-gateway-connect', text: 'Подключить' });
    connect.addEventListener('click', () => { this.app.host.gateway.setUrl(url.value); this.app.host.gateway.activate(this.app.host.privacy); this.render(); });
    el.append(
      h('div', null, sectionTitle('Исполнитель'), this.exec),
      h('div', null, sectionTitle('Активная генерация'), this.active),
      h('div', null, sectionTitle('Очередь'), this.queue),
      h('div', null, sectionTitle('GPU-гейт'), this.gate),
      h('div', null, sectionTitle('Решения AdmissionController'), this.log),
      h('details', { class: 'card', id: 'gateway-box' },
        h('summary', { text: 'Agent Gateway: адрес' }),
        h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', { text: 'URL шлюза (токен сессии хранится только в памяти)' }), url), connect),
        h('p', { class: 'small muted', text: 'Запуск: node gateway/src/server.ts --config data/providers.example.json --origin <адрес этой страницы>. В опубликованной странице сеть заблокирована — шлюз недоступен.' })),
      this.webllm,
    );
  }

  render(): void {
    const host = this.app.host;
    const s = host.snapshot;
    const p = host.provider;
    const st = p.state();
    const backend = p.id === 'rules' ? 'rules' : p.backend(host.privacy);
    patch(this.exec, `${p.id}|${st.state}|${st.message}|${host.privacy}|${host.aiMode}`, () => [
      h('dl', { class: 'kv' },
        h('dt', { text: 'Выбран' }), h('dd', null, h('b', { text: p.label }), ` — ${p.where}`),
        h('dt', { text: 'Состояние' }), h('dd', null, h('span', { class: `badge ${st.state === 'ready' ? 'ok' : st.state === 'unavailable' ? 'bad' : 'warn'}`, id: 'provider-state', text: PROVIDER_STATE_RU[st.state] ?? st.state }), ` ${st.message}`),
        h('dt', { text: 'Полоса ядра' }), h('dd', null, h('span', { class: 'mono', text: backend }), backend === 'remote' ? ' (разговор уходит за пределы страницы)' : backend === 'rules' ? ' (без модели)' : ' (локально)'),
        h('dt', { text: 'Профиль' }), h('dd', { text: `${host.privacy} · режим ${s.ai_config.effective_mode}${s.ai_config.cpu_threads !== undefined ? ` · CPU-пул ${s.ai_config.cpu_threads}` : ''}` })),
      p.id === 'claude' ? h('p', { class: 'note' }, 'Claude вызывается только для реплик и поручений Алекса. Инициативы экипажа отвечают правила, если не нажать «Спросить Claude» в очереди. Первый вызов просит разрешение зрителя; ожидание ответа ограничено дедлайном ядра (2,5 с для реплики).') : null,
    ]);

    const now = performance.now();
    const flights = [...host.inflight.values()];
    patch(this.active, flights.map((f) => `${f.taskId}${Math.floor((now - f.startedReal) / 250)}`).join(), () => flights.length ? flights.map((f) => {
      const cancel = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', id: `btn-cancel-${f.taskId}`, text: 'Отменить' });
      cancel.addEventListener('click', () => host.cancel(f.taskId));
      const total = Math.max(1, f.deadlineReal - f.startedReal);
      return h('div', { class: 'card stack' },
        h('div', { class: 'row' }, h('b', { text: `${f.taskId} · ${labelOf(f.actor)}` }), h('span', { class: 'small muted', text: `${KIND_RU[f.kind] ?? f.kind} · ${host.providers[f.provider].label} · полоса ${f.backend}` }), h('span', { class: 'grow' }), cancel),
        h('div', { class: 'small', text: `идёт ${secs(now - f.startedReal)} · до дедлайна ${secs(Math.max(0, f.deadlineReal - now))}` }),
        h('div', { class: 'bar' }, h('i', { width: `${Math.min(100, ((now - f.startedReal) / total) * 100).toFixed(0)}%` })));
    }) : [h('p', { class: 'small muted', text: 'Нет: одна активная генерация на общий экземпляр модели; правила отвечают мгновенно.' })]);

    const nowHost = host.nowMs();
    const q = s.queue;
    patch(this.queue, q.map((x) => `${x.task_id}${Math.floor((x.deadline_ms - nowHost) / 250)}${host.heldForClaude(x.task_id) > 0}`).join() + p.id, () => q.length ? [table(
      ['Запрос', 'NPC', 'Тип', ['Приоритет', 'num'], ['До срока', 'num'], ''],
      q.map((x) => {
        const actions: HTMLElement[] = [];
        if (p.id === 'claude' && host.claude.state().state === 'ready' && (x.kind === 'initiative' || x.kind === 'ambient')) {
          const ask = h('button', { class: 'btn btn-sm', type: 'button', id: `btn-ask-claude-${x.task_id}`, text: 'Спросить Claude' });
          ask.addEventListener('click', () => host.askClaude(x.task_id));
          actions.push(ask);
        }
        const cancel = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', id: `btn-qcancel-${x.task_id}`, text: 'Снять' });
        cancel.addEventListener('click', () => host.cancel(x.task_id));
        actions.push(cancel);
        return [h('span', { class: 'mono', text: x.task_id }), labelOf(x.actor), KIND_RU[x.kind] ?? x.kind, String(x.priority), secs(Math.max(0, x.deadline_ms - nowHost)), h('div', { class: 'row' }, actions)];
      }),
    ), h('p', { class: 'small muted', text: 'Если никто не ответит до срока, ядро само применит обычный игровой ИИ.' })]
      : [h('p', { class: 'small muted', text: 'Очередь пуста.' })]);

    const g = s.gate;
    patch(this.gate, JSON.stringify(g), () => [
      h('div', { class: 'row' }, h('span', { class: `badge ${g.gpu_allowed ? 'ok' : 'warn'}`, id: 'gate-state', text: g.gpu_allowed ? 'GPU-генерация допущена' : 'GPU-генерация запрещена' })),
      h('dl', { class: 'kv' },
        h('dt', { text: 'p95 GPU' }), h('dd', { text: g.p95_gpu_ms === null ? 'нет данных' : ms(g.p95_gpu_ms) }),
        h('dt', { text: 'p99 готовности кадра' }), h('dd', { text: g.p99_frame_ms === null ? 'нет данных' : ms(g.p99_frame_ms) }),
        h('dt', { text: 'Свободная VRAM' }), h('dd', { text: g.vram_free_gib === null ? 'неизвестна (браузер не сообщает)' : `${num(g.vram_free_gib, 2)} GiB` }),
        h('dt', { text: 'Стабильно' }), h('dd', { text: `${num(g.stable_s, 1)} с` }),
        h('dt', { text: 'Охлаждение' }), h('dd', { text: `${num(g.cooldown_remaining_s, 1)} с` })),
      g.reasons.length ? h('ul', { class: 'small', id: 'gate-reasons' }, g.reasons.map((r) => h('li', { text: r }))) : null,
      h('p', { class: 'note', text: 'Пороги — гипотеза политики из profiles.json (p95 GPU < 11,5 мс, p99 < 14 мс, VRAM ≥ 1,5 GiB, 2 с стабильности), а не гарантия FPS.' }),
    ].filter(Boolean) as HTMLElement[]);

    const log = host.dispatchLog.slice(0, 12);
    patch(this.log, log.map((d) => `${d.code}${d.text}${Math.floor(d.at)}`).join('|'), () => log.length ? [h('ul', { class: 'small' }, log.map((d) => h('li', null,
      h('span', { class: `badge ${d.allowed ? 'ok' : 'warn'}`, text: d.code }), ` ${clock(d.simT)} · ${d.backend}: ${d.text}`)))]
      : [h('p', { class: 'small muted', text: 'Решений ещё не было.' })]);

    const w = host.webllm.state();
    patch(this.webllm, `${w.state}|${w.message}|${p.id}`, () => {
      const enable = h('button', { class: 'btn btn-sm', type: 'button', id: 'btn-webllm-enable', text: 'Загрузить WebLLM (согласен на загрузку)' });
      enable.disabled = w.state === 'loading' || w.state === 'ready';
      enable.addEventListener('click', () => { void host.webllm.enable().then(() => { host.applyAiMode(); this.render(); }); this.render(); });
      return [h('details', { class: 'card', id: 'webllm-details', open: p.id === 'webllm' },
        h('summary', { text: 'WebLLM (эксперимент, выключен по умолчанию)' }),
        h('p', { class: 'small' }, `Будет загружено: ${WEBLLM_DOWNLOAD_RU}. Модель: ${WEBLLM_MODEL}. Библиотека: ${WEBLLM_LIBRARY_URL}. Модель делит видеокарту с рендером; запросы допускает только GPU-гейт ядра после калибровки, которой в прототипе нет.`),
        h('p', { class: 'small', id: 'webllm-state' }, h('span', { class: 'badge', text: PROVIDER_STATE_RU[w.state] ?? w.state }), ` ${w.message}`),
        enable)];
    });
  }
}
