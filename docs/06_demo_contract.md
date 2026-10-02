# Демо «Rakis: Heretics» — видение и технический контракт

Документ дополняет `00_GDD.md` и `01_scenario.md`. Часть 1 — что игрок должен почувствовать, часть 2 — обязательные для всех ролей имена классов, API, ассетов, тегов и схем данных. Менять контракт может только `orchestrator`.

---

## Часть 1. Видение

### 1.1 Опоры (pillars)
1. **Масштаб без опор для глаза.** Пустыня огромна и молчалива, человек в ней — точка. Скала «Коготь Шайтана» — единственная вертикаль на 2 км. Червь — масштаб, который ломает восприятие: 360 м длины, 40 м в диаметре, пасть-цветок из трёх лепестков с кольцами кристаллических зубов.
2. **Пустыня слушает.** Главная игровая угроза системная и читаемая: шум → внимание червя. Игрок учится ходить «неритмично», держаться камня, слышать песок.
3. **Вода — это жизнь и власть.** Жара, тень, дистикомб, торговка, отмеряющая воду каплями, решётка цистерны, на которую нельзя смотреть слишком долго.
4. **Обжитая старина.** Сиетч — три исторических слоя (фрименская резьба → символы Квизарата → наивные росписи возрожденцев), отполированный руками камень, янтарь светошаров, пряная дымка.
5. **Минимум интерфейса.** Всё, что можно сказать миром (звук, вибрация, пыль, камера, свет), говорится миром. HUD появляется только по необходимости и гаснет сам.

### 1.2 Погода и время суток (атмосфера мира)
| Пресет (`DT_WeatherPresets`) | Где | Время | Характер |
|---|---|---|---|
| `Dawn_Ridge` | A1, старт | 06:40 | низкое розово-охристое солнце, длинные тени дюн, холодный кобальт в тени, лёгкая дымка у земли |
| `Morning_Erg` | A2 | 08:30 | выбеленная охра, марево набирает силу, позёмка по гребням |
| `Worm_Tension` | A2, Listening/Approach | — | ветер стихает до 1–2 м/с, пыль «висит», экспозиция чуть ниже, глухая тишина |
| `Worm_Reveal` | A2, Surface | — | столб пыли и песка до 150 м, солнце закрыто телом червя, объёмные лучи сквозь пыль |
| `Noon_Approach` | A3 | 11:30 | жёсткий зенитный свет, марево максимум, тени короткие и синие |
| `Storm_Horizon` | A3→A4 | 12:00 | на юго-западе стена бури (кориолисова буря) на горизонте, ветер 14 м/с, пыльные вихри, небо желтеет |
| `Crevice_Shade` | A4 | — | глубокая тень расщелины, отражённый тёплый свет от стен |
| `Sietch_Interior` | B1–B4 | вечер | наружный свет только через световые колодцы; светошары 2700K; объёмный туман, дымка пряности |
| `Hall_Ritual` | B5 | вечер | один «божественный» луч из шахты в песчаную чашу, пыль в луче, хорал |

Буря на горизонте — геймплейно безопасна в срезе, но служит таймером и мотивацией (ветер толкает частицы в кадр, позёмка гуще, звук давит).

### 1.3 Поток демо (≈ 15–20 мин свободной игры, «золотой путь» 3:40 из сценария)
| Глава (title card) | Зона | Что делает игрок | Опора |
|---|---|---|---|
| «Ракис. Гребень Шайтана. Рассвет» | A1 | идёт цепочкой с Илвой и Рэйном, учится неритмичной походке (подсказка один раз) | масштаб |
| «Открытый эрг» | A2 | пересекает 700 м песка; метр шума, жажда; камни-«острова» безопасны | пустыня слушает |
| «Шай-Хулуд» | A2 | гул, подпрыгивающие камни, волна песка → кат-сцена `LS_WormReveal`: червь выходит в 80 м, наездники, Оссана спускается по кольцам | грандиозность |
| «Коготь» | A3 | диалог с Оссаной в движении, по камню; буря на горизонте | вода/власть |
| «Табр-ан-Нур» | A4→B1 | фальшивый камень, двери-уплотнители с шипением, стража проверяет маски | смена мира |
| — | B2 | рынок: ткачи, починка дистикомба, дети «червь и наездник», торговка водой | обжитая старина |
| — | B3/B4 | узкие проходы, занавеси, решётка цистерны | вода — святыня |
| «Глотка Бога» | B5 | святилище: ярусы, песчаная чаша, луч; жрица поёт, «танец»; наиб Хармат оборачивается | финал |

Свободная прогулка в B2–B3 не ограничена по времени; ритуал (`CrowdRitual`) запускается, когда игрок входит в B3 или через 4 мин в B2.

### 1.4 Минималистичный интерфейс (подробно — `docs/ui/ui_design.md`)
- **Шумовая рябь** — 3 тонкие дуги внизу по центру; видна только на песке; толщина/яркость = шум; при Listening/Approach дуги «дрожат» и смещаются в охристо-красный.
- **Ритм шагов** — 6 крошечных засечек под рябью: неровные интервалы = хорошо (охра), метроном = плохо (белые, ровные).
- **Влага** — капля 18 px справа внизу, появляется при < 70 % или при изменении; в тени — едва заметная синяя кайма.
- **Взаимодействие** — одно слово + глиф клавиши у прицела; прицела нет — только точка 2 px, когда есть фокус.
- **Субтитры** — низ экрана, имя говорящего капителью охрой, строка — тёплый белый, мягкая тень; RU/EN.
- **Титры глав** — тонкий шрифт с разрядкой, 4 с, fade.
- **Пауза** — вертикальный список поверх размытого кадра: Продолжить · Фоторежим · Язык · Субтитры · Выход.
- **Фоторежим** — свободная камера в радиусе 15 м, FOV, DOF, экспозиция, скрытие HUD.
- Никаких маркеров, мини-карты, полосок здоровья. Угроза червя — вибрация, тряска камеры, пыль на экране, инфразвук.

---

## Часть 2. Технический контракт

### 2.1 Карта ответственности
| Подсистема | Роль | Файлы |
|---|---|---|
| Ядро типов, настройки, модуль | orchestrator | `Source/Rakis/Public/Core/*`, `Private/Core/*`, `Rakis.Build.cs`, `Config/*`, `Rakis.uproject` |
| Игрок, шум, походка, вода, червь, тампер, взаимодействие, двери | gameplay-programmer (core) | `Source/Rakis/{Public,Private}/{Player,Noise,Hydration,Worm,Interaction,Gameplay}/**`, `Source/Rakis/Tests/**` |
| Погода, зоны, звук-директор, NPC/толпа/компаньоны, кат-сцены | gameplay-programmer (world) | `Source/Rakis/{Public,Private}/{World,Weather,Audio,AI}/**` |
| Диалоги, сюжетный директор, HUD/UI, меню, фоторежим | gameplay-programmer (ui) | `Source/Rakis/{Public,Private}/{Narrative,UI}/**`, `docs/ui/**` |
| Материалы, MPC, шейдер марева, Niagara, свет, пост | tech-artist | `Source/Rakis/Shaders/**`, `Tools/unreal_python/{mat,fx,light}_*.py`, `docs/tech-art/**` |
| Блокаут, разметка, ландшафт, кит сиетча, скала, червь-меш | level-designer + environment-artist | `docs/level/**`, `docs/art/environment/**`, `Tools/unreal_python/{level,env}_*.py`, `Tools/blender/env_*.py` |
| Механики, диалоги, лай, данные, персонажи, анимация, звук | game-designer, character-artist, animator, audio-designer | `docs/{design,lore,art/characters,animation,audio}/**`, `Content/Rakis/Data/*.csv`, `Tools/unreal_python/{data,char,anim,audio}_*.py`, `Tools/tts/**` |
| Сборка демо | orchestrator | `Tools/unreal_python/build_demo.py` |

### 2.2 C++ API (обязательные сигнатуры)
Все классы — `RAKIS_API`, категории `Rakis|<System>`. Заголовки в `Public/<Dir>/`, реализация в `Private/<Dir>/`.

**Core (готово):** `Core/RakisTypes.h` (ERakisSurface, ERakisZone, ERakisWormState, ERakisMusicState, ERakisLanguage), `Core/RakisDataTypes.h` (строки DataTable), `Core/RakisSettings.h` (URakisSettings).

**Player/** — core
```cpp
class ARakisCharacter : public ACharacter
  URakisNoiseComponent*       GetNoise() const;
  URakisHydrationComponent*   GetHydration() const;
  URakisSandWalkComponent*    GetSandWalk() const;
  URakisInteractionComponent* GetInteraction() const;
  bool IsFirstPerson() const;  void SetFirstPerson(bool);  // бесшовный FP/TP
  ERakisSurface GetCurrentSurface() const;
  UFUNCTION(BlueprintCallable) void OnFootstep(bool bLeftFoot); // AnimNotify или таймер-фоллбек
  void SetInputLocked(bool bLocked);                      // для кат-сцен
class ARakisPlayerController : public APlayerController
  // создаёт Enhanced Input (UInputAction/UInputMappingContext) в рантайме — без ассетов
  // Move, Look, Sprint(Shift), SandWalk(Alt hold / LB), Stutter(Space / A — сбить ритм),
  // Interact(E / X), ToggleCamera(V / RS), Thumper(T / Y), Pause(Esc / Start), PhotoMode(P)
  DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnPauseRequested) OnPauseRequested;
  DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnPhotoModeRequested) OnPhotoModeRequested;
  void PlayWormRumble(float Intensity01);                 // вибрация геймпада
class ARakisGameMode : public AGameModeBase  // DefaultPawn=ARakisCharacter, PC=ARakisPlayerController, HUD=ARakisHUD
```
**Noise/** — core
```cpp
struct FRakisNoiseEvent { FVector Location; float Loudness; FName Source; float Time; };
class URakisNoiseSubsystem : public UWorldSubsystem
  void ReportNoise(const FRakisNoiseEvent&);
  float SampleNoise(const FVector& Where, float Radius) const;   // 0..1+ с затуханием по времени/дистанции
  bool  GetLoudestRecent(FVector& OutLocation, float MaxAge) const;
class URakisNoiseComponent : public UActorComponent
  float GetNoise01() const;                                    // персональный метр игрока
  void  AddNoise(float Loudness, FName Source);
  DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnNoiseChanged, float, Noise01) OnNoiseChanged;
class URakisSandWalkComponent : public UActorComponent
  bool  IsSandWalking() const;
  float GetRhythmRegularity() const;                           // 0 = хаос (хорошо) … 1 = метроном (плохо)
  TArray<float> GetRecentIntervals() const;                    // для засечек HUD, ≤ 6
  DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnSandStep, float, Regularity) OnSandStep;
class URakisNoiseTuning : public UPrimaryDataAsset           // параметры §2.6
```
**Hydration/** — core
```cpp
class URakisHydrationComponent : public UActorComponent
  float GetMoisture01() const;  bool IsInShade() const;  float GetHeat01() const;
  bool  IsMaskSealed() const;   void SetMaskSealed(bool);
  DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnMoistureChanged, float, Moisture01) OnMoistureChanged;
class URakisHydrationTuning : public UPrimaryDataAsset
```
Тень — трассировка к солнцу: `ADirectionalLight` с тегом `Rakis.Sun` (или первый найденный), каждые 0.25 с.

**Worm/** — core
```cpp
class ARakisWorm : public AActor
  // тело: USplineComponent + UInstancedStaticMeshComponent колец (SM_Worm_Segment) + голова (SM_Worm_Head)
  ERakisWormState GetState() const;
  float GetThreat01() const;                 // 0..1 для звука, UI, камеры, вибрации
  float GetDistanceToPlayer() const;
  void  ForceSurface(const FVector& Location, const FRotator& Facing); // для кат-сцены/StoryDirector
  void  SetRidden(bool bRidden);
  DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnWormStateChanged, ERakisWormState, OldState, ERakisWormState, NewState) OnWormStateChanged;
  // Niagara: NS_Worm_SandWave (под землёй), NS_Worm_RingSandfall (над землёй), камни-«прыгуны» по радиусу
class URakisWormTuning : public UPrimaryDataAsset
class ARakisThumper : public AActor          // ставится игроком, бьёт каждые N с → ReportNoise(Source="Thumper")
```
**Interaction/** и **Gameplay/** — core
```cpp
UINTERFACE() class URakisInteractable; class IRakisInteractable
  FText GetInteractVerb() const;  bool CanInteract(ARakisCharacter*) const;  void Interact(ARakisCharacter*);
class URakisInteractionComponent : public UActorComponent  // сфера-трасса 250 см из камеры
  AActor* GetFocused() const;
  DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnFocusChanged, AActor*, Actor, FText, Verb) OnFocusChanged;
class ARakisSealDoor : public AActor, public IRakisInteractable   // двери-уплотнители (шипение, пар-конденсат)
class ARakisFalseRock : public AActor, public IRakisInteractable  // фальшивый камень входа A4
class ARakisInspectable : public AActor, public IRakisInteractable // POI: резьба, роспись, решётка; LoreID → DT_Dialogue
```
**Weather/** — world
```cpp
class URakisWeatherSubsystem : public UTickableWorldSubsystem
  void  RequestPreset(FName PresetId, float BlendSeconds = 8.f);
  FName GetCurrentPreset() const;
  float GetWindSpeed() const;  FVector GetWindDirection() const;
  float GetStormIntensity() const;  float GetDustDensity() const;
  // ищет: ADirectionalLight(tag Rakis.Sun), ASkyAtmosphere, ASkyLight, AExponentialHeightFog,
  // AVolumetricCloud, APostProcessVolume(tag Rakis.PP.Global); пишет MPC_RakisWeather (§2.5)
```
**World/** — world
```cpp
class ARakisZoneVolume : public AVolume
  ERakisZone Zone; FName WeatherPreset; ERakisMusicState Music; bool bInterior;
  TArray<TSoftObjectPtr<UWorld>> LevelsToLoad; TArray<TSoftObjectPtr<UWorld>> LevelsToUnload;
class URakisZoneSubsystem : public UWorldSubsystem
  ERakisZone GetPlayerZone() const;
  DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnZoneChanged, ERakisZone, OldZone, ERakisZone, NewZone) OnZoneChanged;
class ARakisCinematicTrigger : public AActor // ULevelSequence (soft), блок ввода, скрытие HUD, OnFinished
  void Play();  DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnCinematicFinished) OnFinished;
```
**Audio/** — world
```cpp
class URakisAudioDirector : public UTickableWorldSubsystem
  void SetMusicState(ERakisMusicState);  ERakisMusicState GetMusicState() const;
  void PostEvent(FName EventID, const FVector& Location);   // по DT_AudioEvents
  // параметры MetaSound музыки: "Intensity", "WormThreat", "Interior", "StateIndex"
```
**AI/** — world
```cpp
class ARakisCitizen : public ACharacter   // FName Archetype; look-at, уступить дорогу, умолкнуть рядом с игроком, лай
  void BeginRitualFlow(const FVector& GatherPoint);
class ARakisCompanion : public ACharacter // FName CompanionId (Ilva, Rayn, Ossana); следование цепочкой
class ARakisCrowdSpawner : public AActor  // спавн 40–80 ARakisCitizen по точкам с тегом Rakis.CrowdSpawn
class URakisCrowdSubsystem : public UWorldSubsystem
  void StartRitual();   // все к точкам Rakis.HallGather
```
**Narrative/** — ui
```cpp
class URakisDialogueSubsystem : public UGameInstanceSubsystem
  void PlayLine(FName DialogueID);  void PlayBark(FName Archetype, FName Context, AActor* Speaker);
  void SetLanguage(ERakisLanguage);  ERakisLanguage GetLanguage() const;
  DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FOnSubtitle, FText, Speaker, FText, Line, float, Duration) OnSubtitle;
  DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnLineFinished, FName, DialogueID) OnLineFinished;
class ARakisStoryDirector : public AActor  // исполняет DT_StoryBeats; один на уровень (тег Rakis.Story)
  DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnTitleCard, FText, Title, float, Duration) OnTitleCard;
  DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnHint, FText, Hint) OnHint;
```
**UI/** — ui (Slate, без ассетов UMG — чтобы работало «из коробки»)
```cpp
class ARakisHUD : public AHUD    // создаёт SRakisHUDRoot; подписывается на делегаты выше
class SRakisNoiseRipple, SRakisRhythmTicks, SRakisMoistureDrop, SRakisSubtitles,
      SRakisInteractPrompt, SRakisTitleCard, SRakisPauseMenu, SRakisPhotoMode
```

### 2.3 Карты и стриминг
- `L_Rakis_Persistent` — свет, атмосфера, StoryDirector, PostProcess, ZoneVolume-ы, точки игрока.
- `L_Rakis_Desert` (подуровень, всегда загружен на A1–A4), `L_Rakis_Sietch` (грузится ZoneVolume A3, выгрузка Desert — в B2).
- Координаты (см) — `docs/level/layout.md`. Старт A1 ≈ (0,0); скала: центр (150000, 60000), сиетч уходит в скалу на отметке ≈ −2000…−6000 по Z от поверхности у основания.

### 2.4 Теги акторов (FName)
| Тег | Значение |
|---|---|
| `gen:<script>` | создан скриптом, удаляется при перезапуске |
| `blockout:<zone>` | примитив блокаута зоны |
| `Rakis.Sun`, `Rakis.SkyLight`, `Rakis.PP.Global` | свет/пост для WeatherSubsystem |
| `Rakis.PlayerStart` | старт игрока (APlayerStart) |
| `Rakis.Companion.Ilva`, `Rakis.Companion.Rayn`, `Rakis.Companion.Ossana` | точки спавна спутников |
| `Rakis.Worm.Spawn`, `Rakis.Worm.Reveal` | точка покоя червя, точка выхода для кат-сцены (80 м от тропы) |
| `Rakis.CrowdSpawn`, `Rakis.CrowdSpawn.<Archetype>` | точки толпы |
| `Rakis.HallGather` | точки сбора к ритуалу (B5) |
| `Rakis.Story` | StoryDirector |
| `Rakis.SmartObject.<Type>` | Loom, Stall, WaterJar, PrayerMat, Bench, Niche, StillsuitRepair |
| `Rakis.POI.<LoreID>` | ARakisInspectable |
| `Rakis.Glowglobe` | светошар (PointLight + меш), мерцание через Light Function |

### 2.5 Ассеты (пути фиксированы)
**MPC** `/Game/Rakis/Materials/Functions/MPC_RakisWeather` — скаляры: `WindSpeed`, `StormIntensity`, `DustDensity`, `HeatHaze`, `TimeOfDay01`, `WormThreat01`, `Interior01`; векторы: `WindDirection`, `SunDirection`, `SandTint`, `PlayerPosition`.

**Материалы** `/Game/Rakis/Materials/Master/`: `M_Landscape_Sand`, `M_Rock_Master`, `M_Sietch_Stone`, `M_Cloth_Worn`, `M_Worm_Chitin`, `M_Worm_Teeth`, `M_Glowglobe`, `M_Water_Still`, `M_Decal_Carving`, `M_Decal_Paint`, `M_Spice_Fabric`; пост: `/Game/Rakis/Materials/PostProcess/M_PP_HeatHaze`, `M_PP_ScreenDust`; инстансы — `/Game/Rakis/Materials/Instances/MI_*`. Блокаут-материал `/Game/Rakis/Materials/Instances/MI_Blockout_Sand|Rock|Stone`.

**Niagara** `/Game/Rakis/FX/`: `NS_Sand_Drift`, `NS_Sand_DustDevil`, `NS_Sandstorm_Wall`, `NS_Worm_SandWave`, `NS_Worm_RingSandfall`, `NS_Worm_Breach`, `NS_Footstep_Sand`, `NS_Thumper_Pulse`, `NS_Dust_LightShaft`, `NS_Spice_Haze`, `NS_Glowglobe_Motes`, `NS_SealDoor_Steam`, `NS_Rock_Hop`. Все читают User-параметры `User.WindDirection`, `User.WindSpeed`, `User.Intensity`.

**Меши** (Blender-генераторы → `Export/` → импорт `env_import.py`): `/Game/Rakis/Worm/SM_Worm_Segment`, `SM_Worm_Head`, `/Game/Rakis/Environment/Rock/SM_Rock_ShaitanClaw`, `/Game/Rakis/Environment/Sietch/SM_Sietch_*`, ландшафт из `Export/heightmap_desert_r16.png` (4033², 2×2 км играбельно + фон импосторы).

**Звук** `/Game/Rakis/Audio/MetaSounds/MS_Music_Adaptive`, `MS_Amb_Desert`, `MS_Amb_Sietch`, `MS_Worm_Approach`, `MS_Worm_Roar`, `MS_Footstep`, `MS_Thumper`, `MS_SealDoor`.

**Кинематика** `/Game/Rakis/Cinematics/LS_WormReveal`, `LS_HallFinale`.

**Данные** `/Game/Rakis/Data/DT_*` из CSV `Content/Rakis/Data/*.csv` (импорт `data_import.py`), DataAsset-ы `DA_WormTuning`, `DA_NoiseTuning`, `DA_HydrationTuning`.

Любой C++ код обязан переживать отсутствие ассета (null-check + `UE_LOG(LogRakis, Warning, ...)` один раз) — блокаут должен играться без арта.

### 2.6 Параметры механик (дефолты; источник — `docs/design/mechanics.md`)
| DataAsset | Поле | Дефолт |
|---|---|---|
| NoiseTuning | `WalkLoudness` / `RunLoudness` / `SandWalkLoudness` | 0.35 / 0.80 / 0.12 |
| | `RhythmPenalty` (множитель за регулярность) | 0.6 |
| | `SurfaceMultiplier` Sand/PackedSand/Rock/SietchStone | 1.0 / 1.4 / 0.0 / 0.0 |
| | `DecayPerSecond`, `RegularityWindow` (шагов) | 0.15, 6 |
| | `ThumperLoudness`, `ThumperInterval` (с) | 1.0, 1.6 |
| WormTuning | `HearingRadius` (см) | 120000 |
| | `ListenThreshold` / `ApproachThreshold` | 0.25 / 0.55 |
| | `ListenTime` / `PassTime` / `DormantCooldown` (с) | 6 / 14 / 45 |
| | `ApproachSpeed` / `SurfaceSpeed` (см/с) | 2500 / 1800 |
| | `Length` / `Diameter` / `SegmentCount` | 36000 / 4000 / 90 |
| | `SurfaceHeight` / `BurrowDepth` (см) | 5000 / 6000 |
| | `RockIsSafe`, `ThumperWeight` | true, 2.0 |
| HydrationTuning | `SunDrainPerMinute` / `ShadeRecoverPerMinute` | 0.06 / 0.02 |
| | `RunMultiplier` / `MaskSealedFactor` / `InteriorRecoverPerMinute` | 2.0 / 0.35 / 0.05 |

### 2.7 Порядок сборки демо (`build_demo.py`)
1. `data_import.py` — DataTable/DataAsset из CSV.
2. `mat_master_materials.py`, `mat_post_process.py` — MPC, мастер-материалы, инстансы, пост.
3. `env_import.py` — импорт мешей и heightmap из `Export/` (если есть).
4. `level_blockout_desert.py`, `level_blockout_sietch.py` — карты и геометрия.
5. `level_markup.py` — зоны, триггеры, точки, StoryDirector, NavMesh.
6. `light_setup.py` — солнце, атмосфера, туман, облака, пост, светошары.
7. `fx_niagara.py` — системы Niagara и их расстановка.
8. `env_dress_sietch.py`, `env_scatter_desert.py` — декор, PCG.
9. `char_crowd_variants.py`, `audio_setup.py` — толпа и звук.

### 2.8 Дополнения по итогам интеграции S1
- **Теги:** `Rakis.FX.Wind` (Niagara-акторы, ветер из WeatherSubsystem → `User.WindDirection/WindSpeed/Intensity`), `Rakis.FX.SandTrout|DustDevil|StormWall` (маркеры FX), `Rakis.GodRay` (луч зала B5, отдельный прожектор — не зависит от времени суток), `Rakis.Ellipsis.A2|A3` (точки «склейки» золотого пути), `Rakis.Thumper`, `Rakis.FalseRock`.
- **Имена типов делегатов** с префиксом `FRakisOn…` (во избежание коллизий UHT); имена членов и сигнатуры — как в §2.2.
- **Диалоги:** спикер `Lore` (надписи POI, показываются по центру); условия расширены: `SandWalk:Regular|Irregular`, `Surface:<ERakisSurface>`, `MoistureBelow:<x>`.
- **Ассеты сверх списка:** `M_Blockout`, `M_LF_GlowglobeFlicker`, `M_FX_Dust`, `NPC_RakisWeather`, `SM_Worm_MouthPetal`, `SM_Worm_Teeth`, `SM_Rock_FalseSlab`.
- **Погода:** канон — `WeatherPresets.csv` (освещённость солнца физическая; ослабление на рассвете делает Sky Atmosphere). Встроенные пресеты в C++ — только фоллбек.
- **Ритуал** запускается и StoryDirector, и автоматически при входе в B3/B4/B5 — `StartRitual()` идемпотентен.
