# Niagara FX «Rakis: Heretics» (T-009)

Генератор: `Tools/unreal_python/fx_niagara.py`. Ассеты: `/Game/Rakis/FX/NS_*` (контракт §2.5), служебные `/Game/Rakis/FX/NPC_RakisWeather`, `/Game/Rakis/FX/Emitters/NE_*`.
Материалы частиц: `MI_FX_Dust_Sand`, `MI_FX_Dust_Storm`, `MI_FX_Dust_Spice`, `MI_FX_Motes` (мастер `M_FX_Dust`), меш-частицы — `MI_Rock_Scatter`.

## 0. Что делает скрипт и что — человек
| Шаг | Скрипт | Вручную |
|---|---|---|
| Ассет NS_* | создаёт, если нет: копия ближайшего шаблона из `/Niagara/DefaultAssets/Templates` (поиск по ключевым словам) → иначе пустая система + копия эмиттера-шаблона в `FX/Emitters/NE_*` | — |
| Существующая NS_* | **не трогает** (ручная работа не теряется) | — |
| Стек эмиттеров | **нельзя из Python** (в UE 5.6 нет публичного скриптового API графа Niagara) | собрать по рецептам ниже (≈ 15–40 мин на систему) |
| User-параметры | пробует известные API; при отсутствии — пишет в лог список систем | добавить `User.WindDirection` (Vector), `User.WindSpeed` (float, м/с), `User.Intensity` (float 0..1+) |
| Fixed bounds, warmup | ставит, где свойства доступны | проверить |
| NPC_RakisWeather | создаёт с Source Material Collection = MPC_RakisWeather (если фабрика доступна) | проверить, что параметры подтянулись |
| Расстановка в картах | да (тег `gen:fx_niagara` + `Rakis.FX.Wind`), с оверрайдами User.* | подвинуть по финальному ландшафту |

Повторный запуск удаляет только акторы `gen:fx_niagara` и ставит заново.

## 1. Общие соглашения
- **Ветер**: `Wind = User.WindDirection * User.WindSpeed * 100` (см/с). Модуль *Add Velocity* / *Drag* с `Inherit` ветра: в Particle Update — `Wind Force` (Niagara-модуль «Wind Force»: Wind Velocity = Wind, Air Resistance 0.6–2) — частицы набирают скорость ветра с инерцией.
- **Интенсивность**: `User.Intensity` умножает Spawn Rate (через Scalability-множитель не делать — именно параметр) и альфу.
- **Глобальная погода**: для систем, которым не задают User.* в рантайме, читать `NPC_RakisWeather.WindDirection/WindSpeed/DustDensity` (Niagara Parameter Collection зеркалит MPC). Рекомендованный узел в Emitter Spawn: `Wind = select(User.WindSpeed >= 0, User.*, NPC.*)`; дефолт `User.WindSpeed = -1` → брать NPC. Расставленные скриптом акторы получают явные оверрайды, рантайм обновляет акторы с тегом `Rakis.FX.Wind` (см. handoff).
- **Освещение спрайтов**: lit translucency (M_FX_Dust) — пыль корректно темнеет в тени скал и подсвечивается контровым солнцем. Unlit пыль запрещена (светится в тени — главный «CG-маркер»).
- **Сортировка**: View Depth; Translucency Sort Priority: стена бури −10, дымка/пыль 0, искры/мотыльки +1.
- **Коллизия GPU**: Depth Buffer (дёшево, только на экране) для мелких частиц; Distance Field — для червя и стены песка (нужно `r.GenerateMeshDistanceFields=True`, уже включено).
- **Scalability** (System → Scalability): Low/Medium/High/Epic — Spawn Count Scale 0.35/0.6/1/1, Max Distance ×0.6/0.8/1/1.2; Cull Proxy для повторяющихся систем (Sand_Drift, Motes) — Max System Instances.
- **Effect Type**: создать `FXT_Rakis_Ambient` (Significance: Distance, Max Instances 16, Cull Distance 20000) и `FXT_Rakis_Hero` (червь/кат-сцена, без culling), назначить системам.
- **Бюджет кадра**: ≤ 150 000 живых GPU-частиц (стандарт), translucency overdraw ≤ 1.5 мс в худшем кадре.

## 2. Бюджет частиц
| Система | Тип | Частиц на экз. (пик) | Экз. в кадре (макс.) | Итого | Overdraw-риск |
|---|---|---|---|---|---|
| NS_Sand_Drift | GPU sprite + ribbon-струйки | 2 500 | 6 из 11 | 15 000 | низкий (мелкие, у земли) |
| NS_Sand_DustDevil | GPU sprite | 3 000 | 3 | 9 000 | средний |
| NS_Sandstorm_Wall | GPU sprite (огромные) | 1 500 + 400 flipbook | 1 | 2 000 | **высокий** → мало, но крупных |
| NS_Worm_SandWave | GPU sprite + mesh | 12 000 | 1 | 12 000 | средний |
| NS_Worm_RingSandfall | GPU sprite + ribbon | 30 000 | 1 | 30 000 | средний |
| NS_Worm_Breach | GPU sprite + mesh | 40 000 (вспышка 6 с) | 1 | 40 000 | **высокий** |
| NS_Rock_Hop | GPU mesh | 60 | 10 | 600 | нет |
| NS_Footstep_Sand | GPU sprite | 120 | 8 | 1 000 | нет |
| NS_Thumper_Pulse | GPU sprite + mesh-кольцо | 1 500 | 1 | 1 500 | низкий |
| NS_Dust_LightShaft | GPU sprite | 6 000 | 1 | 6 000 | средний (в луче) |
| NS_Spice_Haze | GPU sprite | 600 | 5 | 3 000 | средний (крупные мягкие) |
| NS_Glowglobe_Motes | GPU sprite | 150 | 25 видимых из 40 | 3 750 | нет |
| NS_SealDoor_Steam | GPU sprite | 1 200 | 1 | 1 200 | средний |
**Худший кадр — Worm_Reveal (A2):** Drift 15k + Devils 9k + Wall 2k + SandWave 12k + RingSandfall 30k + Breach 40k + Rock_Hop 0.6k + Footsteps 1k ≈ **110k** ≤ 150k. Сиетч: ≤ 15k.
GPU-время частиц (3070, 1440p TSR 66 %): пустыня ambient ≤ 0.5 мс, Worm_Reveal ≤ 1.5 мс (из них overdraw ~1 мс), сиетч ≤ 0.4 мс.

## 3. Рецепты систем
Обозначения: ES — Emitter Spawn, EU — Emitter Update, PS — Particle Spawn, PU — Particle Update, R — Render. Размеры в см, время в с.

### NS_Sand_Drift — позёмка по гребням дюн
Где: вдоль гребней A1/A2 (маркеры `Rakis.FX.SandDrift` или фоллбек 3×3 по эрге). Looping, Local Space = off.
**Эмиттер Drift_Sheet (GPU, sprite)**
- ES: Fixed Bounds ±3000×3000×300; Determinism off.
- EU: Spawn Rate = `600 * User.Intensity * saturate((WindSpeed − 3) / 6)` (позёмка начинается с ~3–4 м/с, как в реальности — порог сальтации), Scalability spawn scale.
- PS: Lifetime 2.5–4.5; Shape Location: Box 3000×200×10 (длинная ось — вдоль гребня, актор повернут скриптом), Z-offset +5; Sprite Size 4–14 (неравномерно, Random Range Float, distribution pow 2 — больше мелких); Color #C9A878 α 0.35–0.6; Mass 1.
- PU: Wind Force (Wind = User.WindDirection·WindSpeed·100·1.2, Air Resistance 1.5); Gravity −300 (лёгкие зёрна держатся у земли); Curl Noise Force: Strength 60, Frequency 0.004, Pan Noise Field = Wind·0.5; Collision: GPU Depth Buffer, Restitution 0.2, Friction 0.6, Radius scale 0.5 (частицы «скачут» по песку = сальтация); Scale Color: α по жизни 0→1 (0.1 с)→1→0 (последние 30 %); Scale Sprite Size: вытягивание по скорости (Sprite Renderer Alignment = Velocity Aligned, Facing = Camera Plane, scale X по скорости 1→3).
- R: Sprite Renderer, `MI_FX_Dust_Sand` (Opacity 0.45), Sort View Depth, Sub-Image none.
**Эмиттер Drift_Streaks (GPU, ribbon)** — тонкие струи-«змейки»:
- EU: Spawn Rate 30·Intensity; PS: Lifetime 1.5–2.5, Ribbon Width 6–20, Ribbon Link Order; PU: те же силы, Curl Strength 120; R: Ribbon Renderer, UV Mode Tiled Distance 200, материал `MI_FX_Dust_Sand` (Opacity 0.25).
LOD: Max Draw Distance 20000; Cull по Effect Type Ambient.

### NS_Sand_DustDevil — пыльный вихрь
- Looping; System Lifetime: возникает/гаснет — EU Spawn Rate × `sin`-огибающая с периодом 40–70 с (Curve), чтобы вихри «жили».
- EU: Spawn Rate 900·Intensity.
- PS: Shape Cylinder R 150, H 50 (у основания); Lifetime 4–7; Size 30–120; Color #BFA07A α 0.25.
- PU: Vortex Velocity (ось Z, Speed 400–600, радиус растёт с высотой: Point Attraction Force отрицательная, Falloff — R ×(1 + Z/1000)); Add Velocity Z 250–400; Wind Force (снос всего столба ветром ×0.6); Curl Noise 80; Scale Size по жизни 1→3; α 0→1→0.
- Дополнительно Ground_Skirt: 200 частиц/с у основания, Shape Ring R 300, Size 40–80, радиальная скорость 150.
- R: `MI_FX_Dust_Sand` (Opacity 0.3, Softness 1.2). Высота столба 15–40 м. Max Distance 60000 (видны издалека — дешёвые, крупные). Сам актор: медленно дрейфует — Blueprint/скрипт не нужен: модуль System Location Offset = Wind·t (Emitter Local Space на, смещать «Owner Position» нельзя — поэтому дрейф делается Spawn Location += WindDirection·Age·150).

### NS_Sandstorm_Wall — кориолисова буря на ЮЗ горизонте
Ставится на (−250000, −300000) — 3.9 км от старта, лицом к карте. Видна всегда, не приближается (геймплейно безопасна).
**Эмиттер Wall_Billows (GPU sprite, огромные)**
- ES: Fixed Bounds ±200000; Warmup 10 с (на старте уже стоит).
- EU: Spawn Rate 120·(0.4 + StormIntensity·0.6) — читать `NPC.StormIntensity`.
- PS: Shape Box 300000×4000×100 (ширина фронта 3 км); Lifetime 18–30; Size 15000–40000 (150–400 м); Color #B8925E→#8F6A40; α 0.5–0.8; Sprite Rotation Random.
- PU: Add Velocity Z 300–600 (клубы встают), +X(локально «вперёд») 200; Curl Noise Strength 400, Frequency 0.00002 (очень крупные завихрения); Scale Size ×1.6 за жизнь; α 0→1(20 %)→1→0.
- R: Sprite, `MI_FX_Dust_Storm` (DepthFade 2000, Softness 1.0); Translucency Sort Priority −10; **Sub-UV флипбук** клубящегося дыма 8×8 (создать в EmberGen/Houdini, `T_FX_StormBillow_8x8`) → Sub UV Animation, Linear blend.
**Эмиттер Wall_Base (GPU sprite)**: тёмная плотная подошва — Box 300000×2000×0, Size 20000–30000, Lifetime 20, почти не растёт, Color #6E5236, α 0.9.
**Эмиттер Wall_Lightning (опционально)**: короткие вспышки Light Renderer (без теней) 1 раз в 6–15 с — только для Storm_Horizon.
Освещение: lit translucency + Volumetric Fog даёт правильную воздушную перспективу. Дополнительно на ЮЗ — Local Fog Volume 50×5×1 км не нужен: дальность — Sky Atmosphere.
Стоимость: из-за размеров каждый спрайт покрывает много пикселей — держать ≤ 1500 частиц, мягкие края.

### NS_Worm_SandWave — бегущая волна песка над червём (Approach)
Спавнится/таскается `ARakisWorm` у головы под песком (Attach к голове, Local Space off).
- EU: Spawn Per Unit (Distance-based) 0.6 частиц/см движения × User.Intensity (= Threat01); Spawn Rate 300 стоя.
- PS: Shape Box 4000×600×50 перпендикулярно движению (ширина волны = диаметр червя), Lifetime 1.5–3; Size 40–200; Velocity: вверх 300–900 + вперёд 0.4 скорости червя; Color #C9A878.
- PU: Gravity −980; Drag 0.8; Wind Force 0.5; Collision Depth Buffer (песок падает обратно), Kill on collision 50 %; Scale Size 1→2.
- Меш-эмиттер Clods: 80 частиц/с, `SM_Rock_Pebble` (или Engine Sphere), `MI_Rock_Scatter`, Size 5–25, вращение.
- R: Sprite `MI_FX_Dust_Sand` + Mesh Renderer. Камера-шейк и звук — у червя.

### NS_Worm_RingSandfall — песок, стекающий с колец (Surface/Ridden)
Множественный: одна система на червя, точки спавна — Skeletal/Static Mesh Location по `SM_Worm_Segment` ISM нельзя напрямую → используем **Spline Location** (Data Interface Spline: тело червя — `USplineComponent`).
- EU: Spawn Rate 6000·Intensity.
- PS: Spline Location (U random 0–0.6 — передняя видимая часть), смещение по окружности R 2000 (верхняя полусфера — Z > 0), Lifetime 2–5; Size 20–90; Color #C9A878→#A88860.
- PU: Gravity −980; Drag 0.3; Wind Force (сносит каскады ветром — главное «чтение» масштаба); Collision Distance Field (о тело червя, Restitution 0.1, Friction 0.9 — песок стекает по пластинам); α гаснет на последних 20 %.
- Ribbon-эмиттер Streams: 300/с, ribbon из точек, Width 30–80 → «струи» как в водопаде, материал `MI_FX_Dust_Sand` Opacity 0.35.
- Пыль у земли (Impact): Event Handler Collision → спавн 3 дымовых частиц 200–600 см (переиспользовать Drift_Sheet настройки).

### NS_Worm_Breach — выход червя (кат-сцена LS_WormReveal, Surface)
One-shot (Loop Once, Duration 6 с); вызывается из секвенции (Niagara track) в точке `Rakis.Worm.Reveal`.
- Emitter Column (GPU sprite): Burst 15 000 за 0.4 с + Spawn Rate 4000 3 с; Shape Cylinder R 2500, H 0; Velocity Z 2500–5500 (столб до 150 м по контракту), радиально 200–800; Gravity −980; Drag 0.4; Size 100–600 → ×4; Lifetime 4–8; Curl Noise 300; Color #C9A878; `MI_FX_Dust_Sand` Opacity 0.5.
- Emitter Curtain (GPU sprite): Burst 8000, Shape Ring R 2500–3500, Velocity outward 1500 + up 800 — «юбка» песка.
- Emitter Debris (GPU mesh): Burst 400 камней, Velocity up 1500–4000, Gravity, Collision DF, `MI_Rock_Scatter`.
- Emitter DustBank (GPU sprite): 2000 огромных (1000–4000) медленных дымов, Lifetime 10–15 — остаётся висеть (+ погода `Worm_Reveal` дает DustDensity 0.9).
- Emitter LightShafts: нет (объёмные лучи сквозь пыль делает volumetric fog + солнце, закрытое телом).
Пик ~40k частиц — допустимо (кат-сцена).

### NS_Footstep_Sand — облачко шага
One-shot, спавнит `ARakisCharacter::OnFootstep` (по поверхности Sand/PackedSand) в точке ступни.
- Burst 60 (Sand) / 30 (PackedSand) × User.Intensity (бег 1.5, «походка по песку» 0.4); Shape Sphere R 8 (полусфера вверх); Velocity: вверх 50–150 + назад (−Forward·100) + Wind·0.5; Gravity −600; Drag 2; Lifetime 0.6–1.2; Size 3–15 → ×3; α 0.3. Меш-песчинки не нужны.
- R: `MI_FX_Dust_Sand`. Scalability: Low — Burst ×0.3.

### NS_Thumper_Pulse — импульс тампера
Looping, пока тампер работает; синхронизация — `ARakisThumper` вызывает `ResetSystem()`/или Niagara Event на каждый удар (ThumperInterval 1.6 с).
- Emitter Ring (GPU sprite): Burst 300 на удар, Shape Ring R 30, радиальная скорость 600–900, Gravity −300, Drag 3, Size 5–20, Lifetime 0.8 — песок подпрыгивает кольцом.
- Emitter Shock (Mesh): 1 плоское кольцо (`SM_FX_Ring` или Engine Cylinder сплющенный), Scale 1→15 м за 0.5 с, материал с искажением нормали — опционально.
- Emitter Dust (sprite): Burst 40, Size 30–80, медленный подъём.

### NS_Dust_LightShaft — пыль в луче B5
Ставится скриптом в середину луча (`Rakis.GodRay` − 12 м по Z).
- Looping, Warmup 8.
- EU: Spawn Rate 400·Intensity; Max particles 6000.
- PS: Shape Cylinder R 150 (по раскрыву шахты; конус 9° → у дна R≈380 — Cone shape: Cone Angle 9, Length 2400, ось −Z), Lifetime 12–20; Size 0.3–1.5 (пылинки!); Color #FFF2DC α 0.6.
- PU: Curl Noise Strength 8, Frequency 0.01 (ленивое кружение); очень слабый Add Velocity Z −2 (оседание); Wind Force 0.1 (сквозняк ритуала); **Ключ**: в материале `MI_FX_Motes` — пылинки lit translucency + EmissiveBoost 0 → видны только в луче (освещаются спотом), вне луча исчезают сами. Kill Volume: цилиндр R 600 — не растекаться.
- R: Sprite, Facing Camera, Size по экрану ≥ 1 px (Min Screen Size 0.0005 через модуль «Sprite Size Constraint» / Pixel Coverage).

### NS_Spice_Haze — дымка пряности B3 (и немного B2)
- Looping, Warmup 8; Spawn Rate 25·Intensity; Lifetime 20–30; Shape Box 1200×400×150 (вдоль прохода), у пола (Z +0..150).
- Size 300–900 → ×1.5; Color #C27A45 α 0.08–0.15; Rotation Rate ±5°/с.
- PU: Curl Noise 15, Frequency 0.002; Add Velocity по сквозняку (User.WindDirection·User.WindSpeed·100 = ~20 см/с); Kill by Volume — зона.
- R: `MI_FX_Dust_Spice` (Softness 2.2, DepthFade 300, Opacity 0.25). Освещается светошарами через lit translucency — даёт «янтарную» глубину.
- Вместе с Local Fog Volume (light_setup) даёт слои: однородная дымка (LFV) + живые клубы (Niagara).

### NS_Glowglobe_Motes — пылинки/мошки у светошара
- Looping, Spawn Rate 10; Lifetime 8–15; Shape Sphere R 80 вокруг шара; Size 0.2–0.8; Curl Noise 6, Point Attraction к центру 5 (держатся у света); Color #FFD9A0; `MI_FX_Motes` (EmissiveBoost 2 — подсветка от шара). Max Draw Distance 2500. Effect Type Ambient, Max Instances 25 (ближайшие).

### NS_SealDoor_Steam — пар-конденсат двери-уплотнителя
One-shot 2.5 с, вызывает `ARakisSealDoor` (открытие/закрытие) по периметру проёма.
- Emitter Jet (GPU sprite): Spawn Rate 500 1.5 с; Shape — Box-периметр двери (4 эмиттера-плоскости по краям или Skeletal/Static Mesh Surface по `SM_Sietch_Door_Frame`), Velocity наружу 200–400 + вниз −50 (холодный влажный воздух тяжелее); Drag 3; Size 10–40 → ×6; Lifetime 1–2.5; Color #E8E4DC α 0.2; `MI_FX_Dust_Sand` с Tint белым (или отдельный MI_FX_Steam: Tint #E8E4DC, Opacity 0.3).
- Emitter Drops (sprite, мелкие 0.3–0.6, Gravity, Collision) — «конденсат».

### NS_Rock_Hop — подпрыгивающие камни (червь приближается)
Спавнит `ARakisWorm` по радиусу (Listening/Approach) — «камни-прыгуны» (контракт).
- Looping пока активен; Spawn Rate 6·Intensity; GPU Mesh Renderer: `SM_Rock_Pebble_A/B/C` (или Engine Shapes), `MI_Rock_Scatter`; Shape Disc R 600 вокруг точки; Velocity Z 150–400 (короткий подскок 10–40 см); Gravity −980; Collision Depth Buffer/DF, Restitution 0.3; Lifetime 1.2; Mesh Orientation random + Rotation Rate.
- Sub-emitter (Event on Collision): 5 частиц пыли `MI_FX_Dust_Sand`.

## 4. Расстановка (fx_niagara.place_all)
| Карта | Система | Где | Кол-во |
|---|---|---|---|
| L_Rakis_Desert | NS_Sand_Drift | маркеры `Rakis.FX.SandDrift` или: эрг A2 (70000, 20000) 3 гребня × 3, поворот вдоль гребня (⊥ ветру Morning_Erg); + 2 у старта A1 | 11 |
| | NS_Sand_DustDevil | `Rakis.FX.DustDevil` или (40000, 50000), (110000, −10000), (190000, 20000) | 3 |
| | NS_Sandstorm_Wall | `Rakis.FX.StormWall` или (−250000, −300000), лицом к центру | 1 |
| L_Rakis_Sietch | NS_Dust_LightShaft | спот `Rakis.GodRay` (light_setup) − 12 м | 1 |
| | NS_Spice_Haze | `Rakis.FX.SpiceHaze` или зоны B3 (3) и B2 (2) из ARakisZoneVolume | 5 |
| | NS_Glowglobe_Motes | `Rakis.FX.Motes` или каждый `Rakis.Glowglobe` (≤ 40) | ≤ 40 |
Z берётся трассой вниз по коллизии ландшафта (без ландшафта — 0).
Остальные системы (червь, тампер, шаги, двери, камни) спавнит C++ в рантайме по контракту §2.2.

## 5. Профилирование
`stat niagara`, `fx.Niagara.Debug.Hud 1` (кол-во частиц по системам), `stat gpu` → «Translucency», `profilegpu`. Проверить худший кадр: `Rakis.Weather Worm_Reveal` + проиграть `LS_WormReveal`. Если > 1.5 мс translucency — первым урезать Size×Count у Breach.Column и Wall_Billows, вторым — разрешение translucency (`r.SeparateTranslucencyScreenPercentage 50` для частиц через «Translucency Pass: Separate/Before DOF + Low Res»).
