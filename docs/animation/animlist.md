# Анимационный список и риг червя

Задача T-013. Скелет — MetaHuman (`metahuman_base_skel`); импорт — `Tools/unreal_python/anim_import.py` из `Export/anim/<Set>/` в `/Game/Rakis/Animation/<Set>/A_*`. 30 fps, root motion — только где указано (RM). Приоритеты: **P0** — без этого срез не играется; **P1** — нужно для «золотого пути»; **P2** — полировка/жизнь.

## 1. Локомоция игрока (Kair) — Motion Matching
Пул для Pose Search Database `PSD_Kair_Locomotion`; ABP `ABP_Kair` (Motion Matching + слой рук + FP-руки).
| Ассет | Описание | Длит. | Приор. |
|---|---|---|---|
| `A_Loco_Idle_Desert` | стоит, вес переносится, прищур от солнца | 6 с loop | P0 |
| `A_Loco_Walk_Fwd/Left/Right/Back` | ходьба 140 см/с, песок (стопа чуть утопает) | loops | P0 |
| `A_Loco_Run_Fwd` + повороты | бег 420 см/с, корпус вперёд | loops | P0 |
| `A_Loco_Walk_Starts/Stops` (8 напр.) | старты/остановки | 0.6–1 с | P1 |
| `A_Loco_Walk_Slope_Up/Down` | подъём/спуск по дюне, стопы проскальзывают | loops | P1 |
| `A_Loco_Rock_Walk` | по камню: шаг увереннее, без проскальзывания | loop | P1 |
| `A_Loco_Interior_Walk` | сиетч: медленнее, плечи расслаблены | loop | P1 |
| `A_Loco_Crouch_Freeze` | «замри»: присед, ладонь на песке (Listening) | 1 с in + loop | P0 |
| `A_Loco_Knockdown_Sand` | сбит ударной волной, подъём | 3.5 с RM | P1 |

## 2. Походка по песку (SandWalk) — ключевая механика
Цель: **неравномерность видна в анимации**, а не только в звуке. Пул `PSD_Kair_SandWalk` с тегом `SandWalk`, переключается при `IsSandWalking()`.
| Ассет | Описание | Приор. |
|---|---|---|
| `A_SandWalk_Long` | длинный скользящий шаг, стопа ставится с носка плашмя, вес мягко | P0 |
| `A_SandWalk_Short` | короткий подшаг, почти шарканье | P0 |
| `A_SandWalk_Pause` | замирание на полшага, опора на заднюю ногу, 0.3–0.8 с | P0 |
| `A_SandWalk_Drag` | протянуть стопу по песку (без удара) | P1 |
| `A_SandWalk_Stutter_L/R` | **stutter step**: сбой — нога зависает, переносится, ставится не туда; корпус компенсирует | P0 |
| `A_SandWalk_Turn_45/90` | поворот без ритма | P1 |
Правило: в сэмплах мокапа **нет двух одинаковых интервалов подряд** (см. mocap_brief). AnimNotify `Footstep` (левая/правая) на касании → `ARakisCharacter::OnFootstep(bLeft)`; у `Pause` нотифая нет. Отдельный notify `SandStep_Soft` для звука `Foot.SandWalk`.

## 3. Спутники
| Ассет | Кто | Приор. |
|---|---|---|
| `A_Comp_Follow_SandWalk` (свой набор, тот же принцип) | Ilva, Rayn, Ossana | P0 |
| `A_Ilva_Observe_Idle` (руки в рукавах, голова чуть наклонена) | Ilva | P1 |
| `A_Ilva_TouchShoulder` (поправляет Рэйна, бит 1.2) | Ilva | P1 |
| `A_Rayn_Walk_Metronome` (ровный «неправильный» шаг для бита 1.2) | Rayn | P0 |
| `A_Rayn_Tremble_Freeze` (дрожь при Listening/Approach) | Rayn | P1 |
| `A_Rayn_LookAround_Nervous` | Rayn | P2 |
| `A_Ossana_Walk_Lead` (широкий уверенный шаг впереди) | Ossana | P1 |
| `A_Comp_LookAt_Worm` (аддитив, голова/корпус) | все | P1 |
| `A_Guard_CheckSeal` (страж щупает горловину) + `A_Rayn_CheckSeal_React` | Guard, Rayn | P1 |

## 4. Ремёсла и быт (толпа, Smart Objects)
| Ассет | Smart Object | Описание | Приор. |
|---|---|---|---|
| `A_Craft_Weave_Loop` / `_Enter` / `_Exit` | Loom | бёрдо, перекидывание челнока, подтяжка | P1 |
| `A_Craft_Weave_PassThread` (пара) | Loom | одна подаёт синюю нить другой | P2 |
| `A_Craft_StillsuitRepair_Blow` / `_Stitch` / `_FitPump` | StillsuitRepair | продуть трубку, шов шилом, вставить насос в пятку | P1 |
| `A_Craft_WaterMeasure` | WaterJar | латунной меркой, капля за каплей, шёпот-счёт (лицо) | P0 |
| `A_Carry_Jar_Walk` / `_Yoke_Walk` | — | ходьба с кувшином/коромыслом | P1 |
| `A_Trade_Haggle_A/B` (пара) | Stall | торг жестами, счёт на пальцах | P1 |
| `A_Sit_Bench_Idle` / `_Talk` / `_Coffee3Sips` | Bench | сидеть, разговор, ритуал трёх глотков | P1 |
| `A_Niche_Lean_Guard` | Niche | страж в нише, рука на рукояти | P1 |
| `A_Rider_SharpenHook` / `A_Rider_FlexShaft` | Bench | точить наконечник, проверять древко | P2 |
| `A_Child_WormGame_Worm` / `_Rider` / `_Thumper` | Bench (точка) | дети: «червь» ползёт под покрывалом, «наездник» цепляется палками, «тампер» бьёт ладонями | P1 |
| `A_Child_Run_Irregular` | — | бег вприпрыжку без ритма | P1 |
| `A_Elder_TeachRhythm` + `A_Teen_LearnRhythm` | Bench | старик отбивает посохом сбитый ритм, подросток повторяет | P2 |
| `A_Crowd_Quarrel_A/B/C` | Stall | ссора о десятине: жесты, обрыв на полуслове | P2 |
| `A_Crowd_Mourn_Idle` | Niche | стоять у задёрнутой занавеси, держа флягу (похоронная сценка) | P2 |
| `A_Crowd_Hush_Turn` (аддитив) | — | замолчать, оглянуться на игрока | P1 |
| `A_Crowd_StepAside_L/R` | — | уступить дорогу | P1 |

## 5. Молитва и ритуал
| Ассет | Описание | Приор. |
|---|---|---|
| `A_Prayer_Kneel_Enter/Loop/Exit` | PrayerMat: на колени, ладони на песок/камень | P1 |
| `A_Prayer_Whisper_Loop` | паломник у ниши Шианы, шёпот, раскачивание | P2 |
| `A_Ritual_Crowd_Sway` (3 вариации, оффсет фаз) | толпа на ярусах раскачивается под «ру…» | P1 |
| `A_Ritual_Walk_ToHall` | неспешный ход к залу | P1 |
| `A_Priestess_Sing_Loop` + `_Gesture_Open/Divide/Lower` | жрица: жесты по строкам песни (P01–P05) | P0 |
| `A_Ritual_SandBowl_Dance` | **«танец» в чаше**: неритмичные шаги, повороты, пятки взметают песок; 60 с без повторяющихся фраз (сборка из 8 клипов в случайном порядке через `Random Sequence Player`, интервалы 0.3–1.4 с) | P0 |
| `A_Harmat_Turn_Judgement` | наиб медленно оборачивается (финал, мокап лица) | P0 |

## 6. Кат-сцена `LS_WormReveal` — спуск наездника
| Ассет | Описание | Приор. |
|---|---|---|
| `A_Rider_OnWorm_Idle` | стоять на кольце, крюки вбиты, баланс по волне тела (аддитив от кривизны) | P0 |
| `A_Rider_Descend_HookSwap` | перецепить крюк с кольца на кольцо ниже: вырвать правый, ударить ниже, перенести вес, левый — повтор (цикл 1.6 с) | P0 |
| `A_Rider_Descend_Slide` | съехать по боку, тормозя крюком (искры песка) | P0 |
| `A_Rider_Jump_Land_Roll` | прыжок 6 м на песок, перекат, встать, **не оглядываться** | P0 |
| `A_Rider_StowHooks` | убрать крюки за спину крест-накрест | P1 |
Требование: руки и крюки — IK к сокетам колец `Ring_##_Hook` на `SK_Worm_Giant`/ISM (см. §7), стопы — IK к поверхности кольца.

## 7. Червь — сплайновый Control Rig `CR_Worm_Spline`
Совместим с C++ `ARakisWorm` (контракт §2.2): тело — `USplineComponent` + `UInstancedStaticMeshComponent` колец `SM_Worm_Segment`, голова `SM_Worm_Head`. Для кат-сцены — скелетная версия `SK_Worm_Giant` с тем же Control Rig.

### 7.1 Структура
| Элемент | Значение |
|---|---|
| Длина | `Length` = 36000 см |
| Диаметр | `Diameter` = 4000 см (сужение к хвосту до 55 %) |
| Сегменты | `SegmentCount` = 90 колец по 400 см; кость `Ring_00` (голова) … `Ring_89` |
| Голова | кость `Head` + 3 кости лепестков `Petal_A/B/C` (по 120°) + `Teeth_Ring_01..03` (вращаемые кольца зубов) |
| Сплайн-контролы | 12 контролов `Spline_CTRL_00..11` (каждые ~33 м), Fit Chain on Curve |
| Сокеты | `Ring_##_Hook` (по 2 на кольцо 10–40 — места крючьев наездников) |

### 7.2 Слои рига (порядок вычисления)
1. **Путь** — кривая из геймплея: C++ пишет точки `USplineComponent` → в рантайме ISM-кольца ставятся по сплайну (без Control Rig, дёшево). Для SK — `Spline From Points` из тех же точек.
2. **Undulation** (волна): синусоида по длине, `Amplitude = UndulationAmp × Diameter`, `λ = 0.33 × Length`, фаза += `UndulationSpeed × dt`; затухает к голове (20 %) и максимальна в середине.
3. **Ring breathing**: каждое кольцо масштабируется 1.0…1.03 со сдвигом фазы — «дыхание» колец, песок осыпается с раскрытых стыков.
4. **Mouth**: `MouthOpen01` → лепестки поворачиваются 0…68° наружу (ease-in-out), кольца зубов вращаются навстречу друг другу ±12° при открытии, внутренняя глотка — эмиссив `M_Worm_Teeth` (тускло-оранжевый) 0…0.4.
5. **Head look**: голова поворачивается к `LookTarget` (камера/игрок) с ограничением 25°, лаг 0.6 с.
6. **Ground contact**: кольца ниже `SandLevel` — скрываются ISM-ом (или клип-маской материала), над песком — `NS_Worm_RingSandfall` по сокетам.

### 7.3 Параметры (переменные Control Rig = параметры для C++/Sequencer)
| Параметр | Тип | Диапазон | Кто пишет |
|---|---|---|---|
| `MouthOpen01` | float | 0..1 | `ARakisWorm` (Surface: 0 → 1 за 2.5 с), Sequencer |
| `UndulationAmp` | float | 0..0.6 | C++ по состоянию: Approach 0.15, Surface 0.35, Ridden 0.2 |
| `UndulationSpeed` | float | 0..2 рад/с | C++: скорость/400 |
| `Threat01` | float | 0..1 | `GetThreat01()` → дрожь колец (шум 0.5 см) |
| `SandLevel` | float | см (Z) | высота песка под головой |
| `LookTarget` | vector | мир | Sequencer / C++ |
| `RingBreath` | float | 0..1 | константа 0.5, в Sequencer до 1 |

Соответствие C++ (`URakisWormTuning`): `UndulationAmp` ↔ `UndulationAmplitude` (см, дефолт 350), длина волны λ ↔ `UndulationWavelength` (9000 см), `UndulationSpeed` ↔ `UndulationFrequency` (0.12 Гц); `MouthOpen01` — `ARakisWorm::MouthOpen01`. Риг читает значения C++, имена в таблице выше — переменные Control Rig.

### 7.4 Анимации червя (Sequencer/риг, не мокап)
| Ассет | Описание | Приор. |
|---|---|---|
| `A_Worm_Breach` | выход из песка: голова вверх до 50 м за 4 с, затем дуга | P0 |
| `A_Worm_MouthOpen` | лепестки 0 → 1 за 2.5 с, «вдох» колец | P0 |
| `A_Worm_Roar` | пасть открыта, голова дрожит, кольца зубов вращаются | P0 |
| `A_Worm_Dive` | уход по дуге под песок | P0 |
| `A_Worm_RidePass` | медленная дуга с наездниками (для кат-сцены) | P1 |

## 8. Лицевая анимация
Липсинк — по черновой TTS (`Tools/tts/tts_batch.py`) через MetaHuman Animator/Audio-driven для всех строк `Dialogue_S1` (кроме `Crowd`/`Lore`); финальные крупные планы (Хармат, Оссана, жрица) — лицевой мокап.

## 9. Сводка по приоритетам
P0: 26 ассетов (локомоция базовая, SandWalk, червь, спуск наездника, жрица, танец, Хармат, водоноска). P1: ~40. P2: ~15.
