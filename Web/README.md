# Rakis: Heretics — браузерная версия (WebGL)

Играбельное демо, которое запускается **без установки Unreal и вообще без установки чего-либо**:
откройте `dist/rakis_demo.html` двойным щелчком (Chrome/Edge/Firefox, офлайн). Это тот же срез
(пустыня Ракиса → червь → сиетч «Табр-ан-Нур» → ритуал), те же данные (`Content/Rakis/Data/*.csv`)
и тот же минималистичный интерфейс, что в проекте UE5, но на Three.js.

```bash
cd Web
npm install
npm run build        # → dist/rakis_demo.html (один самодостаточный файл)
npm run dev          # локально: http://localhost:8080, пересборка при изменениях
npm test             # headless Chromium: прогон ключевых точек + скриншоты в dist/shots/
```
URL-параметры: `?q=low|med|high` (качество; без параметра — автоподбор по GPU/устройству), `&lang=RU|EN`, `&skip=1` (без титульного экрана),
`&at=P4|worm|A3|sietch|gallery|hall` (старт с точки), `&perf=1` (оверлей профайлера; то же — F3), `&drs=0` (выключить динамическое разрешение),
`&fps=55` (цель DRS), `&warm=0|1` (прогрев шейдеров на экране загрузки; по умолчанию вкл., в autotest выкл.).

## Управление
`WASD` — движение, `Shift` — бег, `Мышь` — взгляд (вид только от первого лица; руки видны лишь при взаимодействиях), `E/F` — действие, `T` — тампер, `M` — маска,
`C`/`Alt` — **походка по песку**, `Space` — **прыжок** в обычном режиме и **сбой ритма (stutter)** в режиме походки по песку, `ПКМ` — всегда stutter,
`F2` — погода, `F3` — профайлер. Геймпад: `A` — то же, что Space. Падать с уступов можно (урона нет, при приземлении — вмятина камеры,
лёгкий шум по песку); из сиетча можно выйти через щель по тропе вниз, а с верхних звеньев тропы — спрыгнуть в пустыню.

## Контракт модулей (для разработчиков)

Единицы — метры; оси three.js: X — восток, Z — юг, Y — вверх. Раскладка — `src/core/layout.js`.
Каждый модуль: `export function create(game)` → регистрирует объект через `game.add(name, obj)`.
У объекта могут быть `update(dt, t)`, `lateUpdate(dt, t)`, `alwaysUpdate: true` (работает и на паузе).
Порядок создания: world/weather → sietch → worm → player → companions → zones → dialogue → story → audio → ui.

### Ядро (`src/core`)
- `game` — `renderer, scene, camera, bus, input, settings{quality, lang, at, autotest}, data, time, dt, timeScale, paused, cinematic{active, owner}, lang, zone, space('desert'|'sietch'), t(ru,en), interactables[], shake, heightAt(x,z), surfaceAt(x,z), collide(pos,r), render()`.
- `bus` — события (ниже). `input` — `axis()`, `look{x,y}`, `held(a)`, `pressed(a)`, `device('kbm'|'pad')`, `requestLock()`, `locked`, `enabled`.
  Действия: Fwd/Back/Left/Right, Sprint, SandWalk, Stutter, Jump, Interact, Thumper, Pause, PhotoMode, Mask, Confirm, Skip.
  Escape при захваченном курсоре браузер не отдаёт — пауза открывается по событию потери pointer lock.
- `makeFigure(opts)` (`core/figures.js`) — фигура в одежде пустыни с анимацией ходьбы; `PALETTES` архетипов.
- `util.js` — `clamp, lerp, damp, smoothstep, rng(seed), noise2, fbm2`.

### Модули
| Модуль | Файлы | Объект | API |
|---|---|---|---|
| Пустыня, погода, пост | `src/desert/**` | `game.world`, `game.weather`, `game.post` | world: `heightAt, normalAt, surfaceAt('sand'|'packed'|'rock'), collide, isSafe, shadeAt(x,z)→0..1, addFootprint(x,z,yaw,{type:'foot'|'worm'|'crater'|'thumper', size}), setVisible(b), sunDir`; weather: `request(id, blendSec), current, hours, windDir(Vector3), windSpeed, storm, dust, haze` |
| Червь | `src/worm/**` | `game.worm` | `state, threat 0..1, headPos, playReveal()→Promise, forceSurface(x,z), setSensing(b)` |
| Игрок, спутники | `src/player/**` | `game.player`, `game.companions` | player: `position(ступни), yaw, velocity, figure, noise, sandWalking, regularity, intervals[], moisture, inShade, maskSealed, firstPerson, thumperCharges, focus{label,tag}|null, teleport(x,y,z,yaw), setInputLocked(b)`; companions: `list[{id, figure, position}], teleportBehind(), speakerPos(id)→Vector3|null, setFollow(b)` |
| Сиетч, толпа | `src/sietch/**` | `game.sietch` | `enter()→Promise, heightAt, surfaceAt, collide, zoneAt(pos), startRitual(), playFinale()→Promise, speakerPos(id)` |
| Диалоги, сюжет, звук, UI | `src/story/**`, `src/audio/**`, `src/ui/**` | `game.dialogue`, `game.story`, `game.audio`, `game.ui`, `game.debug` | dialogue: `play(id)→Promise, bark(arch, ctx, pos), lore(id), isBusy`; story: `fire(trigger)`; audio: `event(id, pos?), setMusic(state)`; ui: `fade(toBlack, sec)→Promise, titleCard(text), hint(text), letterbox(b) (только явный вызов), endCard()`; debug: `goto(name)` (`start, erg, P4, worm, A3, trail, cleft, sietch, market, hall, garden, finale, end`), `devour()` (сценарий «червь пожирает харвестер») |

### Производительность и устойчивость (core)
- Игровой цикл (`core/game.js`): `dt` ограничен 50 мс; `game.simulate(sec, dt, onTick)` — симуляция без рендера (боты/тесты); `colliders.tick()` раз в кадр.
- `core/perf.js` — профайлер (оверлей F3/`?perf=1`): CPU мс на модуль (update+lateUpdate), render(cpu), draw calls/треугольники/программы/текстуры
  (`renderer.info`, сбрасывается раз в кадр — композер рисует несколько проходов), куча JS, GPU-время (если есть `EXT_disjoint_timer_query`), график кадра.
  `game.perf.snapshot()` — усреднённые значения для `tools/perf_probe.mjs` (`node tools/perf_probe.mjs --q=low,med`, отчёт `dist/perf/report.json`).
- `core/quality.js` — автопресет и динамическое разрешение (DRS): `game.drs.level/scale`, `game.setRenderScale(s)`; `core/shadows.js` — троттлинг теней солнца при просадке.
- `core/colliders.js` — равномерная сетка (ячейка 12 м) + покрытие с запасом 2 м: `push/near/overlaps/segmentBlocked` не перебирают все тела; тест `node tools/colliders_test.mjs`.
- `desert/field.js: heightAtCached` — кэш высоты основы (узлы 0.25 м, билинейно; погрешность ≤ 8 см на гребнях дюн) для всей игровой логики (`world.heightAt`).
- Игрок: физика с фиксированным шагом 60 Гц (`CFG.phys`), отрисовка и камера по интерполированной `player.renderPos`; на земле — слежение за рельефом без запаздывания
  на склонах, сход с уступа > `CFG.jump.snapDown` → свободное падение (`CFG.jump`: гравитация, койот-время, буфер прыжка); события шины `jump`, `land {impact}`.
- `core/reconcile.js` — после загрузки убирает валуны пустыни, перегородившие тропу подхода.
- Прогрев шейдеров (`main.js: warmup`): состояния «как есть» / «всё видимо» / сочетания огней харвестера и сиетча / «глубоко в сиетче» — число видимых источников света входит в ключ
  программы, переключение посреди игры перекомпилировало все материалы (подвисания). `?warm=0` отключает (в `autotest=1` выключен по умолчанию).
- Инструменты: `tools/perf_probe.mjs` (рендер, SwiftShader: draw/tris/programs/CPU render; `--prof=1` — топ функций), `tools/perf_cpu.mjs` (чистое время JS-логики по модулям без рендера, до/после на любой сборке),
  `tools/perf_report.mjs` (сводка → `dist/perf/report.json`), `tools/route_free.mjs` (плавность, прыжок, сиетч↔пустыня↔тропа, спрыгнуть с уступа; без рендера через `game.simulate`),
  `tools/colliders_test.mjs`/`colliders_bench.mjs`, `tools/drs_test.mjs`, `tools/npc_smooth.mjs`, `tools/dbg_lights.mjs` (кто владеет источниками света).

### События `bus`
`boot`, `start` (игра началась после титула), `zone {from,to}`, `footstep {x,z,yaw,surface,actor}`, `noise {x,z,loudness,source}`,
`stutter`, `sandwalk {on}`, `interact {tag}`, `worm:state {from,to}`, `worm:breach {x,z}`, `thumper {x,z}`,
`subtitle {speaker,name,text,duration,kind}`, `line:end {id}`, `chain:end {id}`, `cinematic {active,id}`,
`weather {id}`, `music {state}`, `ritual`, `space {space}`, `pause {paused}`, `photo {active}`, `end`, `jump {x,z}`, `land {x,y,z,impact,surface}`.

### Сюжет в реальном времени (story/ui/audio)
- Нет склеек времени («N часов спустя») и кат-сцен с отнятым управлением. `PlayCinematic` в StoryBeats лишь вызывает `worm.playReveal()` / `sietch.playFinale()` и ждёт Promise; `game.cinematic` директор не трогает. Действие `Ellipsis` из старых таблиц игнорируется.
- Виртуальные зоны сюжета: `A4_Crevice` (подножие тропы) → `A5_Trail` (подъём) → `A6_Cleft` (щель-вход) → `B1…B5` → `C1_Garden` (выходной сад). Берутся из `game.approach.zoneAt(pos)` / `game.garden.zoneAt` (bus `zone`), при их отсутствии — по геометрии `ENTRY`/`GARDEN` из layout.
- Меню паузы → «Сценарии / Scenarios»: «Червь пожирает харвестер» (`game.debug.devour()`: заводит `game.harvester`, затем `game.worm.playDevour()`), быстрые переходы Start / Erg / Trail / Cleft / Market / Hall / Garden через `debug.goto`.
- Звук: сад (`bus 'garden:enter'|'garden:leave'` или зона `C1_Garden`) — птицы, насекомые, ручей; интерьер/улица смешиваются плавно по `game.space` и расстоянию до проёмов (`ENTRY.cleft`, `GARDEN.portal`, либо `game.sietch.openings[{x,y,z,kind}]`); поедание харвестера — bus `worm:devour {phase, x?, z?, duration?}`, фазы распознаются по ключевым словам: rumble/wormsign/approach → рокот; klaxon/alarm → клаксон; carryall/lift/strain → переносчик; swallow/devour/strike/breach → рёв и скрежет; debris/collapse/aftermath → обломки; end/done → музыка к `DesertDrone`.
