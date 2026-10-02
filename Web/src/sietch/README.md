# Сиетч «Табр-ан-Нур» (браузерная версия)

Модуль `game.sietch` (регистрируется в `create(game)` из `index.js`). Все локальные координаты — относительно
`SIETCH_ORIGIN` (5000, 0, 0); наружу API принимает/отдаёт мировые координаты.

## API
| Метод | Что делает |
|---|---|
| `enter([point])` → Promise | `game.space='sietch'`, bus `space`, `game.world.setVisible(false)`, туман/фон интерьера, игрок в B1 (x=2.4, лицом вглубь, yaw=0; `point` = `'B1'|'B2'|'B3'|'B4'|'B5'|'bowl'` для debug.goto), `companions.teleportBehind()`, погода `Sietch_Interior` |
| `leave()` | обратно в пустыню (`space='desert'`, мир виден) |
| `heightAt(x,z[,yFeet])`, `surfaceAt(x,z)`, `collide(pos,r)`, `zoneAt(pos)` | земля: лестницы/балкон/мост (два уровня по высоте ступней, порог 0.5 м), ярусы зала, `'sand'` в чаше, SDF-стены |
| `startRitual()` | идемпотентно; также по bus `ritual` и при входе в `B5_Hall` |
| `playFinale({hold})` → Promise | ~20 с: `cinematic {active, owner:'sietch'}`, bus `cinematic` (`HallFinale`), облёт свода → луч → танцовщица → Хармат оборачивается; по окончании cinematic снимается (`hold:true` — оставить кадр) |
| `endFinale()` | прервать финал |
| `speakerPos(id)` | `'Harmat' \| 'Priestess' \| 'Dancer' \| 'Guard'` → Vector3 (мир) |
| `crowd`, `doors`, `lighting`, `finale`, `poi` | внутренние подсистемы (для отладки/тестов) |

## Интерактивные точки
`game.interactables`: `LORE_*` (метка «Осмотреть»): Carving_Fremen, Quizarate_Sigil, Revivalist_Mural, Cistern_Grate,
Water_Rings, Maker_Hooks, Shiana_Shrine, Worm_Throat, Thumper_Rack → `game.dialogue.lore(id)` + bus `interact`
`{tag:'Rakis.POI.<id>'}`. Пустынная точка `Rakis.FalseRock` («Отодвинуть камень») → `ui.fade` → `enter()` → `ui.fade`.
Двери-уплотнители: автооткрытие, bus `interact {tag:'Rakis.SealDoor'}`, звук `Door.SealHiss`.

## Устройство файлов
`plan.js` (ячейки-помещения, высоты, SDF-коллизия, зоны) → `arch.js`/`hall.js` (стены с проёмами, своды, колонны, балконы,
лестницы, ниши, цистерна, зал) → `props.js` (рынок, станки, стойки; точки деятельности `ctx.spots`) → `builder.js`
(слияние по материалу и региону, запечённый тёплый свет `aGlow`) → `mats.js` (шейдер «отполированного ладонями камня»,
ткани с раскачкой, декали трёх слоёв истории из `textures.js`) → `lighting.js` (светошары, пул PointLight, лучи, пыль, пар,
вода цистерны) → `crowd.js` (толпа, LOD, ритуал, жрица/Хармат/танцовщица) → `doors.js`, `finale.js`.

## Бюджеты
Статика ~50–60 мешей (слияние), ~270 тыс. треугольников в B2; полные фигуры `makeFigure` только у ближайших
(`low` 4 / `med` 7 / `high` 10), остальные — 3 инстанс-меша. Пул реальных PointLight: 6/10/14. NPC: 46/62/70.

## Проверка
`node tools/build_data.mjs && node tools/build.mjs --out=sietch.html && node tools/sietch_shots.mjs` → `dist/shots/sietch/*.png`.
