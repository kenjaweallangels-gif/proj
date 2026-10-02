# Мировые системы: погода, зоны, кат-сцены, звук-директор, NPC

Роль: gameplay-programmer (world). Код: `Source/Rakis/{Public,Private}/{Weather,World,Audio,AI}/**`.
Контракт: `docs/06_demo_contract.md` §1.2, §1.3, §2.2–2.5. Все системы переживают отсутствие ассетов
(null-check + однократный `UE_LOG(LogRakis, Warning, …)`), блокаут играется без контента.

## 1. Карта систем

```
ARakisZoneVolume ──overlap──▶ URakisZoneSubsystem ──▶ URakisWeatherSubsystem.RequestPreset / SetInterior
                                     │              ──▶ URakisAudioDirector.SetMusicState / SetAmbienceZone / SetInterior / SetZoneReverb
                                     │              ──▶ URakisHydrationComponent.SetInterior (игрок)
                                     │              ──▶ Load/UnloadStreamLevelBySoftObjectPtr
                                     └─OnZoneChanged──▶ URakisCrowdSubsystem (авторитуал), StoryDirector (ZoneEnter:*)
ARakisWorm ──GetThreat01 / OnWormStateChanged──▶ URakisAudioDirector (WormThreat / WormReveal)
ARakisCinematicTrigger ──▶ ULevelSequencePlayer | фоллбек: ARakisWorm.ForceSurface(Rakis.Worm.Reveal)
ARakisCrowdSpawner ──▶ ARakisCitizen ×N ──▶ URakisCrowdSubsystem (точки, разговоры, лай, ритуал)
                      │ (UStateTreeComponent: ST_Citizen | C++-фоллбек)  └─▶ USmartObjectSubsystem (слоты точек)
                                         └─▶ URakisDialogueSubsystem.PlayBark
ARakisCompanion ── след игрока (крошки) ──▶ цепочка за игроком
```

Единственный писатель MPC_RakisWeather — `URakisWeatherSubsystem` (кроме `WormThreat01`, его пишет червь).

## 2. Погода и время суток — `URakisWeatherSubsystem` (UTickableWorldSubsystem)

- **Данные:** `URakisSettings::WeatherPresets` (DT_WeatherPresets, `FRakisWeatherPresetRow`). Нет таблицы/строки →
  встроенные пресеты в коде (9 штук, имена контракта). `TimeOfDayHours < 0` = «сохранить текущее время».
- **Смешивание:** все поля пресета, smoothstep; люксы — в логарифме, цвет солнца — HSV, время и направление ветра —
  по кратчайшей дуге. Повторный запрос текущего пресета игнорируется.
- **Солнце:** астрономическая формула (широта `LatitudeDeg`=23°, склонение `SolarDeclinationDeg`=12°, север = +X).
  Восход — на востоке (+Y), полдень — на юге. Затухание за горизонтом. Солнце должно быть **Movable**.
- **Сцена** (поиск при BeginPlay и на каждый `LevelAddedToWorld`):
  `ADirectionalLight` (тег `Rakis.Sun`, иначе первый), `ASkyLight` (тег `Rakis.SkyLight`, иначе первый; при выключенном
  real-time capture — `RecaptureSky` с троттлингом), `ExponentialHeightFog` (плотность × буря, falloff, inscatter,
  volumetric scattering distribution, extinction = 1 + Dust·K), `SkyAtmosphere` (Mie × (1 + Dust·K)),
  `VolumetricCloud` (MID на материал облаков, скаляр `Coverage`), `PostProcessVolume` с тегом `Rakis.PP.Global`
  (`AutoExposureBias`), все `WindDirectionalSource` (сила/скорость/порывы).
  Статичные параметры обновляются только при изменениях (смешивание/время/новый пресет), ветер — каждый кадр.
- **MPC_RakisWeather:** `WindSpeed` (с порывами, м/с), `StormIntensity`, `DustDensity`, `HeatHaze` (× (1 − Interior01)),
  `TimeOfDay01`, `Interior01`; векторы `WindDirection` (xy — куда дует, w — скорость), `SunDirection` (xyz — на солнце,
  w — высота/90°), `SandTint` (rgb — оттенок от солнца и бури, a — пыль), `PlayerPosition` (xyz). Отсутствующий в MPC
  параметр — одно предупреждение, дальше пропуск.
- **Порывы:** скорость × (1 + A·N), N — сумма трёх октав Perlin (0.11/0.37/1.3 Гц), A = 0.35 + 0.4·Storm; рыскание ±12°.
- **Консоль:** `Rakis.Weather <PresetId> [BlendSec]`, `Rakis.TimeOfDay <Hours>`.
- **Тюнинг:** `[/Script/Rakis.RakisWeatherSubsystem]` в DefaultGame.ini (Config-свойства), напр. `TimeScaleHoursPerSecond`.

> Замечание по данным: в `WeatherPresets.csv` `Hall_Ritual` = 17.75 ч (17:45) — солнце ~8° над горизонтом, в вертикальную шахту
> зала оно не попадёт. «Божественный луч» нужно делать отдельным SpotLight/Rect Light (tech-artist) или поднять солнце
> (встроенный фоллбек использует 15:00, ≈46°).

## 3. Зоны — `ARakisZoneVolume` + `URakisZoneSubsystem`

- Объём: `Zone`, `WeatherPreset` (+`WeatherBlendSeconds`), `Music` (+`bSetMusic`), `bInterior` (+`InteriorBlendSeconds`),
  `Priority`, `Reverb` (UReverbEffect, опц.), `LevelsToLoad`, `LevelsToUnload`. Brush: QueryOnly, Overlap с Pawn;
  `bGenerateOverlapEventsDuringLevelStreaming = true`. При BeginPlay объём регистрируется и проверяет, не стоит ли игрок внутри.
- Стек: активен объём с максимальным `Priority`, при равенстве — последний вошедший. Вне всех объёмов — зона не меняется.
- Применение: погода → интерьер (MPC + вода игрока) → музыка/эмбиент/реверб → стриминг (latent, UUID уникальны) →
  `OnZoneChanged(Old, New)` (только если сменился `ERakisZone`). После окончания стриминга — `ReevaluateFromPlayerPosition()`.
- Рекомендуемая разметка (level_markup.py): A3 — `LevelsToLoad = L_Rakis_Sietch`; B2 — `LevelsToUnload = L_Rakis_Desert`;
  B1–B4 — `Sietch_Interior`, `bInterior`; B5 — `Hall_Ritual`, `HallChorale`, `bInterior`, Priority 1.

## 4. Кат-сцены — `ARakisCinematicTrigger`

- `Play()` / `Stop()` / `OnFinished`; опц. автозапуск по TriggerBox (`bAutoPlayOnOverlap`, `bPlayOnce`).
- С ассетом: `ULevelSequencePlayer::CreateLevelSequencePlayer` (bHideHud, блок движения/взгляда), `OnFinished` плеера.
- Всегда: `ARakisCharacter::SetInputLocked(true/false)`, `PlayerController->GetHUD()->bShowHUD` (с восстановлением).
- Без ассета (блокаут): через `FallbackDuration` (12 с) — `OnFinished`; если `bFallbackForceWormSurface` и есть червь —
  `ARakisWorm::ForceSurface(точка Rakis.Worm.Reveal, лицом к игроку)`. Для LS_HallFinale ставьте флаг в false.
- Для StoryDirector: `ARakisCinematicTrigger::PlaySequenceAtRuntime(World, "/Game/Rakis/Cinematics/LS_WormReveal", bForceWorm)` —
  создаёт временный актор, играет, уничтожается после `OnFinished` (подписка успевает: событие не раньше следующего кадра).

## 5. Звук — `URakisAudioDirector` (UTickableWorldSubsystem)

- **Музыка, режим MetaSound:** один `UAudioComponent` на `MS_Music_Adaptive`; параметры `StateIndex` (int = ERakisMusicState),
  `Intensity` (max(угроза, буря·0.6, override)), `WormThreat`, `Interior` — сглажены, 10 Гц. Громкость состояния —
  `Volume` строки `Music.<State>` (Silence = 0) через `AdjustVolume`.
- **Музыка, фоллбек-кроссфейд** (MetaSound не найден): строка `Music.<State>` по EventID либо по Trigger `Music.<State>`/`Music:<State>`,
  два компонента, `MusicFadeIn`/`MusicFadeOut`.
- **Эмбиент:** 2D-строка `Amb.<Zone>` (EventID) или Trigger `Amb.<Zone>`/`ZoneEnter:<Zone>` → `Amb.Desert`/`Amb.Sietch` →
  `MS_Amb_Desert`/`MS_Amb_Sietch`. Один и тот же ассет между зонами не перезапускается — плавно меняется громкость.
- **Погода:** слой `Weather:<PresetId>` (напр. `Storm.Distant`), кроссфейд на смене пресета; порывы — `Weather:Gust`
  на переднем фронте (скорость/база > 1.25, кулдаун 7 с, только снаружи).
- **Червь:** опрос `GetThreat01()` (поиск `TActorIterator<ARakisWorm>` раз в 2 с), > 0.35 → `WormThreat`,
  < 0.2 и удержание 6 с (WormReveal — 25 с) → возврат к прежнему состоянию. `OnWormStateChanged(Surface)` → `WormReveal`.
  Пока звучит угроза, запросы «спокойных» состояний от зон лишь меняют состояние возврата. `SetAutoWormMusic(false)` — отключить.
- **События:** `PostEvent(EventID, Location)` (Is2D → PlaySound2D, иначе SpawnSoundAtLocation с Attenuation из строки);
  `PostEventByTrigger(Trigger, Location)` — по полю Trigger (наибольший Priority). Используется толпой:
  `SmartObject:<Type>`, `Crowd:PlayerNear`, `CrowdRitual`, спутниками: `Footstep:Companion`.
- **Реверб:** `ARakisZoneVolume::Reverb` → `ActivateReverbEffect` (тег `Rakis.ZoneReverb`). Sound Mix / AudioModulation
  не используются (держим просто; интерьер в музыке — параметр `Interior`).
- Поле `Bus` строк пока не маршрутизируется (сабмиксы задаются в самих ассетах).

## 6. NPC

> С S2 (T-015) решения горожанина — StateTree `ST_Citizen` с C++-задачами, точки — Smart Objects, LOD 40/70 м;
> прежний автомат остался фоллбеком. Подробно — **`docs/tech/crowd.md`**. Ниже — поведение, общее для обоих режимов.

### 6.1 `ARakisCitizen` (ACharacter + AAIController + UStateTreeComponent)
- Решения: `UStateTreeComponent` с `ST_Citizen` (если ассет есть) или C++-автомат на таймере `BehaviourHz` (5 Гц).
  LOD (таймер 1 Гц): ≤ 40 м — полная частота; ≤ 70 м — StateTree тикает раз в 0.5 с / автомат решает раз в 1 с;
  дальше — скрыт, движение и дерево на паузе (кроме пути на ритуал). Tick актора включается только для плавного
  доворота корпуса. Поза меша — `OnlyTickPoseWhenRendered`, RVO включён.
- Цикл: точка своего архетипа (75 %; Smart Object слот: FindSmartObjects → Claim → Occupy → Free) → `UsingSpot`
  (длительность из поведения слота SOD или 10–30 с; лицом по повороту слота, разговор 45 % × множитель слота,
  ×1.6 если на точке уже кто-то) → прогулка по навмешу → пауза 2–7 с. Без навмеша — прямое движение.
- Look-at: ≤ 6 м, `LookAtTarget` (голова игрока) + `bLookAtPlayer`; стоящий доворачивает корпус, если угол > 70°.
- Уступить дорогу: игрок ≤ 1.5 м и идёт на NPC (или NPC идёт на игрока) → шаг 1.4 м вбок, затем возврат к цели.
- Разговоры: реестр в `URakisCrowdSubsystem` (группа = точка). Игрок ближе 4 м → группа умолкает (`bConversationSilenced`,
  звук `Crowd:PlayerNear`), дальше 5.5 м в течение 1.5 с → продолжает.
- Лай: `URakisDialogueSubsystem::PlayBark(Archetype, Context, this)`; контексты: `Stranger` (игрок проходит ≤ 3.5 м, 35 %,
  кулдаун 90 с), `Market`/`Water`/`Shiana`/`Kin`/`Offworld` (разговор на точке, по типу точки), `Idle` (один на точке),
  `Ritual` (по пути в зал). Личный кулдаун 25–50 с + глобальное окно 3.5 с на всю толпу; только ≤ 12 м от игрока.
- `BeginRitualFlow(GatherPoint)`: бросить точку, идти (×1.05), по прибытии — лицом к центру зала (среднее `Rakis.HallGather`).
- Визуал: `BaseMesh` архетипа → `SKM_Quinn_Simple` (+`ABP_Unarmed`) → цилиндр-заглушка. Цвет одежды — из `ClothPalette`
  (`ClothTint` на MID всех слотов; у заглушки ещё `Color`). Дети — капсула 24/62 см, меш ×0.68.
- AnimBP читает: `LookAtTarget`, `bLookAtPlayer`, `bHasLookAtTarget`, `bIsTalking`, `bConversationSilenced`, `Activity`, `CurrentSpotType`.

### 6.2 `ARakisCompanion`
- `CompanionId` (Ilva/Rayn/Ossana), `ChainIndex` (0 = авто 1/2/3), `ChainSpacing` 3.5 м.
- Крошки следа игрока каждые 40 см; спутник идёт строго по ним (`AddMovementInput` каждый кадр) — на песке «след в след».
  Держит дистанцию `ChainIndex × ChainSpacing` по длине следа; скорость = скорость игрока + 0.8·отставание (90…480 см/с).
- Игрок стоит → спутник стоит и через 0.75 с поворачивается к нему; `LookAtTarget`/`bLookAtPlayer` для AnimBP.
- До встречи (игрок дальше 15 м) — ждёт на месте (Оссана у A3). Застрял > 2.5 с или отстал > 25 м — AI MoveTo с
  навигацией; > 60 м — телепорт на след, только если не в кадре. `SetFollowEnabled(false)` — для сюжетных стоек.
- Шаги: `Footstep:Companion` по пройденному пути (пока нет AnimNotify).

### 6.3 `ARakisCrowdSpawner` и `URakisCrowdSubsystem`
- Спавнер в `L_Rakis_Sietch`: при BeginPlay (уровень подгружен) строит детерминированный план по `Seed`: архетип по
  `SpawnWeight`, точка `Rakis.CrowdSpawn.<Archetype>` (75 %) или `Rakis.CrowdSpawn`, разброс 1.8 м, приземление трассой;
  спавн пачками по 6 каждые 0.05 с, `SpawnActorDeferred` → `InitCitizen` → `FinishSpawning`, уровень = уровень спавнера.
- Подсистема: архетипы (DT или 8 встроенных), кэш точек `Rakis.SmartObject.<Type>` (алиасы Prayer→PrayerMat,
  Water→WaterJar, Repair→StillsuitRepair, Market→Stall); маркерам добавляется `USmartObjectComponent`
  (SOD_<Type> или рантайм-определение, слоты = ёмкость: Bench 3, Stall/WaterJar 2, прочие 1; фоллбек — теговое резервирование),
  реестр разговоров, окно лая, `StartRitual()` (точки сбора по имени, горожане от ближних к дальним, круговая раскладка
  «золотым углом» вокруг точки при нехватке точек, задержка 0.5 + 0.35·i + rand(0..1.5) с), `OnRitualStarted`,
  звук `CrowdRitual` в центре зала. Опоздавшие (подгрузились после старта) идут в зал сразу.
- Автоматика по docs/06 §1.3: вход в B3/B4/B5 → `StartRitual`; 240 с в B2 → `StartRitual` (`Rakis.Crowd.AutoRitual 0` — выкл).
- Автоспавн спутников у маркеров `Rakis.Companion.<Id>` в постоянный уровень, если такого `CompanionId` нет
  (`Rakis.Companions.AutoSpawn 0` — выкл; класс — `CompanionClass` в `[/Script/Rakis.RakisCrowdSubsystem]`).
- Консоль: `Rakis.Crowd.StartRitual`.

## 7. Апгрейд толпы на Mass / StateTree / Smart Objects

**Статус (S2, T-015):** пункты 1 (Smart Objects — рантайм-регистрация на маркерах, ассеты `ai_smart_objects.py`) и
2 (StateTree — C++-узлы + `UStateTreeComponent` на горожанине, ассет `ST_Citizen` собирается в редакторе по
`docs/tech/crowd.md` §3) **сделаны**; LOD 40/70 м — сделан (сон вместо Mass hand-off). Пункт 3 (Mass) — только
разметка и инструкция (`ai_mass_crowd.py`, crowd.md §6), C++ Mass не писали. Отличия от плана ниже: компонент
StateTree — на пешке (схема «StateTree Component»), а не на AAIController; маркеры остаются TargetPoint, компоненты
SO вешаются в рантайме (скрипт разметки уровня не меняли). Исходный план:

1. **Smart Objects.** Заменить теговые точки на `USmartObjectComponent` с `USmartObjectDefinition` на каждый тип
   (Loom, Stall, WaterJar, PrayerMat, Bench, Niche, StillsuitRepair); слоты = нынешняя ёмкость, Activity Tags = тип.
   `ReserveSpot/ReleaseSpot` → `USmartObjectSubsystem::FindSmartObjects / MarkSlotAsClaimed / Release`.
   Теги `Rakis.SmartObject.<Type>` оставить — скрипт разметки по ним добавит компоненты (идемпотентно).
2. **StateTree `ST_Citizen`.** Состояния = `ERakisCitizenActivity`: Idle → FindSpot (SO query) → MoveTo → UseSpot
   (анимация по типу, разговор) → Wander; глобальные переходы — StepAside (событие от сенсора близости игрока),
   Ritual (событие `Rakis.Event.Ritual`). Задачи — тонкие обёртки над текущими функциями. Для акторов: `UStateTreeComponent`
   на `AAIController` (`GameplayStateTreeModule` уже подключён).
3. **Mass для массовки.** Фон (дальше ~15 м и в зале на ярусах) — Mass-сущности: `UMassEntityConfigAsset` с трейтами
   Movement, Avoidance, Navigation (ZoneGraph-дорожки по галерее), LOD, Representation (ISM-импосторы / облегчённые
   актор-видимости через `MassActors`), `MassSmartObject` для пользования точками, `MassStateTree` с тем же `ST_Citizen`.
   Спавн — `AMassSpawner` с `UMassEntityConfigAsset` на архетип, веса из DT_CrowdArchetypes.
4. **Гибрид.** Рядом с игроком (≤ 15 м) Mass-представление поднимается до полноценного `ARakisCitizen`
   (look-at, лай, уступить дорогу, разговоры остаются в акторе) — стандартная схема Mass LOD → Actor.
   `URakisCrowdSubsystem` остаётся фасадом: `StartRitual`, реестр разговоров, окно лая; для Mass ритуал = сигнал
   `UMassSignalSubsystem` всем сущностям с фрагментом `FRakisCitizenFragment`.
   (S2: Mass не реализован; спящие > 70 м горожане просто скрыты.)
5. **Порядок работ:** (а) SO-компоненты на точки, (б) ST_Citizen для актора, (в) Mass для зала (статичные ярусы),
   (г) Mass для галереи с LOD → Actor. Модули `MassEntity/MassCommon/MassSpawner/MassActors/SmartObjectsModule`
   уже в `Rakis.Build.cs`; понадобятся ещё `MassMovement`, `MassNavigation`, `MassLOD`, `MassRepresentation`,
   `MassAIBehavior`, `ZoneGraph`, `MassCrowd` — их добавляет orchestrator.

## 8. Проверка

- PIE в `L_Rakis_Persistent`: лог `LogRakis` — пресет погоды, активная зона, музыка, спавн толпы.
- `Rakis.Weather Storm_Horizon 5`, `Rakis.TimeOfDay 6.5` / `18` — солнце уходит на восток/запад, туман и пыль меняются.
- `Rakis.Crowd.StartRitual` — толпа идёт к `Rakis.HallGather`.
- `Rakis.Crowd.AutoRitual 0`, `Rakis.Companions.AutoSpawn 0` — выключение автоматики.
- `Rakis.Crowd.StateTree 0`, `Rakis.Crowd.SmartObjects 0`, `Rakis.Crowd.LOD 0` — откат толпы к поведению S1 (crowd.md §1).
- Без контента: вместо людей — цилиндры, музыка молчит с одним предупреждением, кат-сцена червя — фоллбек ForceSurface.
