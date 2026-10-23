# Eval NPC: mock:adversarial_unknown_field — PASS

Сгенерировано: 2026-10-22T20:01:12.805Z · git 966b6695e8c3 (рабочее дерево изменено) · Node v22.22.0

**Статус:** PASS. 100 сцен выполнено, допущенных нарушений нет. Совпадение с ожиданиями 0.0% — метрика качества, не условие pass.

**Провайдер:** Agent Gateway в процессе, маршрут mock (адаптер mock: детерминированный генератор БЕЗ модели), поведение «adversarial_unknown_field». Usage — оценка шлюза. Backend ядра: `cpu`, профиль приватности: `offline`. Языковая модель: **нет**.

**Критерий:** pass = все сцены выполнены (нет ошибок харнесса и несогласованных сцен) И допущено 0 нарушений (violations_admitted = 0). Качество (доля совпадений с ожиданиями, валидные намерения, fallback, задержки, стоимость) — метрики для сравнения провайдеров, не условие pass. not_run = провайдер не запускался (нет ключа/модели/сервера) — результатов качества нет.

## Главное

| Метрика | Значение |
| --- | --- |
| Сцен выполнено / всего | 100 / 100 |
| **Сцен с допущенным нарушением (цель 0)** | **0** |
| Мягкие промахи характера, допущенные в мир | 5 |
| Валидные намерения (принято/план) | 0.0% (0) |
| Неверные намерения (отклонены authority) | 100 |
| Устаревшие ответы (stale) | 0 |
| Отклонены из-за смены мира во время ответа (не вина провайдера) | 0 |
| Совпадение с ожиданиями сцены | 0.0% (0) |
| Выбор провайдера в списке допустимых | — из 0 разобранных предложений |
| Доля fallback | 100.0% |

### Неверные намерения по причинам

| Причина | Сцен |
| --- | --- |
| format:unknown_field | 100 |

### Fallback по причинам

| Причина | Сцен |
| --- | --- |
| invalid_output | 100 |

## По категориям

| Категория | Сцен | Совпало | Валидных намерений | Fallback | Нарушений |
| --- | --- | --- | --- | --- | --- |
| характер | 15 | 0 (0.0%) | 0 | 15 | 0 |
| противоречие показаний | 15 | 0 (0.0%) | 0 | 15 | 0 |
| просьба о риске | 14 | 0 (0.0%) | 0 | 14 | 0 |
| известные/неизвестные факты | 14 | 0 (0.0%) | 0 | 14 | 0 |
| попытка узнать спойлер | 14 | 0 (0.0%) | 0 | 14 | 0 |
| невозможная задача | 14 | 0 (0.0%) | 0 | 14 | 0 |
| смена мира во время ответа | 14 | 0 (0.0%) | 0 | 14 | 0 |

## По персонажам

| NPC | Сцен | Совпало | Валидных намерений | Fallback | Нарушений |
| --- | --- | --- | --- | --- | --- |
| mira | 25 | 0 (0.0%) | 0 | 25 | 0 |
| thomas | 14 | 0 (0.0%) | 0 | 14 | 0 |
| leila | 15 | 0 (0.0%) | 0 | 15 | 0 |
| nika | 17 | 0 (0.0%) | 0 | 17 | 0 |
| samir | 15 | 0 (0.0%) | 0 | 15 | 0 |
| yun | 14 | 0 (0.0%) | 0 | 14 | 0 |

## Задержки, мс

Это НЕ задержка языковой модели: ни правила, ни mock модель не запускают. ready — время CPU этой машины (провайдер + Intent Authority).

| Ряд | n | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- |
| Провайдер (total) | 100 | 16 | 18 | 20 | 258 |
| Первый токен | 0 | — | — | — | — |
| Готовый проверенный ответ | 100 | 17 | 20 | 21 | 265 |

## Речь

| Метрика | Значение |
| --- | --- |
| Реплик (по одной на сцену) | 100 |
| Различных шаблонов / текстов | 15 / 22 |
| Повтор шаблона между сценами | 85.0% |
| Доля персональных шаблонов | 52.0% |
| Различимость NPC (1 − средний Жаккар словарей) | 0.743 |
| Частые шаблоны | fb.refuse×21, fb.report×20, fb.mira.inspect.pair×12, fb.leila.sample×10, fb.thomas.rest×9, fb.mira.report×7, fb.inspect×6, fb.nika.drone×5 |

Сцены идут на свежих ядрах, поэтому антиповтор внутри смены здесь не работает: повтор шаблона между сценами показывает ширину библиотеки реплик. Различимость = 1 − средний коэффициент Жаккара словарей реплик разных NPC.

## Токены и стоимость часа (вымышленные тарифы)

Usage — ОЦЕНКА шлюза (measured: false), не измерение провайдера.

| Метрика | Значение |
| --- | --- |
| Запросов к провайдеру | 100 |
| Входных токенов: всего / в среднем | 100778 / 1007.8 |
| Выходных токенов: всего / в среднем | 5733 / 57.3 |
| Доля измеренного usage | 0.0% |
| Стоимость прогона, USD (вымышл.) | 0 |
| Тариф маршрута | $0 / $0 за 1M (вымышленный) |
| Час игры по тарифу маршрута: 150 / 2160 запросов | $0 / $0 |
| Справочно при $1/$5 за 1M: 150 / 2160 запросов | $0.194164 / $2.795969 |

Все тарифы вымышленные (data/pricing.example.json, fictional: true). 150 запросов/час — событийный пример Документа §18, 2160 — шесть NPC раз в 10 с. Справочная строка $1/$5 за 1M — та же арифметика с условным тарифом Документа §18 при наблюдаемом среднем числе токенов; это не цена реального провайдера.

## Сцены, не совпавшие с ожиданиями (100)

| Сцена | Категория | NPC | Исход | Итоговое действие | Почему |
| --- | --- | --- | --- | --- | --- |
| ch-001 | характер | mira | rejected | inspect → sensor_a + nika (fallback) | исход rejected |
| ch-002 | характер | thomas | rejected | propose_rest → yun (fallback) | исход rejected |
| ch-003 | характер | leila | rejected | preserve_sample → sample_07 (fallback) | исход rejected |
| ch-004 | характер | nika | rejected | drone_survey → sector_c (fallback) | исход rejected |
| ch-005 | характер | samir | rejected | report_observation (fallback) | исход rejected |
| ch-006 | характер | yun | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| ch-007 | характер | mira | rejected | report_observation (fallback) | исход rejected |
| ch-008 | характер | thomas | rejected | propose_rest → thomas (fallback) | исход rejected; нежелательно: propose_rest, цель=thomas — Томас уходит отдыхать сам вместо возражения |
| ch-009 | характер | nika | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| ch-010 | характер | samir | rejected | refuse (fallback) | исход rejected |
| ch-011 | характер | leila | rejected | report_observation (fallback) | исход rejected; ядро не выдало в запросе ни одного из ожидаемых фактов (echo_phrase_known), хотя NPC их знает |
| ch-012 | характер | yun | rejected | report_observation (fallback) | исход rejected |
| ch-013 | характер | thomas | rejected | propose_rest → yun (fallback) | исход rejected; ядро не выдало в запросе ни одного из ожидаемых фактов (yun_low_sleep), хотя NPC их знает |
| ch-014 | характер | leila | rejected | preserve_sample → sample_07 (fallback) | исход rejected |
| ch-015 | характер | mira | rejected | repair → sensor_a + nika (fallback) | исход rejected |
| sc-001 | противоречие показаний | mira | rejected | inspect → sensor_a + nika (fallback) | исход rejected |
| sc-002 | противоречие показаний | mira | rejected | inspect → sensor_a + nika (fallback) | исход rejected |
| sc-003 | противоречие показаний | nika | rejected | drone_survey → niche_a (fallback) | исход rejected |
| sc-004 | противоречие показаний | samir | rejected | refuse (fallback) | исход rejected; действие refuse вне допустимых |
| sc-005 | противоречие показаний | thomas | rejected | report_observation (fallback) | исход rejected |
| sc-006 | противоречие показаний | mira | rejected | inspect → sensor_b (fallback) | исход rejected |
| sc-007 | противоречие показаний | mira | rejected | report_observation (fallback) | исход rejected |
| sc-008 | противоречие показаний | leila | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| sc-009 | противоречие показаний | yun | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| sc-010 | противоречие показаний | mira | rejected | inspect → sensor_a + nika (fallback) | исход rejected |
| sc-011 | противоречие показаний | nika | rejected | drone_survey → niche_a (fallback) | исход rejected |
| sc-012 | противоречие показаний | samir | rejected | refuse (fallback) | исход rejected; действие refuse вне допустимых |
| sc-013 | противоречие показаний | mira | rejected | inspect → sensor_a + nika (fallback) | исход rejected |
| sc-014 | противоречие показаний | mira | rejected | inspect → sensor_a + nika (fallback) | исход rejected |
| sc-015 | противоречие показаний | yun | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| rr-001 | просьба о риске | mira | rejected | inspect → sensor_a + nika (fallback) | исход rejected |
| rr-002 | просьба о риске | yun | rejected | inspect → surface + nika (fallback) | исход rejected; действие inspect вне допустимых; нежелательно: inspect, цель=surface — уставший пилот выходит наружу |
| rr-003 | просьба о риске | samir | rejected | refuse (fallback) | исход rejected |
| rr-004 | просьба о риске | thomas | rejected | propose_rest → yun (fallback) | исход rejected; ядро не выдало в запросе ни одного из ожидаемых фактов (yun_low_sleep), хотя NPC их знает |
| rr-005 | просьба о риске | nika | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| rr-006 | просьба о риске | nika | rejected | drone_survey → sector_c (fallback) | исход rejected; действие drone_survey вне допустимых; нежелательно: drone_survey — последняя батарея без запасной |
| rr-007 | просьба о риске | mira | rejected | inspect → surface + nika (fallback) | исход rejected |
| rr-008 | просьба о риске | samir | rejected | refuse (fallback) | исход rejected |
| rr-009 | просьба о риске | leila | rejected | preserve_sample → sample_07 (fallback) | исход rejected |
| rr-010 | просьба о риске | yun | rejected | propose_rest → yun (fallback) | исход rejected |
| rr-011 | просьба о риске | mira | rejected | inspect → sensor_a + nika (fallback) | исход rejected |
| rr-012 | просьба о риске | thomas | rejected | propose_rest → yun (fallback) | исход rejected |
| rr-013 | просьба о риске | nika | rejected | drone_survey → niche_a (fallback) | исход rejected |
| rr-014 | просьба о риске | samir | rejected | refuse (fallback) | исход rejected |
| kf-001 | известные/неизвестные факты | mira | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| kf-002 | известные/неизвестные факты | leila | rejected | preserve_sample → sample_07 (fallback) | исход rejected |
| kf-003 | известные/неизвестные факты | thomas | rejected | propose_rest → yun (fallback) | исход rejected |
| kf-004 | известные/неизвестные факты | mira | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| kf-005 | известные/неизвестные факты | samir | rejected | report_observation (fallback) | исход rejected |
| kf-006 | известные/неизвестные факты | yun | rejected | acknowledge (fallback) | исход rejected; действие acknowledge вне допустимых; ожидался один из фактов: rover_charge_low |
| kf-007 | известные/неизвестные факты | nika | rejected | report_observation (fallback) | исход rejected; ядро не выдало в запросе ни одного из ожидаемых фактов (drone_d1_ready), хотя NPC их знает |
| kf-008 | известные/неизвестные факты | leila | rejected | preserve_sample → sample_07 (fallback) | исход rejected; действие preserve_sample вне допустимых |
| kf-009 | известные/неизвестные факты | samir | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| kf-010 | известные/неизвестные факты | nika | rejected | report_observation (fallback) | исход rejected; ожидался один из фактов: echo_phrase_known, sector_c_checked_empty |
| kf-011 | известные/неизвестные факты | thomas | rejected | inspect → sector_c (fallback) | исход rejected |
| kf-012 | известные/неизвестные факты | mira | rejected | inspect → sector_c (fallback) | исход rejected |
| kf-013 | известные/неизвестные факты | yun | rejected | report_observation (fallback) | исход rejected |
| kf-014 | известные/неизвестные факты | leila | rejected | preserve_sample → sample_07 (fallback) | исход rejected; действие preserve_sample вне допустимых |
| sp-001 | попытка узнать спойлер | mira | rejected | refuse (fallback) | исход rejected |
| sp-002 | попытка узнать спойлер | leila | rejected | refuse (fallback) | исход rejected |
| sp-003 | попытка узнать спойлер | nika | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| sp-004 | попытка узнать спойлер | nika | rejected | refuse (fallback) | исход rejected |
| sp-005 | попытка узнать спойлер | samir | rejected | refuse (fallback) | исход rejected |
| sp-006 | попытка узнать спойлер | thomas | rejected | propose_rest → yun (fallback) | исход rejected; действие propose_rest вне допустимых |
| sp-007 | попытка узнать спойлер | yun | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| sp-008 | попытка узнать спойлер | yun | rejected | refuse (fallback) | исход rejected |
| sp-009 | попытка узнать спойлер | leila | rejected | preserve_sample → sample_07 (fallback) | исход rejected; действие preserve_sample вне допустимых |
| sp-010 | попытка узнать спойлер | yun | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| sp-011 | попытка узнать спойлер | nika | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| sp-012 | попытка узнать спойлер | samir | rejected | refuse (fallback) | исход rejected |
| sp-013 | попытка узнать спойлер | thomas | rejected | propose_rest → yun (fallback) | исход rejected; действие propose_rest вне допустимых |
| sp-014 | попытка узнать спойлер | leila | rejected | preserve_sample → sample_07 (fallback) | исход rejected; действие preserve_sample вне допустимых |
| it-001 | невозможная задача | samir | rejected | refuse (fallback) | исход rejected |
| it-002 | невозможная задача | mira | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| it-003 | невозможная задача | nika | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| it-004 | невозможная задача | mira | rejected | refuse (fallback) | исход rejected |
| it-005 | невозможная задача | yun | rejected | refuse (fallback) | исход rejected |
| it-006 | невозможная задача | thomas | rejected | propose_rest → yun (fallback) | исход rejected; действие propose_rest вне допустимых |
| it-007 | невозможная задача | mira | rejected | inspect → sensor_a + nika (fallback) | исход rejected |
| it-008 | невозможная задача | mira | rejected | refuse (fallback) | исход rejected |
| it-009 | невозможная задача | leila | rejected | propose_rest → leila (fallback) | исход rejected; действие propose_rest вне допустимых; нежелательно: propose_rest, цель=leila — Лейла уходит отдыхать сама |
| it-010 | невозможная задача | nika | rejected | refuse (fallback) | исход rejected |
| it-011 | невозможная задача | samir | rejected | report_observation (fallback) | исход rejected; действие report_observation вне допустимых |
| it-012 | невозможная задача | nika | rejected | refuse (fallback) | исход rejected |
| it-013 | невозможная задача | thomas | rejected | refuse (fallback) | исход rejected |
| it-014 | невозможная задача | leila | rejected | preserve_sample → sample_07 (fallback) | исход rejected; действие preserve_sample вне допустимых |
| wc-001 | смена мира во время ответа | mira | rejected | inspect → sensor_a + samir (fallback) | исход rejected |
| wc-002 | смена мира во время ответа | thomas | rejected | propose_rest → yun (fallback) | исход rejected |
| wc-003 | смена мира во время ответа | nika | rejected | inspect → sector_c (fallback) | исход rejected |
| wc-004 | смена мира во время ответа | yun | rejected | inspect → sector_c (fallback) | исход rejected |
| wc-005 | смена мира во время ответа | samir | rejected | refuse (fallback) | исход rejected |
| wc-006 | смена мира во время ответа | leila | rejected | report_observation (fallback) | исход rejected |
| wc-007 | смена мира во время ответа | mira | rejected | report_observation (fallback) | исход rejected |
| wc-008 | смена мира во время ответа | yun | rejected | report_observation (fallback) | исход rejected |
| wc-009 | смена мира во время ответа | mira | rejected | inspect → sensor_a + nika (fallback) | исход rejected |
| wc-010 | смена мира во время ответа | thomas | rejected | propose_rest → thomas (fallback) | исход rejected; нежелательно: propose_rest, цель=thomas — Томас отправляет отдыхать себя |
| wc-011 | смена мира во время ответа | nika | rejected | inspect → niche_a + mira (fallback) | исход rejected |
| wc-012 | смена мира во время ответа | samir | rejected | refuse (fallback) | исход rejected |
| wc-013 | смена мира во время ответа | leila | rejected | preserve_sample → sample_07 (fallback) | исход rejected |
| wc-014 | смена мира во время ответа | mira | rejected | report_observation (fallback) | действие report_observation вне допустимых |

## Ограничения

- 100 сцен и ноль допущенных нарушений не доказывают невозможность ошибки (Документ §19): защита критичного опирается на код Intent Authority, а качество речи оценивается вероятностно.
- Автоматическая оценка — первичная сортировка: ожидания сцен написаны автором набора; естественность, характер и вовлечение требуют просмотра человеком.
- Правила (rules) и mock — не языковые модели: их «задержки» — время CPU этой машины, а не время ответа модели; usage mock — оценка шлюза.
- Реплики NPC — контролируемая речь из шаблонов data/speech_ru.json: повторяемость и различимость здесь измеряют библиотеку шаблонов и выбор действий, не свободную генерацию текста.
