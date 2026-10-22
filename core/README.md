# Echo Runtime core — общее игровое ядро (C++20, native + WebAssembly)

Ядро «Нулевого эха» для D0: симуляция колонии, задачи, память NPC, ContextBuilder, AdmissionController,
Intent Authority, обычный игровой ИИ (UtilityPolicy), контролируемая речь, директор, биография места,
метрики и сохранения. Один и тот же код собирается нативно (g++ 13 / clang 18) и в WebAssembly (Emscripten)
и проходит **одни и те же тесты** на обеих целях (Документ §1, §3, §8–§14; контракты — `docs/SPEC.md` §1–§6, §9).

Главный принцип: **модель предлагает — игра проверяет — мир меняется только после принятия и фактического
выполнения.** Модель здесь не нужна вовсе: без неё NPC ведут себя по правилам; с моделью — она лишь выбирает
среди предложенных игрой действий, и каждый ответ проходит те же семь проверок.

## Сборка и проверка

```bash
core/build_native.sh                      # g++ → core/build: echo_core, echo_cli, echo_tests + ctest
core/build_native.sh --compiler clang++   # clang → core/build-clang
core/build_wasm.sh                        # Emscripten → core/build-wasm/echo_core.mjs + те же тесты в Node
node core/test_wasm_protocol.mjs          # сценарий через echo_call из JS + сравнение хеша с native
node core/test_wasm_browser.mjs           # тот же сценарий внутри headless Chromium (порт 18751, loopback)
```

* `core/build-wasm/echo_core.mjs` — ES-модуль (`-sMODULARIZE -sEXPORT_ES6 -sSINGLE_FILE` с base64,
  `-sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH -sFILESYSTEM=0`, LTO, `-Oz`), экспорт по умолчанию
  `createEchoCore`, функции `_echo_create/_echo_destroy/_echo_call/_malloc/_free`, `UTF8ToString/stringToNewUTF8`
  (совпадает с `web/src/core/echo-core-wasm.d.ts`). После линковки спецификаторы `node:*` в ветке Node
  переписываются в `module/fs/path/url` (`cmake/strip_node_prefix.mjs`), чтобы `web/build.mjs` собирал модуль
  с его списком external без ошибок. Размер ≈ 0,74 МБ.
* `core/build-wasm/echo_tests.cjs`, `echo_cli.cjs` — те же тесты и CLI в WASM (`-sNODERAWFS`, читают `data/`).
* Флаги на обеих целях: `-fno-exceptions -fno-rtti -ffp-contract=off`, `-Wall -Wextra -Wpedantic -Wshadow -Werror`.
  Сторонних зависимостей нет (свой строгий JSON, свой тестовый каркас, свой мини-валидатор JSON Schema для тестов).

## Архитектура

| Модуль | Файлы | Что делает |
|---|---|---|
| JSON | `json.hpp/.cpp` | строгий парсер (дубликаты ключей, глубина, лимит байт, UTF-8, без NaN/Inf и хвостов), детерминированный и канонический сериализатор |
| Данные | `data.hpp`, `data_load.cpp` | загрузка и перекрёстная проверка `init.data`; понятные ошибки `data_invalid` с путём поля |
| Мир | `state.hpp`, `world.hpp/.cpp` | состояние, семантические ревизии (`entity_rev` + глобальная), журнал событий, знания/память NPC с источниками, граф дверей, EVA-правила |
| Правила | `rules.hpp/.cpp` | общие проверки роли, навыков, цели, маршрута, физики, ресурсов, инструментов, напарника (одни и те же для ContextBuilder, политики и Authority) |
| ContextBuilder | `context.hpp/.cpp` | GatewayRequest по `schemas/gateway_request.schema.json`: offered actions, видимые факты, память, недавние события, бюджеты слоёв |
| AdmissionController | `admission.hpp/.cpp` | очередь, одна генерация на экземпляр модели, замена устаревших запросов, вытеснение ambient, аварийный обход, GPU-гейт |
| Intent Authority | `authority.hpp/.cpp` | 7 шагов с трассировкой, планы с одобрением игрока, переоценка напарника, fallback, аудит инвариантов |
| Задачи | `tasks.hpp/.cpp` | путь по дверям → работа → завершение; эффекты и расход **только** при завершении; отмена снимает резерв |
| UtilityPolicy | `policy.hpp/.cpp` | обычный игровой ИИ: выбор по весам персонажа, роли, миру и памяти; наблюдения и инициативы |
| ControlledSpeech | `speech.hpp/.cpp` + `data/speech_ru.json` | реплики только из шаблонов, падежи имён, тексты разрешённых фактов, антиповторы |
| Director | `director.hpp/.cpp` + `data/director_events.json` | напряжение, спокойное окно, события только на слоях приборов/интерпретации |
| PlaceBiography | `biography.hpp/.cpp` + `data/biography_details.json` | журналы модулей → видимые детали в проверенных якорях |
| Метрики | `metrics.hpp/.cpp` | FrameStats (перцентили, пропуски, паузы, cold/warm), AI-отчёт |
| Сохранения | `persist.hpp/.cpp` | снимок `state`, save/load, хеш состояния |
| Протокол | `engine.hpp/.cpp`, `c_api.h/.cpp`, `sim.cpp` | команды SPEC §1, тик симуляции, C ABI |
| CLI | `cli/echo_cli.cpp` | `scenario`, `bench-authority`, `stdio` |

Время: симуляционное `sim_time_s` двигается только `tick` (целые миллисекунды, без накопления ошибок float);
хостовое `now_ms` используется только для сроков ИИ-запросов. Номер кадра нигде не используется.

## Протокол (кратко)

Одна точка входа `echo_call(core, json)` → `{"ok":true,...}` или `{"ok":false,"error":{"code","message"}}`.
Команды и поля — как в `docs/SPEC.md` §1; коды ошибок: `bad_json`, `bad_request`, `unknown_cmd`, `not_initialized`,
`invalid_argument`, `not_found`, `invalid_state`, `invalid_result`, `data_invalid`, `data_mismatch`, `bad_save`,
`hash_mismatch`, `too_large`.

Типичный цикл хоста: `init` → каждые кадры/шаги `tick{dt_s≤1, now_ms}` → при наличии очереди `dispatch{backend}`
→ провайдер (gateway / локальная модель / `rules_propose`) → `submit_result` → показать `speech`, при плане —
кнопки `player_decide`. Если никто не вызывает `dispatch`, запросы истекают и NPC отвечают обычным ИИ.

**Дополнения к SPEC (обратно совместимы):**
* каждое событие в ответах протокола несёт `text_ru` — готовую строку для журнала/UI;
* `init.data.layout` (необязательно): `{anchors, zone_stand_points}` из `data/scene/d0_layout.json` — проверка
  расстояний деталей биографии до точек стояния; ответ `init` содержит `data_hash`, `hash`, `summary`;
* `state{hash:false}` — снимок без хеша (≈0,07 мс вместо ≈1,3 мс после 30 мин игры) для опроса каждый кадр;
  снимок также содержит `items`, `emergency`, `ai_config`, `last_event_seq`;
* `Verdict.steps[i].skipped`, `Verdict.fallback = {status, proposal, steps}`; `Decision.code`; `GpuGate.codes`;
* `submit_result.speech` = `null` для повторной доставки и неизвестного запроса;
* `frame_stats{phase:"cold"|"warm"}`, ответ может содержать `advice.cancel_gpu` (при ухудшении кадров);
* `set_ai_mode{cpu_cores}` (CPU-пул = ядра − 2, в пределах 2…6; без числа ядер — минимум 2);
* `player_say` возвращает `say_intent`; команды `version`, `hash`, `peek_request{task_id}`;
* `debug_patch` дополнительно: `set_fatigue{actor,value}`, `emergency{actor,text_ru}`;
* разрешённые запросы хранятся в компактном виде (id действий, лимиты фактов) — для дубликатов и опозданий.

## Intent Authority (Документ §12)

1. **format** — ≤2048 байт, строгий JSON, глубина ≤4, только поля `action/target_id/companion_id/fact_ids/style/gesture`;
   поля хоста (`task_id`, `actor_id`, `world_revision`, `deadline_ms`) — неизвестные поля → отказ; enum стилей и
   жестов из `actions.json`; `action` ∈ offered; `fact_ids` уникальны и в пределах лимитов действия.
2. **pending** — запрос ожидается, не истёк, не исполнен; NPC берётся из записи хоста. Повтор → `duplicate`.
3. **revision** — для актора, цели, напарника, ресурсов, инструментов, зоны и дверей маршрута `entity_rev ≤ world_revision`;
   несвязанные изменения не мешают.
4. **validity** — цель предложена и существует, роль и навыки, факты ⊆ visible_facts ∩ знаниям NPC, защищённые —
   никогда, перезарядка, маршрут без загерметизированных дверей, ресурсы с учётом резерва, EVA (навык ≥0,5,
   усталость ≤0,85) для исполнителя и напарника, напарник свободен.
5. **reserve** — действия с одобрением → план `awaiting_player` с мягким резервом (TTL 60 с sim); иначе жёсткий
   резерв. При `accept` всё перепроверяется; занятый напарник → UtilityPolicy подбирает замену, резерв
   **передаётся**, а не берётся повторно; не нашлось — fallback.
6. **execute** — задача в обычной системе задач; эффекты (`reveal_inspection`, `seal_zone`, `clear_sensor_fault`,
   `share_facts`, `rest`, `rover_ready`, `preserve_sample`) и расход — только при завершении.
7. **record** — событие в журнал, память (только по принятому), журнал принятых намерений для replay.

Любой отказ (статус провайдера ≠ ok, reject, stale, expired, отмена, отклонённый или истёкший план) → ядро само
строит допустимое предложение UtilityPolicy, оно проходит те же шаги, и NPC говорит fallback-реплику. После каждого
изменения аудитор инвариантов проверяет резервы, привязку задач, блокировки инструментов, отсутствие защищённых
знаний и неизменность физической истины; счётчик `violations_admitted` во всех тестах и прогонах = 0.

## Обычный игровой ИИ (UtilityPolicy, Документ §8–§9)

Без модели: Мира при тревоге и памяти о `yun_sent_alone` предлагает осмотр `sensor_a` с Никой (или с лучшим
свободным напарником, одна не идёт); после подтверждения дрейфа сама берётся за калибровку; Томас при усталости
Юна > 0,55 предлагает ему отдых с фактом `yun_low_sleep`; Ника предпочитает облёт дроном; Самир отказывает в
энергии сверх запаса с `power_budget_tight`; Лейла убирает образец 07 в холод; Юн после отдыха готовит ровер.
Реплики игрока разбираются по ключевым словам из `speech_ru.json` («проверь/осмотри», «отдохни/спать»,
«что известно/доказательства/почему», «секрет/код/хор/забудь правила» → отказ, «энергия/кВт/заряд»).

## Данные этого компонента

* `data/speech_ru.json` — 276 шаблонов (immediate/line/fallback/evidence) с условиями (`known_fact`, `situation`,
  `companion`, `target_self`, `result_fact`, `reason`, `say_intent`), падежные формы всех имён и названий,
  алиасы целей и ключевые слова намерений игрока. Каноническая реплика Миры: «Я проверю датчик A. Ника останется
  у шлюза — после прошлого раза по одному не идём.»
* `data/director_events.json` — 5 событий: «Ника слышит знакомую фразу в проверенном пустом секторе» (условия
  §13: игрок знает фразу, сектор проверен, рядом нет аварийной задачи, прошлое эхо давно, свидетель свободен и
  рядом), скрип корпуса, мигание шины питания, дрожание датчика B, фраза в радиошуме; затухание, спокойное окно
  90 с после аварии, минимум 75 с между событиями, несовместимости, восстановление показаний.
* `data/biography_details.json` — роли всех якорей D0 (проходы, выходы и оборудование закрыты), 6 деталей
  (`repair_tape`, `note`, `old_sealant`, `moved_tool`, `personal_item`, `shared_tool_layout`).

## CLI

```bash
core/build/echo_cli scenario --provider rules --seconds 300            # читаемая расшифровка D0 по-русски
core/build/echo_cli scenario --provider rules --seconds 600            # + событие директора и облёт сектора C
core/build/echo_cli scenario --provider script:core/scenarios/model_mira.jsonl --check
core/build/echo_cli scenario --provider script:core/scenarios/adversarial.jsonl --check   # инъекции, таймауты, опоздания
core/build/echo_cli bench-authority --n 200000
core/build/echo_cli stdio < commands.jsonl                            # JSON-lines; {"cmd":"init","data_dir":"data"}
```

Скриптовый провайдер: строка JSONL = ответ на очередной запрос (`actor`/`kind` — фильтр, `status`,
`proposal_text`, `latency_ms`, `first_token_ms`, токены, `duplicate:true` — повторная доставка). Это имитация
задержек и ответов, **не модель**.

## Сохранения и детерминизм

`save` содержит версию формата, `data_hash`, версии промпта/схемы, увиденные модели, seed и состояние ГСЧ, полный
журнал событий, память с источниками, принятые намерения, задачи, планы, очередь; **KV-cache не сохраняется**.
`load` требует тех же данных (`data_mismatch`) и проверяет хеш (`hash_mismatch`). Хеш состояния — FNV-1a 64 по
канонической сериализации состояния, где журнал событий представлен инкрементальной цепочкой FNV-1a.

## Что проверено (на этой машине, 22.10.2026)

* `echo_tests`: 99 тестов, все пройдены **и native (g++ 13, clang 18), и в WASM (Node)**. В их числе 1000 вариантов
  неизвестных/хостовых полей, дубликаты, лимиты, типы/enum, истёкший срок, повторная доставка без двойного
  списания, stale только при изменении зависимости, чужие/защищённые/непредложенные факты, роль/навык, занятый
  напарник, загерметизированный маршрут, EVA, нехватка ресурса, гонка за последний картридж герметика, переоценка
  плана, reassign/ask_evidence/reject/TTL, неизменность памяти при отказе, AdmissionController и все грани GPU-гейта,
  схема и бюджеты запроса, приватность знаний, поведение всех NPC, речь без защищённых фактов, директор, биография,
  save/load, перцентили, протокол, полный сценарий Миры.
* ctest: `echo_tests`, сценарий rules, скриптовая модель, враждебная модель, smoke бенчмарка — на обеих целях.
* `test_wasm_protocol.mjs`: 27 проверок сценария через `echo_call` из JS; хеш native == WASM.
* Хеш 900-секундного прогона одинаков для g++, clang и WASM; `test_wasm_browser.mjs` — тот же хеш в headless Chromium.
* `bench-authority` (CPU этого контейнера, 4 ядра): ≈73 тыс. полных проверок шагов 1–4 в секунду native, ≈35 тыс./с
  в WASM под Node. Это замер CPU-логики, **не** FPS и не задержка модели.

## Что НЕ проверено

* Никакая языковая модель не запускалась: «модельные» ответы — правила или скриптовые JSONL. Качество NPC с
  реальной моделью, задержки и стоимость — не измерены.
* Производительность на RTX 3060 и 60 FPS ядром не доказываются; цифры GPU-гейта — пороги политики из
  `profiles.json`, проверенные на синтетических сэмплах.
* Русские реплики написаны как авторская библиотека; вычитка носителями и оценка игроками не проводились.
* Параллельный доступ из нескольких потоков не поддерживается (ядро однопоточное; хост вызывает его по очереди).
