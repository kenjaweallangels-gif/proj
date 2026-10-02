# Материалы «Rakis: Heretics»

Генераторы: `Tools/unreal_python/mat_master_materials.py` (MPC, мастера, инстансы), `mat_post_process.py` (пост), общий строитель графа `mat_graph_lib.py`. HLSL — `Source/Rakis/Shaders/*.ush` (виртуальный путь `/Project/Rakis/…`, регистрирует `FRakisModule` на `PostConfigInit`).

Принципы:
- Всё, что художник может захотеть подвинуть, — параметр инстанса (группы с номерами «01 Color», «02 …»). Хардкод только в физических константах.
- Цвета в таблицах — sRGB hex; скрипт переводит их в линейные (`srgb()`).
- Тяжёлая процедурщина — в `.ush` (одна Custom-нода на функцию), «клей» — нодами, чтобы граф был читаем.
- Текстуры Megascans — опционально через статический свитч `UseTextures` (выключенная ветка не компилируется → 0 стоимости).
- Погода приходит через `MPC_RakisWeather` (никаких Tick-обновлений MID для погоды).

## MPC_RakisWeather (`/Game/Rakis/Materials/Functions/`)
| Параметр | Тип | Дефолт | Кто пишет | Смысл |
|---|---|---|---|---|
| WindSpeed | scalar | 3.5 | WeatherSubsystem | м/с (с порывами) |
| StormIntensity | scalar | 0 | WeatherSubsystem | 0..1 |
| DustDensity | scalar | 0.10 | WeatherSubsystem | 0..1 |
| HeatHaze | scalar | 0.10 | WeatherSubsystem | 0..1 |
| TimeOfDay01 | scalar | 0.278 | WeatherSubsystem | часы/24 |
| WormThreat01 | scalar | 0 | ARakisWorm | 0..1 |
| Interior01 | scalar | 0 | WeatherSubsystem (SetInterior) | 0 пустыня … 1 сиетч |
| WindDirection | vector | (0.574, 0.819, 0) | WeatherSubsystem | единичный, **куда** дует |
| SunDirection | vector | рассвет (0.125, 0.963, 0.238) | WeatherSubsystem | единичный, **на** солнце |
| SandTint | vector | (1, 0.97, 0.95) | WeatherSubsystem | множитель цвета песка/пыли |
| PlayerPosition | vector | 0 | персонаж/WeatherSubsystem | см, для следов/RVT |

Повторный запуск скрипта сохраняет GUID существующих параметров (ссылки в материалах и C++ не ломаются) и удаляет параметры вне контракта.

## Мастер-материалы (`/Game/Rakis/Materials/Master/`)

### M_Landscape_Sand — см. `sand.md`
Ландшафт/Nanite. Рябь (`SandRipples.ush`), искры (`SandSparkle.ush`), макро/микро вариация, склон рыхлый/плотный, выбеливание дали, RVT-выход, Nanite displacement, крючок следов. **~290 инструкций**, 0 текстур (процедурно).

### M_Rock_Master
Скала «Коготь Шайтана» и россыпь камней. Nanite, ISM.
| Вход | Источник |
|---|---|
| BaseColor | RockColorA/B по слоям `RakisRockStrata` (Z, изгиб fbm) + макромаска + прожилки `VeinColor`; при `UseTextures` — трипланар `WorldAlignedTexture(T_Rock_BC)`; песок на верхних гранях: `saturate((N.z − (1 − SandAccumulation))·SandSharpness)` × микрошум, цвет `SandColor × MPC.SandTint` |
| Roughness | `Roughness` 0.86, полировка ветром: на наветренных гранях (−N·WindDirection) до ×0.55 (`WindPolish`); песок 0.93 |
| Normal | `T_Rock_N` (UV0 × `DetailNormalTiling`) при `UseTextures`, сглаживается под песком |
| AO | `T_Rock_ORM.R` |
Параметры: RockColorA #8A6A50, RockColorB #6B5241, VeinColor #B59C7E, SandColor #C9A878, MacroScale 6000, MicroScale 150, MacroStrength 0.35, StrataScale 180, StrataWarp 2.5, StrataStrength 0.35, VeinStrength 0.25, SandAccumulation 0.55, SandSharpness 5, WindPolish 0.35, Roughness 0.86, TextureSizeCm 400, DetailNormalTiling 4.
Стоимость: ~230 инструкций, 0 текстур / 5 выборок с текстурами (трипланар = 3 BC + N + ORM).
Текстуры: Megascans «Sandstone Cliff», «Desert Rock Formation», «Eroded Sandstone» → `T_Rock_Claw_BC/N/ORM` (4K для доминанты, тайлинг 4 м + макромаски). Инстансы: `MI_Rock_Claw` (слои сильнее, StrataScale 240, Macro 120 м), `MI_Rock_Scatter` (больше песка, мелкий макро).

### M_Sietch_Stone
Модули сиетча (Nanite, ISM, сетка 50 см). Принимает DBuffer-декали (три исторических слоя).
| Вход | Источник |
|---|---|
| BaseColor | StoneColor/StoneColorDark × вариация; полировка → × `PolishTint` (тёплое затемнение от кожи рук); копоть `SootColor` выше `SootHeightWS` (мир. Z, плавно на `SootFadeCm`); грязь в углублениях по AO (`Grime`) |
| Polish-маска | `Polish` × (рёбра + полоса высоты рук `HandBandMinCm..HandBandMaxCm` (лок. Z, 70–170 см) × `HandBandWeight`). Рёбра: `UseVertexPolish` = Vertex Color R (кривизна, запекается Blender-скриптом env-artist) иначе `T_Polish_Mask.R` (по умолчанию чёрная) |
| Roughness | 0.78 → `PolishRoughness` 0.28 по маске, копоть 0.95 |
| AO | `T_Stone_ORM.R` или Vertex Color A, сила `AOStrength` |
| Normal | `T_Stone_N`, ослаблена на полированном (−60 %) |
Стоимость: ~170 инструкций, 0–4 текстуры. Megascans: «Sandstone Wall», «Rough Hewn Stone», «Limestone Block» → `T_Sietch_Stone_BC/N/ORM` (2K, trim-sheet). Инстансы: `MI_Sietch_Stone_Floor` (Polish 0.8, без копоти и полосы рук), `MI_Sietch_Stone_Wall` (Polish 0.5, HandBand 0.6, копоть 0.6). `SootHeightWS` выставлять **на инстанс зоны** (потолок B2 ≈ Z пола + 450 см).

### M_Cloth_Worn
Shading model **Cloth**, two-sided, skeletal/ISM. `ClothTint` — **имя фиксировано**: `ARakisCitizen` создаёт MID и пишет цвет из палитры архетипа (`CrowdArchetypes.csv: ClothPalette`).
| Вход | Источник |
|---|---|
| BaseColor | ClothTint (× `T_Cloth_BC` при `UseTextures`); потёртость (`RakisClothWear`.x) → светлее/бледнее; пыль → `DustColor × SandTint`, усиливается `MPC.DustDensity` |
| Fuzz Color (Subsurface pin) | `SheenColor` (гаснет под пылью) |
| Cloth (CustomData0) | `SheenAmount` 0.6 → 0.2 под пылью |
| Roughness | 0.82 → 0.9 потёртость → 0.95 пыль |
| Normal | `T_Cloth_Weave_N` × `WeaveTiling` 8 |
Маска износа: `UseVertexWear` → Vertex Color G (Marvelous/Blender), иначе константа `WearBase`. Пыль: подол (лок. Z < `HemHeightCm` 45) + верхние грани.
Стоимость ~120 инструкций, 1–2 текстуры. Инстансы: `MI_Cloth_Stillsuit` (#4A4038, Sheen 0.25, Roughness 0.62 — прорезиненный слой), `MI_Cloth_Robe_Ochre` (#A07A4A), `MI_Cloth_Robe_Indigo` (#2E3A5C).
Текстуры: Megascans/Fab «Linen Coarse», «Wool Felt», «Canvas Fabric» → `T_Cloth_Weave_N` (1K, тайлинг).

### M_Spice_Fabric
Тот же граф, что M_Cloth_Worn + процедурный узор (полосы + ромбы, `PatternColor` ибад-синий #2C4A7A, `PatternScale` 12, `PatternWidth` 0.12) на ткани цвета пряности #A04A22. Для навесов рынка B2, ковров B5. ~140 инструкций.

### M_Worm_Chitin
Shading **Subsurface**; ISM, spline mesh, Nanite, skeletal (на будущее).
| Вход | Источник |
|---|---|
| BaseColor | `RakisChitin(UV0)`: кольца вдоль V (`RingsPerSegment` 3 на сегмент 4 м), пластины Вороного (`PlatesAround` 14), трещины (`CrackWidth`, `CrackDarkening`), светлые стёртые гребни; песок в бороздках (`SandInGrooves` 0.8) и сверху (`SandOnTop`); влажность пасти `MouthWetness` → `MouthWetColor` #4A1E18 |
| Roughness | 0.62, гребни 0.4, песок 0.95, мокрое 0.22 |
| Subsurface Color / Opacity | `SubsurfaceTint` #6E2E1E / 0.3 (мокрое ×1.6 / 0.6) — тёплое просвечивание тонких краёв пластин в контровом свете |
| Normal | `T_Chitin_N` × `DetailTiling` 6 |
Пасть: для внутреннего слота `SM_Worm_Head` сделать MI с `MouthWetness` = 1 (вручную/env-скрипт). ~200 инструкций, 1 текстура (4K тайлинг хитина по стандарту).

### M_Worm_Teeth
Subsurface, кристаллические молочно-белые: `TeethColor` #E6DFD2 → `MilkColor` #F4F1EA по френелю (молочный ореол на рёбрах), к корню (UV.V → 1) `RootColor` #A89478, кристаллические прожилки (микровариация), Roughness 0.22, Specular 0.6, Subsurface #D8C4A0 / 0.65. ~110 инструкций.

### M_Glowglobe
Default Lit, эмиссив. `BlackBody(TemperatureK = 2700)` × `EmissiveIntensity` 30 × мерцание `RakisGlowFlicker` (сид из ObjectPositionWS — каждый шар свой ритм; медленное «дыхание» + редкие провалы, `FlickerAmount` 0.15) × ядро (обратный френель, `CoreFalloff`). Стекло #1A140C, Roughness 0.08. ~80 инструкций. Эмиссив **не** освещает сцену (Lumen подхватывает слегка) — свет даёт Point Light (`light_setup.py`).

### M_LF_GlowglobeFlicker (Light Function)
Домен Light Function; яркость = `RakisGlowFlicker(Time, PhaseSeed, …)`. Инстансы `MI_LF_GlowglobeFlicker_A/B/C` (PhaseSeed 0.13/0.51/0.87) раздаются светошарам по кругу, чтобы соседние не мерцали синхронно. Мерцание лампы ±12 % — чуть меньше, чем у меша (глаз прощает рассинхрон).

### M_Water_Still
Default Lit opaque (дешевле translucency; отражения — Lumen). `DeepColor` #06090B → `EdgeTint` #1B2A2E по френелю, Roughness 0.03, Specular 0.255 (F0 воды 0.02). Нормаль — редкие капли с кольцами `RakisDripRipples` (`DropsPerCell` 0.3, ячейка 120 см). ~90 инструкций. Для «нельзя смотреть слишком долго» на решётке цистерны: контраст отражения светошаров в чёрной воде.

### M_Decal_Carving / M_Decal_Paint (Deferred Decal, DBuffer)
Три исторических слоя сиетча (опора 4 GDD):
1. Фрименская резьба — `M_Decal_Carving`, `Weathering` 0.6–0.8, `CarvingTint` тёплый тёмный, нормаль `T_Carving_N`.
2. Символы Квизарата — `M_Decal_Carving`, `Weathering` 0.1–0.2, `SootInGrooves` 0.6 (копоть лампад).
3. Наивные росписи возрожденцев — `M_Decal_Paint`: `PaintColor` (охра-красная #9E3B22, ибад #2C4A7A, белая глина #E8DCC8), `Flaking` 0.35 (шелушение fbm), `ColorFade`.
Маски `T_Carving_Mask` / `T_Paint_Mask` (R/A — маска, RGB у краски — вариант цвета), по умолчанию белые — **без назначенной маски декаль — сплошной квадрат**, назначать текстуру в MI обязательно. Источник масок: генерация env-artist (Blender bake height → mask) или Fab «Carved Stone Ornament» decals. ~60 инструкций.

### M_FX_Dust (служебный, не в контракте)
Спрайты Niagara: lit translucency (Volumetric Per-Vertex Non-Directional — освещается солнцем/туманом, дёшево), мягкий круг × fbm-разрыв (`ParticleRandom` как сид), `DepthFade`. Инстансы: `MI_FX_Dust_Sand`, `MI_FX_Dust_Storm`, `MI_FX_Dust_Spice`, `MI_FX_Motes` (EmissiveBoost 2). ~70 инструкций, **главный риск — overdraw**, см. fx.md.

### M_Blockout (служебный, не в контракте)
Без Custom-include (работает даже без собранного модуля): `Color` + мировая сетка 1 м (`GridStrength`). Инстансы контракта: `MI_Blockout_Sand` #C9A878, `MI_Blockout_Rock` #8A6A50, `MI_Blockout_Stone` #9C8670.

## Пост-процесс (`/Game/Rakis/Materials/PostProcess/`)
### M_PP_HeatHaze
Blendable Location «Scene Color Before DOF» (= до тонмаппера), Custom `RakisHeatHazeUV` (`HeatHaze.ush`) → смещённые UV → `SceneTexture:PostProcessInput0`.
Маска: дистанция (`StartDistanceCm` 15 м → `FullDistanceCm` 250 м) × близость к уровню земли (`exp(−h/HeightFalloffCm)`, h — высота точки над уровнем ног камеры), на небе — только полоса горизонта (`SkyHorizonBand`). Рябь: три октавы value-noise, вертикально вытянутые, поднимаются (`RiseSpeed`), сносятся поперёк ветра. Сила = `MPC.HeatHaze × Intensity × (1 − Interior01)`; `MPC.WormThreat01 × WormThreatInfluence` добавляет низкочастотную «дрожь» нижней трети кадра. Максимальный сдвиг `MaxOffsetUV` 0.0025 (≈3.6 px в 1440p). Стоимость ~0.15 мс @1440p (1 доп. выборка + ~70 ALU).
### M_PP_ScreenDust
Пыльная «вуаль» по краям кадра: виньетка (`VignetteInner/Outer`) × fbm-зерно, сносимое ветром, × драйверы `StormIntensity·1.0 + WormThreat01·0.8 + DustDensity·0.25`; цвет — яркость сцены × `DustTint` (не плоская заливка → не «серит» кадр); редкие тёмные песчинки (`SpeckAmount`). В интерьере выключено. ~0.1 мс.
Инстансы `MI_PP_HeatHaze`, `MI_PP_ScreenDust` в `/Instances/` — их кладёт в blendables `light_setup.py`.

## Сводка стоимостей (оценка, PS-инструкции)
| Материал | Инструкции | Текстуры (макс.) | Где на экране |
|---|---|---|---|
| M_Landscape_Sand | ~290 | 0 (+4 с текстурами/следами) | 50–80 % кадра в пустыне |
| M_Rock_Master | ~230 | 5 | до 40 % в A3 |
| M_Sietch_Stone | ~170 | 4 | 60–90 % в сиетче |
| M_Cloth_Worn / M_Spice_Fabric | ~120 / ~140 | 2 | толпа 40–80 NPC |
| M_Worm_Chitin / Teeth | ~200 / ~110 | 1 / 0 | кат-сцена |
| M_Glowglobe | ~80 | 0 | мелкие |
| M_Water_Still | ~90 | 0 | B4 |
| Decals | ~60 | 2 | |
| M_FX_Dust | ~70 | 0 | overdraw! |
Числа сверить в редакторе: Material Editor → Stats (после первой компиляции) и записать сюда.

## Что делается вручную в редакторе
- Проверить компиляцию каждого мастера (если модуль Rakis не собран — Custom с `#include` не найдут файл → WorldGridMaterial).
- Назначить реальные текстуры Megascans/Fab (скрипт найдёт их сам по именам `T_*` — достаточно переименовать при импорте и перезапустить скрипт).
- RVT-ассеты и Virtual Texture Volume (sand.md §5).
- MI для внутреннего слота пасти червя (`MouthWetness` = 1), MI с масками для декалей.
- Материал облаков с параметром `Coverage` (см. lighting_weather.md).
