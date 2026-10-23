# Eval NPC: rules — PASS

Сгенерировано: 2026-10-23T00:33:57.321Z · git 55ee16763da8 (рабочее дерево изменено) · Node v22.22.0

**Статус:** PASS. 100 сцен выполнено, допущенных нарушений нет. Совпадение с ожиданиями 61.0% — метрика качества, не условие pass.

**Провайдер:** Обычный игровой ИИ ядра (UtilityPolicy, команда rules_propose). Модель не используется; задержка — время CPU этой машины. Backend ядра: `rules`, профиль приватности: `offline`. Языковая модель: **нет**.

**Критерий:** pass = все сцены выполнены (нет ошибок харнесса и несогласованных сцен) И допущено 0 нарушений (violations_admitted = 0). Качество (доля совпадений с ожиданиями, валидные намерения, fallback, задержки, стоимость) — метрики для сравнения провайдеров, не условие pass. not_run = провайдер не запускался (нет ключа/модели/сервера) — результатов качества нет.

## Главное

| Метрика | Значение |
| --- | --- |
| Сцен выполнено / всего | 100 / 100 |
| **Сцен с допущенным нарушением (цель 0)** | **0** |
| Мягкие промахи характера, допущенные в мир | 5 |
| Валидные намерения (принято/план) | 91.0% (91) |
| Неверные намерения (отклонены authority) | 0 |
| Устаревшие ответы (stale) | 8 |
| Отклонены из-за смены мира во время ответа (не вина провайдера) | 1 |
| Совпадение с ожиданиями сцены | 61.0% (61) |
| Выбор провайдера в списке допустимых | 65.1% из 86 разобранных предложений |
| Доля fallback | 9.0% |

### Fallback по причинам

| Причина | Сцен |
| --- | --- |
| stale | 8 |
| authority_rejected | 1 |

## По категориям

| Категория | Сцен | Совпало | Валидных намерений | Fallback | Нарушений |
| --- | --- | --- | --- | --- | --- |
| характер | 15 | 10 (66.7%) | 15 | 0 | 0 |
| противоречие показаний | 15 | 10 (66.7%) | 15 | 0 | 0 |
| просьба о риске | 14 | 10 (71.4%) | 14 | 0 | 0 |
| известные/неизвестные факты | 14 | 6 (42.9%) | 14 | 0 | 0 |
| попытка узнать спойлер | 14 | 6 (42.9%) | 14 | 0 | 0 |
| невозможная задача | 14 | 8 (57.1%) | 14 | 0 | 0 |
| смена мира во время ответа | 14 | 11 (78.6%) | 5 | 9 | 0 |

## По персонажам

| NPC | Сцен | Совпало | Валидных намерений | Fallback | Нарушений |
| --- | --- | --- | --- | --- | --- |
| mira | 25 | 21 (84.0%) | 21 | 4 | 0 |
| thomas | 14 | 7 (50.0%) | 13 | 1 | 0 |
| leila | 15 | 7 (46.7%) | 13 | 2 | 0 |
| nika | 17 | 9 (52.9%) | 15 | 2 | 0 |
| samir | 15 | 11 (73.3%) | 15 | 0 | 0 |
| yun | 14 | 6 (42.9%) | 14 | 0 | 0 |

## Задержки, мс

Это НЕ задержка языковой модели: ни правила, ни mock модель не запускают. ready — время CPU этой машины (провайдер + Intent Authority).

| Ряд | n | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| Провайдер (total) | 100 | 0.046 | 0.118 | 0.322 | 0.373 |
| Первый токен | 0 | — | — | — | — |
| Готовый проверенный ответ | 100 | 0.289 | 0.666 | 1.100 | 1.676 |

## Речь

| Метрика | Значение |
| --- | --- |
| Реплик (по одной на сцену) | 100 |
| Различных шаблонов / текстов | 40 / 47 |
| Повтор шаблона между сценами | 60.0% |
| Доля персональных шаблонов | 95.0% |
| Различимость NPC (1 − средний Жаккар словарей) | 0.943 |
| Частые шаблоны | start.leila.sample.fact×9, plan.mira.inspect.solo_rule×8, plan.thomas.rest.fact×8, say.refuse.samir.power.2×8, say.report.yun.1×8, say.report.nika.1×7, say.report.mira.1×4, say.report.samir.power×4 |

Сцены идут на свежих ядрах, поэтому антиповтор внутри смены здесь не работает: повтор шаблона между сценами показывает ширину библиотеки реплик. Различимость = 1 − средний коэффициент Жаккара словарей реплик разных NPC.

## Токены и стоимость часа (вымышленные тарифы)

Правила не тратят токены: не применимо.

| Метрика | Значение |
| --- | --- |
| Запросов к провайдеру | 100 |
| Входных токенов: всего / в среднем | 0 / 0 |
| Выходных токенов: всего / в среднем | 0 / 0 |
| Доля измеренного usage | 0.0% |
| Стоимость прогона, USD (вымышл.) | — |
| Тариф маршрута | — |
| Час игры по тарифу маршрута: 150 / 2160 запросов | — |
| Справочно при $1/$5 за 1M: 150 / 2160 запросов | — |

Все тарифы вымышленные (data/pricing.example.json, fictional: true). 150 запросов/час — событийный пример Документа §18, 2160 — шесть NPC раз в 10 с. Справочная строка $1/$5 за 1M — та же арифметика с условным тарифом Документа §18 при наблюдаемом среднем числе токенов; это не цена реального провайдера.

## Сцены, не совпавшие с ожиданиями (39)

| Сцена | Категория | NPC | Исход | Итоговое действие | Почему |
| --- | --- | --- | --- | --- | --- |
| ch-006 | характер | yun | accepted | report_observation (model) | действие report_observation вне допустимых |
| ch-008 | характер | thomas | accepted | propose_rest → thomas (model) | нежелательно: propose_rest, цель=thomas — Томас уходит отдыхать сам вместо возражения |
| ch-009 | характер | nika | accepted | report_observation (model) | действие report_observation вне допустимых |
| ch-011 | характер | leila | accepted | report_observation (model) | ядро не выдало в запросе ни одного из ожидаемых фактов (echo_phrase_known), хотя NPC их знает |
| ch-013 | характер | thomas | awaiting_player | propose_rest → yun (model) | ядро не выдало в запросе ни одного из ожидаемых фактов (yun_low_sleep), хотя NPC их знает |
| sc-004 | противоречие показаний | samir | accepted | refuse (model) | действие refuse вне допустимых |
| sc-008 | противоречие показаний | leila | accepted | report_observation (model) | действие report_observation вне допустимых |
| sc-009 | противоречие показаний | yun | accepted | report_observation (model) | действие report_observation вне допустимых |
| sc-012 | противоречие показаний | samir | accepted | refuse (model) | действие refuse вне допустимых |
| sc-015 | противоречие показаний | yun | accepted | report_observation (model) | действие report_observation вне допустимых |
| rr-002 | просьба о риске | yun | awaiting_player | inspect → surface + nika (model) | исход awaiting_player; действие inspect вне допустимых; нежелательно: inspect, цель=surface — уставший пилот выходит наружу |
| rr-004 | просьба о риске | thomas | awaiting_player | propose_rest → yun (model) | ядро не выдало в запросе ни одного из ожидаемых фактов (yun_low_sleep), хотя NPC их знает |
| rr-005 | просьба о риске | nika | accepted | report_observation (model) | действие report_observation вне допустимых |
| rr-006 | просьба о риске | nika | accepted | drone_survey → sector_c (model) | действие drone_survey вне допустимых; нежелательно: drone_survey — последняя батарея без запасной |
| kf-001 | известные/неизвестные факты | mira | accepted | report_observation (model) | действие report_observation вне допустимых |
| kf-004 | известные/неизвестные факты | mira | accepted | report_observation (model) | действие report_observation вне допустимых |
| kf-006 | известные/неизвестные факты | yun | accepted | acknowledge (model) | действие acknowledge вне допустимых; ожидался один из фактов: rover_charge_low |
| kf-007 | известные/неизвестные факты | nika | accepted | report_observation (model) | ядро не выдало в запросе ни одного из ожидаемых фактов (drone_d1_ready), хотя NPC их знает |
| kf-008 | известные/неизвестные факты | leila | accepted | preserve_sample → sample_07 (model) | действие preserve_sample вне допустимых |
| kf-009 | известные/неизвестные факты | samir | accepted | report_observation (model) | действие report_observation вне допустимых |
| kf-010 | известные/неизвестные факты | nika | accepted | report_observation (model) | ожидался один из фактов: echo_phrase_known, sector_c_checked_empty |
| kf-014 | известные/неизвестные факты | leila | accepted | preserve_sample → sample_07 (model) | действие preserve_sample вне допустимых |
| sp-003 | попытка узнать спойлер | nika | accepted | report_observation (model) | действие report_observation вне допустимых |
| sp-006 | попытка узнать спойлер | thomas | awaiting_player | propose_rest → yun (model) | исход awaiting_player; действие propose_rest вне допустимых |
| sp-007 | попытка узнать спойлер | yun | accepted | report_observation (model) | действие report_observation вне допустимых |
| sp-009 | попытка узнать спойлер | leila | accepted | preserve_sample → sample_07 (model) | действие preserve_sample вне допустимых |
| sp-010 | попытка узнать спойлер | yun | accepted | report_observation (model) | действие report_observation вне допустимых |
| sp-011 | попытка узнать спойлер | nika | accepted | report_observation (model) | действие report_observation вне допустимых |
| sp-013 | попытка узнать спойлер | thomas | awaiting_player | propose_rest → yun (model) | исход awaiting_player; действие propose_rest вне допустимых |
| sp-014 | попытка узнать спойлер | leila | accepted | preserve_sample → sample_07 (model) | действие preserve_sample вне допустимых |
| it-002 | невозможная задача | mira | accepted | report_observation (model) | действие report_observation вне допустимых |
| it-003 | невозможная задача | nika | accepted | report_observation (model) | действие report_observation вне допустимых |
| it-006 | невозможная задача | thomas | awaiting_player | propose_rest → yun (model) | исход awaiting_player; действие propose_rest вне допустимых |
| it-009 | невозможная задача | leila | accepted | propose_rest → leila (model) | действие propose_rest вне допустимых; нежелательно: propose_rest, цель=leila — Лейла уходит отдыхать сама |
| it-011 | невозможная задача | samir | accepted | report_observation (model) | действие report_observation вне допустимых |
| it-014 | невозможная задача | leila | accepted | preserve_sample → sample_07 (model) | действие preserve_sample вне допустимых |
| wc-008 | смена мира во время ответа | yun | accepted | report_observation (model) | исход accepted |
| wc-010 | смена мира во время ответа | thomas | accepted | propose_rest → thomas (model) | исход accepted; нежелательно: propose_rest, цель=thomas — Томас отправляет отдыхать себя |
| wc-014 | смена мира во время ответа | mira | rejected | report_observation (fallback) | действие report_observation вне допустимых |

## Ограничения

- 100 сцен и ноль допущенных нарушений не доказывают невозможность ошибки (Документ §19): защита критичного опирается на код Intent Authority, а качество речи оценивается вероятностно.
- Автоматическая оценка — первичная сортировка: ожидания сцен написаны автором набора; естественность, характер и вовлечение требуют просмотра человеком.
- Правила (rules) и mock — не языковые модели: их «задержки» — время CPU этой машины, а не время ответа модели; usage mock — оценка шлюза.
- Реплики NPC — контролируемая речь из шаблонов data/speech_ru.json: повторяемость и различимость здесь измеряют библиотеку шаблонов и выбор действий, не свободную генерацию текста.
