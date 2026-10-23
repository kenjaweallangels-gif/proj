# Eval NPC: 100 сцен и прогон провайдеров

Набор сцен и харнесс для сравнения исполнителей намерений NPC на **одинаковых** сценах (Документ §16:
«нужен одинаковый набор из 100 сцен на русском»; §19 «ИИ-метрики»). Каждая сцена проходит через настоящее
ядро Echo Runtime (WASM-сборка `core/build-wasm/echo_core.mjs`, та же, что в браузерном клиенте) и его
Intent Authority — провайдер только предлагает, игра проверяет.

Сводка последних прогонов: [`reports/eval/README.md`](../reports/eval/README.md) (машиночитаемо — `reports/eval/index.json`).

## Быстрый старт

```bash
node eval/run.ts --provider rules                       # обычный игровой ИИ ядра, без модели (≈1 с)
node eval/run.ts --provider mock:good                   # Agent Gateway в процессе, mock-адаптер
node eval/run.ts --provider mock:adversarial_spoiler    # враждебные ответы: защищённый факт
node eval/run.ts --provider mock:timeout --deadline-ms 800 --concurrency 4
bash eval/run_all.sh                                    # все отчёты reports/eval/* + сводка (≈2 мин)
node --test eval/test/*.test.ts                         # тесты набора, оценщика, раннера и CLI
node eval/run.ts --lint-only                            # только проверка набора сцен
node eval/run.ts --provider rules --dump ch-001         # показать GatewayRequest, который ядро строит для сцены
```

Отчёт пишется в `reports/eval/<провайдер>.json` (машиночитаемый) и рядом `.md` (сводка по-русски);
путь меняется `--out`. Коды выхода: `0` pass, `1` fail, `2` ошибка вызова/конфигурации, `3` not_run.

## Провайдеры

| `--provider` | Что это |
|---|---|
| `rules` | `rules_propose` ядра — UtilityPolicy (Документ §8). Модели нет; задержки — время CPU. |
| `mock:<поведение>` | `gateway/src` как библиотека, маршрут `mock`, заголовок `X-Echo-Mock`: `good`, `adversarial_unknown_field`, `adversarial_spoiler`, `adversarial_dup_keys`, `adversarial_foreign_fact`, `slow`, `timeout`, `429`, `500`, `429_once`, `500_once`, `refusal`, `garbage`, `truncated`. Модели нет. |
| `route:<маршрут>` | любой маршрут конфигурации шлюза (`--config`, по умолчанию `data/providers.example.json`) в процессе: `local_llamacpp`, `openai`, `anthropic`, `gemini`, `vllm_selfhost`… Перед прогоном — probe; выключенный/недоступный маршрут даёт `not_run` с причиной, без единого вызова. |
| `gateway:<url>:<маршрут>` | запущенный шлюз по HTTP (`/v1/session`, `/v1/providers`, `/v1/intent`), например `gateway:http://127.0.0.1:8787:local_llamacpp`; для mock-маршрута — `--mock-behavior <поведение>`. |

Опции: `--privacy offline|hybrid|online` (для удалённых маршрутов по умолчанию `online`; ядро переводится в тот же
профиль и выдаёт запросы с backend `remote`), `--deadline-ms N` (срок, передаваемый провайдеру: `deadline_ms`
запроса ≤ N; собственный срок ядра — из `data/profiles.json`), `--concurrency N` (сцен параллельно; по умолчанию 1 —
задержки без очереди), `--shared-gateway` (один экземпляр шлюза на прогон: видны circuit breaker и квоты между
сценами; по умолчанию каждая сцена — свежий шлюз и своя сессия, как отдельная игра), `--only id,id`,
`--category <категория>`, `--note <текст>` (пояснение в отчёт).

## Как запустить реальных провайдеров (делает владелец)

Здесь реальные провайдеры **не запускались**: нет ключей и весов моделей. Их отчёты в `reports/eval/route_*.json` —
`not_run` с причиной. Тесты контракта идут без ключей; реальный прогон включается только конфигурацией владельца
(Документ §20). Полный прогон — 100 запросов; по оценке шлюза ≈1000 входных и ≈40 выходных токенов на запрос
(≈0,1 млн входных токенов на прогон, плюс reasoning-токены, если модель их тратит).

1. **Конфигурация.** Скопируйте `data/providers.example.json` в свой файл (например `~/zero-echo/providers.json`;
   в репозиторий не коммитьте), включите маршрут (`"enabled": true`), проверьте закреплённый id модели
   (никаких `latest`) и при профиле `hybrid` добавьте маршрут в `privacy.hybrid_remote_allowlist`.
   Тариф — в своём файле тарифов с `"fictional": false`, `verified_on`, `source` (иначе стоимость останется вымышленной).
2. **Ключи** — только в окружении сервера/харнесса или в файле секретов с правами `0600`, никогда в данных игры:
   `ECHO_KEY_OPENAI`, `ECHO_KEY_ANTHROPIC`, `ECHO_KEY_GEMINI`, `ECHO_KEY_VLLM_SELFHOST` (имя = `ECHO_KEY_<МАРШРУТ>`).
3. **Запуск:**
   ```bash
   export ECHO_KEY_OPENAI=…   # ключ владельца
   node eval/run.ts --provider route:openai --config ~/zero-echo/providers.json --privacy online --out reports/eval/route_openai.json
   node eval/run.ts --provider route:anthropic --config ~/zero-echo/providers.json --privacy online --out reports/eval/route_anthropic.json
   node eval/run.ts --provider route:gemini --config ~/zero-echo/providers.json --privacy online --out reports/eval/route_gemini.json
   node eval/summarize.ts
   ```
4. **llama.cpp (локально).** Скачайте GGUF сами (например Qwen3-1.7B Q4_K_M — версию и шаблон зафиксируйте),
   запустите `llama-server -m <модель>.gguf --jinja --host 127.0.0.1 --port 8081` и укажите этот порт в `endpoint`
   маршрута `local_llamacpp` своей конфигурации (порт 8080 по умолчанию занят `tools/serve.mjs`). Шлюз сверит имя
   модели с `/props` и `/v1/models`. Затем `node eval/run.ts --provider route:local_llamacpp --config <ваш файл>`.
   Для честной задержки не запускайте одновременно рендер, сборку и другие тяжёлые процессы (Документ §19).
5. **vLLM / свой сервер:** `endpoint` по https, `model_revision` (commit весов), `declared_capabilities`; для сервера в
   частной сети — `network.allow_private_network: true`. Запуск — `--provider route:vllm_selfhost`.
6. **Через запущенный шлюз:** `node gateway/src/server.ts --config <ваш файл> --port 8787`, затем
   `node eval/run.ts --provider gateway:http://127.0.0.1:8787:<маршрут>`.

Повторяйте прогон несколько раз и на разных сетях: один прогон — одна выборка задержек.

## Формат сцены (`data/eval/scenes_ru.json`)

| Поле | Смысл |
|---|---|
| `id`, `category`, `npc_id`, `title_ru`, `register`, `notes_ru` | `category` ∈ `character`, `sensor_contradiction`, `risk_request`, `known_unknown_facts`, `spoiler_attempt`, `impossible_task`, `world_change`; `register` — тон реплики (`neutral`, `casual`, `formal`, `urgent`, `rude`, `emotional`, `adversarial`, `injection`, `none` для инициатив) |
| `setup` | команды до запроса на свежем ядре. Макросы харнесса: `advance {seconds, background: expire\|rules, plans: leave\|accept\|reject}` (тики по 0,5 с; фоновые запросы других NPC истекают в обычный ИИ или сразу отвечаются им), `settle`, `decide_plans`. Команды ядра: `debug_patch`, `player_say`, `player_order`, `set_ai_mode` (`now_ms` подставляется). |
| `request` | `say` (реплика `player_utterance` → `player_say`), `order` (`player_order` с `action/target_id/companion_id`; `player_utterance` — формулировка в интерфейсе, ядру не передаётся), `initiative` (запрос-инициатива этого NPC из очереди; `player_utterance: null`) |
| `mutate_during_response` | операции `debug_patch`, применяемые между выдачей запроса и `submit_result` |
| `expectations.forbidden_actions`, `forbidden_fact_ids`, `forbidden_proposals` | **жёсткие**: то, что игра не должна допустить в этом состоянии при любом ответе провайдера. Защищённые факты запрещены везде автоматически; факты, неизвестные NPC на момент запроса, — тоже. |
| `expectations.acceptable_actions`, `expected_outcome_any_of`, `discouraged_proposals`, `expected_fact_ids_any_of` | **качество**: итоговое поведение NPC, ожидаемый исход (`accepted`, `awaiting_player`, `rejected`, `stale`, `fallback`), нежелательные по характеру выборы, ожидаемые факты-обоснования |

Шаблон предложения (`forbidden_proposals`, `discouraged_proposals`): `{action?, target_id?, companion_id?, solo?, fact_id?, note_ru?}` —
совпадает, если совпали все указанные поля (`solo: true` — без напарника).

Харнесс проверяет набор статически (`--lint-only`: ссылки на мир, противоречия) и в момент запроса: запрещённые
факты действительно неизвестны NPC, ожидаемые — известны, хотя бы одно допустимое действие предложено ядром. Иначе
сцена помечается как несогласованная (`scene_invalid`), и прогон получает `fail`: это ошибка набора, а не провайдера.

## Метрики

| Метрика | Определение |
|---|---|
| `violations_admitted` | число сцен, где игра **допустила** запрещённое: принятое предложение провайдера или fallback ядра содержит запрещённое действие/сочетание, защищённый, запрещённый, неизвестный NPC или не выданный в запросе факт, не предложенные действие/цель/напарника, лишнее поле; принятое предложение зависит от сущности, изменённой во время ответа (подмножество шага 3 Intent Authority); реплика содержит сырой текст модели, защищённый текст или неизвестный факт; NPC узнал запрещённое; ядро сообщило нарушение инвариантов; запрос/ответ не по схеме. **Цель — 0.** `violation_findings` — все находки по типам. |
| `soft_violations_admitted` | итоговое поведение совпало с `discouraged_proposals` (допустимо правилами, но против характера/ситуации) |
| `valid_intent_rate` | доля сцен, где предложение провайдера принято (`accepted` или план `awaiting_player`) |
| `invalid_intents`, `invalid_intents_by_reason` | провайдер ответил, но ответ — не допустимое намерение: отклонён Intent Authority (`format:*`, `knowledge:*`, `offer:*`, `rules:*`) или уже шлюзом (`gateway:not_json`, `gateway:truncated`…). `stale` и отказ по правилам из-за смены мира в сцене `world_change` (`rejected_after_world_change`) считаются отдельно — это не вина провайдера. |
| `expectation_match_rate` | доля сцен, где одновременно: исход ∈ `expected_outcome_any_of`, итоговое действие ∈ `acceptable_actions`, нет нежелательного выбора, есть ожидаемый факт (если задан) и нет нарушений. Промах из-за того, что ядро не выдало ожидаемый факт в запросе, помечается `context_gap` (вопрос к ContextBuilder, а не к модели). |
| `model_choice_acceptable_rate` | доля разобранных предложений самого провайдера с действием из `acceptable_actions` (без сцен `world_change`, где допустимость оценивается после изменения мира) |
| `fallback_rate`, `fallback_by_reason` | доля сцен, где поведение построил fallback ядра, и причины (`stale`, `invalid_output`, `authority_rejected`, `timeout`, `deadline`, `unavailable`, `refused`…) |
| `latency_ms` | `provider_total` — время провайдера по данным шлюза; `first_token` — только при потоковой передаче (иначе нет данных); `ready` — от выдачи запроса до проверенного ответа (провайдер + Intent Authority). p50/p95/p99 — ближайший ранг. |
| `speech` | по одной итоговой реплике на сцену: число шаблонов и текстов, повтор шаблона между сценами, доля персональных шаблонов, различимость NPC = 1 − средний коэффициент Жаккара словарей реплик разных NPC |
| `tokens`, `cost` | usage из `GatewayResult` (`measured` — от провайдера или оценка шлюза), стоимость по `data/pricing.example.json` (все тарифы вымышленные) и цена часа по Документу §18 при 150 и 2160 запросах/час; справочно — та же арифметика при условных $1/$5 за 1M |

`status`: `pass` — все сцены выполнены, набор согласован и `violations_admitted = 0`; `fail` — иначе;
`not_run` — провайдер не запускался (причина в отчёте). Качество — метрики для сравнения, не условие pass.

## Ограничения (читать до выводов)

- **100 сцен и ноль ошибок не доказывают невозможность ошибки** (Документ §19). Защита критичного держится на коде
  Intent Authority; качество речи и характера оценивается вероятностно.
- **Автоматическая оценка — первичная сортировка.** Ожидания написаны автором набора и могут быть спорными;
  естественность, характер, вовлечение и уместность реплик требуют просмотра человеком (Документ §20).
  Например, текст контролируемой реплики оценщик не понимает: противоречие между репликой и ситуацией видно
  только при чтении.
- `rules` и `mock:*` — не языковые модели: их задержки — время CPU этой машины и заданные задержки mock,
  а не время ответа модели; usage mock — оценка шлюза. Это проверка пути «шлюз → ядро → authority», а не качества NPC.
- Цифры этой машины (облачный контейнер без GPU) не переносятся на ПК игрока; задержки моделей и стоимость
  измеряются только реальными прогонами владельца.
- Сцены идут на свежих ядрах: антиповтор реплик внутри смены не проявляется; повтор между сценами отражает ширину
  библиотеки шаблонов.

## Файлы

- `eval/run.ts` — CLI; `eval/summarize.ts` — сводка `reports/eval/README.md` + `index.json`; `eval/run_all.sh` — все прогоны.
- `eval/lib/core.ts` (ядро WASM и данные), `scenes.ts` (формат и проверка набора), `runner.ts` (прогон сцены),
  `providers.ts` (rules, шлюз в процессе, шлюз по HTTP), `score.ts` (оценка и агрегаты), `report.ts` (JSON и Markdown).
- `eval/test/` — тесты: инварианты набора, проверка набора, оракул нарушений на синтетических наблюдениях, прогон
  на ядре WASM, mock-шлюз, CLI, `tools/hw_manifest.py`.
