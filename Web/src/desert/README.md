# Пустыня Ракиса (`Web/src/desert`)

`index.js` → `create(game)` регистрирует `game.world`, `game.weather`, `game.post` (+ служебный модуль `desertRoot`).

| Файл | Что |
|---|---|
| `field.js` | Аналитическое поле высот (детерминированное, без THREE): дюны вдоль `WIND_DIR`, гряда A1 (~36 м), «пан» вокруг золотого пути, подъём к скале, острова, плиты A3, SDF скалы/расщелины/«плавников», маски `rock`/`packed`. |
| `terrain.js` | Тороидальный клипмап, 7 колец (шаг 1…64 м, ±80 м…±5 км), высоты/нормали/маски — в `DataTexture` (RGBA32F), геоморфинг к более грубому кольцу, пески — `MeshStandardMaterial` + `onBeforeCompile` (рябь 3 масштаба, зерно, искры, макро-вариация, склоны, следы, туман). |
| `footprints.js` | Следы: окно 64 м, RT 1024² (R — глубина, G — вал), штампы инстансами, заживление/сдвиг ping-pong. |
| `rock.js`, `rockMaterial.js` | «Коготь Шайтана» (процедурный меш по осям из `layout.js`), «плавники» расщелины A4, фальшивая дверь с меткой крюка; шейдер страт/эрозии/песка на уступах. |
| `dressing.js` | Валуны/галька (InstancedMesh), остов харвестера, рёбра червя, стойка тамперов. |
| `sky.js`, `weather.js` | Небо (аналитическое «пыльное»), солнце/полусфера/тени (привязка к текселям), пресеты погоды, экспозиция. |
| `fx.js` | Позёмка, пылинки, пыльные вихри, стена бури, пул клубов пыли `world.puff`. |
| `post.js` | EffectComposer: Render → марево → bloom → грейд → Output. |
| `env.js` | Общие uniform-ы (`ENV`), GLSL-шум, туман, тень Когтя, `patchMaterial`. |

## API
- `world.heightAt(x,z)`, `normalAt(x,z[,out])`, `surfaceAt(x,z)` → `'sand'|'packed'|'rock'`, `isSafe(x,z)`, `collide(pos,r)` (скала, расщелина, «плавники», валуны, харвестер, рёбра), `shadeAt(x,z)` 0..1 (тень Когтя; расщелина ≈ 0.12), `sunDir`, `setVisible(b)`.
- `world.addFootprint(x, z, yaw, {type:'foot'|'worm'|'crater'|'thumper', size, depth})`. `yaw` — направление движения `(sin yaw, cos yaw)` в (x, z) (поворот `rotation.y` three.js). Дубли отсекаются (шаг ближе 0.35 м за 0.4 с, кратер/тампер — 3 м за 1.5 с). Размер `size` — полуразмер штампа, м (стопа 0.17, червь 15, кратер 26, тампер 4).
- Автоматически слушает шину: `footstep` (следы + пыль), `thumper`, `worm:breach` (кратер/клубы), `space` (скрытие пустыни при `sietch`), `resize`.
- `world.puff(x,y,z,{count,size,life,speed,spread,alpha,up,grow})` — клубы пыли (пул 160).
- `weather.request(id, blendSec)`, `current`, `hours`, `windDir`, `windSpeed` (с порывами), `storm`, `dust`, `haze`, `exposure`, `sunElev`.
- `post.composer`, `post.haze/bloom/grade` (pass-ы), `post.dust`.

## Настройка (без хардкода в коде игры)
Цвета песка — `terrain.sandU` (`uSandLoose/Packed/Dist`), цвета породы — uniform-ы материала скалы, экспозиция — `weather.state.exposure`/`world.exposureTrim`, всё остальное идёт из `WeatherPresets.csv`.
Качество: `low` — без теней/MSAA/марева/bloom/искр/ряби 12 см; `med` — тень 2048, MSAA×4, bloom, 2600 частиц позёмки, 2 вихря; `high` — тень 4096, 6500 частиц, 3 вихря.

## Солнце
Высота — по формуле `docs/tech-art/lighting_weather.md` §3; азимут (от +X к +Z) — по часам: 6.67 ч → −47°, 8.5 ч → 20° (`SUN_AZIMUTH_DEG`), 11.5 ч → 56°, 17.5 ч → 188°. Солнце в рассвет — с северо-востока: скала не перекрывает его со старта.
