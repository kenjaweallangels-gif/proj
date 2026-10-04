# Песок Ракиса — M_Landscape_Sand (T-008)

Мастер: `/Game/Rakis/Materials/Master/M_Landscape_Sand`. Генератор: `Tools/unreal_python/mat_master_materials.py` → `build_landscape_sand()`.
HLSL: `Source/Rakis/Shaders/SandRipples.ush`, `SandSparkle.ush`, `SandTrail.ush` (следы, T-017), `RakisSurface.ush` (`RakisMacroVariation`), `RakisNoise.ush`.
Следы: C++ `URakisSandTrailSubsystem` (`Source/Rakis/{Public,Private}/Sand/`), ассеты RT — `Tools/unreal_python/mat_sand_trails.py`.
Инстансы: `MI_Sand_Erg_Dry` (открытый эрг, гребни), `MI_Sand_Packed` (межгрядья, тропа, «барабанный» песок), `MI_Blockout_Sand` (блокаут, другой мастер).

## 1. Что видит игрок (и почему так)
| Признак реального песка | Как реализовано |
|---|---|
| Песок не однотонный на километрах — пятна светлее/темнее, следы старых дюн | 2 шкалы мирового шума: `MacroScale` 400 м, `MicroScale` 6 м (`RakisMacroVariation`, fbm 4+3 октавы), сила 10 % / 5 % |
| Ветровая рябь 5–15 см, гребни поперёк ветра, асимметричный профиль, Y-ветвления | `RakisSandRipples`: фаза вдоль `MPC.WindDirection`, профиль с пологим наветренным (`RippleAsymmetry` 0.72) и крутым подветренным склоном, изгиб fbm + обрывы гребней (`RippleBreakup`) |
| Рябь медленно ползёт по ветру | `Drift = Time · WindSpeed · 0.0003 · RippleMigration` (≈ 1 длина волны за ~10 мин при 6 м/с — глаз видит «жизнь», но не поток) |
| На крутых подветренных склонах (лавинные, ~32°) ряби нет, песок рыхлый и светлее | маска `loose = saturate((LooseSlopeNormalZ − N.z)·Sharpness)`: рыхлый — `SandColor_Loose`, шероховатость 0.93, рябь ×(1−loose) |
| Межгрядья и наветренные склоны плотные, чуть темнее и глаже | `SandColor_Packed`, `Roughness_Packed` 0.82 (в `MI_Sand_Packed` 0.74) |
| Искры кварца на солнце | `RakisSandSparkle`: ячейки 1.2 см, 3.5 % «зеркальных» зёрен, Blinn H-вектор к `MPC.SunDirection`; маска опускает Roughness → 0.10 и поднимает Specular → 1. Блик рисует настоящий свет — **в тени искр нет** |
| Даль выбелена и обесцвечена (атмосфера + пыль) | lerp к `SandColor_Distance` (#DCC7A3) от 50 м до 1.25 км, до 35 %. Основную воздушную перспективу даёт Sky Atmosphere/туман, это лишь «досолка» |
| Цвет песка меняется с погодой (розоватый рассвет, жёлтая буря) | × `MPC.SandTint` (пишет WeatherSubsystem) |

## 2. Параметры (группы в инстансе)
| Группа | Параметр | Дефолт | Диапазон | Комментарий |
|---|---|---|---|---|
| 01 Color | SandColor_Loose / _Packed / _Distance | #C9A878 / #B8936A / #DCC7A3 | — | sRGB-значения, в VectorParameter — линейные |
| 02 Variation | MacroScale, MicroScale | 40000, 600 см | | |
| | MacroStrength, MicroStrength | 0.10, 0.05 | 0–0.5 | |
| 03 Slope | LooseSlopeNormalZ | 0.90 (≈26°) | 0.5–1 | ниже — рыхлый |
| | LooseSlopeSharpness | 8 | | ширина перехода |
| | Roughness_Loose / _Packed, Specular | 0.93 / 0.82 / 0.35 | | сухой кварц: F0 ≈ 0.028 |
| 04 Ripples | RippleWavelength | 9 см | 3–30 | |
| | RippleBreakup, RippleMigration, RippleAsymmetry | 0.45, 1, 0.72 | | |
| | RippleStrength, RippleFadeDistance | 0.65, 6000 см | | дальше 60 м рябь не видна и мерцает — гасим |
| 05 Sparkle | SparkleCellSize, Density, Sharpness | 1.2 см, 0.035, 180 | | |
| | SparkleFadeDistance, Intensity, Roughness | 2500 см, 1, 0.10 | | |
| 06 Distance | DistanceBleachStart / Range / Amount | 5000 / 120000 см / 0.35 | | |
| 07 Nanite | DisplacementIntensity | 1.0 | 0–4 | сила ряби в displacement (рябь до 1.5 см); magnitude материала 16 см, center 0.5 (±8 см) |
| 08 Trails | UseTrails (switch) | false (в MI_Sand_* — true) | | см. §4 |
| | SandTrailRT / SandTrailRTFar (Texture Object) | RT_SandTrail / RT_SandTrail_Far | | RT следов, ставит скрипт |
| | TrailDarkening, TrailRimLighten, TrailRoughnessDelta | 0.16, 0.05, −0.08 | | вид «взрыхлённого» песка |
| | TrailNormalStrength, TrailDisplacementScale, TrailWPOScale | 1, 1, 1 | 0–4 / 0–2 | |
| | TrailMaxDepthNearCm / FarCm, TrailMaxRimNearCm / FarCm | 7.5 / 200, 2.5 / 60 | | кламп накопления |
| | TrailNearTexels / TrailFarTexels | 2048 / 1024 | | = разрешение RT (для градиента) |
| Textures | UseTextures (switch), T_Sand_BC/N/ORM, TextureTilingCm, TextureTint | false, 200 см | | см. §3 |

## 3. Текстуры (опционально)
По умолчанию песок **полностью процедурный** (0 текстурных выборок кроме RVT). Если в проект импортированы Megascans/Fab — скрипт ищет `T_Sand_BC|N|ORM` (а также `T_Desert_Sand_*`, `T_Sand_Dune_*`) в `/Game/Rakis`, `/Game/Megascans`, `/Game/Fab`, `/Game/Quixel` и включает `UseTextures` в обоих инстансах.
Рекомендуемые поверхности Megascans (найти в Fab по названию): «Desert Sand» / «Wind-Swept Sand», «Coarse Sand», «Sand Ripples» (для крупного плана тропы). Переименовать при импорте в `T_Sand_BC`, `T_Sand_N`, `T_Sand_ORM` (ORM: sRGB off, compression Masks). Тайлинг 2 м, текстуры 2K достаточно (плотность 512 px/м — фон).

## 4. Следы и колея червя (деформация) — T-017, реализовано
### 4.1 Что видит игрок
| Признак | Реализация |
|---|---|
| Отпечаток стопы с пяткой и плюсной, толчок носком (плюсна глубже, песок выброшен вперёд — вал у носка выше) | процедурная форма `RakisTrailStampShape` (тип Footprint), квад 2R×1.1R, повёрнут по направлению шага |
| Левая/правая стопа, длина шага | игрок — точка стопы из `ARakisCharacter` (шум "Footstep"); NPC — каждые 60 см смещения, ±10 см вбок |
| Бег глубже ходьбы, «походка по песку» — мелкие следы | `Depth01 = lerp(0.6, 1, Loudness)` (игрок) / `lerp(0.6, 1, speed/600)` (NPC); плотный песок (SurfaceType6) ×0.5 |
| Съезд по склону — борозда, а не следы | NPC/игрок: падение высоты/путь > 0.45 и скорость ≥ 220 см/с → тип Sliding |
| Удар тампера: лунка, кольцо «прыгающего» песка, концентрические волны | тип ThumperRing на каждый импульс (шум "Thumper"), импульсы накапливаются |
| Колея червя — широкий (≈30 м) жёлоб с валами, глубже, когда голова ближе к поверхности | тип WormFurrow вдоль пути головы (шаг R/2), Approach/Surface/Ridden/Pass; `Depth01` от глубины головы |
| Кратер выхода | тип WormCrater (R 26 м, глубина до 1.6 м, вал 0.5 м) при входе в Surface |
| Внутри следа песок темнее (влажнее), глаже, ряби нет; вал чуть светлее | `TrailDarkening`, `TrailRoughnessDelta`, `rip_amt ×(1 − disturb)`, `TrailRimLighten` |
| Следы «затягивает» ветром, буря стирает за секунды | fade: полураспад 120 с в штиль, ×(1 + Wind/6 м/с), буря +ln2/8 с; колея червя — вдвое медленнее |

### 4.2 Данные: два каскада RT
| Каскад | Ассет | Размер | Окно | см/тексель | Снап окна | Типы |
|---|---|---|---|---|---|---|
| Ближний | `/Game/Rakis/Materials/RT/RT_SandTrail` | 2048², RG16f | 40.96 м | 2 | 5.12 м | Footprint, Sliding, ThumperRing |
| Дальний | `/Game/Rakis/Materials/RT/RT_SandTrail_Far` | 1024², RG16f | 204.8 м | 20 | 25.6 м | WormFurrow, WormCrater, ThumperRing |
Почему два, а не один 2048² × 160 м: при 7.8 см/тексель стопа (28×13 см) — 3×2 текселя, форма не читается; колее червя (30 м) нужно окно ≥ 150 м. Два RT = 16 + 4 МБ VRAM.

Каналы: **R — глубина вмятины, см** (≥ 0), **G — высота вала, см**. Высота поверхности = G − R. Штампы складываются аддитивно (тропа, по которой прошли трижды, глубже — как в жизни), накопление ограничивает кламп в материале (`TrailMaxDepth*/TrailMaxRim*`).

Окно: `MPC_RakisWeather.TrailOrigin` / `TrailOriginFar` = (центр X, центр Y, размер окна, активен 0/1), см. **Параметры добавлены в MPC в T-017** (разрешение orchestrator; остальные параметры контракта §2.5 не тронуты, GUID сохраняются). Пишет только `URakisSandTrailSubsystem` (при рецентровке и раз в секунду). Дефолт w = 0 — без подсистемы ландшафт RT не сэмплирует.

Отображение (одно и то же в C++ `WorldToPixel` и HLSL): `UV = (WorldPos.xy − Origin.xy) / Origin.z + 0.5`; +X мира → +U, +Y мира → +V. Yaw штампа = мировой yaw (экранный поворот Canvas +X→+Y совпадает).

### 4.3 Рисование (C++, каждый кадр, игровой поток)
1. **Рецентровка**: окно следует за пешкой игрока (или камерой) с гистерезисом в шаг снапа; новый центр — на сетке снапа, кратной текселю. Сдвиг содержимого — пинг-понг: `M_SandTrail_Copy` (Opaque, `UVOffset` = Δ/размер, вне [0,1] → 0) рисует Target→Scratch со сдвигом, затем Scratch→Target. Δ кратна текселю → копия без пересэмплинга (без «расплывания»). Телепорт дальше окна — очистка.
2. **Заживление** (раз в 0.25 с): `M_SandTrail_Fade` (Translucent, Emissive 0, Opacity = FadeAlpha) → `dest *= 1 − FadeAlpha`, `FadeAlpha = 1 − exp(−Rate·Δt)`, Rate из MPC `WindSpeed`/`StormIntensity`. Точность R16f: минимальный шаг (штиль, дальний каскад) ≈ 0.12 %/0.25 с ≥ 2 ulp — затухание не «залипает».
3. **Штампы**: копятся за кадр (`AddStamp`), на каскад — одна пара `BeginDrawCanvasToRenderTarget` / `EndDrawCanvasToRenderTarget`, каждый штамп — `UCanvas::K2_DrawMaterial(MID, позиция, размер, UV 0..1, Rotation = yaw, Pivot 0.5)`. `M_SandTrail_Stamp` — Unlit **Additive**, Emissive = (`StampDepthCm`·w.x, `StampRimCm`·w.y, 0). MID — свой на каждый штамп пачки (пул до 128, переиспользуется между кадрами: Canvas рендерит при EndDraw, и параметры одного MID внутри пачки «схлопнулись» бы). Штамп меньше 1.5 текселя или вне окна каскада не рисуется.
Форма — процедурная (`RakisTrailStampShape`, 0 текстур); квад = 1.3 × радиус формы, чтобы вал помещался.

### 4.4 Ландшафт (M_Landscape_Sand, `UseTrails`)
Одна Custom-нода `RakisSandTrail` (SandTrail.ush): на каскад 5 выборок `SampleLevel` (центр + 4 соседа ±1 тексель → градиент), маска окна (последние 10 % окна — плавное затухание), под `BRANCH` — вне окна выборок нет. Выход float4: (dh/dx, dh/dy, высота ближнего, высота дальнего), см.
- **BaseColor**: `× (1 − disturb·TrailDarkening) × (1 + rim·TrailRimLighten)`, disturb = 1.5 см следа или 25 см колеи = «полностью взрыхлено».
- **Normal**: `normalize(−dh/dx, −dh/dy, 1)` (касательное ≈ мировое у ландшафта) смешивается whiteout-ом с текстурой и рябью. Нормаль обязательна: ни Nanite displacement, ни WPO нормали не пересчитывают.
- **Roughness**: `+ disturb·TrailRoughnessDelta` (утоптанное глаже); рябь гасится внутри следа.
- **Displacement (Nanite tessellation)**: ближний каскад + рябь. `DisplacementScaling` magnitude 16 см, center 0.5 → ±8 см (вмятина до −7.5, вал до +2.5). Рябь сохранила прежнюю высоту (1.5 см).
- **WPO**: дальний каскад (колея/кратер червя — метры, гладко; плотности вершин Nanite-ландшафта хватает). `max_world_position_offset_displacement` = 260 см.
- RVT получает цвет **без** следов (RVT обновляется редко — следы в нём «застыли» бы).

### 4.5 Стоимость (цель ≤ 0.3 мс GPU, RTX 3070, 1440p TSR 66 %)
| Часть | Оценка |
|---|---|
| Ландшафт: 10 выборок RG16f (кэш-дружелюбно, RT 16+4 МБ) + ~40 ALU, только в окне | ≈ 0.10–0.15 мс (песок 60–80 % кадра) |
| WPO/Displacement: +1 Custom в вершинном/тесселяции (5 выборок дальнего / ближнего) | ≈ 0.03–0.05 мс |
| Fade: 2048² + 1024² полноэкранных квада раз в 0.25 с | < 0.01 мс в среднем (≈ 0.03 мс в кадре прохода) |
| Скролл: 2 копии каскада раз в 5–25 м пути | ≈ 0.04 мс в кадре рецентровки |
| Штампы: 1–30 квадов за кадр (колея — до ~10 крупных) | < 0.02 мс |
| **Итого** | **≈ 0.15–0.25 мс** |
CPU: скан персонажей 10 Гц (TActorIterator + 1 трасса на след), червь 10 Гц — < 0.05 мс. Выключение: `Rakis.SandTrails 0` (MPC w = 0 → ветка без выборок), либо `UseTrails = false` в MI (ветка вырезается при компиляции).

### 4.6 C++: `URakisSandTrailSubsystem` (`Source/Rakis/Public/Sand/RakisSandTrailSubsystem.h`)
`UTickableWorldSubsystem`, только Game/PIE, не создаётся на выделенном сервере.
```cpp
// Любой код/Blueprint: поставить штамп (рисуется в конце кадра).
if (URakisSandTrailSubsystem* Trails = URakisSandTrailSubsystem::Get(this))
{
    Trails->AddStamp(WorldPos, /*RadiusCm*/ 15.f, /*Depth01*/ 1.f, /*YawDeg*/ Actor->GetActorRotation().Yaw,
                     ERakisStampType::Footprint);   // Footprint | Sliding | WormFurrow | ThumperRing | WormCrater
}
Trails->ClearTrails();   // кат-сцена/телепорт
```
- `RadiusCm` — радиус вмятины (стопа — полудлина ≈ 15 см; колея — 15 м). Глубина = `Depth01 × <Type>DepthCm` (config).
- Подключение без правки чужого кода: `URakisNoiseSubsystem::OnNoiseReported` ("Footstep" → след ближайшего персонажа, "Thumper" → кольцо); скан `ACharacter` 60 м/10 Гц (персонажи, приславшие шум шага за последние 1.5 с, сканом не штампуются — без дублей); `ARakisWorm::GetState/GetHeadLocation/GetGroundZ` через `TActorIterator`.
- «Песок ли»: теги `Rakis.Surface.Sand|PackedSand` (как у персонажа) → Physical Surface 1 (Sand) / 6 (PackedSand, ×0.5) → физматериал не задан на ландшафте = песок; камень/пол сиетча — без следов.
- Настройки — `UPROPERTY(Config)` в секции `[/Script/Rakis.RakisSandTrailSubsystem]` DefaultGame.ini (размеры окон, снап, глубины типов, полураспады, радиус скана).
- Консоль: `Rakis.SandTrails 0|1`, `Rakis.SandTrails.Clear`. Тесты: `Rakis.Sand.*` (отображение мир→RT, снап, затухание).
- Нет ассетов → предупреждение в лог и подсистема спит; нет RT-ассета → транзиентный RT (код работает, ландшафт его не видит).

## 5. RVT
В графе есть `Runtime Virtual Texture Output` (BaseColor, Specular, Roughness, Normal, WorldHeight) — **статические** данные без анимированной ряби и искр. Чтобы заработало:
1. Создать ассеты `RVT_Desert_Color` (тип Base Color, Normal, Roughness, Specular, сжатие BC) и `RVT_Desert_Height` (World Height) в `/Game/Rakis/Environment/Desert/`.
2. На ландшафте: `Draw in Virtual Textures` = оба RVT; поставить `Runtime Virtual Texture Volume` по границам ландшафта (кнопка «Set Bounds»).
3. Меши-камни (M_Rock_Master) могут сэмплить RVT для «врастания» в песок (Virtual Texture Sample по WorldPosition, блендинг по высоте — 30–60 см). Это добавляется вручную (зависит от созданного RVT-ассета), в M_Rock_Master место отмечено группой «04 Sand».
RVT-нормаль для ландшафта пишется в касательном ≈ мировом пространстве (ландшафт выровнен по XY) — для точности можно вставить TransformVector Tangent→World перед выходом.

## 6. Nanite-тесселяция
Материал включает `Enable Tessellation` и выход `Displacement` (рябь × сила). Нужно:
- в настройках ландшафта включить Nanite (`Enable Nanite`) и пересобрать Nanite-данные;
- `r.Nanite.Tessellation=1` и `r.Nanite.AllowTessellation=1` (уже в `Config/DefaultEngine.ini`);
- displacement считается не в пиксельном шейдере, поэтому в `SandRipples.ush` `fwidth` закрыт `#if PIXELSHADER`.
Стоимость тесселяции ландшафта 2×2 км — ~0.6–0.9 мс на 3070; при нехватке бюджета `DisplacementIntensity = 0` (рябь остаётся нормалью).

## 7. Стоимость
| Часть | ALU (оценка) | Текстуры |
|---|---|---|
| Вариация (fbm 4+3) | ~150 | 0 |
| Рябь | ~60 | 0 |
| Искры | ~45 | 0 |
| Склон, цвет, дистанция | ~30 | 0 |
| UseTextures = true | +10 | +3 |
| UseTrails = true | +45 PS, +15 VS/тесселяция | +10 выборок RT (только в окне) |
| **Итого (процедурный)** | **~290 инструкций PS** | 0 (+RVT при включении) |
Целевой бюджет ландшафта — ≤ 350 инструкций (Shader Complexity «зелёно-жёлтый»). Если упрёмся в GPU — первым урезать `RakisMacroVariation` до 3+2 октав (−50 ALU) или запечь макровариацию в RVT.

## 8. Как проверить
1. `build_demo.py --only mat_master_materials`; в логе `Материал M_Landscape_Sand собран` без «не удалось соединить».
2. Открыть `MI_Sand_Erg_Dry`, назначить на плоскость 50×50 м: при низком солнце (`Rakis.TimeOfDay 7`) видна рябь поперёк ветра, при развороте камеры к солнцу — искры.
3. Консоль `Rakis.Weather Storm_Horizon 2` → рябь ориентируется по новому ветру (yaw 40°), песок желтеет (SandTint).
4. `viewmode shadercomplexity` — ландшафт не красный.
5. Следы (T-017): PIE в L_Rakis_Desert, пройтись/пробежать по песку — следы с пяткой и носком, бег глубже; `Rakis.Weather Storm_Horizon 2` — следы затягиваются за ~10 с. `stat GPU` — Landscape BasePass +≤ 0.15 мс к `UseTrails = false`. Отладка RT: Content Browser → `RT_SandTrail` (двойной клик во время PIE), `Rakis.SandTrails.Clear`.
