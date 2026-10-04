# Толпа сиетча: Smart Objects, StateTree, LOD, Mass

Роль: gameplay-programmer (world). Задача: T-015 (спринт S2, апгрейд толпы на целевую архитектуру GDD §5).
Код: `Source/Rakis/{Public,Private}/AI/**`. Скрипты: `Tools/unreal_python/ai_smart_objects.py`, `ai_mass_crowd.py`.
Связанные документы: `docs/tech/world_systems.md` §6–7, `docs/level/layout.md` §5 (маркеры), `docs/06_demo_contract.md` §2.2.

Все API ниже сверены с документацией UE 5.6 (`dev.epicgames.com/documentation/en-us/unreal-engine/API/...?application_version=5.6`).
Код **ещё ни разу не компилировался** — первый билд обязателен перед ревью (см. §8).

## 1. Архитектура

```
маркер TargetPoint [Rakis.SmartObject.<Type>]
   └─(первое обращение)─ URakisCrowdSubsystem::RebuildSpotCache → EnsureSmartObject
         + USmartObjectComponent (RF_Transient) с USmartObjectDefinition:
             /Game/Rakis/AI/SmartObjects/SOD_<Type> (если валиден) | рантайм-определение
         → USmartObjectSubsystem (регистрация, FSmartObjectHandle → маркер)

ARakisCitizen ── UStateTreeComponent "StateTree" ── ST_Citizen (если ассет есть)
   │                 └─ C++-узлы: RakisCitizenStateTree.h (Sense, Wander, Idle, FindAndUseSmartObject,
   │                    LookAtPlayer, YieldToPlayer, FallSilent, GoToRitual; условия RitualRequested, ShouldYieldToPlayer)
   ├─ C++-фоллбек (прежний автомат), если ассета нет / дерево не стартовало / сломалось
   ├─ таймер BehaviourHz (5 Гц): в режиме StateTree — только лай и звук работы на точке
   └─ таймер LOD (1 Гц): Full ≤ 40 м, Low ≤ 70 м (StateTree тикает раз в 0.5 с), Dormant > 70 м (скрыт, пауза)

URakisCrowdSubsystem (фасад, публичный API без изменений: StartRitual, OnRitualStarted, GetHallCentre, Get)
   ├─ ReserveSpot  → FindSmartObjects(ActivityRequirements = Rakis.SO.<типы архетипа>) → MarkSlotAsClaimed
   ├─ MarkSpotInUse→ MarkSlotAsOccupied(URakisSmartObjectBehaviorDefinition)
   ├─ ReleaseSpot  → MarkSlotAsFree
   └─ фоллбек: теговое резервирование с ёмкостью (CVar Rakis.Crowd.SmartObjects 0 или ни один SO не зарегистрирован)
```

Обе ветки решений (StateTree и фоллбек) вызывают одни и те же примитивы `ARakisCitizen` (`StartWander`,
`ClaimSpotAndMove`, `ArriveAtSpot`, `LeaveSpot`, `UpdateLookAt`, `StepAsideFromPlayer`, `BeginRitualWalk`/`UpdateRitualWalk`),
поэтому поведение совпадает. Поля для AnimBP не изменились (`LookAtTarget`, `bLookAtPlayer`, `bHasLookAtTarget`,
`bIsTalking`, `bConversationSilenced`, `Activity`, `CurrentSpotType`).

### Консоль
| CVar / команда | По умолчанию | Что делает |
|---|---|---|
| `Rakis.Crowd.StateTree` | 1 | 0 — новые горожане на C++-фоллбеке даже при наличии ST_Citizen |
| `Rakis.Crowd.SmartObjects` | 1 | 0 — теговое резервирование вместо USmartObjectSubsystem (для новых резервов) |
| `Rakis.Crowd.LOD` | 1 | 0 — всегда полная частота, без сна |
| `Rakis.Crowd.StartRitual` | — | как раньше |

## 2. Smart Objects

### 2.1 Типы и слоты
| Тип (`Rakis.SmartObject.<Type>`) | Тег активности | Слотов | Длительность в SOD (сек) | Охота говорить |
|---|---|---|---|---|
| Loom | `Rakis.SO.Loom` | 1 | 20–45 | ×0.6 |
| Stall | `Rakis.SO.Stall` | 2 | 15–40 | ×1.4 |
| WaterJar | `Rakis.SO.WaterJar` | 2 | 8–20 | ×1.3 |
| PrayerMat | `Rakis.SO.PrayerMat` | 1 | 25–60 | ×0.2 |
| Bench | `Rakis.SO.Bench` | 3 | 15–45 | ×1.5 |
| Niche | `Rakis.SO.Niche` | 1 | 10–30 | ×0.8 |
| StillsuitRepair | `Rakis.SO.StillsuitRepair` | 1 | 20–50 | ×0.7 |

Слоты стоят в ряд поперёк «лица» маркера (локальная Y, шаг 70 см), поворот слота = поворот маркера (точки размечены
лицом к станку/прилавку). Рантайм-определение (без ассета) использует ту же ёмкость, длительность — `SpotIdleMin/Max`
горожанина, разговор ×1.3 для многоместных точек.

Теги `Rakis.SO.*` и события `Rakis.Crowd.Event.Ritual`, `Rakis.Crowd.Event.PlayerBlocking` — **нативные**
(`UE_DEFINE_GAMEPLAY_TAG_COMMENT` в `RakisSmartObjects.cpp`), в `DefaultGameplayTags.ini` их добавлять не нужно.

### 2.2 Цикл использования (API 5.6)
1. `USmartObjectSubsystem::FindSmartObjects(const FSmartObjectRequest&, TArray<FSmartObjectRequestResult>&, const AActor* UserActor)`;
   запрос — коробка `±SpotSearchRadius × ±SpotSearchRadius × ±20 м` вокруг горожанина, фильтр
   `FSmartObjectRequestFilter::ActivityRequirements = FGameplayTagQuery::MakeQuery_MatchAnyTags(теги типов архетипа)`.
   Занятые слоты отсеиваются самим фильтром (`bShouldIncludeClaimedSlots = false`).
2. Выбор слота — вес `1/(1 + d/10 м)` (ближние вероятнее), до 3 попыток.
3. `MarkSlotAsClaimed(SlotHandle, ESmartObjectClaimPriority::Normal, FConstStructView::Make(FSmartObjectActorUserData(Citizen)))`.
4. Путь — к `GetSlotTransform(ClaimHandle)` (`TOptional<FTransform>`), по прибытии — поворот по yaw слота.
5. `MarkSlotAsOccupied(ClaimHandle, URakisSmartObjectBehaviorDefinition::StaticClass())` → длительность и множитель разговора.
6. `MarkSlotAsFree(ClaimHandle)` — при уходе с точки, прерывании задачи, `EndPlay`, `UnregisterCitizen`
   (только если `IsClaimedSmartObjectValid`). Устаревший `Release` не используется.

Регистрация: `NewObject<USmartObjectComponent>` → `SetDefinition` → `SetupAttachment(root маркера)` → `AddInstanceComponent`
→ `RegisterComponent()`; если после этого `GetRegisteredHandle()` невалиден — явный `RegisterSmartObject(USmartObjectComponent&)`.
Если на маркере уже есть `USmartObjectComponent` (дизайнер поставил руками) — используется он.

Рантайм-определение: массив `Slots` у `USmartObjectDefinition` приватный, а `DebugAddSlot()` — тестовый, поэтому слоты
добавляются через рефлексию UPROPERTY `Slots` (`FScriptArrayHelper`); затем `Validate(TArray<TPair<EMessageSeverity::Type, FText>>*)`,
ошибки — в лог.

### 2.3 Ассеты SOD_<Type> (необязательно)
`Tools/unreal_python/ai_smart_objects.py` (после сборки модуля — нужны нативные теги и класс
`RakisSmartObjectBehaviorDefinition`): создаёт/перезаписывает `/Game/Rakis/AI/SmartObjects/SOD_<Type>` с таблицей §2.1.
C++ принимает ассет, только если у каждого слота есть тег `Rakis.SO.<Type>` и поведение `Rakis Citizen Spot Behavior`;
иначе — предупреждение и рантайм-определение. Дизайнер может править длительности/слоты в ассете.

## 3. StateTree `ST_Citizen`

Ассет: `/Game/Rakis/AI/ST_Citizen` (мягкий путь `ARakisCitizen::StateTreeAsset`). Нет ассета — C++-фоллбек, одна
строка в логе «StateTree … не найден». StateTree из Python не собирается — дерево авторится руками по шагам ниже.

### 3.1 Создание и схема
1. Content Browser → `/Game/Rakis/AI/` → Add → Artificial Intelligence → **StateTree** → в диалоге схемы выбрать
   **StateTree Component** (`UStateTreeComponentSchema`; НЕ «StateTree AI Component» — компонент висит на пешке, не на контроллере).
   Имя: `ST_Citizen`.
2. В панели схемы (Details при выбранном корне дерева / вкладка Schema):
   - **Context Actor Class** = `RakisCitizen` (или BP-наследник, если спавнер использует `CitizenClass`).
   - **Scheduled Tick Policy** = **Denied** — тогда LOD задаёт интервал тика компонента (§5). При Allowed/Default
     компонент сам управляет интервалом и редкий тик LOD Low может не работать.
3. **Evaluators** → добавить **Rakis Citizen Sense** (категория Rakis|Crowd). Его выходы доступны для привязок и
   условий: `PlayerDistance`, `bPlayerNear`, `bPlayerBlocking`, `bRitualRequested`, `PlayerZone`, `bIsTalking`, `Activity`, `LOD`.
4. **Global Tasks** → **Rakis Look At Player** и **Rakis Fall Silent** (SilenceRadius 400, ResumeRadius 550, ResumeDelay 1.5).
   Обе задачи бесконечные и `bConsideredForCompletion = false` (не мешают завершению состояний).

### 3.2 Состояния

```
Root                         Selection: Try Select Children In Order
├─ Ritual                    Enter Conditions: Rakis Ritual Requested
│  ├─ RitualYield            Enter Conditions: Rakis Should Yield To Player   Tasks: Rakis Yield To Player
│  │                         Transitions: On State Completed → Ritual
│  └─ RitualWalk             Tasks: Rakis Go To Ritual   (Running бесконечно)
├─ Yield                     Enter Conditions: Rakis Should Yield To Player   Tasks: Rakis Yield To Player
│                            Transitions: On State Completed → Life
└─ Life                      Selection: Try Select Children In Order
   ├─ UseSpot                Enter Conditions: Random (Threshold 0.75)        Tasks: Rakis Find And Use Smart Object
   │                         Transitions: On State Succeeded → Rest; On State Failed → Wander
   ├─ Wander                 Tasks: Rakis Wander
   │                         Transitions: On State Completed → Rest
   └─ Rest                   Tasks: Rakis Idle (DurationMin/Max ≤ 0 → WanderIdleMin/Max горожанина)
                             Transitions: On State Completed → Life
```

Пошагово:
1. Корень `Root`: **Selection Behavior = Try Select Children In Order**.
2. Добавить дочерний `Ritual`:
   - Enter Conditions → **Rakis Ritual Requested** (bInvert = false).
   - Selection: Try Select Children In Order.
   - Дочерний `RitualYield`: Enter Condition **Rakis Should Yield To Player**; Task **Rakis Yield To Player**;
     Transition **On State Completed → Ritual** (вернуться в поток).
   - Дочерний `RitualWalk`: Task **Rakis Go To Ritual**. Без переходов (задача Running до конца уровня;
     выход «пришёл» — `bGathered` в её Output, можно привязать к анимации/отладке).
3. Добавить `Yield`: Enter Condition **Rakis Should Yield To Player**; Task **Rakis Yield To Player**;
   Transition **On State Completed → Life**.
4. Добавить `Life` (Selection: Try Select Children In Order) с детьми:
   - `UseSpot`: Enter Condition **Random** (встроенное условие StateTree, Threshold = 0.75 ≈ `SpotChance`);
     Task **Rakis Find And Use Smart Object** (параметры ≤ 0 = значения горожанина/слота);
     Transitions: **On State Succeeded → Rest**, **On State Failed → Wander**.
   - `Wander`: Task **Rakis Wander**; Transition **On State Completed → Rest**.
   - `Rest`: Task **Rakis Idle**; Transition **On State Completed → Life**.
5. Переходы-прерывания на `Life` (Transitions самого состояния `Life`, они проверяются, пока активен любой ребёнок):
   - **On Tick**, Condition **Rakis Should Yield To Player** → `Yield` (Priority: High).
   - **On Event**, Event Tag **Rakis.Crowd.Event.Ritual** → `Ritual` (Priority: Critical).
   - Подстраховка: **On Tick**, Condition **Rakis Ritual Requested** → `Ritual` (Priority: Critical).
   На `Yield` — те же два ритуальных перехода (иначе событие, пришедшее во время шага в сторону, потеряется до следующего тика).
6. Если в 5.6 у состояния есть **Tasks Completion** — оставить **Any** (состояние завершается задачей-«работой»,
   глобальные бесконечные задачи не мешают).
7. Compile → Save. В PIE: лог «Crowd: горожане работают от StateTree …», `IsUsingStateTree()` у горожан = true.

### 3.3 Контракт узлов
| Узел | Возврат | Побочные эффекты |
|---|---|---|
| Rakis Citizen Sense (evaluator) | — | только чтение |
| Rakis Ritual Requested / Should Yield To Player (conditions) | bool (`bInvert`) | нет |
| Rakis Wander | Succeeded — дошёл; Failed — некуда идти | Activity = Wandering/Idle |
| Rakis Idle | Succeeded по таймеру | Activity = Idle |
| Rakis Find And Use Smart Object | Succeeded — отработал; Failed — нет слота/не дошёл/прервано | Claim → Occupy → (ExitState) Free; разговор; `SpotType` (Output) |
| Rakis Look At Player | Running | `LookAtTarget/bLookAtPlayer/bHasLookAtTarget`, доворот корпуса |
| Rakis Yield To Player | Succeeded — отошёл; Failed — не нужно | шаг 1.4 м вбок, кулдаун 2 с |
| Rakis Fall Silent | Running | `bConversationSilenced`; пока активна, реестр подсистемы не трогает этого горожанина |
| Rakis Go To Ritual | Running; Failed — ритуал не запрошен | путь к точке сбора, по прибытии лицом к центру зала |

Узлы берут горожанина из `Context.GetOwner()` (сам `ARakisCitizen`; если компонент перенесут на AI-контроллер — его пешка).

### 3.4 Страховки (почему дерево не сломает демо)
- Нет ассета / схема не та / `StartLogic` не запустил дерево → C++-фоллбек (одно предупреждение).
- Дерево завершилось (корень Succeeded/Failed) → перезапуск; > 5 остановок подряд с интервалом < 2 с → фоллбек.
- `BeginRitualFlow` шлёт событие `Rakis.Crowd.Event.Ritual`; если за 3 с горожанин не в RitualWalk/RitualGathered —
  дерево останавливается, ритуал ведёт C++ (контракт `StartRitual` из docs/06 §1.3 важнее).

## 4. C++-фоллбек

Прежний автомат `BehaviourUpdate` (Idle → точка 75 % / прогулка → пауза; шаг в сторону с возвратом к цели; ритуал),
теперь через те же примитивы и Smart Objects. Отличие от S1: дальше 40 м горожанин не «замирает», а решает в 5 раз реже
(LOD Low), дальше 70 м — спит (§5).

## 5. LOD / значимость

| LOD | Дистанция до игрока (гистерезис ±3 м) | StateTree | Фоллбек | Видимость/движение |
|---|---|---|---|---|
| Full | ≤ `SignificanceRadius` = 40 м | тик каждый кадр | 5 Гц | как есть |
| Low | ≤ `DormantRadius` = 70 м | `SetComponentTickInterval(LowLODTickInterval = 0.5 с)` | решения раз в 1 с, без look-at | как есть |
| Dormant | > 70 м | `PauseLogic("RakisLOD.Dormant")` | пропуск | `SetActorHiddenInGame(true)`, тик CharacterMovement выкл. |

- Пересчёт LOD — таймер `LODUpdateInterval` = 1 с со случайной фазой.
- Идущие на ритуал не засыпают (не ниже Low), иначе толпа не дошла бы до зала, пока игрок далеко; уже стоящие в зале — спят.
- `BeginRitualFlow` будит спящего. Слот SO спящий держит (точка остаётся «занятой» — визуально незаметно на 70 м+).
- Hand-off в Mass при Dormant не реализован (см. §6).

## 6. Mass: фоновая массовка (эксперимент, только «клей»)

C++ Mass в этом прогоне **не трогали**: API трейтов/процессоров MassGameplay 5.6 не удалось сверить с достаточной
уверенностью, а ошибка там ломает сборку. Модули в `Rakis.Build.cs` не добавлялись.

`Tools/unreal_python/ai_mass_crowd.py`:
- ставит маркеры `Rakis.MassCrowd.Silhouette` + `Rakis.MassCrowd.Gallery|Hall` (балконы B2 −14 м, шаг 2.4 м; терраса B5 −42 м
  по кольцу за внешним ярусом, без помоста) — не ближе 2.5 м к точкам толпы/SO/сбора;
- пытается создать `/Game/Rakis/AI/Mass/MEC_CrowdSilhouette` (UMassEntityConfigAsset) с трейтом стационарной визуализации;
- если MEC есть — ставит `MassSpawner_Gallery` / `MassSpawner_Hall` (Count = число маркеров, `auto_spawn_on_begin_play = false`).

Ручные шаги в редакторе:
1. `MEC_CrowdSilhouette`: трейты **Stationary Visualization** (Static Mesh Instance Desc: меш силуэта в плаще,
   `SM_Crowd_Silhouette` от character-artist; LOD Significance — только Low/Off), **LOD Collector**, **Distance LOD**
   (Low ≥ 15 м). Без Movement/Avoidance — силуэты стоят.
2. EQS `EQS_MassSilhouettes`: генератор **Actors Of Class** (`TargetPoint`, Search Radius 100 м вокруг Querier), тест
   по имени/тегу недоступен из коробки — либо отдельный BP-класс маркера, либо ограничить радиус спавнером.
   У каждого `MassSpawner_*` → Spawn Data Generators → **EQS SpawnPoints Generator** с этим запросом, Proportion 1.
3. Включить `Auto Spawn On Begin Play` у спавнеров. Проверка: `mass.debug` / Mass Debugger, в PIE силуэты видны с
   балкона B2 и в зале до начала ритуала.
4. Связь с ритуалом (позже): по `OnRitualStarted` — `AMassSpawner::DoDespawning()` для `MassSpawner_Hall`
   (на ярусы встают живые горожане).

## 7. Ручные шаги (сводка)
1. Собрать `RakisEditor` (Development Editor) — первый билд этого кода.
2. Запустить `ai_smart_objects.py` (необязательно; без него — рантайм-определения).
3. Создать `ST_Citizen` по §3 (необязательно; без него — C++-фоллбек).
4. (Эксперимент) `ai_mass_crowd.py` + §6.
5. NavMesh на балконах/ярусах уже нужен для толпы (без изменений).

## 8. Проверка
- PIE `L_Rakis_Persistent`, лог `LogRakis`:
  `Crowd SO: тип Bench — ассет SOD|рантайм-определение`, `… зарегистрировано в USmartObjectSubsystem: N` (≈ 56 по layout.md),
  `Crowd: горожане работают от StateTree …` или `… не найден — горожане на C++-фоллбеке`.
- Gameplay Debugger (`'` → категория Smart Objects): слоты на скамьях (3), прилавках (2), занятые — другим цветом.
- Подойти к скамье с говорящими ближе 4 м — `bConversationSilenced` = true, отойти на 5.5 м — через 1.5 с снова говорят.
- `Rakis.Crowd.StartRitual` — все идут в зал (и в режиме StateTree, и на фоллбеке); `Rakis.Crowd.LOD 0` — без сна.
- StateTree Debugger (окно StateTree, Debugger) на выбранном горожанине — активные состояния Root/Life/UseSpot.
- `Rakis.Crowd.SmartObjects 0` → новые резервы по тегам (регрессия к S1).
