# Core-геймплей: игрок, шум, походка, вода, червь, взаимодействие

Зона: `Source/Rakis/{Public,Private}/{Player,Noise,Hydration,Worm,Interaction,Gameplay}/**`, `Source/Rakis/Tests/**`.
Контракт: `docs/06_demo_contract.md` §2.2, §2.6. Всё работает без арта: каждый soft-ассет null-safe (одно предупреждение `LogRakis` на путь, `RakisAssets::Load` в `Gameplay/RakisAssetUtils.h`).

## 1. Классы

| Класс | Файл | Назначение |
|---|---|---|
| `ARakisGameMode` | `Player/RakisGameMode.h` | Pawn = `ARakisCharacter`, PC = `ARakisPlayerController`, HUD — по пути `/Script/Rakis.RakisHUD` (`LoadClass` в `InitGame`, без include). Если на уровне есть актор с тегом `Rakis.Worm.Spawn`, а `ARakisWorm` нет — спавнит червя. |
| `ARakisPlayerController` | `Player/RakisPlayerController.h` | Строит Enhanced Input в рантайме, делегаты Pause/PhotoMode, тряска камеры и вибрация от червя. |
| `URakisWormCameraShake` + `URakisPerlinShakePattern` | `Player/RakisWormCameraShake.h` | Бесконечная перлин-тряска; масштаб = f(угроза). |
| `ARakisCharacter` | `Player/RakisCharacter.h` | Кайр: камеры FP/TP с бесшовным переходом, поверхность, шаги, походки, тампер. |
| `FRakisNoiseEvent`, `URakisNoiseSubsystem` | `Noise/RakisNoiseSubsystem.h` | Мировой кольцевой буфер шума, `SampleNoise`, `GetLoudestRecent`. |
| `URakisNoiseComponent` | `Noise/RakisNoiseComponent.h` | Персональный метр шума (HUD), громкость шага, отправка событий в мир. |
| `URakisSandWalkComponent` | `Noise/RakisSandWalkComponent.h` | Мини-механика ритма: интервалы, регулярность, «сбивка». |
| `URakisHydrationComponent` | `Hydration/RakisHydrationComponent.h` | Влага, жара, солнце/тень/интерьер, маска дистикомба. |
| `ARakisWorm` | `Worm/RakisWorm.h` | Шай-Хулуд: тело-сплайн + кольца ISM, голова с пастью-цветком, автомат состояний, FX/звук/угроза. |
| `ARakisThumper` | `Worm/RakisThumper.h` | Тампер: удар каждые `ThumperInterval` → шум `Source="Thumper"`; 30 с; можно забрать. |
| `IRakisInteractable` | `Interaction/RakisInteractable.h` | `GetInteractVerb / CanInteract / Interact` (C++-виртуальные). |
| `URakisInteractionComponent` | `Interaction/RakisInteractionComponent.h` | Сфера-трасса из камеры, 250 см от игрока, 10 Гц, канал `Interact`. |
| `ARakisSealDoor` | `Gameplay/RakisSealDoor.h` | Дверь-уплотнитель: 2 створки (Slide/Rotate), шипение, пар, автозакрытие, состояние «запечатано». |
| `ARakisFalseRock` | `Gameplay/RakisFalseRock.h` | Фальшивый камень A4: одноразово отъезжает. |
| `ARakisInspectable` | `Gameplay/RakisInspectable.h` | POI с `LoreID`; глобальное событие `ARakisInspectable::OnInspected`. |
| `URakisNoiseTuning`, `URakisWormTuning`, `URakisHydrationTuning` | `Noise/`, `Worm/`, `Hydration/` | DataAsset-ы §2.6; `X::Get()` = DA из `URakisSettings` или CDO. |

## 2. Карта ввода (создаётся в рантайме, ассеты не нужны)

| Действие | Клавиатура/мышь | Геймпад | Тип |
|---|---|---|---|
| Move | WASD | левый стик | Axis2D |
| Look | мышь | правый стик | Axis2D (градусы) |
| Sprint | Left Shift (удерж.) | L3 | bool |
| SandWalk | Left Alt (удерж.) | LB | bool |
| Stutter — сбить ритм | Space | A | bool |
| Interact | E | X | bool |
| ToggleCamera | V | RS (клик) | bool |
| Thumper | T | Y | bool |
| Pause | Esc | Start | bool, работает на паузе |
| PhotoMode | P | View/Back | bool, работает на паузе |

Обзор пишет `ControlRotation` напрямую (не через легаси-масштабы PC): мышь × `MouseLookScale` (2.5), стик × `GamepadLookRate` (150 °/с), `bInvertLookY`. Тангаж ограничен `MinViewPitch/MaxViewPitch`. Действия доступны через `ARakisPlayerController::GetInputActions()` (структура `FRakisInputActions`), контекст — `GetMappingContext()`.

## 3. Игрок
- Скорости (см/с): ходьба 220, бег 520, походка по песку 160; «сбивка» на 0.3 с замедляет до 45 %.
- Камера: TP — SpringArm 320 см, плечо (0,55,55), FOV 75; FP — камера на сокете `head` (если его нет — на капсуле `(12,0,68)`), FOV 88. Переход 0.45 с: TP-камера плавно «влетает» в голову (Tick включается только на время перехода), затем активируется FP-камера; голова (кость `head`) прячется. В FP тело плавно доворачивается за взглядом.
- Поверхность: трасса вниз (5 Гц и на каждом шаге), `SurfaceType1..6 → Sand, Rock, SietchStone, Cloth, Metal, PackedSand`. Без Physical Material → `DefaultSurface` (Sand). Переопределение тегом актора/компонента: `Rakis.Surface.Rock` и т.п. (удобно на блокауте).
- Шаги: AnimNotify → `OnFootstep(bLeftFoot)`. Если уведомлений нет дольше 0.8 с — таймер 30 Гц по пройденной дистанции (длина шага 62…120 см линейно от скорости походки до бега). Каждый шаг: регистрация в `SandWalk` → громкость → `Noise.AddNoiseAt` → `NS_Footstep_Sand` (только песок, `User.Intensity` = скорость) → `MS_Footstep` (параметры `Surface` int, `Speed`, `Loudness`).
- Тампер: только на песке, `ThumperCharges` = 2; подобрать — взаимодействием.
- `SetInputLocked(true)`: стоп, сброс походки и ритма, выключение фокуса взаимодействия.
- Без скелетного меша показывается цилиндр-блокаут.

## 4. Шум и походка
- Громкость шага: `Base(Walk 0.35 | Run 0.80 | SandWalk 0.12) × SurfaceMultiplier × (1 + RhythmPenalty × Regularity)`.
- Метр игрока: `+= Loudness × MeterGainPerStep (0.2)`, спад `DecayPerSecond` (0.15/с) таймером 10 Гц; `OnNoiseChanged(Noise01)`.
- Регулярность: последние `RegularityWindow` (6) интервалов, `1 − clamp(CV / RhythmCVReference(0.35))`; пауза > `RhythmResetGap` (1.5 с) сбрасывает ритм; меньше 2 интервалов → 0. Ровный шаг ≈ 0.8–1 (метроном), «сбивки» → ≈ 0. `OnSandStep(Regularity)` на каждый шаг, `GetRecentIntervals()` ≤ 6.
- «Сбивка» (Stutter, только в SandWalk, кулдаун 0.2 с): немедленный полушаг + пауза 25–70 % длины шага + краткое замедление.
- Мир: вклад события `L × (1 − d/R) × exp(−age/EventMemoryTau(2 с))`, события старше `EventMaxAge` (10 с) игнорируются; сумма × `SampleScale` (0.25). Ориентиры: ровная ходьба рядом ≈ 0.5, бег ≈ 1.3, неритмичная походка ≈ 0.1, тампер (×2) ≈ 0.6.

## 5. Вода и жара
- Таймер 0.25 с. Интерьер, если `SetInterior(true)` (вызывает `URakisZoneSubsystem`), или игрок пересекает актор с тегом `Rakis.Interior`, или солнца нет. Иначе трасса к солнцу (`ADirectionalLight` с тегом `Rakis.Sun`, иначе первый найденный) на 2 км: перекрыто → тень.
- Δвлаги/мин: солнце `−0.06 × (бег ? 2 : 1) × (маска ? 0.35 : 1)`; тень `+0.02` (при беге 0); интерьер `+0.05`. Старт 0.9, маска закрыта по умолчанию. `Heat01` плавно → 1 / 0.4 / 0.1. Смерти нет.
- События: `OnMoistureChanged(Moisture01)` (при изменении ≥ 0.002), `OnShadeChanged(bInShade)`.

## 6. Червь
**Масштаб:** 360 м × Ø 40 м, 90 колец (`SM_Worm_Segment`, ожидается вытянутым по X; фоллбек — цилиндр движка) + голова `SM_Worm_Head` (по X) + три лепестка пасти (отдельный меш `PetalMeshAsset` либо плиты-кубы при фоллбек-голове). Хвост сужается с 62 % длины до 30 %. Кольца получают per-instance custom data #0 = позиция вдоль тела 0..1.

**Тело «как поезд»:** голова оставляет след точек (шаг 2 м); по следу от шеи строится `USplineComponent` (32 точки) с вертикальной синусоидой (`UndulationAmplitude` 3.5 м, λ 90 м, 0.12 Гц; у головы амплитуда 0), кольца расставляются по сплайну (`BatchUpdateInstancesTransforms`). Глубоко спящий червь скрыт и не перестраивается.

**Автомат** (`ComputeNextState`, 10 Гц):
| Из | Условие | В |
|---|---|---|
| Dormant | шум ≥ ListenThreshold (0.25) и нет кулдауна | Listening |
| Listening | шум ≥ ApproachThreshold (0.55) и цель не на камне | Approach |
| Listening | тишина ≥ ListenTime (6 с) | Dormant |
| Approach | до цели ≤ SurfaceTriggerDistance (80 м): цель на камне → Pass, иначе | Surface |
| Approach | тишина ≥ ListenTime | Pass |
| Surface | `SetRidden(true)` | Ridden |
| Surface | прошло SurfaceDuration (10 с) | Pass |
| Ridden | `SetRidden(false)` | Pass |
| Pass | прошло PassTime (14 с) | Dormant + кулдаун 45 с |

Слух — взвешенная сумма событий у поверхности над головой (тампер × `ThumperWeight`), радиус `HearingRadius` (1.2 км); цель — самое «громкое» событие. «Камень безопасен»: шаги по Rock/SietchStone беззвучны (множитель 0), а если цель — игрок на камне, червь не идёт в Approach и проходит мимо (Pass).

**Движение:** Dormant — круг R 300 м вокруг точки `Rakis.Worm.Spawn` на глубине 60 м; Listening — дрейф к звуку 5 м/с на 45 м; Approach — 25 м/с на 24 м с поворотом 18 °/с; Surface — дуга: подъём до +50 м за 35 % времени, «зависание», нырок; при естественном выходе целится на 35 м вбок от игрока (проходит рядом, а не сквозь); Ridden — голова +16 м, медленный поворот; Pass — уход на глубину.

**Обратная связь:** `GetThreat01()` (сглажено) → MPC `WormThreat01` (из `URakisSettings::WeatherMPC`), `ARakisPlayerController::ApplyWormThreat` (тряска > 0.2, вибрация > 0.3), `MS_Worm_Approach` (параметры `Distance` — метры, `Threat` 0..1; звучит вне Dormant), `MS_Worm_Roar` при прорыве. Niagara: `NS_Worm_SandWave` над неглубокой головой, `NS_Rock_Hop` у головы в Approach, `NS_Worm_RingSandfall` ×4 с колец над песком, `NS_Worm_Breach` в момент прорыва; всем ставится `User.Intensity`.

**API:** `ForceSurface(Location, Facing)` — голова пересечёт песок ровно в `Location`, лицом по `Facing` (кат-сцена `LS_WormReveal`, `ARakisCinematicTrigger`, StoryDirector `ForceWorm`). `SetRidden`, `SetSensingEnabled`, `GetHeadLocation` (для деформации песка/RVT), `GetGroundZ`, `GetHeardNoise`, `MouthOpen01` (BlueprintReadOnly; также скаляр `MouthOpen` динамического материала авторской головы).

## 7. Взаимодействие и интерактивные объекты
- Канал трассы — `ECC_GameTraceChannel1` («Interact», блокирует по умолчанию). Фокус → `OnFocusChanged(Actor, Verb)` (nullptr + пустой Verb — фокуса нет); успех → `OnInteracted(Actor)` (StoryDirector: триггер `Interact:<ActorTag>`).
- `ARakisSealDoor`: `Open/Close/Toggle/SetLocked`, `IsOpen/IsSealed/IsMoving`; `OnDoorMoved(bOpening)`, `OnSealedChanged(bSealed)`. Разгерметизация и запечатывание — `MS_SealDoor` + `NS_SealDoor_Steam`. Автозакрытие через 5 с, пока в проёме нет пешек. Меш створки — `/Game/Rakis/Environment/Sietch/SM_Sietch_SealDoor_Panel` (пивот в центре), иначе куб.
- `ARakisFalseRock`: `Open()` (одноразово), `SetLocked`, `OnStartedOpening`, `OnOpened`. Меш — `/Game/Rakis/Environment/Rock/SM_Rock_FalseSlab` (иначе куб 80×420×380), смещение `OpenOffset`, пыль `NS_Rock_Hop`.
- `ARakisInspectable`: `LoreID` (EditAnywhere), автотег `Rakis.POI.<LoreID>`, `bOneShot`. **Связь с нарративом без зависимости компиляции:** статический нативный делегат
  `static FRakisInspectDelegate ARakisInspectable::OnInspected; // DECLARE_MULTICAST_DELEGATE_OneParam(FRakisInspectDelegate, FName)`.
  Narrative/UI подписывается в `Initialize`: `ARakisInspectable::OnInspected.AddUObject(this, &URakisDialogueSubsystem::ShowLore);` и отписывается `RemoveAll(this)` в `Deinitialize`. Для BP есть `OnInspectedDynamic(LoreID)` на каждом экземпляре.
- Глаголы — `FText` с английским исходником (`LOCTEXT`), русский — через локализацию (или переопределить в BP-наследнике).

## 8. Как тюнить
1. Создать `DA_NoiseTuning / DA_WormTuning / DA_HydrationTuning` в `/Game/Rakis/Data/` (пути уже в `Config/DefaultGame.ini`). Пока их нет — используются дефолты CDO (= контракт §2.6).
2. Червь «слишком нервный» → поднять `ListenThreshold/ApproachThreshold` или понизить `NoiseTuning.SampleScale`; «глухой» → наоборот или увеличить `ListenDriftSpeed`.
3. Ходьба наказывается быстро/медленно → `MeterGainPerStep`, `RhythmPenalty`, `RhythmCVReference`.
4. Зрелищность выхода → `SurfaceHeight`, `SurfaceDuration`, `SurfaceSpeed`, `SurfacePassOffset` (в BP-наследнике червя), `UndulationAmplitude`.
5. Камера/вибрация → `ARakisPlayerController`: `WormShakeMaxScale`, `WormShakeThreshold`, `WormRumbleThreshold`, `WormRumbleMax`.
6. Логи: `LogRakis` пишет каждый переход червя (`RakisWorm: Dormant -> Listening (noise 0.31, dist ...)`).

## 9. Тесты
`Source/Rakis/Tests/RakisGameplayTests.cpp` (`WITH_DEV_AUTOMATION_TESTS`): `Rakis.Noise.RhythmRegularity`, `Rakis.Noise.DecayAndLoudness`, `Rakis.Worm.StateThresholds`, `Rakis.Hydration.Rates`.
Запуск: Session Frontend → Automation → фильтр `Rakis.`, или
`UnrealEditor-Cmd Rakis.uproject -ExecCmds="Automation RunTests Rakis.;Quit" -unattended -nullrhi -log`.
