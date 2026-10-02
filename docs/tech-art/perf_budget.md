# Бюджет кадра «Rakis: Heretics»

Цель (стандарт проекта): **60 fps = 16.6 мс**, **GPU ≤ 14 мс**, RTX 3070 (эталон; 4060 ≈ −5 %), **1440p, TSR 66 %** (внутреннее ≈ 1690×950), Lumen HW RT (surface cache), Nanite, VSM. Запас 2.6 мс — на пики (кат-сцена червя, стриминг).

## 1. GPU — пустыня (A2, Morning_Erg, худший обычный кадр)
| Проход | Бюджет, мс | Комментарий |
|---|---|---|
| Nanite VisBuffer + ландшафт (вкл. тесселяцию) | 2.0 | ландшафт Nanite 2×2 км + тесселяция ~0.7 |
| BasePass / материалы (песок ~290 инстр.) | 1.6 | песок занимает 60–80 % кадра |
| VSM (солнце) | 1.3 | кэш статики, движутся только персонажи/червь |
| Lumen Scene Update + Surface Cache | 0.8 | |
| Lumen Final Gather (Screen Probe) | 2.1 | Quality 1 |
| Lumen Reflections | 0.7 | песок шероховатый — мало трассировок |
| Sky Atmosphere + Volumetric Cloud | 0.7 | облака высокие, редкие; `r.VolumetricCloud.ReflectionRaySampleMaxCount` по умолчанию |
| Height Fog + Volumetric Fog | 0.5 | |
| Translucency (Niagara: позёмка, вихри, стена бури) | 0.5 | ≤ 30k частиц |
| Пост: марево + пыль + TSR + bloom + тонмаппер | 1.6 | TSR ~1.1, марево 0.15, пыль 0.1 |
| Прочее (HZB, velocity, AO, UI) | 0.7 | |
| **Итого** | **12.5** | запас 1.5 до 14 |

## 2. GPU — выход червя (A2, Worm_Reveal + LS_WormReveal, пик)
| Отличие от §1 | Δ мс |
|---|---|
| Червь: 360 м, 90 сегментов ISM Nanite + Subsurface | +0.6 |
| Частицы до 110k, overdraw пыли | +1.0 |
| Volumetric fog плотнее (Dust 0.9) | +0.2 |
| Лучи/тени от тела червя (VSM инвалидирует страницы) | +0.5 |
| **Итого** | **≈ 14.8** — допустимо в кат-сцене (30-кадровый провал не нужен, но 55–60 fps ок); при превышении — Scalability Breach.Column ×0.6 |

## 3. GPU — сиетч (B2 рынок, Sietch_Interior)
| Проход | мс |
|---|---|
| Nanite + BasePass (камень, ткани, толпа 40–80 NPC) | 3.2 |
| Тени: 30–60 точечных светошаров (VSM local, кэш) | 2.0 |
| Lumen (GI в закрытом пространстве дороже — много отражённого) | 3.3 |
| Volumetric fog (много локальных источников) + Local Fog Volumes | 0.9 |
| Translucency (дымка пряности, пылинки) | 0.4 |
| Скелетные меши толпы (skin cache) | 1.0 |
| Пост + TSR | 1.4 |
| Прочее | 0.6 |
| **Итого** | **12.8** |
Самые рискованные: тени светошаров (держать ≤ 25 теневых в кадре: Max Draw Distance 60 м + у мелких декоративных шаров `Cast Shadows = off`), Lumen Final Gather в узких проходах.

## 4. CPU (game + render thread, ≤ 12 мс)
| Система | Бюджет |
|---|---|
| Толпа 40–80 ARakisCitizen (Mass/StateTree, анимация с URO) | 3.0 мс |
| Червь (сплайн 90 ISM обновлений/кадр) | 0.5 |
| Niagara (CPU-часть, ~25 систем) | 0.6 |
| WeatherSubsystem, Noise, Audio | 0.4 |
| Render thread (Nanite — мало draw calls; тени, Lumen) | ≤ 8 |

## 5. Память (VRAM 8 ГБ на 3070)
Текстуры стриминга ≤ 3 ГБ (пул `r.Streaming.PoolSize=3000`), Nanite стриминг 512 МБ, Lumen/VSM ~1 ГБ, RT ~0.6 ГБ, частицы/буферы 0.3 ГБ.

## 6. Как мерить
1. `stat unit` / `stat unitgraph` — Game/Draw/GPU; `stat gpu` — проходы (сравнить с таблицами выше); `profilegpu` — детально.
2. Unreal Insights: `-trace=default,gpu,niagara` (+ `stat namedevents`), снимать 3 «золотых» точки: A1 старт, A2 Worm_Reveal, B2 рынок + B5 луч.
3. `r.ScreenPercentage 66` + `r.AntiAliasingMethod 4` (TSR) — фиксированно для замеров; отключить vsync (`r.VSync 0`), `t.MaxFPS 0`.
4. `viewmode shadercomplexity`, `viewmode quadoverdraw` (частицы), `r.Lumen.Visualize.*`, `r.Shadow.Virtual.Visualize`.
5. Результаты замеров → таблица в `docs/qa/S1_report.md` (T-QA), отклонения > 10 % — задача tech-artist.

## 7. Рычаги, если не влезаем (по порядку)
1. Lumen Final Gather Quality 1 → 0.75 в сиетче (локальный PPV).
2. Тени светошаров: `Cast Shadows = off` у шаров ниже 900 лм.
3. Nanite-тесселяция ландшафта: `DisplacementIntensity = 0` (MI) — рябь останется нормалью.
4. Частицы: Scalability spawn ×0.6, translucency в low-res pass.
5. Volumetric fog: `r.VolumetricFog.GridPixelSize 16` (по умолчанию 8 на Epic).
6. Макровариация песка: 4+3 → 3+2 октавы (`RakisMacroVariation`).
7. TSR 66 % → 58 % (Balanced) на 3060-классе.
