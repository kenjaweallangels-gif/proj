// «О прототипе»: architecture in brief and an honest list of what is real and what is simulated here.
import type { AppApi, Tab } from '../context.ts';
import { h } from '../dom.ts';

export class AboutTab implements Tab {
  readonly id = 'about' as const;
  readonly label = 'О прототипе';
  private readonly app: AppApi;
  private versions!: HTMLElement;

  constructor(app: AppApi) { this.app = app; }

  mount(el: HTMLElement): void {
    this.versions = h('p', { class: 'small muted', id: 'about-versions' });
    el.append(h('div', { class: 'prose' },
      h('h3', { text: 'Модель предлагает — игра проверяет — мир меняется' }),
      h('p', { text: 'Echo Runtime — узкий движок «Нулевого эха». Шесть колонистов живут в общей симуляции: ходят по модулям, устают, выполняют задачи. Обычный игровой ИИ (правила с весами характера) работает всегда, даже без модели. Языковая модель, если она подключена, только выбирает одно действие из списка, который ей дала игра, и ссылается на известные персонажу факты.' }),
      h('ol', null,
        h('li', { text: 'Событие (тревога, реплика Алекса) ставит запрос в очередь AdmissionController: одна генерация за раз, срок ответа 2,5–4 с.' }),
        h('li', { text: 'Ядро собирает контекст: роль, разрешённые знания именно этого NPC, ситуацию, память, допустимые действия.' }),
        h('li', { text: 'Исполнитель (правила, Claude, шлюз, WebLLM) возвращает сырой текст.' }),
        h('li', { text: 'Intent Authority проверяет его в семь шагов: формат, ожидание, ревизия мира, допустимость, резерв, исполнение, запись.' }),
        h('li', { text: 'Мир меняется только по завершении задачи. Любой отказ или опоздание — fallback обычного ИИ; игра не ждёт модель.' }),
        h('li', { text: 'Реплики собираются из авторских шаблонов (контролируемая речь); свободный текст модели в мир не попадает.' })),
      h('h3', { text: 'Что здесь настоящее' }),
      h('ul', null,
        h('li', { text: 'Ядро C++20, собранное в WebAssembly и встроенное в страницу: симуляция, задачи, память с источниками, Intent Authority, директор, биография места, сохранения. Тот же код проходит нативные тесты.' }),
        h('li', { text: 'WebGPU-рендер сцены D0 (если браузер его поддерживает) с честным GPU-временем через timestamp-query.' }),
        h('li', { text: 'Провайдер Claude — настоящий вызов модели через страницу-хост, но только когда приложение открыто в просмотрщике Claude и зритель разрешил.' }),
        h('li', { text: 'Отказы Intent Authority и счётчик «допущено нарушений» — реальная проверка ядра, а не имитация.' })),
      h('h3', { text: 'Что смоделировано или не проверено' }),
      h('ul', null,
        h('li', { text: 'Mock-исполнитель (?dev=1) — сценарные ответы, не модель.' }),
        h('li', { text: 'WebLLM и локальный llama.cpp здесь не запускались (not_run): веса не скачивались.' }),
        h('li', { text: 'Замеры кадра на программном адаптере (SwiftShader) — не доказательство 60 FPS. Приёмка — три прогретых прохода на RTX 3060.' }),
        h('li', { text: 'Бюджеты GPU и VRAM — план из profiles.json, не измерение.' }),
        h('li', { text: 'Персонажи — жёсткие фигуры в скафандрах; лица, кожа, озвучивание и распознавание речи не реализованы.' }),
        h('li', { text: 'Токены Claude в странице — оценка; стоимость считает только шлюз, и тарифы там условные.' })),
      h('h3', { text: 'Приватность' }),
      h('p', { text: 'offline — разговоры не покидают страницу (правила, mock). hybrid/online — разрешена удалённая полоса: Claude через страницу-хост или Agent Gateway. Скрытого перехода к облаку нет: если удалённый исполнитель недоступен, отвечают правила. Ключи API в страницу никогда не попадают.' }),
      this.versions,
    ));
  }

  render(): void {
    if (this.versions.dataset.done) return;
    try {
      const v = this.app.host.core.call<{ core_version: string; prompt_version: string; intent_schema_version: string; save_format: string }>('version');
      this.versions.textContent = `Ядро: ${v.core_version} · промпт: ${v.prompt_version} · схема намерения: ${v.intent_schema_version} · сохранение: ${v.save_format}`;
      this.versions.dataset.done = '1';
    } catch {
      this.versions.textContent = 'Версия ядра недоступна.';
    }
  }
}
