# Agent Gateway — шлюз моделей «Нулевого эха»

Backend-компонент Echo Runtime (docs/SPEC.md §7; Документ §15–§18, сетевые и ключевые части §7 и §11).
Игровое ядро формирует **GatewayRequest** (`schemas/gateway_request.schema.json`), шлюз отправляет его
выбранному исполнителю — mock, локальному llama.cpp, своему серверу vLLM, OpenAI, Claude, Gemini или
пользовательскому endpoint — и возвращает нормализованный **GatewayResult** (`schemas/gateway_result.schema.json`).

Главное правило Документа соблюдается и здесь: **модель предлагает — игра проверяет**. Шлюз не решает
игровую допустимость. `proposal_text` — сырой текст модели (допускается только снятие markdown-ограды
функцией `extractJsonCandidate` из `shared/prompt.ts`); дубликаты ключей, неизвестные поля, чужие и
защищённые факты проверяет Intent Authority ядра. Шлюз отвечает за то, что от него зависит: приватность,
ключи, сеть, сроки, квоты, учёт usage и стоимости.

Промпт и узкая JSON Schema каждого запроса берутся только из `shared/prompt.ts`
(`buildIntentMessages`, `buildIntentSchema`, `buildDialogueMessages`, `PROMPT_VERSION`) — шлюз их не копирует.

## Запуск

Node ≥ 22.18 (TypeScript исполняется напрямую, без сборки). Из корня репозитория:

```bash
npm ci --prefix gateway        # официальный @anthropic-ai/sdk (нужен только маршруту anthropic)

# backend-режим (по умолчанию только 127.0.0.1:8787)
node gateway/src/server.ts --config data/providers.example.json

# локальный помощник для браузера: loopback, проверка Host и Origin, токен на каждом методе
node gateway/src/server.ts --config data/providers.example.json --local-helper --origin http://127.0.0.1:8000

# тесты (только loopback, без ключей и внешней сети) и проверка типов
node --test gateway/test/
npx tsc -p tsconfig.json

# CLI
node gateway/src/cli.ts cost --rph 150 --in 1200 --out 180 --pin 1 --pout 5      # → 0.315 USD/h
node gateway/src/cli.ts cost --rph 2160 --in 1200 --out 180 --route openai         # тариф из pricing.example.json → 4.536 USD/h
node gateway/src/cli.ts probe                       # опрос локальных маршрутов
node gateway/src/cli.ts probe --allow-remote --deep # + удалённые (только по явному решению владельца; deep тратит токены)
node gateway/src/cli.ts manifest                    # build manifest
```

Флаги сервера: `--host`, `--port`, `--local-helper`, `--allow-lan` (без него адрес, отличный от loopback,
отклоняется — в том числе `0.0.0.0`), `--origin <origin>` (добавить в allowlist), `--secrets <файл>`,
`--log-file <путь>`, `--debug-content` (писать содержимое разговоров в журнал — только для отладки).

Пример обмена:

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8787/v1/session -H 'content-type: application/json' \
  -d '{"privacy_profile":"offline","client":"eval"}' | jq -r .session_token)
curl -s -X POST http://127.0.0.1:8787/v1/intent -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H 'x-echo-mock: adversarial_spoiler' --data @request.json
```

Программно (eval, тесты): `new Gateway(loadConfig(path))`, затем `createSession()` и
`handle(session, request, 'generate_intent', { receivedAt })` — тот же путь, что и по HTTP.

## HTTP API

| Метод | Путь | Описание |
|---|---|---|
| POST | `/v1/session` | `{privacy_profile, client, route?, quotas?, custom_endpoint?}` → `{session_token, expires_at, quotas, routes, default_route, schema_version, prompt_version}`. Квоты можно только уменьшить. |
| POST | `/v1/intent` | GatewayRequest (`capability: generate_intent`) + `Authorization: Bearer`, опц. `X-Echo-Route`, `X-Echo-Mock` → GatewayResult (HTTP 200 при любом статусе модели). |
| POST | `/v1/dialogue` | то же для `generate_dialogue` (экспериментальная свободная реплика, `schemas/dialogue.schema.json`). |
| POST | `/v1/cancel` | `{task_id}` → `{task_id, cancelled, state}`; `state`: `running`, `done`, `cancelled`, `pre_registered`. |
| GET | `/v1/health` | маршруты, состояние circuit breaker, занятость очередей, наличие ключа (да/нет, без значения). |
| GET | `/v1/providers` | результаты `probe` (без секретов); `?refresh=1`, `?deep=1` (deep — только для локальных). Опрашиваются только маршруты, разрешённые профилем сессии. |
| GET | `/v1/usage` | usage и стоимость сессии: измеренные/оценочные попытки, оставшиеся квоты, оценки по прерванным вызовам. |
| GET | `/v1/manifest` | build manifest: `schema_version`, `prompt_version`, sha256 исходника промпта, git revision, закреплённые модели, версии адаптеров, флаг вымышленности тарифов. |

Дополнительно к SPEC: заголовки ответа `X-Echo-Route-Used` (какой маршрут реально ответил) и
`X-Echo-Replay: true` (повторная доставка того же `task_id`). Поле `provider` в GatewayResult — **id
маршрута** из конфигурации (`mock`, `local_llamacpp`, `openai`, …); тип адаптера виден в `/v1/manifest`.
Ошибки протокола (нет токена, плохой JSON, запрос не по схеме, конфликт `task_id`) — HTTP 4xx с
`{error: {code, message}}`; ошибки модели и сети — всегда GatewayResult со статусом.

## Нормализованные статусы

| status | Когда |
|---|---|
| `ok` | получен полный ответ, синтаксически это один JSON-объект. Игровую допустимость проверяет ядро. |
| `timeout` | истёк общий срок `deadline_ms` (считается от приёма запроса, включая очередь) или срок в очереди. Поздний ответ отбрасывается. |
| `refused` | отказ модели: элемент `refusal` (OpenAI), `stop_reason: refusal` (Claude), `blockReason` / `SAFETY` / `RECITATION` (Gemini), `content_filter`. **Никогда** не перенаправляется другой модели. |
| `invalid_output` | ответ обрезан по лимиту токенов (`incomplete`, `max_tokens`, `length`, `MAX_TOKENS`), поток оборвался, пусто, не JSON-объект, больше 8192 символов. Частичный JSON не применяется; сырой текст оставлен для отладки. |
| `unavailable` | маршрут выключен, запрещён профилем приватности (`privacy_blocked`), открыт circuit breaker (`circuit_open`), нет ключа, ошибка сети/5xx, модель не найдена или не совпала, возможность не подтверждена handshake (`capability_unsupported`), endpoint заблокирован политикой SSRF. |
| `rate_limited` | 429 провайдера (с `retry_after_ms`), лимит запросов сессии в минуту, переполнена очередь шлюза. |
| `budget_exceeded` | лимит токенов сессии в час, лимит стоимости сессии, `insufficient_quota` / 402 у провайдера. |
| `cancelled` | игра вызвала `/v1/cancel`; поздний ответ отбрасывается, его usage всё равно учитывается. |

## Сетевая политика (Документ §17)

* **Строгий общий срок.** Попытка получает `оставшееся время − deadline_margin_ms`; по истечении запрос
  к провайдеру прерывается (соединение закрывается), игра сразу получает `timeout`.
* **Не более одного осмысленного повтора** (`retry.max_attempts` ≤ 2, проверяется при загрузке).
  Повтор — только для временных сбоев (429/5xx/сеть), только если после паузы осталось
  `retry.min_remaining_ms`. Пауза: full jitter экспоненциального backoff; `Retry-After` (секунды или
  HTTP-дата, `retryDelay` Gemini, `retry-after-ms`) соблюдается как минимум — если он не помещается в срок,
  повтора нет, а `retry_after_ms` уходит игре. `retry.attempt_timeout_ms` (опционально) ограничивает
  первую попытку, чтобы зависший провайдер оставил время на повтор/запасной маршрут.
* **Circuit breaker** на маршрут: `failure_threshold` подряд неудач (unavailable/timeout/rate_limited) →
  `open` (запросы сразу получают `unavailable/circuit_open` без обращения к провайдеру) → после `cooldown_ms`
  `half_open` с одной пробой → успех `closed`, неудача — снова `open` с удвоенным cooldown (≤ `max_cooldown_ms`).
* **Пределы конкурентности:** глобальный (`limits.global_concurrency`) и на маршрут (`concurrency`,
  у llama.cpp по умолчанию 1 — одна генерация на общий экземпляр модели, §11) с ограниченными очередями.
* **Идемпотентность:** повторная доставка того же `task_id` в той же сессии возвращает кэшированный (или
  ещё выполняющийся) результат без второго вызова провайдера; тот же `task_id` с другим телом — 409.
* **Отмена:** `/v1/cancel` прерывает соединение (best effort — провайдер мог уже потратить токены), результат
  `cancelled`, поздний ответ отбрасывается (`late_response_discarded` в журнале), его измеренный usage
  записывается. Отмена до прихода запроса регистрируется заранее. Для прерванного вызова без ответа в лимит
  сессии засчитывается худшая оценка (вход + полный выходной бюджет).

## Приватность и маршрутизация (Документ §11, §15)

* `offline` — только локальные маршруты (mock, llama.cpp на loopback, локальный OpenAI-совместимый
  сервер). Ничего не уходит с машины; удалённые провайдеры даже не опрашиваются `probe`.
* `hybrid` — локальные + явный список `privacy.hybrid_remote_allowlist`.
* `online` — локальные + `privacy.online_remote_allowlist` (`"all_enabled"` — все включённые удалённые).
* Действует **более строгий** профиль из сессии и запроса. Маршрут по умолчанию обязан быть локальным.
* **Нет скрытого перехода к другому провайдеру.** Запасной маршрут используется только если он указан в
  `fallback_route` **и** разрешён профилем; он и есть тот самый единственный повтор (переход виден в
  `provider` и `X-Echo-Route-Used`). Запасной маршрут подхватывает только сбои доступности, но не отказы
  и не неверный вывод.

## Модель безопасности

* **Ключи** — только на сервере: `ECHO_KEY_<МАРШРУТ>` (например `ECHO_KEY_OPENAI`) или JSON-файл
  `{"keys": {"openai": "..."}}` с правами **0600** и владельцем-текущим пользователем (иначе файл отклоняется,
  содержимое в ошибку не попадает). Ключи не попадают в ответы, журналы и ошибки: всё исходящее проходит
  через редактор (точные значения ключей + типовые формы `sk-…`, `AIza…`, `Bearer …`, `x-api-key: …`).
  Клиент получает только случайный токен сессии (32 байта) с квотами; хранится лишь его sha256.
* **SSRF.** Каждый endpoint: только http(s), без учётных данных и query в URL; удалённые маршруты — только
  https на публичные адреса. Имя разрешается DNS **один раз на запрос**, проверяются **все** адреса
  (запрещены 0/8, 10/8, 100.64/10 CGNAT, 127/8, 169.254/16 и адреса метаданных, 172.16/12, 192.168/16,
  multicast/reserved, `::`, `::1`, fc00::/7, fe80::/10, IPv4-mapped/NAT64/6to4 с частным адресом внутри),
  соединение **закрепляется** за проверенным адресом (защита от DNS rebinding), TLS проверяется по имени.
  Редиректы не выполняются, размер ответа ограничен, клиент маршрута не может обратиться к чужому origin
  — поэтому ключ маршрута уходит только на его хост. Частная сеть или http для своего сервера — только явная
  настройка владельца (`network.allow_private_network`, `network.allow_insecure_http`); адреса метаданных
  запрещены всегда.
* **Пользовательский endpoint** (`custom_endpoint`, выключен по умолчанию): адрес задаёт сессия
  (`POST /v1/session {custom_endpoint: {url, model, api_key?, capabilities?}}`), всегда только https на публичный
  адрес; плавающие алиасы моделей запрещены; ключ владельца туда **никогда** не отправляется, ключ игрока
  живёт только в памяти сессии и тоже вычищается из журналов.
* **Локальный помощник** (`--local-helper`): привязка только к 127.0.0.1 (`0.0.0.0` — лишь с `--allow-lan`),
  проверка заголовка `Host` (защита от DNS rebinding), проверка `Origin` по allowlist на каждом запросе
  (включая создание сессии и preflight; ответ `Access-Control-Allow-Private-Network` — только разрешённым
  origin), токен сессии обязателен на всех методах, кроме `/v1/session`.
* В обоих режимах: чужой `Origin` → 403 без CORS-заголовков; тело POST — только `application/json`
  (никаких «простых» CSRF-запросов), ограничение размера тела, `Cache-Control: no-store`.
* **Журнал** — JSONL (stdout или `--log-file`, права 0600): идентификаторы, статусы, тайминги, usage,
  стоимость. Реплики игрока, промпты и ответы моделей не пишутся без `--debug-content`.
* `player_utterance` — речь персонажа, а не инструкция шлюзу: шлюз его не интерпретирует.

## Адаптеры

| Адаптер | Вызов | Структурированный ответ | Thinking / reasoning | Отказ / обрыв |
|---|---|---|---|---|
| `mock` | без сети | детерминированный генератор; режимы `X-Echo-Mock`: `good`, `adversarial_unknown_field`, `adversarial_spoiler`, `adversarial_dup_keys`, `adversarial_foreign_fact`, `slow`, `timeout`, `429`, `500`, `429_once`, `500_once`, `refusal`, `garbage`, `truncated` | — | usage — оценка (`measured: false`), TTFT не выдумывается |
| `llamacpp` | `POST /v1/chat/completions` (SSE) | `response_format: json_schema` → GBNF, `max_tokens`, `cache_prompt` | `chat_template_kwargs: {enable_thinking: false}` | `length` → invalid_output; `reasoning_content` игнорируется |
| `openai` | `POST /v1/responses` | `text.format {type: json_schema, name, schema, strict: true}`, `max_output_tokens`, `store: false` | `reasoning.effort` — только если задан владельцем | `incomplete` (max_output_tokens / content_filter), элемент `refusal`, `insufficient_quota` |
| `anthropic` | официальный SDK, `messages.create` | `output_config.format {type: json_schema}` | `output_config.effort` (по умолчанию `low`) + запас `extra_output_tokens` | `stop_reason` проверяется до `content`: `refusal`, `max_tokens` |
| `gemini` | `POST /v1beta/models/{m}:generateContent` | `responseMimeType: application/json` + `responseJsonSchema` (при отказе endpoint — `responseSchema`-подмножество) | `thinkingConfig.thinkingBudget` — только если задан | `promptFeedback.blockReason`, `SAFETY`/`RECITATION`/…, `MAX_TOKENS` |
| `openai_compat` | `POST /v1/chat/completions` | `response_format {type: json_schema, json_schema: {name, schema, strict: true}}` | `chat_template_kwargs` из конфигурации | `length`, `content_filter` |

**Почему для llama.cpp выбран `/v1/chat/completions`.** Сервер сам применяет chat template из GGUF (Jinja),
поэтому промпт не переупаковывается вручную; thinking отключается технически через
`chat_template_kwargs.enable_thinking=false` (Qwen3), а не просьбой «не думай» (Документ §10);
`json_schema` превращается сервером в грамматику GBNF (подмножество JSON Schema, [S11]); SSE даёт настоящее
время до первого токена за один запрос. Режим `options.mode: "completion"` (`/apply-template` +
`/completion` с `json_schema` и `n_predict`) оставлен для серверов без `--jinja`. Перед первой генерацией
выполняется handshake: `/health` (503 — модель загружается), `/props` (путь GGUF, шаблон, контекст) и
`/v1/models`; несовпадение закреплённой модели → `unavailable/model_mismatch`.

**OpenAI-совместимые серверы.** Название «OpenAI-compatible» ничего не гарантирует (Документ §16).
Возможности определяются handshake `GET /v1/models` (модель должна быть в списке; если сервер публикует
поля возможностей — они главнее), явным объявлением владельца `options.declared_capabilities` или deep probe —
**никогда** по имени модели. Неподтверждённая возможность сообщается в `probe` и отклоняется
(`capability_unsupported`).

**Серверный refusal-fallback Claude выключен намеренно.** Anthropic рекомендует для `claude-opus-5-5`
параметр `fallbacks: "default"` (бета `server-side-fallback-2026-07-01`): отклонённый классификатором запрос
API само перезапускает на **другой** модели. В этой игре по умолчанию это запрещено: Документ требует, чтобы
разговор не уходил к другому исполнителю без явного решения владельца, а отказ обрабатывался игрой
(обычный ИИ + допустимая реплика). Владелец может включить флаг маршрута
`options.server_side_refusal_fallback: true`; тогда шлюз шлёт бета-заголовок и `fallbacks: "default"`, а в
`provider_revision` отмечает «(server-side fallback)», если ответила запасная модель.

### Учёт usage

`usage.input_tokens` — все входные токены, включая кэшированные (`cached_input_tokens` — их подмножество;
у Claude к входным прибавляются `cache_read` и `cache_creation`). `usage.output_tokens` — все тарифицируемые
выходные, включая reasoning/thinking (`reasoning_tokens` — подмножество; у Gemini
`candidatesTokenCount + thoughtsTokenCount`). `measured: true` — числа пришли от провайдера; `false` —
оценка шлюза (mock) или прерванный вызов без ответа. `latency_ms.first_token` — только при потоковой
передаче (llama.cpp, opt-in для openai_compat), иначе `null`: время первого токена не подменяется.

## Конфигурация

`data/providers.example.json` (формат `zero-echo.providers.v1`, поля `note_ru` — комментарии):

* `server`: `host` (по умолчанию 127.0.0.1), `port`, `max_body_bytes`, `allowed_origins`, `session_ttl_s`, `max_sessions`.
* `limits`: `global_concurrency`, `global_max_queue`, `result_cache_ttl_s` / `result_cache_max` (кэш по `task_id`),
  `deadline_margin_ms`, `max_response_bytes`.
* `default_quotas`: `requests_per_min`, `tokens_per_hour`, `cost_cap_usd`.
* `privacy`: `hybrid_remote_allowlist`, `online_remote_allowlist`.
* `default_route` (локальный), `pricing_file`, `secrets_file`.
* `routes[]`: `id`, `adapter`, `enabled`, `locality` (`local`/`remote`), `endpoint`, `model` (**закреплённый**:
  `latest`, `*-latest`, `:latest`, `default`, `auto` отклоняются с понятной ошибкой), `model_revision`,
  `capabilities`, `concurrency`, `max_queue`, `retry {max_attempts ≤ 2, base_backoff_ms, max_backoff_ms,
  min_remaining_ms, attempt_timeout_ms?}`, `breaker {failure_threshold, cooldown_ms, max_cooldown_ms}`,
  `network {allow_private_network, allow_insecure_http}`, `fallback_route`, `user_supplied_endpoint`,
  `options` (параметры адаптера; неизвестные ключи — ошибка).

Все удалённые маршруты в примере **выключены**. Чтобы включить, например, OpenAI: задать
`ECHO_KEY_OPENAI`, поставить `enabled: true`, проверить закреплённую модель и тариф, добавить маршрут в
allowlist нужного профиля, выполнить `node gateway/src/cli.ts probe --allow-remote --deep`.
Включённый удалённый маршрут без тарифа шлюз не запустит (иначе лимит стоимости нельзя соблюсти).

## Стоимость (Документ §18)

`цена_часа = запросы_в_час × (input_tokens × P_in + output_tokens × P_out) / 1 000 000`.
Пример Документа: 150 запросов/ч, 1200 входных и 180 выходных токенов, условные $1/$5 за 1M →
**0.315 USD/h**; 2160 запросов/ч → **4.536 USD/h** (оба числа проверяются тестами и CLI).
Тарифы берутся только из `data/pricing.example.json`; **все они вымышленные** (`"fictional": true`), реальный
тариф требует `fictional: false`, `verified_on` и `source`. Стоимость запросов считается по измеренному usage
(кэшированные входные — по `cached_input_per_mtok`, запись в кэш — по `cache_write_per_mtok`), в GatewayResult
есть `cost_usd` и `cost_is_fictional`.

## Что проверено, а что нет

| Что | Статус | Как |
|---|---|---|
| Нормализация всех 8 статусов; формы запросов OpenAI Responses, Claude Messages (через SDK), Gemini, llama-server, OpenAI-compatible | **pass** (локально) | `node --test gateway/test/` — поддельные серверы на loopback (порты 18700–18799) |
| Узкие enum в схемах, лимиты токенов, ключи только в заголовках своего хоста | **pass** | те же тесты |
| Срок, один повтор, backoff/Retry-After, circuit breaker, конкурентность, идемпотентность, отмена и отбрасывание позднего ответа, квоты | **pass** | тесты политики и шлюза (mock и поддельные провайдеры) |
| Профили приватности, отсутствие скрытого fallback, SSRF (частные, loopback, link-local, metadata, CGNAT, ULA, rebinding-pinning), Origin/Host в режиме помощника, редакция ключей | **pass** | тесты net/privacy/server |
| Арифметика стоимости и CLI | **pass** | 0.315 и 4.536 USD/h |
| Реальные OpenAI / Anthropic / Gemini | **not_run** | ключей нет, платные API не вызывались; модели и тарифы в примере требуют проверки владельцем |
| Реальный llama-server с Qwen3-1.7B, vLLM | **not_run** | модели не скачивались; проверен только протокол на поддельном сервере |
| Задержка, качество NPC, надёжность сети, 60 FPS | **not_run** | тесты на искусственных входах не являются доказательством качества, задержки p95 или сетевой надёжности (Документ §19, §21) |

## Ограничения прототипа

* Состояние (сессии, кэш `task_id`, breaker) — в памяти одного процесса; для нескольких экземпляров нужен общий стор.
* Потоковая передача реализована для chat completions (llama.cpp, openai_compat); OpenAI Responses, Claude и
  Gemini вызываются без потока — `first_token` у них `null`.
* Исходящий HTTP-прокси не поддерживается (соединение идёт напрямую к закреплённому адресу).
* Оценка входных токенов для квот — эвристика `ceil(символов / 3.2)`; фактический usage приходит от провайдера.
* BYO-ключ для собственного endpoint живёт только в памяти сессии; системное хранилище секретов (native BYOK,
  Документ §17) — задача клиента.
