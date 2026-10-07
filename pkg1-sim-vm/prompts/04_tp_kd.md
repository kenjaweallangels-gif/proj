# 04. ТП и КД: импорт таблиц технолога и листов КД

Контекст: `tools/tp_csv_to_json.py`, `data/examples/op040_csv/`, `schemas/operation.schema.json`, `tools/kd_pdf_to_png.sh`.

Задача:
1. Импорт прямо из Excel: `tools/tp_xlsx_to_json.py` — книга с листами operation, markers, parts, fasteners, steps,
   kd_sheets (те же столбцы, что CSV). Сделать шаблон `data/templates/tp_template.xlsx` с выпадающими списками
   (kind, confirm, type крепежа) и примечаниями к столбцам. Логика сборки — общая с CSV (вынести в функцию).
2. Ошибки для технолога по-русски с адресом ячейки: «steps!E5: нет детали K999». Сейчас ошибка без адреса.
3. Листы КД: `kd_pdf_to_png.sh` → PNG; утилита `tools/kd_positions.py` — открывает PNG в окне OpenCV, технолог
   кликает рамку позиции, номер позиции вводит с клавиатуры, результат пишется в `kd_sheets.csv` (столбец positions).
4. Выгрузка на сервер: `tools/publish.py папка_ТП --server http://... --token ...` → проверка → POST пакета и файлов.

Критерии приёмки: round-trip XLSX → JSON == `op040_shelf_bench.json` (тест); ошибка ссылки содержит адрес ячейки (тест);
`publish.py` в тесте против TestClient сервера.
