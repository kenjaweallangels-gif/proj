# Свет и погода «Rakis: Heretics»

Генератор: `Tools/unreal_python/light_setup.py`. Данные: `Content/Rakis/Data/WeatherPresets.csv` → `DT_WeatherPresets` (`FRakisWeatherPresetRow`). Рантайм: `URakisWeatherSubsystem` (смешивает пресеты, двигает солнце, пишет `MPC_RakisWeather`).

## 1. Сцена L_Rakis_Persistent (всё — `gen:light_setup`)
| Актор | Тег | Ключевые настройки |
|---|---|---|
| Directional Light «Rakis_Sun» | `Rakis.Sun` | Movable; Atmosphere Sun Light (index 0); Light Source Angle **0.53°**; cast shadows (VSM — `r.Shadow.Virtual.Enable=1`), contact shadows 0.04; cloud shadows 0.6; per-pixel transmittance; старт — Dawn_Ridge: 75 000 лк, (1.00, 0.86, 0.72), поворот по формуле §3 |
| Sky Atmosphere | — | см. §2 |
| SkyLight | `Rakis.SkyLight` | Real Time Capture, Captured Scene, Movable, нижняя полусфера тёплая (0.20, 0.15, 0.10) |
| Exponential Height Fog | — | Z = 0; плотность/спад/цвет из пресета; Volumetric Fog on: Scattering Distribution (g) из пресета, Albedo (235, 215, 185), Extinction Scale 1 + Dust·4, View Distance 80 м |
| Volumetric Cloud | — | слой 7–10 км (высокие редкие), материал движка `m_SimpleVolumetricCloud_Inst` |
| Wind Directional Source | — | yaw из пресета; Strength = WindSpeed/14, Speed = WindSpeed/6 (для SpeedTree/травы и cloth) |
| PostProcessVolume Unbound | `Rakis.PP.Global` | §4 |
| PostProcessVolume ×N по зонам B* | `Rakis.PP.Interior` | Priority 1, Blend Radius 4 м, Exposure EV100 5..9 (B5: 5..8), bloom 0.5, vignette 0.3 |
| Local Fog Volume ×N по зонам B* | — | radial 0.15 (B5 0.25), height 0.3 (B4/B5 0.45), falloff 600, phase g 0.5, albedo (0.85, 0.72, 0.55) |
Шаблонные атмосферные акторы **без тегов** (из `new_level`) удаляются, чтобы не было двух солнц. Акторы с чужими тегами не трогаются — в лог пишется предупреждение.

## 2. Sky Atmosphere — «пыльный Ракис»
| Параметр | Земля (дефолт UE) | Ракис | Зачем |
|---|---|---|---|
| Rayleigh Scattering Scale | 0.0331 | **0.0281** (−15 %) | небо менее насыщенно-синее, «пыльный кобальт» |
| Rayleigh Exponential Distribution | 8 км | 8 км | |
| Mie Scattering Scale | 0.003996 | **0.0092** (×2.3) | сухая пыль в воздухе: белёсое небо у горизонта, сильный ореол вокруг солнца |
| Mie Scattering (цвет) | белый | (1.0, 0.93, 0.82) | тёплое рассеяние |
| Mie Absorption Scale | 0.000444 | **0.0014** | пыль поглощает |
| Mie Absorption (цвет) | белый | (0.32, 0.50, 1.0) | поглощение сильнее в синем → горизонт охристый, закат «ржавый» |
| Mie Anisotropy | 0.8 | 0.76 | ореол чуть шире |
| Mie Exponential Distribution | 1.2 км | **1.8 км** | пыль поднята ветром выше |
| Other Absorption (озон) | 0.001881 | 0.0006 | меньше пурпура в сумерках, сухая атмосфера |
| Ground Albedo | (0.40, 0.40, 0.40) | (170, 135, 95) | песок подсвечивает нижнее небо |
| Aerial Perspective Distance Scale | 1.0 | 1.2 | масштаб — дали «тают» быстрее |
WeatherSubsystem дополнительно умножает Mie Scattering Scale на `1 + DustDensity·3` (база снимается с компонента при старте) — буря/выход червя желтят небо без отдельных пресетов атмосферы.

## 3. Солнце: формула (совпадает с `URakisWeatherSubsystem`)
Широта φ = 23°, склонение δ = +12° (начало лета), +X — север, +Y — восток. Часовой угол H = 15°·(t − 12).
```
east  = −cos δ · sin H
north =  sin δ · cos φ − cos δ · cos H · sin φ
up    =  sin δ · sin φ + cos δ · cos H · cos φ
SunDirection (на солнце) = (north, east, up);  Light forward = −SunDirection
```
| Пресет | Часы | Высота солнца | Азимут |
|---|---|---|---|
| Dawn_Ridge | 06:40 | 13.7° | восток (чуть севернее) |
| Morning_Erg | 08:30 | 39° | восток |
| Noon_Approach | 11:30 | 77° | почти зенит, юг |
| Storm_Horizon | 12:00 | 79° | юг |
| Sietch_Interior | 17:30 | ≈ 11.5° | запад |
| Hall_Ritual | 17:45 | ≈ 8° | запад |
`TimeOfDayHours = −1` (Worm_Tension, Worm_Reveal, Crevice_Shade) — «сохранить текущее время» (контракт: «—»).

## 4. Пресеты (WeatherPresets.csv)
Интенсивность солнца — **до атмосферы** (Atmosphere Sun Light сам ослабляет и краснит у горизонта), поэтому цвет почти белый, а рассветная розово-охристость получается физически + лёгкий тёплый сдвиг SunColor.
| PresetID | ч | Солнце лк | SunColor | Sky | Fog dens/falloff | Inscatter | VF g | Dust | Ветер м/с, yaw | Storm | Haze | ExpBias | Clouds |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Dawn_Ridge | 6.67 | 75 000 | 1, .86, .72 | 1.2 | .012 / .15 | .55 .45 .42 | .60 | .10 | 3.5, 55 | 0 | .10 | +1.0 | .08 |
| Morning_Erg | 8.5 | 105 000 | 1, .95, .88 | 1.0 | .006 / .08 | .78 .66 .50 | .60 | .15 | 6, 50 | .05 | .45 | +1.25 | .10 |
| Worm_Tension | — | 95 000 | 1, .93, .84 | 0.9 | .010 / .10 | .74 .62 .48 | .65 | .35 | 1.5, 50 | 0 | .55 | +0.9 | .12 |
| Worm_Reveal | — | 60 000 | 1, .85, .68 | 0.7 | .030 / .04 | .70 .55 .38 | .85 | .90 | 8, 50 | .10 | .30 | +0.6 | .15 |
| Noon_Approach | 11.5 | 120 000 | 1, .98, .95 | 1.0 | .005 / .06 | .80 .70 .55 | .60 | .12 | 5, 45 | .15 | 1.0 | +1.5 | .05 |
| Storm_Horizon | 12 | 90 000 | 1, .90, .74 | 0.85 | .018 / .03 | .82 .64 .38 | .70 | .55 | 14, 40 | .70 | .70 | +1.1 | .35 |
| Crevice_Shade | — | 110 000 | 1, .96, .90 | 1.4 | .008 / .10 | .70 .56 .42 | .60 | .08 | 2, 45 | .40 | .05 | +1.3 | .30 |
| Sietch_Interior | 17.5 | 40 000 | 1, .78, .58 | 0.15 | .020 / .02 | .30 .20 .12 | .80 | .25 | 0, 45 | 0 | 0 | +0.3 | .10 |
| Hall_Ritual | 17.75 | 30 000 | 1, .74, .52 | 0.10 | .025 / .02 | .28 .18 .10 | .90 | .40 | 0.3, 45 | 0 | 0 | −0.3 | .10 |
Логика: Worm_Tension — ветер стихает до 1.5 м/с, пыль «висит» (0.35), экспозиция ниже; Worm_Reveal — пыль 0.9, туман ×5, солнце 60 клк (закрыто телом/пылью), g 0.85 → сильные объёмные лучи вперёд; Storm_Horizon — 14 м/с, StormIntensity 0.7, небо желтеет (Mie ×2.65 от Dust 0.55); Crevice_Shade — небо 1.4 (тень освещена небом и тёплым отражением стен через Lumen); интерьеры — малый falloff (сиетч ниже 0 по Z, иначе экспоненциальный туман стал бы стеной).
`VolumetricFogScattering` = Scattering Distribution (анизотропия g). `FogInscatterColor` = Fog Inscattering Luminance. `CloudCoverage` уходит в параметр `Coverage` MID облаков (`URakisWeatherSubsystem::CloudCoverageParam`) — у движкового `m_SimpleVolumetricCloud` такого параметра нет: **вручную** сделать `MI_VolumetricCloud_Rakis` на копии `m_SimpleVolumetricCloud` с ScalarParameter `Coverage` (умножает профиль плотности) и назначить в Volumetric Cloud.

## 5. Экспозиция: пустыня vs сиетч
| | Пустыня (полдень) | Пустыня (рассвет) | Сиетч B2–B4 | Зал B5 |
|---|---|---|---|---|
| Освещённость | 100–120 клк + небо 15–20 клк | 15–30 клк на гребнях | 50–300 лк у светошаров, 5–20 лк в проходах | 3000 лк в пятне луча, 10–50 лк по ярусам |
| Целевая EV100 | **14–15** | 12–13 | **6–8** | 6–7 (луч «пересвечен» на +3 EV — так и надо) |
| ExposureBias | +1…+1.5 (стандарт проекта) | +1.0 | +0.3 | −0.3 (держать зал тёмным, луч — главный) |
| Диапазон автоэкспозиции | 4..15.5 (глобальный PPV) | | 5..9 (PPV интерьера) | 5..8 |
Метод — Histogram, Low/High percent 60/95 (песок занимает большую часть кадра: без отсечения 60 % автоэкспозиция «серит» песок). Адаптация: Speed Up 3 (из сиетча на свет — быстро, как зрачок), Speed Down 0.8 (с солнца в сиетч — медленная темновая адаптация: первые секунды в B1 темно — это задумано, «смена мира»). Local Exposure: highlight 0.8, shadow 0.85 — держит текстуру песка и детали в тени скал. Почему Bias +1…+1.5: физически корректная экспозиция песка (альбедо ~0.45) даёт «серый» песок на мониторе — выбеленная охра требует подъёма на ~1 стоп.

## 6. Lumen
- Проект: `r.DynamicGlobalIlluminationMethod=1`, `r.ReflectionMethod=1`, HW RT для Lumen (`LightingMode=0` — surface cache), Mesh SDF.
- Глобальный PPV: Scene Lighting Quality 1, Scene Detail 1, View Distance 200 м, Final Gather Quality 1 (2 — фоторежим/кинематика), Reflection Quality 1, Max Trace Distance 200 м, Skylight Leaking 0.05 (глубокие расщелины не уходят в чистый чёрный).
- Сиетч: GI держат светошары + световые колодцы. Для колодцев — Rect Light «sky portal» в устье (вручную, env-artist) или полагаться на SkyLight + Lumen (тогда Skylight Leaking 0 в PPV интерьера).
- Пустыня: главная задача Lumen — тёплый отражённый свет песка в тенях скал и под тентами. Проверка: тень у основания «Когтя» должна быть тёплой (≈ #6A5040 при Bias +1), а не синей.
- Сетка камня в сиетче — Nanite; для Lumen Surface Cache у тонких модулей (<10 см) — `Lumen → Emissive Light Source` off, Mesh Card Representation на.

## 7. Светошары и луч (L_Rakis_Sietch)
- Каждый `Rakis.Glowglobe`: Point Light Movable, **2700 K**, 800–1500 лм (детерминированно по позиции), Source Radius 9, Soft Source 25, Attenuation 16 м, тени on (VSM local), Volumetric Scattering 1.5, Max Draw Distance 60 м, Light Function `MI_LF_GlowglobeFlicker_A/B/C` (по кругу), IES — нет (шар светит равномерно). Если маркер — Static Mesh Actor, его меш получает `MI_Glowglobe` (без теней); иначе рядом создаётся сфера Ø22 см с `MI_Glowglobe`.
- Свет теней от 60+ точечных источников — главный риск бюджета: VSM кэширует статичные — не двигать светошары в рантайме; дальние гасятся Max Draw Distance.
- B5 «божественный луч»: Spot Light `Rakis.GodRay` в своде (маркер `Rakis.LightShaft` или центр `Rakis.HallGather` + 24 м), направлен вниз, 1.7·10⁶ кд (≈ 3000 лк в чаше), 4800 K, конус 4°/9°, Source Radius 60, **Volumetric Scattering 8**, volumetric shadow on. Пыль в луче — `NS_Dust_LightShaft` (fx_niagara по тегу `Rakis.GodRay`). Почему спот, а не солнце через шахту: вечернее солнце низко (8°) и не попадёт в вертикальную шахту — художественное допущение, читается как «солнце в зените сквозь глотку Бога».

## 8. Фотореалистичный чек-лист (перед ревью кадра)
1. Нет чистого чёрного и чистого белого: песок в полдень ≤ 0.92 sRGB, тени ≥ 0.04.
2. Тени на песке в полдень — короткие, синеватые от неба (SkyLight), но не голубые: проверить `Rakis.TimeOfDay 11.5`.
3. Рассвет: солнце ниже 15°, длинные тени дюн, холодная (кобальтовая) тень против тёплого света — контраст цветовой температуры ≥ 2500 K.
4. Ореол вокруг солнца (Mie) виден, горизонт светлее и теплее зенита.
5. Воздушная перспектива: скала в 2 км заметно светлее/голубее-охристее, чем вблизи.
6. Марево: видно только у земли вдали и у горизонта, нет на руках/оружии/небе выше горизонта.
7. Искры песка только на солнце, не в тени; без мерцания при движении камеры (TSR).
8. Частицы пыли темнеют в тени скал (lit translucency).
9. Сиетч: светошары тёплые 2700 K, мерцание мягкое и несинхронное; синие акценты (ткань, вода) не «кислотные».
10. Луч B5 — плотный столб с пылинками, края мягкие; остальной зал читается силуэтами.
11. Хроматическая аберрация 0, lens flare 0, motion blur умеренный, зерно — почти незаметное.
12. Экспозиция при переходе A4→B1 адаптируется за 3–5 с, не мгновенно.
