# 03. Модель данных: пакет операции

Пакет операции — один JSON-файл (+ файлы моделей и листов КД), который описывает всё, что нужно для показа и
выполнения операции ТП. Схема: `schemas/operation.schema.json`. Примеры: `data/examples/op040_shelf_bench.json`,
`data/examples/op070_bin_fuselage.json`.

## Связи

```
operation ──< steps ──< parts ──> model.node (узел GLB)
                  │         └──> kd_sheet + позиция на листе
                  └──< fasteners ──> part
anchors.markers ──> система координат операции (reference_frame)
```

## Системы координат и единицы
- Все координаты в пакете — **миллиметры** в СК операции (`anchors.reference_frame`), ось Y вверх, правая тройка.
- Для операции на верстаке СК — центр верхней плоскости ложемента. Для фюзеляжа — пересечение оси секции с плоскостью пола
  на шпангоуте, указанном в `reference_frame` (например, `fuselage_frame_18`).
- Поворот — кватернион `[x, y, z, w]`. Позиция метки — центр метки, ось +Y — нормаль от поверхности.
- Движки (Godot, Three.js) работают в метрах: деление на 1000 делается в загрузчике пакета, больше нигде.

## Объекты

### operation
| Поле | Тип | Пример |
|---|---|---|
| id | строка | `"070"` |
| title | строка | `"Монтаж полки багажной, шп. 17–19"` |
| product | обозначение КД | `"АИ.8120.300 МЧ"` |
| revision | литера/ревизия | `"Б"` |
| workplace | рабочее место | `"Секция Ф3, стапель 2"` |

### models[]
`{ "id": "m_main", "uri": "models/op070.glb" }` — GLB с узлами, имена узлов = `parts[].node`.

### anchors
`reference_frame` и `markers[]`: `id`, `dictionary` (`DICT_6X6_250` или `DICT_APRILTAG_36h11`), `size_mm`, `pose`.
Минимум 3 метки, не на одной прямой; для крупных изделий — на разных шпангоутах.
`check_distance` — контрольное расстояние между двумя точками для проверки масштаба: `{ "from": [..], "to": [..], "nominal_mm": 1060, "tol_mm": 2 }`.

### parts[]
| Поле | Смысл |
|---|---|
| id | уникальный ID экземпляра (`K3140-L`) |
| designation | обозначение по КД (`К-3140`) |
| name | наименование |
| model, node | где геометрия: модель и имя узла GLB |
| fallback | примитив для демо без GLB: `{ "type": "box", "size_mm": [100, 70, 60] }` |
| target | поза установки `{ position: [мм], rotation: [x,y,z,w] }` |
| source | откуда взять: `{ kind: cart|bin|rack|lift, cell: "A", position: [мм] }` |
| kd | `{ sheet: "kd_l2", position: "1" }` — позиция на листе |
| mass_kg | для подсказки «брать вдвоём» > 15 кг |

### fasteners[]
`id`, `type` (`bolt|nut|washer|rivet|qpin|cpin|cotter|qturn|clip`), `designation`, `part`, `position` (мм), `axis` (единичный),
`torque_nm` (если есть), `lock` (`self_locking_nut|cotter|wire|none`), `new_only` (только новые).

### kd_sheets[]
`{ id, uri, title, positions: { "1": [x, y, w, h] } }` — прямоугольники позиций на PNG листа (в пикселях), чтобы подсвечивать.

### steps[]
| Поле | Смысл |
|---|---|
| id, n, title | идентификатор, номер, заголовок |
| kind | `align` (привязка), `install`, `fasten`, `adjust`, `check`, `photo` |
| parts, fasteners | ID из списков выше |
| tool | инструмент |
| params | `torque_nm`, `gap_mm`, `angle_deg`… |
| check | `{ type: gap|torque|visual|lock, nominal_mm, tol_mm }` |
| critical | критичный шаг: нужен ввод значения или фото, голос «дальше» недостаточен |
| confirm | `voice|button|value|photo` |
| norm_s | норма времени, с |
| kd | листы КД шага |
| notes | указания технолога |

## Журнал выполнения (сервер)
`runs` (выполнение операции: исполнитель, серийный номер изделия, начало/конец) и `run_steps`
(шаг, время начала/конца, повторы, введённые значения, отклонение привязки, фото). Чат: `messages` с привязкой к `run` и `step`.
В коде (`pkg1-sim-vm/server/db.py`) журнал шагов хранится как поток событий `run_events` — это те же `LogEvent` движка шагов;
таблица `run_steps` строится из них запросом/представлением.

## Как технолог готовит пакет
1. Папка таблиц по образцу `data/examples/op040_csv/` (Excel → CSV UTF-8, разделитель `;`): `operation.csv`, `markers.csv`,
   `steps.csv`, `kd_sheets.csv`.
2. Таблицы деталей и крепежа (BOM): `parts.csv`, `fasteners.csv` там же.
3. Экспорт сборки из NX в STEP AP242 → `tools/step_to_glb.py` → GLB с именами узлов.
4. `tools/tp_csv_to_json.py` собирает JSON, `tools/validate_bom.py` сверяет BOM с узлами GLB.
5. Пакет загружается на сервер; клиенты получают его по API.
