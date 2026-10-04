# Модульный кит сиетча «Табр-ан-Нур» (T-011)

Генератор: `Tools/blender/env_sietch_kit.py` → `Export/sietch/SM_Sietch_<Name>.fbx` + `Export/sietch/kit_manifest.json`.
Импорт: `Tools/unreal_python/env_import.py` → `/Game/Rakis/Environment/Sietch/SM_Sietch_<Name>` (Nanite, complex-as-simple).
Используют: `level_blockout_sietch.py` (рамы дверей, решётка, балюстрады, колонны, кольцо шахты, бортик чаши) и
`env_dress_sietch.py` (реквизит по Smart Object-слотам).

Сейчас это **заготовки** (blockout+): точный габарит, pivot, слоты материалов, фаски износа 4 см, UV блочной проекцией 2 м.
Финальный вид делает человек-художник (скульпт в ZBrush/Blender → Nanite 50–500k, trim sheets 2K) **не меняя габарит и pivot**.

## 1. Правила кита
| Правило | Значение |
|---|---|
| Сетка | **50 см** (все габариты и шаги кратны 0.5 м); высота этажа 4 м, яруса галереи 6 м |
| Единицы | Blender — метры, FBX_SCALE_UNITS → 1 м = 100 uu |
| Оси экспорта | Z вверх, X вперёд (правило `.cursor/rules/30-blender.mdc`); проверка ориентации — `rock_and_dunes.md` §6 |
| Pivot стен/полов/лестниц | низ модуля на линии сетки; стены — длина по +X от pivot, толщина 0.5 м **центрирована** на Y=0 |
| Pivot углов/Т-стыков | в узле сетки (пересечение осей стен) |
| Pivot лестниц/пандусов | низ первой ступени, подъём по +X, центр ширины на Y=0 |
| Pivot пропов | **центр основания** (прилавок, станок, скамья, ковёр, верстак, стойка) или ось вращения (кувшин, светошар, тампер, крюк) |
| Pivot настенных пропов | на плоскости стены: панель резьбы и штанга — от левого края, лицом в −Y; кронштейн — стена со стороны +Y |
| Snap в UE | Grid 50, Rotation 15° (5° для ковров/занавесей), Scale — запрещён для стен (кроме Z колонн) |
| Толщина стен в блокауте | 1 м (ящики) — кит 0.5 м ставится на внутреннюю грань |
| Коллизия | complex-as-simple (заготовки); для финала — простые боксы у стен/полов, complex у арок/лестниц |
| Nanite | да, кроме `Glowglobe`, `WaterJar_A/B` (полупрозрачные слоты) |

## 2. Слоты материалов (имя слота = имя MI)
| Слот | Мастер (контракт §2.5) | Что |
|---|---|---|
| `MI_Sietch_Stone` | `M_Sietch_Stone` | песчаник, тёсаный, слой 1 (фрименская резьба) — геометрия |
| `MI_Sietch_StonePolished` | `M_Sietch_Stone` | отполированный руками камень: цоколи, поручни, ступени через одну, полки |
| `MI_Metal_Old` | `M_Sietch_Stone` (метал. ветка) | двери-уплотнители, решётки, кронштейны, кольца |
| `MI_Cloth_Worn` | `M_Cloth_Worn` | занавеси, ковры, коврики, навесы, полотно станка |
| `MI_Glowglobe` | `M_Glowglobe` | светошар (эмиссив 2700K, мерцание — Light Function) |
| `MI_Sietch_Clay` | `M_Sietch_Stone` | глиняные кувшины, чаши |
| `MI_Sietch_Fiber` | `M_Cloth_Worn` / `M_Spice_Fabric` | «дерево Дюны»: прессованное волокно, пластик-кость (рамы станков, стойки) |
| `MI_Water_Still` | `M_Water_Still` | вода в кувшинах/бассейне |
Фолбэки при импорте (если MI ещё нет): см. `env_import.py` → `MI_FALLBACKS` (в итоге `MI_Blockout_Stone`).

## 3. Модули (46 шт.)
Треугольники: «сейчас» — заготовка из генератора; «финал» — бюджет Nanite-скульпта (стандарт: модули 50–500k, пропы 1–30k).

| # | Модуль | Габарит X×Y×Z, м | Pivot | Snap / стыковка | Слоты | Тр. сейчас | Тр. финал |
|---|---|---|---|---|---|---|---|
| 1 | SM_Sietch_Wall_2m | 2 × 0.5 × 4 | низ, начало по X, ось толщины | 2 м по X | Stone, StonePolished | 208 | 60–120k |
| 2 | SM_Sietch_Wall_4m | 4 × 0.5 × 4 | то же | 4 м | Stone, StonePolished | 208 | 120–250k |
| 3 | SM_Sietch_Wall_8m | 8 × 0.5 × 4 | то же | 8 м | Stone, StonePolished | 208 | 250–500k |
| 4 | SM_Sietch_Wall_Corner_4m | 4.25 × 4.25 × 4 | узел сетки | 90° | Stone | 208 | 150–300k |
| 5 | SM_Sietch_Wall_T_4m | 4 × 4.25 × 4 | узел сетки | 90° | Stone | 216 | 150–300k |
| 6 | SM_Sietch_Wall_Doorway_4m | 4 × 0.5 × 4 (проём 2 × 2.2 + арка) | как стена | 4 м | Stone, StonePolished | 476 | 150–300k |
| 7 | SM_Sietch_Arch_4m | 4 × 1 × 4 (пролёт 3 м) | низ, левый край | 4 м | Stone | 476 | 100–200k |
| 8 | SM_Sietch_Arch_8m | 8 × 1.5 × 6 (пролёт 6 м) | низ, левый край | 8 м | Stone | 476 | 200–400k |
| 9 | SM_Sietch_Niche_Wall_2m | 2 × 1 × 4 (ниша-полка) | как стена | 2 м | Stone, StonePolished | 672 | 80–150k |
| 10 | SM_Sietch_SleepingNiche_4m | 4.5 × 2.5 × 3 | низ, левый передний угол | 4 м + 0.25 щёки | Stone, Polished, Metal, Cloth | 828 | 150–300k |
| 11 | SM_Sietch_Stairs_4m | 4 × 2.5 × 2.3 (подъём 2 м, 10 ст.) | низ первой ступени | 4 м / 2 м по Z | Stone, StonePolished | 1588 | 80–200k |
| 12 | SM_Sietch_Stairs_Wide_8m | 8 × 4.5 × 4.3 (подъём 4 м) | то же | 8 м / 4 м | Stone, StonePolished | 3788 | 200–400k |
| 13 | SM_Sietch_Ramp_4m | 4 × 2.5 × 1.3 (подъём 1 м) | низ начала | 4 м / 1 м | Stone, StonePolished | 280 | 50–100k |
| 14 | SM_Sietch_Floor_2m | 2 × 2 × 0.5 | угол, верх в Z=0 | 2 м | Stone, StonePolished | 216 | 30–60k |
| 15 | SM_Sietch_Floor_4m | 4 × 4 × 0.5 | угол, верх в Z=0 | 4 м | Stone, StonePolished | 216 | 60–150k |
| 16 | SM_Sietch_Ceiling_Barrel_4m | 4 × 4 × 2 (пролёт 3 м) | центр пролёта на пяте | 4 м | Stone | 516 | 80–150k |
| 17 | SM_Sietch_Balcony_Rail_4m | 4 × 0.4 × 1.12 | низ, начало | 4 м | Stone, StonePolished | 1908 | 30–80k |
| 18 | SM_Sietch_Balcony_Slab_4m | 4 × 3 × 2 (плита + консоли) | верх плиты у стены | 4 м | Stone | 672 | 80–150k |
| 19 | SM_Sietch_Column_4m | 1.2 × 1.2 × 4 | центр основания | 4 м по Z | Stone | 980 | 50–120k |
| 20 | SM_Sietch_Column_Carved_6m | 1.2 × 1.2 × 6 | центр основания | масштаб Z разрешён | Stone | 3188 | 120–250k |
| 21 | SM_Sietch_SealDoor_Frame | 4 × 1.2 × 4.5 (проём 2.5 × 3, овал) | низ, левый край (ставится yaw 90 поперёк коридора) | коридор 4 м | Stone, Metal | 1422 | 150–300k |
| 22 | SM_Sietch_SealDoor_Panel | 0.24 × 1.25 × 3 (толщина по X) | **центр** (ARakisSealDoor масштабирует под PanelSize) | 2 панели в раме | Metal, Cloth | 648 | 20–50k |
| 23 | SM_Sietch_Cistern_Grate | 3 × 0.2 × 2.5 (мотив «кольца воды») | низ, левый край | проём 3 м | Stone, Metal | 3100 | 30–80k |
| 24 | SM_Sietch_Cistern_Edge_4m | 4 × 0.8 × 1 | низ, начало | 4 м | Stone, StonePolished | 318 | 40–80k |
| 25 | SM_Sietch_Glowglobe_Bracket | 0.4 × 0.6 × 0.5 | на плоскости стены (стена +Y) | маркер `Rakis.Glowglobe` | Metal | 1016 | 5–15k |
| 26 | SM_Sietch_Glowglobe | Ø0.35 | центр | в кольцо кронштейна | Glowglobe | 320 | 2–5k (не Nanite) |
| 27 | SM_Sietch_Stall_Counter | 2.5 × 1 × 2.2 (навес) | центр основания | слот `Stall` | Stone, Polished, Cloth, Fiber | 1312 | 20–40k |
| 28 | SM_Sietch_Loom_Frame | 2.12 × 1 × 2.2 | центр основания | слот `Loom` | Cloth, Fiber | 4928 | 20–40k |
| 29 | SM_Sietch_WaterJar_A | Ø0.56 × 0.8 | центр дна | слот `WaterJar` | Clay, Water | 1080 | 5–15k (не Nanite) |
| 30 | SM_Sietch_WaterJar_B | Ø0.56 × 1.2 | центр дна | то же | Clay, Water | 1080 | 5–15k (не Nanite) |
| 31 | SM_Sietch_PrayerMat | 0.8 × 1.7 × 0.02 | центр | слот `PrayerMat` | Cloth | 24 | 2–8k |
| 32 | SM_Sietch_Carpet_2x3 | 2 × 3.1 × 0.02 | центр | на пол | Cloth | 36 | 5–15k |
| 33 | SM_Sietch_Curtain_2m | 2 × 0.2 × 2.4 (складки) | верх-лево (висит со штанги) | масштаб X 1.5 = 3 м ниша | Cloth | 1534 | 10–30k (или Chaos Cloth) |
| 34 | SM_Sietch_CurtainRod_2m | 2 × 0.15 × 0.1 | начало штанги | над проёмом ниши | Metal | 3572 | 3–8k |
| 35 | SM_Sietch_Carved_Panel_2m | 2 × 0.2 × 2 (рельеф 3 см) | низ-лево, лицо −Y | на стену | Stone | 13126 | 100–300k |
| 36 | SM_Sietch_VaultRib_45 | 17.5 × 0.75 × 12.4 (сектор 45° R 17.5) | центр дуги | 4 копии = полукруг | Stone, Polished | 1860 | 100–200k |
| 37 | SM_Sietch_VaultRib_Spine | 2.5 × 0.7 × 0.75 | верх, начало | по коньку | Stone, Polished | 192 | 20–40k |
| 38 | SM_Sietch_LightShaft_Ring | Ø6 × 1 (отверстие Ø4) | центр | на отверстие шахты B5 | Stone, Polished | 1728 | 50–100k |
| 39 | SM_Sietch_LightWell_Tube | Ø2 × 4 | центр низа | колодцы B2 | Stone | 768 | 30–60k |
| 40 | SM_Sietch_SandBowl_Rim_45 | сектор 45°, R 7–8 м, h 0.55 | центр чаши | 8 копий через 45° | Stone, Polished | 652 | 60–120k |
| 41 | SM_Sietch_Bench_2m | 2 × 0.5 × 0.45 | центр основания | слот `Bench` | Stone, Polished | 324 | 10–30k |
| 42 | SM_Sietch_MakerHooks | 0.45 × 0.1 × 2.55 | центр низа древка | в стойку | Metal, Cloth, Fiber | 952 | 10–20k |
| 43 | SM_Sietch_MakerHooks_Rack | 3 × 0.5 × 1.8 | центр основания | у стены | Fiber | 432 | 10–30k |
| 44 | SM_Sietch_Thumper_Prop | Ø0.5 × 1.66 | острие у земли (Z=0) | в песок / в стойку | Metal | 624 | 10–20k |
| 45 | SM_Sietch_StillsuitBench | 2.1 × 1 × 1.6 | центр основания | слот `StillsuitRepair` | Stone, Polished, Metal, Clay, Fiber | 1592 | 20–40k |
| 46 | SM_Sietch_WaterRings | 0.2 × 0.02 × 0.6 | верх шнура | над прилавком торговки | Metal, Fiber | 672 | 2–5k |

Рекомендация художнику: для свода зала (эллипс, подъём 15 м при полуширине 17 м) сделать дополнительный модуль
`SM_Sietch_VaultRib_Full` (полная полуарка без поворота) — его можно масштабировать по Z (0.86) без искажений; сектор 45°
годится только для круговых арок (B2, проходы). В блокауте зала рёбра — примитивы (`level_blockout_sietch.build_vault`).

## 4. Три слоя истории (декали поверх кита)
Опора «обжитая старина»: каждая значимая стена — палимпсест. Порядок наложения (снизу вверх), Sort Order декалей 0/1/2.
| Слой | Эпоха | Как сделан | Материал / декаль | Где | Правило |
|---|---|---|---|---|---|
| 1 | **Фрименская резьба** (до Лето II) | геометрия `Carved_Panel_2m` + нормали в `MI_Sietch_Stone` | — (меш) | панели B1–B5 (13 шт. в `env_dress_sietch.PANELS`) | глубокая, ритмичная: кольца червя, спирали «творца», капли воды; края скруглены тысячелетиями ладоней |
| 2 | **Символы Квизарата** (Империя) | декаль поверх резьбы, иногда «срубает» её | `MI_Decal_Quizarate` → фолбэк `M_Decal_Carving` | над панелями (Z +2.1 м), знак у входа B2 (`LORE_Quizarate_Sigil`) | геометрично, жёстко, позолота стёрлась; поверх старых узоров — символ власти |
| 3 | **Росписи возрожденцев** (сейчас) | декаль-краска, наивная | `MI_Decal_Revivalist` → фолбэк `M_Decal_Paint` | ниже и сбоку (Z +1.2 м), большая роспись B2 (`LORE_Revivalist_Mural`), дом-алтарь Шианы | охра, индиго, сажа; неумелые фигурки червя и девочки; краска затекла, поверх трещин |
| + | Износ | декаль «полировка ладонями» | `MI_Decal_HandPolish` → `M_Decal_Carving` | у пола/поручней (Z +0.6 м) | там, где касаются люди, — блестит |
Ориентир плотности: на 10 м стены — 1 панель резьбы, 1 знак Квизарата, 1–2 росписи; в зале B5 — больше, в B3 — меньше.

## 5. Текстуры и плотность
- Trim sheet 2K «Sietch_Stone_Trim» (полосы: тёсаный камень / полировка / резной бордюр / ступень) + тайлинг 2K, 1024 px/м на
  героических поверхностях (B2 нижний ярус, B5 ярусы), 512 px/м на потолках/сводах.
- Ткани — атлас 2K на 8 вариантов (синий/охра/выгоревший), общий с одеждой толпы (`docs/art/characters/**`, character-artist).
- Источники Megascans/Fab — фиксировать в `docs/art/environment/sources.csv`.

## 6. Проверка
```
blender -b -P Tools/blender/env_sietch_kit.py -- --out Export/sietch
# → 46 FBX + kit_manifest.json; модуль можно пересобрать отдельно: --only Wall_4m,Arch_4m
```
В UE: `env_import.py` → Content Browser `/Game/Rakis/Environment/Sietch/` — 46 мешей, Nanite (кроме 3), слоты назначены.
