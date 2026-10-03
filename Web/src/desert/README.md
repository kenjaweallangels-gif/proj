# Пустыня Ракиса (`Web/src/desert`)

`index.js` → `create(game)` регистрирует `game.world`, `game.weather`, `game.post` (+ служебный модуль `desertRoot`).

| Файл | Что |
|---|---|
| `field.js` | Аналитическое поле высот (детерминированное, без THREE): дюны вдоль `WIND_DIR`, гряда A1 (~36 м), «пан» вокруг золотого пути, подъём к скале, острова, плиты A3, SDF скалы/расщелины/«плавников», маски `rock`/`packed`. |
| `terrain.js` | Тороидальный клипмап, 7 колец (шаг 1…64 м, ±80 м…±5 км), высоты/нормали/маски — в `DataTexture` (RGBA32F), геоморфинг к более грубому кольцу, пески — `MeshStandardMaterial` + `onBeforeCompile` (рябь 3 масштаба, зерно, искры, макро-вариация, склоны, следы, туман). |
| `footprints.js` | Следы: окно 64 м, RT 1024² (R — глубина, G — вал), штампы инстансами, заживление/сдвиг ping-pong. |
| `rock.js`, `rockMaterial.js` | «Коготь Шайтана» (процедурный меш по осям из `layout.js`), «плавники» расщелины A4, фальшивая дверь с меткой крюка; шейдер страт/эрозии/песка на уступах. |
| `dressing.js` | Валуны/галька (InstancedMesh), остов харвестера, рёбра червя, стойка тамперов. |
| `sky.js`, `weather.js` | Небо (сумерки по высоте солнца, звёзды + Млечный Путь, две луны с фазами, кучевые/пылевые и перистые облака), ключевой свет (солнце днём, луна ночью), полусфера, тени (привязка к текселям, окно растёт при низком солнце), пресеты и API погоды/времени, экспозиция. |
| `fx.js` | Позёмка по гребням, пылинки (лунная пыль ночью), пыльные вихри, стена бури (кольцо, надвигается), песок бури, летящий мимо камеры, пул клубов пыли `world.puff`. |
| `post.js` | EffectComposer: Render → санитайзер NaN/Inf + марево + лучи света (god rays) → bloom → грейд (ночь/буря/пыль/блики на линзе/зерно) → Output. |
| `env.js` | Общие uniform-ы (`ENV`), GLSL-шум, туман, тень Когтя, `patchMaterial`. |

## API
- `world.heightAt(x,z)`, `normalAt(x,z[,out])`, `surfaceAt(x,z)` → `'sand'|'packed'|'rock'`, `isSafe(x,z)`, `collide(pos,r)` (скала, расщелина, «плавники», валуны, харвестер, рёбра), `shadeAt(x,z)` 0..1 (тень Когтя; расщелина ≈ 0.12), `sunDir`, `setVisible(b)`.
- `world.addFootprint(x, z, yaw, {type:'foot'|'worm'|'crater'|'thumper', size, depth})`. `yaw` — направление движения `(sin yaw, cos yaw)` в (x, z) (поворот `rotation.y` three.js). Дубли отсекаются (шаг ближе 0.35 м за 0.4 с, кратер/тампер — 3 м за 1.5 с). Размер `size` — полуразмер штампа, м (стопа 0.17, червь 15, кратер 26, тампер 4).
- Автоматически слушает шину: `footstep` (следы + пыль), `thumper`, `worm:breach` (кратер/клубы), `space` (скрытие пустыни при `sietch`), `resize`.
- `world.puff(x,y,z,{count,size,life,speed,spread,alpha,up,grow})` — клубы пыли (пул 160).
- Погода и время — раздел «API погоды и времени» ниже.
- `world.flattenZone` = `{x:330, z:-60, radius:70, blend:80, level:5.4}` — плоская площадка под харвестер (`heightAt` там ≈ `level` ± 0.12 м, дюн нет, песок «плотный»); выше `level` над плоскостью — рельеф 0.
- `post.composer`, `post.haze/bloom/grade` (pass-ы), `post.dust`.

## Настройка (без хардкода в коде игры)
Цвета песка — `terrain.sandU` (`uSandLoose/Packed/Dist`), цвета породы — uniform-ы материала скалы, экспозиция — `weather.state.exposure`/`world.exposureTrim`, всё остальное идёт из `WeatherPresets.csv`.
Качество: `low` — без теней/MSAA/марева/bloom/искр/ряби 12 см; `med` — тень 2048, MSAA×4, bloom, 2600 частиц позёмки, 2 вихря; `high` — тень 4096, 6500 частиц, 3 вихря.

## Солнце
Высота — по формуле `docs/tech-art/lighting_weather.md` §3; азимут (от +X к +Z) — по часам: 6.67 ч → −47°, 8.5 ч → 20° (`SUN_AZIMUTH_DEG`), 11.5 ч → 56°, 17.5 ч → 188°. Солнце в рассвет — с северо-востока: скала не перекрывает его со старта.


## API погоды и времени (`game.weather`)
Модуль работает и при `game.paused` (меню): изменения видны сразу. Время суток 0..24 ч, формула высоты солнца из `docs/tech-art/lighting_weather.md` §3 (до полудня 15°/ч, после — 13.5°/ч): восход ≈ 5:40, закат ≈ 19:05, ночь 20:20–04:30. Две луны Ракиса (большая и малая) идут по своим суточным дугам, фазы меняются по суткам (`day`) либо задаются вручную.

```js
weather.presets(opts?)         // → [{id, RU, EN, kind:'time'|'weather'|'story', hours|null}]; без opts — список для меню; {all:true} — все, включая сюжетные
weather.request(id, blendSec = 6, {keepTime?})  // плавный переход к пресету; пресеты kind:'time' (и CSV с часами ≥ 0) сдвигают время, keepTime:true — не трогать часы
weather.setHours(h, instant = true, durSec = 3)  // 0..24; instant=false — плавно по кратчайшей дуге за durSec
weather.getHours()             // текущее время, 0..24 (то же в weather.hours; weather.day — счётчик суток)
weather.setTimeScale(v)        // игровых СЕКУНД за реальную: 0 — стоп (по умолчанию), 60 — сутки за 24 мин, 3600 — час в секунду. Свойство weather.timeScale читается/пишется напрямую
weather.setOverride({wind, storm, dust, haze, clouds, fog}, blendSec = 3)  // частичные переопределения 0..1 (ключ: null → снять); wind — м/с (0..40), остальные 0..1; fog 0..1 → видимость от ≈ 8 км до ≈ 100 м
weather.clearOverride(keys?, blendSec = 3)         // снять все или перечисленные ключи (массив)
weather.getOverride()          // → {ключ: значение} только активные
weather.setMoonPhase(a, b)     // 0 новая … 0.5 полная … 1; null — вернуть автоход; weather.moons[i] = {phase, lit, elev, dir}
weather.snapshot()             // → {id, hours, timeScale, phase:'night'|'dawn'|'day'|'dusk', isNight, sandstorm, storm, dust, wind, windBase, clouds, haze, fog, override, sunElev, moons:[{id,phase,lit,elev}]}
weather.snap()                 // мгновенно применить всё (экспозиция без адаптации)
```
Пресеты для меню (порядок): `Dawn_Ridge` Рассвет на гребне, `Morning_Erg` Утро в эрге, `Clear_Noon` Ясный полдень, `Haze_Noon` Знойное марево, `Noon_Approach` Жёсткий полдень, `Dusk_Gold` Золотой закат, `Twilight_Violet` Фиолетовые сумерки, `Night_Clear` Ясная ночь, `Storm_Horizon` Буря на горизонте, `Sandstorm_Full` Песчаная буря (время не меняет), `Overcast_Dust` Пыльная мгла, `Calm_Still` Штиль. Сюжетные (`Worm_Tension`, `Worm_Reveal`, `Crevice_Shade`, `Sietch_Interior`, `Hall_Ritual`) — только `presets({all:true})`.

Шина: `bus.on('weather', e)`, `e = {type, ...snapshot}`; `type`: `preset` | `hours` | `override` | `timeScale` | `moons` | `phase` (смена night/dawn/day/dusk) | `sandstorm:start` / `sandstorm:end` (storm пересёк 0.7 — звуковые хуки: вой ветра, шорох, приглушение музыки). Во время хода суток событий `hours` нет (читайте `weather.hours`).

Читаемые поля: `hours, day, windDir, windSpeed (с порывами), windBase, storm, dust, haze, clouds, fog, exposure, sunElev, isNight, phase, sandstorm, moons`. Экспозиция адаптируется сама (ночью выше, в бурю ниже).

## Ночь, луны, буря, защита от «чёрного кадра»
- Ключевой свет `ENV.uKeyDir/uKeyColor` и `world.sunDir` — солнце днём, ночью — более яркая луна (мягкие синие тени); `uSunDir/uSunColor` — только настоящее солнце (небо). `uNight` 0..1.
- Звёзды — 3 слоя ячеек + Млечный Путь с пылевой полосой, вращаются вокруг полюса мира; мерцание сильнее у горизонта. Эмиссия неба ночью умножается на `uInvExp` (стабильная экранная яркость при любой экспозиции).
- Песчаная буря (`storm → 1`): кольцо стены сужается, видимость падает до ≈100–150 м (плотность тумана), песок летит мимо камеры (`fx.js`), небо — охра, солнце гаснет и краснеет, грейд добавляет полосы и вуаль.
- `post.js`: любой NaN/Inf/отрицательный пиксель HDR-буфера заменяется до bloom (и в грейде), экспозиция проверяется на конечность, `weather` санирует цели экспозиции; лучи света и луч-семплирование ограничены по UV. Лучи (god rays) — только на `med/high` (нужна глубина), на `low` — санитайзер.


## Сиетч внутри Когтя: отверстия, проходы, заплатки рельефа
- `world.addRockHole({x,y,z,r})` — отверстие-сфера в материале скалы (Коготь и «плавники»): `discard` во фрагментном и теневом проходах, кромка затемнена (читается как проём). До 8 штук (`MAX_HOLES`), возвращает индекс (−1 при переполнении). Uniform-ы `ENV.uniforms.uHoles/uHoleN`.
- `world.addPassage({points:[{x,y,z},…], r})` — капсулы вдоль ломаной: внутри (3D, по центру тела +0.9 м) отключена 2D-коллизия контура Когтя в `world.collide`. Коллизия также «высотная»: если `pos.y` выше рельефа более чем на 2.5 м (уступы грани), контур скалы не выталкивает. `pos` — позиция ступней.
- `world.addGroundPatch({x,z,radius,blend?,height:(x,z,baseH)=>y|null})` — переопределение `heightAt` в круге (плавное смешение на `blend` метрах у края; `null` — оставить базовую высоту). Меш ландшафта перезаливается автоматически (`terrain.invalidate()`). Подходит для котловины сада (`GARDEN.floorY`≈4) и площадок тропы.
- Валуны/обломки, созданные `world.addObstacle`, регистрируются в `game.colliders` (владелец `'desert'`, тег `boulder`, сфера).

## Реализм (текстуры, пост, окружение)
- Текстуры: CC0 Poly Haven, `tools/fetch_textures.mjs` → `src/assets/textures.js`; лицензии — `assets_src/LICENSES.md`. Доступ — `core/textures.js` (`getTex`), проекции — `core/triplanar.js` (`applyTriplanar`, `applyDetail`, `triplanarKit`).
- Песок: фотограмметрическое зерно (`sand`, ближний слой до 190 м) + естественная рябь (`sand_ripples`, повёрнута по ветру) поверх процедурной ряби/следов; цвет модулирует палитру. Камень: `rock_cliff` (Коготь), `rock_desert` (валуны), whiteout поверх процедурной нормали, песок на уступах остаётся процедурным. Харвестер — `metal_rusty` в локальных координатах. Червь — `rock_cave` по (s, угол).
- Пост: SSAO по глубине (в `AtmoShader`, 9/14 шагов; на `low` нет), AgX (`?tm=aces` — старый ACES), грейд lift/gain/контраст, хроматизм только по краям, bloom выше порогом, SMAA на `low`, тени PCF с радиусом, растущим при низком солнце.
- Окружение: `envmap.js` — PMREM из процедурного неба + тёплый низ, `scene.environment`, пересбор при смене света (не чаще 1 с); в сиетче интенсивность 0. `hemi` умножается на 0.55 (часть ambient теперь из окружения).
