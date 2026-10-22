# Echo Runtime — внутренняя спецификация v0.1 (контракты модулей)

Этот файл — **единый источник контрактов** между модулями. Источник требований — техническое дополнение
«ZERO ECHO · Движок, локальный ИИ и API» v0.1 (21.10.2026), далее «Документ», разделы §1–§23.
Код идентификаторы — английские; пользовательский текст и документация — русские.

Принцип из Документа, который нельзя нарушать нигде: **модель предлагает — игра проверяет — мир меняется только
после принятия и фактического выполнения**. Модель и место её запуска заменяемы; игровая власть и память — часть игры.

## 0. Структура репозитория и владение

| Каталог | Что | Язык |
|---|---|---|
| `data/` | Общие данные мира D0: `world/zero_echo_d0.json`, `npcs.json`, `actions.json`, `profiles.json`, `scene/d0_layout.json`, `speech_ru.json`, `director_events.json`, `biography_details.json`, `eval/scenes_ru.json`, `providers.example.json`, `pricing.example.json` | JSON |
| `schemas/` | JSON Schema: `intent`, `dialogue`, `gateway_request`, `gateway_result` | JSON |
| `core/` | **Echo Runtime core** (C++20): JSON, симуляция, задачи, память NPC, ContextBuilder, AdmissionController, IntentAuthority, UtilityPolicy (обычный игровой ИИ), ControlledSpeech, Director, PlaceBiography, FrameStats, save/load. Сборки: native (CMake, g++/clang) и WASM (Emscripten) из **одного** кода. | C++20 |
| `gateway/` | **Agent Gateway** — backend: адаптеры провайдеров, ключи только на сервере, сессии с квотами, circuit breaker, privacy-профили, allowlist endpoint'ов, учёт usage/стоимости | TypeScript (Node ≥22.18, запуск без сборки через type stripping) |
| `web/` | Браузерный клиент: WebGPU-рендер (WGSL), профили качества, контрольный маршрут и метрики, экран совместимости, UI диалогов и отладки ИИ, провайдеры | TypeScript + WGSL, сборка esbuild |
| `eval/` | Набор eval-сцен и прогон (ядро WASM в Node + провайдеры) | TypeScript |
| `tools/` | `serve.mjs`, `chromium.mjs` (headless WebGPU), `webgpu_probe.html`, `hw_manifest.py`, `build_all.sh`, `test_all.sh`, `make_report.mjs` | — |
| `reports/` | Машиночитаемые результаты: `validation.json` (pass / fail / blocked / not_run), отчёты тестов, скриншоты | JSON/PNG |

TypeScript: импорты с явным расширением `.ts`, только «стираемый» синтаксис (никаких `enum`, `namespace`,
parameter properties) — `tsconfig.json` включает `erasableSyntaxOnly`. Проверка типов: `npx tsc -p tsconfig.json`.

## 1. Ядро: JSON-протокол команд (`core/`)

Ядро экспортирует **одну** точку входа (одинаковую для native, WASM и тестов):

```c
// core/include/echo/c_api.h
extern "C" {
  typedef struct EchoCore EchoCore;
  EchoCore*   echo_create(void);
  void        echo_destroy(EchoCore*);
  const char* echo_call(EchoCore*, const char* request_json); // returns UTF-8 JSON, valid until next echo_call on the same core
}
```

WASM-сборка: ES-модуль `core/build-wasm/echo_core.mjs` (`-sMODULARIZE -sEXPORT_ES6 -sSINGLE_FILE=1
-sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1`), обёртка `web/src/core/echo_core.ts` вызывает
`echo_call` через `ccall`/`cwrap`. Одинаковые тесты протокола проходят в native и в WASM (Node).

Запрос: `{"cmd": "<name>", ...args}`. Ответ: `{"ok": true, ...}` или `{"ok": false, "error": {"code", "message"}}`.
Время: ядро ведёт **симуляционное** время `sim_time_s` (через `tick`) и принимает **хостовое монотонное** время
`now_ms` для сроков ИИ-запросов (задержка модели — реальное время).

| cmd | Аргументы | Ответ (поля помимо ok) |
|---|---|---|
| `init` | `data: {world, npcs, actions, profiles, speech, director, biography}` (разобранные JSON-объекты), `seed?` | `revision`, `summary: {zones, npcs, facts, actions}` |
| `tick` | `dt_s` (≤ 1.0), `now_ms` | `events: Event[]`, `revision`, `expired: string[]` (task_id просроченных запросов → fallback уже применён) |
| `state` | `debug?: bool` | `Snapshot` (см. ниже) |
| `player_say` | `npc_id`, `text` (≤600 симв.), `now_ms` | `queued: {task_id, kind, priority} \| null`, `immediate: Speech \| null` (мгновенная короткая реакция), `admission: Decision` |
| `player_order` | `npc_id`, `action`, `target_id?`, `companion_id?`, `now_ms` | как `player_say` (NPC может выполнить или отказаться) |
| `player_decide` | `plan_id`, `decision: "accept"\|"reject"\|"reassign"\|"ask_evidence"`, `companion_id?`, `now_ms` | `verdict: Verdict`, `speech?: Speech`, `events` |
| `dispatch` | `now_ms`, `backend: "rules"\|"cpu"\|"gpu"\|"remote"` | `request: GatewayRequest \| null`, `decision: Decision` (почему выдан/не выдан) |
| `submit_result` | `result: GatewayResult` (см. schemas), `now_ms` | `verdict: Verdict`, `speech: Speech`, `events` |
| `rules_propose` | `task_id` | `proposal_text` — предложение обычного игрового ИИ (UtilityPolicy) в том же контракте |
| `cancel` | `task_id`, `now_ms` | `cancelled: bool` (поздний ответ будет отброшен) |
| `frame_stats` | `samples: [{interval_ms, cpu_ms, gpu_ms\|null}]`, `vram_free_gib?: number\|null`, `now_ms` | `gate: GpuGate` |
| `set_ai_mode` | `mode: "smooth"\|"live"\|"extended"`, `gpu_enabled: bool`, `calibrated: bool`, `privacy_profile` | `config` |
| `metrics` | — | `frame: FrameReport`, `ai: AiReport` |
| `events` | `since_seq` | `events` |
| `memory` | `npc_id` | `entries: MemoryEntry[]`, `known_facts: [{id, source}]` |
| `save` | — | `save` (объект; включает версию схемы, seed, журнал событий, память с источниками, принятые намерения, версии модели/шаблона, без KV-cache) |
| `load` | `save` | `revision` |
| `debug_patch` | `patch: [{op: "set_actor_busy"\|"set_resource"\|"set_door"\|"move_actor"\|"set_sensor_reading"\|"bump_revision", ...}]` | `revision` — для eval «мир изменился во время ответа» |

### 1.1 Snapshot (`state`)
```jsonc
{
  "sim_time_s": 132.5, "revision": 57,
  "resources": [{"id","name_ru","amount","reserved","unit"}],
  "zones": [{"id","name_ru","sealed":false}], "doors": [{"id","a","b","state"}],
  "sensors": [{"id","zone","reading":{"value","trend"},"fault":bool, "truth"?: {...} /* только при debug */}],
  "actors": [{"id","name_ru","zone","target_zone"?, "task_id"?, "activity":"idle|walking|working|resting|talking",
              "fatigue","trust_player","gesture","style","busy":bool}],
  "tasks": [{"id","action","actor","companion"?, "target"?, "state":"active|done|cancelled|failed","progress":0..1}],
  "plans": [{"plan_id","actor","proposal":{...},"state":"awaiting_player|accepted|rejected|replanned|expired","expires_s"}],
  "queue": [{"task_id","actor","kind","priority","state":"queued|active","deadline_ms"}],
  "director": {"tension":0..1, "last_event"?: "...", "cooldowns": {...}},
  "biography": [{"zone","anchor","detail_id","label_ru"}],
  "emergency_lights": false,
  "gate": GpuGate
}
```

### 1.2 Speech (контролируемая речь)
`{"actor","text","style","gesture","fact_ids":[],"template_id","kind":"immediate|line|fallback|evidence"}`.
Текст строится **только** из шаблонов `data/speech_ru.json` + подстановок (имена, названия целей, фразы
разрешённых фактов). Свободный текст модели в контролируемом режиме не принимается.

### 1.3 Verdict (результат Intent Authority)
```jsonc
{
  "task_id": "req-000012", "actor": "mira",
  "status": "accepted|awaiting_player|rejected|stale|duplicate|expired|fallback",
  "fallback_used": false, "fallback_reason": null,          // timeout/invalid_output/... или причина отказа authority
  "proposal": {...}|null,                                    // разобранное предложение (после шага 1)
  "steps": [ {"step": 1, "name": "format", "ok": true, "detail": "..."}, ... ], // 7 шагов, трассировка для UI
  "plan_id": "plan-0003"|null, "world_task_id": "task-0007"|null,
  "reasons": ["unknown_field:secret", ...]
}
```

## 2. Intent Authority — порядок проверки (Документ §12)

1. **format** — ограничить байты (`max_bytes` 2048); строгий JSON-парсер ядра: дубликаты ключей → reject,
   неизвестные поля → reject, глубина ≤4, типы/enum (`action` ∈ allowed_actions запроса, `style`, `gesture`),
   `fact_ids` уникальны, ≤ лимита действия. Принимается **только** объект; поля хоста (`task_id`, `actor_id`,
   `world_revision`, `deadline_ms`) в ответе модели — это неизвестные поля → reject.
2. **pending** — запрос с этим `task_id` ожидается, не истёк (`now_ms` ≤ дедлайна), не исполнен
   (идемпотентность: повторная доставка → `duplicate`, без повторного расхода), привязка к исходному NPC
   берётся из записи запроса хоста, а не из ответа.
3. **revision** — смысловая ревизия: для каждой сущности, от которой зависит предложение (actor, target,
   companion, используемые ресурсы и инструменты, двери маршрута), `entity_rev[e] ≤ request.world_revision`.
   Номер кадра не используется. Изменилась зависимость → `stale` (+ fallback).
4. **validity** — цель есть в `allowed_actions[action].targets` этого запроса и существует; роль/навыки NPC;
   `fact_ids` ⊆ `visible_facts` запроса **и** ⊆ знаний NPC; защищённые факты (`protected`) никогда не
   проходят; cooldown; маршрут (граф дверей: путь без `sealed`); ресурсы (`amount - reserved ≥ consumes`);
   физические условия (`suit_required` зона → `eva` ≥ `eva_min_skill`, `fatigue` ≤ `eva_max_fatigue`);
   компаньон существует, не занят, не равен актору, допускается действием.
5. **reserve** — атомарно зарезервировать ресурсы, инструменты (lock), актора и компаньона. Для действий с
   `approval` → создаётся **plan** `awaiting_player` с мягким резервом (TTL 60 с sim). При `accept` резерв
   перепроверяется: если компаньон стал занят — **переоценка** (UtilityPolicy подбирает замену или fallback),
   ресурсы не расходуются дважды. Ничего не списывается на этапе «NPC подумал».
6. **execute** — создаётся задача в обычной системе задач; мир меняется **только** по завершении задачи
   (эффекты: `reveal_inspection`, `seal_zone`, `clear_sensor_fault`, `share_facts`, `rest`, `rover_ready`,
   `preserve_sample`). Расход ресурса — при завершении; отмена → снятие резерва.
7. **record** — событие в журнал, обновление памяти (только по принятому/выполненному; отвергнутое
   предложение память не меняет), идемпотентная запись (`executed_task_ids`).

При любом отказе (status ≠ ok от провайдера, или authority reject/stale/expired) ядро **само** применяет
fallback: UtilityPolicy строит допустимое предложение, оно проходит те же шаги; персонаж продолжает полезное
поведение и говорит допустимую fallback-реплику. Игра не блокируется отказом модели (§14).

## 3. AdmissionController (Документ §11)

* Очередь: элемент = `{task_id, actor, kind: emergency|direct_reply|initiative|ambient|order_response, priority,
  created_ms, deadline_ms, revision}`. `emergency` вообще не ждёт LLM (сразу правила).
* Одна активная генерация на общий экземпляр модели (`max_active_generations`). Новое событие того же NPC
  **заменяет** устаревший ещё не начатый запрос. Длина очереди ограничена (`max_queue_length`), при переполнении
  вытесняется самый низкий приоритет (`ambient`), для него — готовая реакция.
* `dispatch(backend)`: `rules` — всегда разрешён; `cpu` — по пулу потоков (`cpu_threads`); `remote` — только
  если privacy_profile ≠ offline; `gpu` — только при `gpu_enabled && calibrated && mode ∈ {live, extended}`
  **и** свежей статистике кадров (возраст ≤ `stats_max_age_s`) с `p95_gpu < 11.5 мс`, `p99_frame < 14 мс`,
  `vram_free ≥ 1.5 GiB` (если неизвестно — GPU запрещён), стабильность ≥ `stable_window_s`. При ухудшении —
  запрет новых GPU-запросов, cooldown `cooldown_s`. `extended` запрещён во время аварии.
  Решение возвращается с причиной (`Decision {allowed, backend, reason, gate}`) для UI.
* Немедленная реакция: при постановке запроса ядро возвращает короткую реплику из набора `immediate`
  («Сверю показания», кивок/взгляд). Дедлайн обычного обмена 2.5 с → затем fallback.

## 4. ContextBuilder и память (Документ §10)

Слои с лимитами токенов (`profiles.json → admission.memory_layers_tokens`): роль, разрешённые знания,
текущая ситуация, недавние события (3–6 эпизодов), отношения/память, формат ответа. Сумма ≤
`max_input_tokens`. Оценка токенов — эвристика `ceil(codepoints / 3.2)` для кириллицы/латиницы (честно
помечена как оценка; фактическое usage приходит от провайдера). Обрезка по важности → давности.
Память NPC: `MemoryEntry {id, kind: fact|opinion|promise|episode, text_ru, source: "event:<id>"|"observation:<x>"|"reported_by:<npc>", confidence?, importance, time_s, tags[]}`.
Факт («игрок пообещал вернуться через час», с источником-событием) хранится отдельно от мнения
(«ему нельзя доверять», субъективно, с confidence). Сводка не заменяет журнал событий. Поиск — по тегам,
важности, давности; без embedding-модели.

Request для провайдера — строго по `schemas/gateway_request.schema.json`. `task_id` формата `req-000001`.
Мира не видит знаний Лейлы: `visible_facts` = знания этого NPC ∩ релевантные ситуации, **никогда** не
`protected`.

## 5. UtilityPolicy — обычный игровой ИИ (Документ §8)

Детерминированный выбор действия из `allowed_actions` по весам персонажа (`policy_weights`), состоянию мира
и памяти. Примеры обязательного поведения (тесты): Мира при тревоге давления и памяти о `yun_sent_alone`
предлагает `inspect sensor_a` с компаньоном (Ника, если свободна; иначе другой свободный); Томас при
`fatigue > 0.55` у Юна предлагает `propose_rest yun`; Ника предпочитает `drone_survey`; Самир на просьбу
потратить энергию сверх запаса — `refuse` с `power_budget_tight`. Работает без модели вообще.

## 6. Director и биография места (Документ §13)

`data/director_events.json`: событие = `{id, tension_cost, cooldown_s, story_window, requires_facts[],
incompatible[], witness_candidates[], effects: [{type: "sound"|"instrument_distortion"|"interpretation"}],
recovery}`. Директор не трогает физические запасы, не меняет построенные ниши, не доказывает финал.
Напряжение затухает; после аварии — спокойное окно. Пример: «Ника слышит знакомую фразу в проверенном
пустом секторе» → наблюдение `sound_heard_sector_c` (layer `interpretation`) у свидетеля; фактом проверки
становится только после `inspect sector_c`.
`data/biography_details.json`: детали (`repair_tape`, `moved_tool`, `note`, `old_sealant`, `personal_item`,
`shared_tool_layout`) с допустимыми якорями; детали выбираются из журнала модуля; размещение валидируется
(не на `zone_stand_points`/проходах, не закрывает выход).

## 7. Agent Gateway (Документ §15–§18) — HTTP API

Сервер: `node gateway/src/server.ts --config data/providers.example.json [--local-helper]`.

| Метод | Путь | Тело/ответ |
|---|---|---|
| POST | `/v1/session` | `{privacy_profile, client: "web"\|"native"\|"eval"}` → `{session_token, expires_at, quotas: {requests_per_min, tokens_per_hour, cost_cap_usd}, routes: [...]}` |
| POST | `/v1/intent` | `GatewayRequest` (+ заголовок `Authorization: Bearer <session_token>`, опц. `X-Echo-Route: <route id>`) → `GatewayResult` |
| POST | `/v1/dialogue` | то же, `capability = generate_dialogue` (опционально, экспериментально) |
| POST | `/v1/cancel` | `{task_id}` → `{cancelled}` (best effort; поздний ответ отбрасывается) |
| GET | `/v1/health` | состояние маршрутов и circuit breaker'ов |
| GET | `/v1/providers` | результат `probe` (возможности, без секретов) |
| GET | `/v1/usage` | usage и стоимость текущей сессии |
| GET | `/v1/manifest` | build manifest: schema_version, prompt_version, модели маршрутов (никаких `latest`) |

Адаптеры: `mock`, `llamacpp`, `openai` (Responses API), `anthropic` (Messages API), `gemini`,
`openai_compat` (vLLM/свой endpoint). Каждый реализует `probe`, `generateIntent`, `generateDialogue?`,
`cancel` (best effort), `usage`, `health`. Нормализованные статусы: `ok, timeout, refused, invalid_output,
unavailable, rate_limited, budget_exceeded, cancelled`. Шлюз **не** решает игровую допустимость — только
нормализует; `proposal_text` — сырой текст модели.
Сеть: строгий общий дедлайн; максимум один осмысленный retry, если осталось время; jitter/backoff при
429/5xx; circuit breaker; пределы конкурентности и расходов. Повторная доставка того же `task_id` не
повторяет вызов (кэш результата по task_id). Без скрытого fallback на другого удалённого провайдера.
Ключи: только из env/файла секретов на сервере; никогда в ответах/логах/клиенте. Пользовательский endpoint
через сервер — только https на публичные адреса (DNS → запрет private/loopback/link-local/metadata/CGNAT),
кроме явно разрешённого локального режима. `--local-helper`: bind 127.0.0.1, проверка `Origin` по allowlist,
обязательный session token; `0.0.0.0` только с явным `--allow-lan`.
Стоимость: `price_per_hour = requests_per_hour × (in × P_in + out × P_out) / 1e6` (Документ §18), тарифы —
только из конфигурации с флагом `fictional`.

## 8. Web: контракты рендера (`web/src/contracts.ts`)

Рендер (`web/src/render/**`, `web/src/shaders/**`, `web/src/bench/**`, `web/src/gpu/**`) экспортирует
`createRenderer(opts): Promise<Renderer>` из `web/src/render/index.ts` строго по `web/src/contracts.ts`.
UI/приложение (`web/src/ui/**`, `web/src/agent/**`, `web/src/core/**`, `web/src/main.ts`, `web/index.html`)
использует только этот интерфейс. Сборка: `node web/build.mjs` → `web/dist/index.html` (одиночный файл со
встроенными JS/WASM — для публикации и офлайн-запуска) и `web/dist/render-dev.html`.

## 9. Метрики (Документ §2, §19)

FrameStats: p50/p95/p99 интервалов кадров, CPU- и GPU-времени (GPU — только из timestamp-query; если нет —
`"unavailable"`, без подмены CPU-метрикой), доля пропущенных сроков (>16.67 мс), максимальная пауза,
число пауз >33.3 мс, разделение холодный старт / прогретые проходы. ИИ: время до первого токена и время
готового проверенного ответа раздельно, p50/p95/p99, доля fallback по причинам, число неверных намерений и
**число реально допущенных нарушений (цель — 0)**, повторяемость реплик, фактические токены и стоимость.

## 10. Честность результатов

Все отчёты машиночитаемы: `pass | fail | blocked | not_run`, git revision, версии инструментов. Нельзя
выдавать capability probe, SwiftShader-рендер или Python/Node-тесты за доказательство 60 FPS, качества NPC
или сетевой надёжности. Модели не скачиваются, платные API не вызываются без явной конфигурации владельца.
