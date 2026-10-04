# Стандарты проекта

## Структура репозитория
```
Rakis/                      # корень UE-проекта (Rakis.uproject)
  Config/
  Content/Rakis/
    Maps/          L_Rakis_Desert, L_Rakis_Sietch, L_Rakis_Persistent
    Environment/   Desert/ Rock/ Sietch/ Props/
    Characters/    Heroes/ Riders/ Crowd/ Modular/
    Worm/
    Materials/     Master/ Instances/ Functions/
    FX/
    Animation/
    Audio/         Music/ Ambience/ SFX/ VO/ MetaSounds/
    Blueprints/
    Data/          *.csv → DataTable, DA_* DataAsset
    Cinematics/
  Source/Rakis/            C++ модуль (+ Shaders/)
  Tools/unreal_python/     скрипты редактора
  Tools/blender/           скрипты Blender
  Tools/houdini/           HDA и скрипты
  Tools/tts/               черновая озвучка
  docs/  orchestrator/  .claude/  .cursor/  .codex/
```

## Нейминг ассетов
| Тип | Префикс | Пример |
|---|---|---|
| Static Mesh | SM_ | SM_Sietch_Wall_4m_A |
| Skeletal Mesh | SK_ | SK_Worm_Giant |
| Material / Instance / Function | M_ / MI_ / MF_ | MI_Sand_Erg_Dry |
| Texture | T_ ; суффиксы _BC _N _ORM _H _M | T_Rock_Claw_BC |
| Niagara System | NS_ | NS_Worm_SandWave |
| Blueprint / Anim BP | BP_ / ABP_ | BP_Thumper |
| MetaSound | MS_ | MS_Worm_Approach |
| DataTable / DataAsset | DT_ / DA_ | DT_Dialogue_S1, DA_WormTuning |
| Level Sequence | LS_ | LS_WormReveal |
| StateTree | ST_ | ST_Worm, ST_Citizen |

## Бюджеты
| Объект | Треугольники | Текстуры | Примечание |
|---|---|---|---|
| Скала-доминанта | Nanite, 5–20 млн источник | 4K тайлинг + макро-маски | 2–3 уникальных маски |
| Модули сиетча | Nanite, 50–500k | 2K, trim sheets | сетка 50 см |
| Пропы | Nanite/классика 1–30k | 1–2K | |
| Герои | 60–100k | 4K (лицо, тело, одежда) | MetaHuman-база |
| Толпа | 20–40k, LOD до 3–5k | атласы 2K | модульная одежда |
| Червь | 300–500k + сплайн-деформация | 4K тайлинг хитина | 300–400 м длиной |
| Частицы (кадр) | ≤ 150k GPU-частиц | | |

Плотность текстур: 1024 px/м героические поверхности, 512 px/м фон. Кадр: 16,6 мс (60 fps), GPU ≤ 14 мс, RTX 3070/4060, 1440p, TSR/DLSS «Качество».

## Освещение и пост
- Lumen GI + отражения, Sky Atmosphere, Volumetric Clouds (почти ясно), Exponential Height Fog.
- Пустыня: экспозиция +1…+1.5 EV, лёгкий bloom, марево. Сиетч: объёмный туман, светошары — Point Light с мерцанием (Light Function), один «божественный» луч в зале.

## Git
- Git LFS для бинарников (`.gitattributes`). Ветки `task/<ID>`. Коммиты `<role>(<ID>): ...`.
- Для команды больше 2–3 человек рассмотрите Perforce/Diversion — UE лучше дружит с блокировками файлов.
