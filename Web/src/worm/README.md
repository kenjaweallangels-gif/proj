# Шай-Хулуд (`src/worm/**`)

Модуль `game.worm` (создаётся после sietch, до player). Длина 360 м, Ø 40 м, 90 колец по 4 м.

| Файл | Что делает |
|---|---|
| `index.js` | Состояния Dormant → Listening → Approach → Surface → Pass (+ Ridden в кат-сцене), слух, кинематика головы, API |
| `spine.js` | История пути головы (шаг 1 м) → 91 точка тела (через 4 м), параллельный перенос нормали, текстура-позвоночник |
| `shaders.js` | Хитин/плоть/зубы: `MeshStandardMaterial` + `onBeforeCompile` (освещение и туман сцены сохраняются) |
| `body.js` | Труба 600×108 (деформация в вершинном шейдере по `uSpine`), голова: 3 лепестка + глотка + губа + ~800 кристаллических зубов, наездники |
| `fx.js` | Пул частиц (инстансные билборды, баллистика в вершинном шейдере), холм-волна, камни-«прыгуны», тень-лента |
| `path.js` | Профили дуг головы (pitch/yaw от пройденного пути): обычное всплытие и «колонна» для reveal |
| `reveal.js` | Кат-сцена `LS_WormReveal` (~28 с), режиссура камеры |

## API (`game.worm`)
- `state`, `threat` (0..1), `headPos` (Vector3, центр головы), `noise` (0..1, текущий уровень слуха), `exposed`
- `setSensing(bool)` — запретить/разрешить случайные атаки (кат-сцены, сиетч)
- `forceSurface(x?, z?)` — сценарный выход (`ForceWorm`); для точки у `WORM_REVEAL` червь идёт под песком (~8 с) и **ждёт `playReveal()`** под песком (если не вызвана 16 с — всплывает как обычно)
- `playReveal() → Promise<{skipped}>` — кат-сцена; пропуск — `input.pressed('Skip')`
- `foreshadow()` — «предвестие»: далёкая рябь через эрг (безопасно)
- `tuning` — аналог `DA_WormTuning` (метры/секунды); `look` — uniform-ы шейдеров (`uBump`, `uSandAmt`…); `fx.shared` — цвета/ветер частиц
- Шина: `worm:state {from,to}`, `worm:breach {x,z}`, `worm:reveal {phase}` (`start|erupt|open|roar|dive|silence|end`), `cinematic {active,id:'WormReveal'}`

Необязательные внешние вызовы (через `?.`): `game.world.addFootprint(x,z,yaw,{type:'worm'|'crater',size})`,
`game.weather.request('Worm_Reveal',3)`, `game.audio.event('Worm.Breach'|'Worm.Roar'|'Worm.RingSandfall', pos)`, `game.ui.letterbox(bool)`.
Цвет песка/солнца частиц берётся из `game.world.sandColor` / `sunColor` (THREE.Color), направление на солнце — `game.world.sunDir`.

## Отладка
`worm.debugPose({x,z,yaw,sigma,open,profile:'reveal'|'normal'})` ставит червя в позу и замораживает; `worm.debugUnfreeze()`.
Скриншоты: `node tools/build.mjs --out=worm.html && node tools/worm_shots.mjs --only=reveal|pose|behaviour`.
