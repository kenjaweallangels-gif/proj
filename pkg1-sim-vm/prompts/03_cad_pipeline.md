# 03. Конвейер CAD → GLB на реальной модели

Контекст: `docs/04_cad_kd_tp_pipeline.md`, `tools/step_to_glb.py`, `tools/validate_bom.py`, `tools/make_fallback_glb.py`.

Вход от технолога/конструктора: STEP AP242 сборки (экспорт из NX/КОМПАС/T-FLEX) и таблица `parts.csv`.

Задача:
1. Прогнать `step_to_glb.py` на реальном STEP; подобрать `--deflection` так, чтобы GLB ≤ 30 МБ после
   `gltf-transform optimize … --flatten false --join false --simplify false`, а отклонение формы ≤ 0,2 мм (сравнить габариты узлов до/после).
2. Перенос СК: опция `--origin "x,y,z"` и `--rotate` в `step_to_glb.py`, чтобы начало координат GLB совпало с базой
   оснастки (`anchors.reference_frame`). Записать в пакет `models[].note`, какие преобразования применены.
3. Сопоставление имён: если имена компонентов CAD не совпадают с `parts.node`, `validate_bom.py --map map.csv`
   (столбцы cad_name;node). Отчёт: детали без узла, узлы без детали, расхождение центров > 2 мм.
4. Тест на маленьком STEP уже есть (`tests/test_step_to_glb.py`, `tests/data/two_brackets.step`): имена, единицы, оси.
   Добавить в него случай с вложенной подсборкой и повторяющимися деталями (несколько экземпляров одного болта) —
   имена экземпляров должны различаться (`F1`, `F2`…), иначе `parts.node` неоднозначен.

Ограничения: не использовать flatten/join/simplify без проверки validate_bom; не коммитить реальные модели изделий в git
(только в `server_data/files`, git-lfs — по согласованию с режимом).

Критерии приёмки: `validate_bom.py пакет.json модель.glb --tol-mm 2` → OK на реальной операции; тест на образце зелёный.
