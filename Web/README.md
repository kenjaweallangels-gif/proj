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
URL-параметры: `?q=low|med|high` (качество), `&lang=RU|EN`, `&skip=1` (без титульного экрана),
`&at=P4|worm|A3|sietch|gallery|hall` (старт с точки).

## Контракт модулей (для разработчиков)

Единицы — метры; оси three.js: X — восток, Z — юг, Y — вверх. Раскладка — `src/core/layout.js`.
Каждый модуль: `export function create(game)` → регистрирует объект через `game.add(name, obj)`.
У объекта могут быть `update(dt, t)`, `lateUpdate(dt, t)`, `alwaysUpdate: true` (работает и на паузе).
Порядок создания: world/weather → sietch → worm → player → companions → zones → dialogue → story → audio → ui.

### Ядро (`src/core`)
- `game` — `renderer, scene, camera, bus, input, settings{quality, lang, at, autotest}, data, time, dt, timeScale, paused, cinematic{active, owner}, lang, zone, space('desert'|'sietch'), t(ru,en), interactables[], shake, heightAt(x,z), surfaceAt(x,z), collide(pos,r), render()`.
- `bus` — события (ниже). `input` — `axis()`, `look{x,y}`, `held(a)`, `pressed(a)`, `device('kbm'|'pad')`, `requestLock()`, `locked`, `enabled`.
  Действия: Fwd/Back/Left/Right, Sprint, SandWalk, Stutter, Interact, ToggleCamera, Thumper, Pause, PhotoMode, Mask, Confirm, Skip.
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
| Диалоги, сюжет, звук, UI | `src/story/**`, `src/audio/**`, `src/ui/**` | `game.dialogue`, `game.story`, `game.audio`, `game.ui`, `game.debug` | dialogue: `play(id)→Promise, bark(arch, ctx, pos), lore(id), isBusy`; story: `fire(trigger)`; audio: `event(id, pos?), setMusic(state)`; ui: `fade(toBlack, sec)→Promise, titleCard(text), hint(text), letterbox(b), endCard()`; debug: `goto(name)` |

### События `bus`
`boot`, `start` (игра началась после титула), `zone {from,to}`, `footstep {x,z,yaw,surface,actor}`, `noise {x,z,loudness,source}`,
`stutter`, `sandwalk {on}`, `interact {tag}`, `worm:state {from,to}`, `worm:breach {x,z}`, `thumper {x,z}`,
`subtitle {speaker,name,text,duration,kind}`, `line:end {id}`, `chain:end {id}`, `cinematic {active,id}`,
`weather {id}`, `music {state}`, `ritual`, `space {space}`, `pause {paused}`, `photo {active}`, `end`.
