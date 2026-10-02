# Песок Ракиса — M_Landscape_Sand (T-008)

Мастер: `/Game/Rakis/Materials/Master/M_Landscape_Sand`. Генератор: `Tools/unreal_python/mat_master_materials.py` → `build_landscape_sand()`.
HLSL: `Source/Rakis/Shaders/SandRipples.ush`, `SandSparkle.ush`, `RakisSurface.ush` (`RakisMacroVariation`), `RakisNoise.ush`.
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
| 07 Nanite | DisplacementIntensity | 1.0 | 0–4 | magnitude в материале = 1.5 см |
| 08 Trails | UseTrails (switch), TrailExtentCm, T_TrailMask | false, 4096 | | см. §4 |
| Textures | UseTextures (switch), T_Sand_BC/N/ORM, TextureTilingCm, TextureTint | false, 200 см | | см. §3 |

## 3. Текстуры (опционально)
По умолчанию песок **полностью процедурный** (0 текстурных выборок кроме RVT). Если в проект импортированы Megascans/Fab — скрипт ищет `T_Sand_BC|N|ORM` (а также `T_Desert_Sand_*`, `T_Sand_Dune_*`) в `/Game/Rakis`, `/Game/Megascans`, `/Game/Fab`, `/Game/Quixel` и включает `UseTextures` в обоих инстансах.
Рекомендуемые поверхности Megascans (найти в Fab по названию): «Desert Sand» / «Wind-Swept Sand», «Coarse Sand», «Sand Ripples» (для крупного плана тропы). Переименовать при импорте в `T_Sand_BC`, `T_Sand_N`, `T_Sand_ORM` (ORM: sRGB off, compression Masks). Тайлинг 2 м, текстуры 2K достаточно (плотность 512 px/м — фон).

## 4. Следы и колея червя (деформация)
Реализовано как «крючок» (`UseTrails`), рантайм — задача геймплея:
1. Render Target `RT_SandTrails` 2048², покрывает `TrailExtentCm` = 40.96 м вокруг `MPC.PlayerPosition` (2 см/px).
2. Каждый шаг (`ARakisCharacter::OnFootstep`) рисует в RT мягкое пятно (Draw Material to Render Target, материал-штамп), при смещении игрока RT «скроллится» (смещение UV на величину сдвига, кратную пикселю).
3. Червь (`ARakisWorm`) — отдельная широкая полоса в том же RT (канал R), след затухает за ~60 с (материал-«стиратель» с альфой 0.02 каждый кадр).
4. В материале: `T_TrailMask` ← RT, `UseTrails` = true: цвет ×0.82 (влажнее внутри), рябь гасится, displacement Nanite вычитает глубину (до 1.5 см; для колеи червя увеличить `magnitude` в MI до 15 см — инстанс-перекрытие «Displacement Scaling»).
Нужно для этого: C++-компонент/Blueprint рисования в RT (зона gameplay-programmer core) — вопрос в handoff T-008.

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
| UseTrails = true | +5 | +1 |
| **Итого (процедурный)** | **~290 инструкций PS** | 0 (+RVT при включении) |
Целевой бюджет ландшафта — ≤ 350 инструкций (Shader Complexity «зелёно-жёлтый»). Если упрёмся в GPU — первым урезать `RakisMacroVariation` до 3+2 октав (−50 ALU) или запечь макровариацию в RVT.

## 8. Как проверить
1. `build_demo.py --only mat_master_materials`; в логе `Материал M_Landscape_Sand собран` без «не удалось соединить».
2. Открыть `MI_Sand_Erg_Dry`, назначить на плоскость 50×50 м: при низком солнце (`Rakis.TimeOfDay 7`) видна рябь поперёк ветра, при развороте камеры к солнцу — искры.
3. Консоль `Rakis.Weather Storm_Horizon 2` → рябь ориентируется по новому ветру (yaw 40°), песок желтеет (SandTint).
4. `viewmode shadercomplexity` — ландшафт не красный.
