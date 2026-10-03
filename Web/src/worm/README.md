# Шай-Хулуд (`src/worm/**`)

Модуль `game.worm` (создаётся после sietch, до player). Длина 360 м, Ø 40 м, 90 колец по 4 м.
Два режима: **дикий** червь (слух, не смертельный) и **укрощённый** червь сцены «Встреча» (наездники, Оссана).

| Файл | Что делает |
|---|---|
| `index.js` | Дикий червь: Dormant → Listening → Approach → Pass; сценарное `Ridden`; слух, кинематика головы, API, шкала качества |
| `encounter.js` | Сцена «Встреча»: маршрут, камера (только прибытие/отход), Оссана (спуск по канату, ходьба, диалог), крючья, события |
| `path.js` | Маршрут по поверхности: подход → «великая дуга» (спираль вокруг группы) → отход, пересэмплирован по 1 м |
| `spine.js` | История пути головы → 91 точка тела, параллельный перенос нормали, подъём головы, дыхание, текстура-позвоночник |
| `shaders.js` | Хитин/плоть/зубы (`MeshStandardMaterial` + `onBeforeCompile`), защита от NaN, `guardPostHaze` |
| `body.js` | Труба (шкала качества low/med/high), голова: 3 лепестка со складками губ, зубы-гребёнка у швов, глотка со свечением пряности |
| `gear.js` | Крючья творца в швах колец, канаты, сёдла, лестница-канат; фигуры наездников (`makeFigure`) |
| `fx.js` | Пул частиц, песчаная «юбка» по линии контакта, носовая волна, шлейф, холм-волна дикого червя, тень-лента |

## API (`game.worm`)
- `state`: `Dormant | Listening | Approach | Pass | Ridden` (`Surface` больше не используется — дикий червь не всплывает). `threat` 0..1, `headPos`, `noise`, `exposed`, `tamed`.
- `playReveal()` ≡ `playEncounter()` → `Promise<{skipped}>`: выполняется, когда сцена закончилась и червь ушёл (`'gone'`). Сам вызывает `dialogue.play('DLG_A2_RIDER_01')`
  когда Оссана остановилась в 4 м от игрока; цепочка заканчивается — Оссана поднимается, отход начинается только после `chain end`.
- `forceSurface(x?, z?)` — далёкая песчаная волна идёт к группе (state `Ridden`), подходит не ближе ~260 м и отворачивает, если `playReveal()` не вызван (~24 с).
- `setSensing(b)`, `foreshadow()`, `speakerPos('Ossana'|'Rider1'|'Rider2')` → Vector3 | null, `distanceToPlayer()`, `ossanaLanding`.
- `setQuality('low'|'med'|'high')`, `autoQuality` (понижает по FPS, когда червь на экране), `look` — uniform-ы шейдеров (`uBump`, `uDust`, `uSandAmt`, `uRim`, `uSubs`, `uCrust`, `uGlow`).
- Шина: `worm:encounter {phase: arrive|stop|dismount|talk|mount|depart|gone}` (+ `stir` на реплике `DLG_A2_RIDER_09`), `cinematic {active,id:'WormReveal'}`
  (только на прибытии и отходе; во время разговора `game.cinematic.active=false`), `worm:state`, `worm:breach {x,z}` (далёкое всплытие в начале), `worm:reveal {phase: start|erupt|dive|end}`.
- Синхронизация по `bus 'subtitle' {id}`: `DLG_A2_RIDER_09` — червь шевелится; `DLG_A2_RIDER_10` — Оссана уходит на ходу.
- Любой путь выхода (конец, пропуск `Skip`, отмена) безусловно возвращает `cinematic.active=false`, `ui.letterbox(false)` и событие `cinematic {active:false}`.
- Игрок не может пройти сквозь тело (на время сцены оборачивается `game.world.collide`). Если игрок дальше 40 м от места спуска — Оссана ждёт и зовёт (bark-субтитр).
- Необязательные внешние вызовы (через `?.`): `world.addFootprint`, `audio.event('Worm.Breach'|'Worm.Pass'|'Worm.RingSandfall', pos)`, `ui.letterbox`, `ui.hint`.

## Причина «чёрного экрана» и защита (подробно — в отчёте задачи)
HDR-буфер — полу-float, `UnrealBloomPass` размазывает **один** NaN-пиксель на весь кадр. Источники NaN в старых шейдерах: `pow(1-abs(dot(n,v)), 2.2)` на зубах
(на реальном GPU аргумент бывает −1e-7), `normalize(0)` (нулевые нормали кончика лепестка/хвоста), производные внутри `if(gl_FrontFacing)` и после `discard`.
Теперь: `wnrm/wpow/wss`, проверка NaN/Inf по битам на выходе фрагмента, `guardPostHaze` (санитайзер в шейдере марева), безопасные нормали, начальная поза позвоночника.

## Тесты
- `node tools/build.mjs --out=worm.html && node tools/worm_encounter_shots.mjs [--gl=swiftshader|egl|default]` — вся сцена шагами 1/30 с, снимки, средняя яркость, поиск NaN в HDR-буфере.
- `node tools/worm_look.mjs --views=aerial,hero,head,rings,ossana` — быстрый осмотр вида. `node tools/worm_probe.mjs` — NaN-проба на позах.
