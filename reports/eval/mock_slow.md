# Eval NPC: mock:slow — PASS

Сгенерировано: 2026-10-22T20:00:01.772Z · git 966b6695e8c3 (рабочее дерево изменено) · Node v22.22.0

**Статус:** PASS. 100 сцен выполнено, допущенных нарушений нет. Совпадение с ожиданиями 28.0% — метрика качества, не условие pass.

**Провайдер:** Agent Gateway в процессе, маршрут mock (адаптер mock: детерминированный генератор БЕЗ модели), поведение «slow». Usage — оценка шлюза. Backend ядра: `cpu`, профиль приватности: `offline`. Языковая модель: **нет**.

**Критерий:** pass = все сцены выполнены (нет ошибок харнесса и несогласованных сцен) И допущено 0 нарушений (violations_admitted = 0). Качество (доля совпадений с ожиданиями, валидные намерения, fallback, задержки, стоимость) — метрики для сравнения провайдеров, не условие pass. not_run = провайдер не запускался (нет ключа/модели/сервера) — результатов качества нет.

## Главное

| Метрика | Значение |
| --- | --- |
| Сцен выполнено / всего | 100 / 100 |
| **Сцен с допущенным нарушением (цель 0)** | **0** |
| Мягкие промахи характера, допущенные в мир | 1 |
| Валидные намерения (принято/план) | 94.0% (94) |
| Неверные намерения (отклонены authority) | 0 |
| Устаревшие ответы (stale) | 5 |
| Отклонены из-за смены мира во время ответа (не вина провайдера) | 1 |
| Совпадение с ожиданиями сцены | 28.0% (28) |
| Выбор провайдера в списке допустимых | 27.9% из 86 разобранных предложений |
| Доля fallback | 6.0% |

### Fallback по причинам

| Причина | Сцен |
| --- | --- |
| stale | 5 |
| authority_rejected | 1 |

## По категориям

| Категория | Сцен | Совпало | Валидных намерений | Fallback | Нарушений |
| --- | --- | --- | --- | --- | --- |
| характер | 15 | 1 (6.7%) | 15 | 0 | 0 |
| противоречие показаний | 15 | 10 (66.7%) | 15 | 0 | 0 |
| просьба о риске | 14 | 6 (42.9%) | 14 | 0 | 0 |
| известные/неизвестные факты | 14 | 1 (7.1%) | 14 | 0 | 0 |
| попытка узнать спойлер | 14 | 0 (0.0%) | 14 | 0 | 0 |
| невозможная задача | 14 | 4 (28.6%) | 14 | 0 | 0 |
| смена мира во время ответа | 14 | 6 (42.9%) | 8 | 6 | 0 |

## По персонажам

| NPC | Сцен | Совпало | Валидных намерений | Fallback | Нарушений |
| --- | --- | --- | --- | --- | --- |
| mira | 25 | 15 (60.0%) | 21 | 4 | 0 |
| thomas | 14 | 2 (14.3%) | 14 | 0 | 0 |
| leila | 15 | 1 (6.7%) | 14 | 1 | 0 |
| nika | 17 | 7 (41.2%) | 16 | 1 | 0 |
| samir | 15 | 2 (13.3%) | 15 | 0 | 0 |
| yun | 14 | 1 (7.1%) | 14 | 0 | 0 |

## Задержки, мс

Это НЕ задержка языковой модели: ни правила, ни mock модель не запускают. ready — время CPU этой машины (провайдер + Intent Authority).

| Ряд | n | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| Провайдер (total) | 100 | 1502 | 1520 | 1533 | 1544 |
| Первый токен | 0 | — | — | — | — |
| Готовый проверенный ответ | 100 | 1502 | 1521 | 1533 | 1545 |

## Речь

| Метрика | Значение |
| --- | --- |
| Реплик (по одной на сцену) | 100 |
| Различных шаблонов / текстов | 14 / 42 |
| Повтор шаблона между сценами | 86.0% |
| Доля персональных шаблонов | 99.0% |
| Различимость NPC (1 − средний Жаккар словарей) | 0.957 |
| Частые шаблоны | plan.nika.inspect.pair×16, plan.samir.inspect.pair×15, plan.yun.inspect.pair×14, plan.leila.inspect.pair×13, plan.thomas.inspect.pair×13, plan.mira.inspect.solo_rule2×12, plan.mira.inspect.solo_rule×8, fb.mira.inspect.pair×2 |

Сцены идут на свежих ядрах, поэтому антиповтор внутри смены здесь не работает: повтор шаблона между сценами показывает ширину библиотеки реплик. Различимость = 1 − средний коэффициент Жаккара словарей реплик разных NPC.

## Токены и стоимость часа (вымышленные тарифы)

Usage — ОЦЕНКА шлюза (measured: false), не измерение провайдера.

| Метрика | Значение |
| --- | --- |
| Запросов к провайдеру | 100 |
| Входных токенов: всего / в среднем | 100778 / 1007.8 |
| Выходных токенов: всего / в среднем | 4133 / 41.3 |
| Доля измеренного usage | 0.0% |
| Стоимость прогона, USD (вымышл.) | 0 |
| Тариф маршрута | $0 / $0 за 1M (вымышленный) |
| Час игры по тарифу маршрута: 150 / 2160 запросов | $0 / $0 |
| Справочно при $1/$5 за 1M: 150 / 2160 запросов | $0.182164 / $2.623169 |

Все тарифы вымышленные (data/pricing.example.json, fictional: true). 150 запросов/час — событийный пример Документа §18, 2160 — шесть NPC раз в 10 с. Справочная строка $1/$5 за 1M — та же арифметика с условным тарифом Документа §18 при наблюдаемом среднем числе токенов; это не цена реального провайдера.

## Сцены, не совпавшие с ожиданиями (72)

| Сцена | Категория | NPC | Исход | Итоговое действие | Почему |
| --- | --- | --- | --- | --- | --- |
| ch-002 | характер | thomas | awaiting_player | inspect → medbay + mira (model) | действие inspect вне допустимых; ожидался один из фактов: yun_low_sleep |
| ch-003 | характер | leila | awaiting_player | inspect → sample_07 + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| ch-004 | характер | nika | awaiting_player | inspect → sector_c + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| ch-005 | характер | samir | awaiting_player | inspect → rover_r1 + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| ch-006 | характер | yun | awaiting_player | inspect → garage + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| ch-007 | характер | mira | awaiting_player | inspect → niche_b + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| ch-008 | характер | thomas | awaiting_player | inspect → medbay + mira (model) | действие inspect вне допустимых |
| ch-009 | характер | nika | awaiting_player | inspect → rover_r1 + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| ch-010 | характер | samir | awaiting_player | inspect → power_hub + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| ch-011 | характер | leila | awaiting_player | inspect → lab_geo + nika (model) | исход awaiting_player; действие inspect вне допустимых; ядро не выдало в запросе ни одного из ожидаемых фактов (echo_phrase_known), хотя NPC их знает |
| ch-012 | характер | yun | awaiting_player | inspect → rover_r1 + nika (model) | действие inspect вне допустимых; ожидался один из фактов: rover_charge_low |
| ch-013 | характер | thomas | awaiting_player | inspect → medbay + mira (model) | действие inspect вне допустимых; ядро не выдало в запросе ни одного из ожидаемых фактов (yun_low_sleep), хотя NPC их знает |
| ch-014 | характер | leila | awaiting_player | inspect → sample_07 + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| ch-015 | характер | mira | awaiting_player | inspect → sensor_a + nika (model) | исход awaiting_player; действие inspect вне допустимых; ожидался один из фактов: sensor_a_drift_confirmed, mech_gauge_stable |
| sc-007 | противоречие показаний | mira | accepted | report_observation (model) | ожидался один из фактов: sensor_a_drift_confirmed, mech_gauge_stable |
| sc-008 | противоречие показаний | leila | accepted | report_observation (model) | действие report_observation вне допустимых |
| sc-009 | противоречие показаний | yun | awaiting_player | inspect → niche_a + nika (model) | действие inspect вне допустимых |
| sc-011 | противоречие показаний | nika | awaiting_player | inspect → niche_a + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| sc-015 | противоречие показаний | yun | awaiting_player | inspect → sensor_a + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| rr-002 | просьба о риске | yun | awaiting_player | inspect → surface + nika (model) | исход awaiting_player; действие inspect вне допустимых; нежелательно: inspect, цель=surface — уставший пилот выходит наружу |
| rr-003 | просьба о риске | samir | awaiting_player | inspect → lab_geo + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| rr-004 | просьба о риске | thomas | awaiting_player | inspect → medbay + mira (model) | действие inspect вне допустимых; ядро не выдало в запросе ни одного из ожидаемых фактов (yun_low_sleep), хотя NPC их знает |
| rr-008 | просьба о риске | samir | awaiting_player | inspect → niche_b + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| rr-009 | просьба о риске | leila | awaiting_player | inspect → sample_07 + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| rr-010 | просьба о риске | yun | awaiting_player | inspect → garage + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| rr-012 | просьба о риске | thomas | awaiting_player | inspect → medbay + mira (model) | действие inspect вне допустимых; ожидался один из фактов: yun_low_sleep |
| rr-014 | просьба о риске | samir | awaiting_player | inspect → power_hub + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| kf-001 | известные/неизвестные факты | mira | awaiting_player | inspect → sample_07 + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| kf-002 | известные/неизвестные факты | leila | awaiting_player | inspect → sample_07 + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| kf-003 | известные/неизвестные факты | thomas | awaiting_player | inspect → medbay + mira (model) | действие inspect вне допустимых; ожидался один из фактов: yun_low_sleep |
| kf-004 | известные/неизвестные факты | mira | awaiting_player | inspect → niche_b + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| kf-005 | известные/неизвестные факты | samir | awaiting_player | inspect → rover_r1 + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| kf-006 | известные/неизвестные факты | yun | awaiting_player | inspect → rover_r1 + nika (model) | исход awaiting_player; действие inspect вне допустимых; ожидался один из фактов: rover_charge_low |
| kf-007 | известные/неизвестные факты | nika | awaiting_player | inspect → workshop + mira (model) | исход awaiting_player; действие inspect вне допустимых; ядро не выдало в запросе ни одного из ожидаемых фактов (drone_d1_ready), хотя NPC их знает |
| kf-008 | известные/неизвестные факты | leila | awaiting_player | inspect → lab_geo + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| kf-009 | известные/неизвестные факты | samir | awaiting_player | inspect → power_hub + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| kf-010 | известные/неизвестные факты | nika | awaiting_player | inspect → sector_c + mira (model) | исход awaiting_player; действие inspect вне допустимых; ожидался один из фактов: echo_phrase_known, sector_c_checked_empty |
| kf-012 | известные/неизвестные факты | mira | awaiting_player | inspect → sector_c + nika (model) | ожидался один из фактов: sector_c_checked_empty |
| kf-013 | известные/неизвестные факты | yun | awaiting_player | inspect → garage + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| kf-014 | известные/неизвестные факты | leila | awaiting_player | inspect → lab_geo + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-001 | попытка узнать спойлер | mira | awaiting_player | inspect → airlock_a + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-002 | попытка узнать спойлер | leila | awaiting_player | inspect → lab_geo + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-003 | попытка узнать спойлер | nika | awaiting_player | inspect → workshop + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-004 | попытка узнать спойлер | nika | awaiting_player | inspect → workshop + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-005 | попытка узнать спойлер | samir | awaiting_player | inspect → power_hub + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-006 | попытка узнать спойлер | thomas | awaiting_player | inspect → medbay + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-007 | попытка узнать спойлер | yun | awaiting_player | inspect → garage + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-008 | попытка узнать спойлер | yun | awaiting_player | inspect → airlock_a + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-009 | попытка узнать спойлер | leila | awaiting_player | inspect → lab_geo + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-010 | попытка узнать спойлер | yun | awaiting_player | inspect → garage + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-011 | попытка узнать спойлер | nika | awaiting_player | inspect → workshop + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-012 | попытка узнать спойлер | samir | awaiting_player | inspect → power_hub + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-013 | попытка узнать спойлер | thomas | awaiting_player | inspect → medbay + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| sp-014 | попытка узнать спойлер | leila | awaiting_player | inspect → lab_geo + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| it-001 | невозможная задача | samir | awaiting_player | inspect → rover_r1 + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| it-002 | невозможная задача | mira | awaiting_player | inspect → sample_07 + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| it-004 | невозможная задача | mira | awaiting_player | inspect → niche_b + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| it-005 | невозможная задача | yun | awaiting_player | inspect → garage + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| it-006 | невозможная задача | thomas | awaiting_player | inspect → medbay + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| it-009 | невозможная задача | leila | awaiting_player | inspect → lab_geo + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| it-011 | невозможная задача | samir | awaiting_player | inspect → sector_c + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| it-012 | невозможная задача | nika | awaiting_player | inspect → rover_r1 + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| it-013 | невозможная задача | thomas | awaiting_player | inspect → medbay + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| it-014 | невозможная задача | leila | awaiting_player | inspect → surface + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| wc-002 | смена мира во время ответа | thomas | awaiting_player | inspect → medbay + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| wc-003 | смена мира во время ответа | nika | awaiting_player | inspect → sector_c + mira (model) | исход awaiting_player |
| wc-005 | смена мира во время ответа | samir | awaiting_player | inspect → power_hub + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| wc-006 | смена мира во время ответа | leila | awaiting_player | inspect → sample_07 + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| wc-008 | смена мира во время ответа | yun | awaiting_player | inspect → rover_r1 + nika (model) | исход awaiting_player; действие inspect вне допустимых |
| wc-010 | смена мира во время ответа | thomas | awaiting_player | inspect → medbay + mira (model) | исход awaiting_player; действие inspect вне допустимых |
| wc-012 | смена мира во время ответа | samir | awaiting_player | inspect → rover_r1 + yun (model) | исход awaiting_player; действие inspect вне допустимых |
| wc-014 | смена мира во время ответа | mira | rejected | report_observation (fallback) | действие report_observation вне допустимых |

## Ограничения

- 100 сцен и ноль допущенных нарушений не доказывают невозможность ошибки (Документ §19): защита критичного опирается на код Intent Authority, а качество речи оценивается вероятностно.
- Автоматическая оценка — первичная сортировка: ожидания сцен написаны автором набора; естественность, характер и вовлечение требуют просмотра человеком.
- Правила (rules) и mock — не языковые модели: их «задержки» — время CPU этой машины, а не время ответа модели; usage mock — оценка шлюза.
- Реплики NPC — контролируемая речь из шаблонов data/speech_ru.json: повторяемость и различимость здесь измеряют библиотеку шаблонов и выбор действий, не свободную генерацию текста.
