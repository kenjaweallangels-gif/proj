# Orbital Station — architecture & module contracts

Browser 3D scene (Vite + three.js r186, WebGL2). A multi-module station in low Earth orbit,
first-person EVA in a spacesuit, docking traffic, orbital motion, day/night cycle, Earth below.

```
index.html                 DOM shell (#app canvas container, #ui overlay root)
src/main.js                bootstraps App
src/core/App.js            owns everything, update loop, module wiring, env-map, lights, debug views
src/core/Renderer.js       two-scene rendering (far km scene + near m scene) + post stack
src/core/Orbit.js          orbital mechanics, Sun/Moon, Earth rotation, frames, eclipse
src/core/Materials.js      shared PBR material library (hull, MLI foil, truss, solar, glass, lights…)
src/core/Textures.js       procedural canvas textures (panel lines, MLI wrinkles, decals, text…)
src/core/Particles.js      GPU sprite particle pool (RCS puffs, vents, debris glints)
src/core/Input.js          keyboard/mouse/pointer-lock/gamepad state
src/core/constants.js      units, layers, quality presets
src/world/Earth.js         FAR scene: Earth (day/night/clouds/ocean/atmosphere), Sun disc, Moon
src/world/Sky.js           FAR scene: star catalogue + Milky Way
src/station/Station.js     NEAR scene: the station (composes src/station/parts/*)
src/ships/Ships.js         NEAR scene: ship types + docking traffic controller
src/player/Player.js       first-person EVA: physics, controls, airlock sequence, suit model
src/ui/Hud.js              helmet HUD / visor overlay / menus / loading (DOM + canvas)
src/audio/Audio.js         procedural WebAudio (breathing, suit fans, radio, thrusters, hatch)
src/fx/Post.js             post-processing passes (bloom, final grade, SMAA) and lens flare
tools/screenshot.mjs       Playwright headless screenshot of any view (for visual verification)
public/textures, public/data   NASA Earth/Moon textures, star catalogue (see CREDITS.md)
```

## Units and frames

* **Near scene** (`ctx.nearScene`): meters. Station is static at the origin. Camera = player.
* **Far scene** (`ctx.farScene`): kilometers, same orientation. Rendered first, then depth is
  cleared and the near scene is drawn on top. Far camera copies the near camera's rotation and
  position×0.001.
* **LVLH frame** (both scenes): `+X` prograde (orbital velocity), `+Y` zenith (away from Earth),
  `+Z = X × Y`. Earth centre in far scene = `orbit.earthCenterFar` = `(0, -6781, 0)` km.
* `orbit.sunDir` / `orbit.moonDir` are unit vectors in this frame; `orbit.earthQuat` orients the
  Earth mesh; `orbit.skyQuat` orients the star field (see Orbit.js header for conventions).
* The orbital motion is visible as the Earth/sky rotating about the station: one revolution per
  92.6 min, with sunrise/sunset and a 35-minute eclipse each orbit.

## Context object (`ctx`) passed to every module

```js
ctx = {
  renderer,            // THREE.WebGLRenderer
  nearScene, farScene, // THREE.Scene
  camera, farCamera,   // PerspectiveCamera (near: meters, far: km)
  orbit,               // Orbit instance (updated before modules each frame)
  materials,           // Materials library  (ctx.materials.get('hullWhite') …)
  textures,            // Textures (procedural generators)
  particles,           // ParticleSystem (near scene)
  input,               // Input state
  quality,             // active quality preset (constants.QUALITY_PRESETS[...]) + {preset}
  time,                // { sim, dt, scale, elapsed }  sim = seconds since epoch
  sunLight,            // DirectionalLight (near scene, follows orbit.sunDir, casts shadows)
  hemiLight,           // earthshine HemisphereLight
  events,              // tiny emitter: events.on(name, fn), events.emit(name, data)
  earth, sky, station, ships, player, hud, audio,   // module instances (filled as created)
  mode,                // 'play' | 'observer'
  isShot,              // true when driven by tools/screenshot.mjs (fixed dt, no pointer lock)
}
```

Module shape: `class X { constructor(ctx) {...}  async load() {}  update(dt, ctx) {}  dispose() {} }`.
Construction must be synchronous and cheap-ish (geometry building is fine, keep < ~1.5 s).
Asset loading goes into `load()`. Modules are created in order: earth, sky, station, ships,
player, hud, audio. A later module may use an earlier one through `ctx`.

## Station contract (`src/station/Station.js`)

```js
class Station extends THREE.Group {
  colliders: Collider[]        // static, station frame = world frame (meters)
  handrails: {a: Vector3, b: Vector3, radius: number}[]   // grabbable segments
  dockingPorts: DockingPort[]
  airlock: Airlock
  ring: { group: Group, angularSpeed: number /* rad/s */, radius: number }
  update(dt, ctx)
}
Collider = { type:'sphere', center, radius }
         | { type:'capsule', a, b, radius }           // segment a-b with radius
         | { type:'box', center, halfSize, quaternion } // oriented box
         // optional: dynamic: true (ring parts; updated each frame in place), name
         // optional surface motion for contacts: velocity (Vector3 m/s) and/or omega (rad/s) + pivot
         // (the ring sets omega/pivot, ships share their velocity) — the player bounces relative to it
DockingPort = { id, name, position: Vector3, quaternion: Quaternion, size:'small'|'large',
                occupant: null | object, approachAxis: Vector3 /* unit, outward */ }
  // Port frame: local +Z points OUTWARD. A docked ship's nose sits at `position`, its
  // nose axis = -approachAxis. Ships read/write `occupant`.
Airlock = { standPosition: Vector3, exitDirection: Vector3 /* unit */, lookDirection: Vector3,
            hatch: { open(): Promise<void>, close(): Promise<void>, isOpen, progress /*0..1*/ },
            interiorColliders: Collider[] /* walls of the airlock chamber */ }
```
Artificial gravity: the habitat ring (`ring.group`) rotates about its axis at ~0.3 rad/s
(radius ~40 m gives ~0.37 g). Its colliders are marked dynamic and rotate with it.

## Ships contract (`src/ships/Ships.js`)

```js
class Ships { ships: Ship[]; update(dt, ctx) }
Ship = { group: Group, type: string, state: 'docked'|'approach'|'dock'|'undock'|'depart'|'loiter',
         port: DockingPort|null, colliders: Collider[] /* world frame, updated when moving */ }
```
Emit RCS puffs with `ctx.particles.emitCone(...)`. Docked ships occupy `port.occupant`.

## Player contract (`src/player/Player.js`)

```js
class Player {
  position, velocity (Vector3, m, m/s), quaternion   // camera follows
  state: { mode: 'airlock'|'eva'|'observer', tetherLength, tetherAttached, propellant /*0..1*/,
           o2 /*0..1*/, power, suitPressure, heartRate, holding: handrail|null,
           speedRelative, distanceToStation }
  update(dt, ctx)
}
```
Zero-g 6-DOF with momentum; SAFER thrusters (translation + rotation), tether to the airlock
with elastic limit, sphere-vs-collider collision (radius ~0.45 m), handrail grabbing/push-off.

## Materials (`ctx.materials.get(name)`) — reuse these, do not invent per-module duplicates

hullWhite, hullWhiteAged, mliGold, mliSilver, mliBlack, truss, metalBare, metalDark,
solarCell, solarBack, radiator, glass, windowGlow, navRed, navGreen, navWhite, floodLight,
nozzle, rubberBlack, paintOrange, paintGray, antennaWhite, label(text) (decal material).
All are MeshStandard/MeshPhysical; `scene.environment` provides reflections automatically.

## Performance rules

* Merge static geometry per material (`BufferGeometryUtils.mergeGeometries`); use `InstancedMesh`
  for repeated small parts (handrails, bolts, panel studs). Target: station < 150 draw calls.
* Only large/opaque meshes cast shadows; set `castShadow` on merged meshes, not on 1000 tiny ones.
* Emissive bits / sprites go on `LAYERS.NO_SHADOW`.
* No per-frame allocations in `update` (reuse scratch vectors).

## Testing / visual verification

```
npm run dev                             # http://127.0.0.1:5173/
node tools/screenshot.mjs --view=overview --t=600 --out=/tmp/x.png   # headless screenshot
npm run smoke                           # real game flow: menu, thrust, airlock, ring contact, observer
```
URL params: `?autostart=1` skip menu · `?observer=1` free camera · `?view=overview|docking|ring|earth|airlock|eva|sunrise`
· `?t=<sim seconds>` (600 day, 1165 sunset, 2000 night, 3200 sunrise) · `?quality=ultra|high|medium|low` · `?timescale=<n>` · `?shot=1` (fixed dt).
`window.__app` exposes the App for console debugging.

## Stubs and module loading

`src/stubs/*.js` hold minimal reference implementations of every module contract. `App.js` imports
the real modules dynamically and falls back to the stub (with a console error and an entry in
`window.__MODULE_ERRORS__`) if a module fails to import or does not export the expected class.
Always write complete, syntactically valid files (run `node --check <file>`) — a dev server shared
with other people transforms files on demand.

## Player extras

`player.setView('airlock' | 'eva' | 'eva-far')` poses the player for screenshots;
`player.setActive(bool)` is called when switching between play and observer modes.
`station.viewpoints = { name: { position: [x,y,z], target: [x,y,z] } }` adds observer views.
`station.airlock.tetherAnchor` (Vector3) is where the EVA tether attaches.

## Player state (as implemented; read by the HUD and audio)

`player.state`: `mode` ('airlock'|'eva'), `prompt` (string hint for the HUD), `sequence {name, progress}`,
`airlockPressure`, `suitPressure`, `o2`, `power`, `propellant`, `heartRate`, `suitTemp`,
`nearHandrail`, `handrailDistance`, `holding`, `canEnterAirlock`,
`tetherAttached`, `tetherStowed`, `tetherLength`, `tetherMax`, `tetherTaut`, `tetherDistance`, `reeling`,
`rotationMode` ('aah'|'free'), `stabilization` (bool), `rotationModeLabel`,
`thrusting`, `boost`, `killing`, `rotationThrust`, `lampOn`,
`speedRelative`, `distanceToStation`, `distanceToAirlock`.
`Player.CONTROLS` is an array of `{key, ru}` used by the menu/help.
Audio: `audio.play(name, opts)`, `audio.setParam('volume'|'fan'|'radio'|'crawl', v)`, `audio.volume`, `audio.muted`.

## HUD API (as implemented)

`hud.showLoading(text)`, `hud.hideLoading()`, `hud.setProgress(0..1)`, `hud.showMenu({ pause })`, `hud.hideMenu()`,
`hud.notify(text, { kind: 'radio'|'info'|'warn'|'alert' })`, `hud.toggleHelp()`. URL param `?menu=1` shows the start
menu even in shot mode. `events.emit('view', name)` fires on every `app.setView`.

## Ships (as implemented)

States: 'docked' | 'undock' | 'depart' | 'arrive' (inbound) | 'approach' | 'dock' | 'loiter' (drone) | 'idle' (recycled, hidden).
noseOffset = 0: a docked ship's position equals `port.position`. `ships.getLog()` returns the last 20 Russian event lines;
`events.emit('ship', {type, ship, port})` fires on undock/dock/depart/arrive. Observer view `ships` frames the docked traffic.

Types (fictional names, real analogues): `soyuz` «Сокол» (Soyuz MS), `progress` «Обоз» (Progress MS), `dragon` «Вега»
(Crew Dragon), `starliner` «Пегас» (Starliner) — small ports; `cygnus` «Лебедь» (Cygnus), `htvx` «Аист» (HTV-X),
`dreamchaser` «Стриж» (Dream Chaser + cargo module) — large ports (berthed vehicles dock with a passive CBM-class ring);
`drone` «Шмель». Each type is authored once (`author(kit)` in `src/ships/types/*`) and built as a three-level template
(`src/ships/Kit.js`): L0 full detail (relief-quilted blankets, bolts, handrails, thruster bells, latches) within
~15 m + 3.5 × bounding radius, L1 to 500 m, L2 (one flat material) beyond; 'lite' uses L1 only close up, L2 otherwise.
Ships clone the template (shared geometry); hidden levels are detached from the scene graph after start-up.
Part animation (`types/Common.js`) follows the traffic state: wings / fans / folding wings deploy at the start of an
arrival, Kurs antennas deploy and track, probe extension / contact / retraction, IDSS soft-capture ring and hooks,
nose cone / hatch cover open at the hold point and close after the push-off, strobes / docking lights / LEDs.
Debug: `?shipshow=clean` (row of every type 120 m above the station, views `ship-<type>[-dock|-aft|-top|-side]`),
`&shipanim=1` (cycles the mechanisms), `?shipshow=track&shipff=<s>` (views `track-<type>`, traffic fast-forwarded).

## 'lite' preset (CPU rasterisers)

Picked automatically when the WebGL renderer string names a software rasteriser (`App.isSoftwareRenderer`).
On SwiftShader the cost is triangles (~3-4 M/s) and pixels, not draw calls or material switches, so the preset:
`src/core/three-lod.js` (Vite alias for `three`) scales round-geometry tessellation by `globalThis.__THREE_DETAIL`
while the station, ships and suit are built; `App.applyLite` swaps PBR for Lambert, drops spotlights and shadows,
atlases text decals and runs `StaticBatcher.batchStatic` (static merge per moving anchor, instances baked, plain
materials merged through vertex colours, pre-merged meshes split into islands, spatial cells, distance-culled detail
batches). `HorizonCull` draws only the visible Earth cap (all presets). `PostStack` renders directly to the canvas:
far scene at `farScale` into a half-float target and stretched, stars straight to the canvas with analytic Earth
occlusion. Dynamic resolution (`App.updateDynamicResolution`) holds `targetFps` with discrete scale steps.
`tools/fps.mjs` measures steady frame rates per view; `tools/demo.mjs` records a scripted session with an fps log.

## GPU presets: 1080p floor and the 60 fps governor

Presets `ultra`/`high`/`medium`/`low` carry `minRenderHeight: 1080` and `targetFps: 60`. `Renderer.floorPixelRatio()`
returns the pixel ratio that gives at least `minRenderHeight` drawing-buffer lines for the current canvas height
(capped by `maxPixelRatio`), and `basePixelRatio()` never goes below it, also after window resizes.

`src/core/QualityGovernor.js` (created by `App` for every non-lite preset unless `?governor=0` or a screenshot run)
measures fps in 0.5 s windows and walks a precomputed list of levels: supersampling down to the floor in ×0.85
steps, then MSAA 2/0, shadow map halved down to 1024, environment refresh ≥ 6 s, bloom off. It steps down one
level below `target − 3` fps (two below 75 % of the target), and up after 6 good windows when the GPU timer
(`EXT_disjoint_timer_query_webgl2`, wrapped around `renderer.render` by `beginGpu/endGpu`) shows less than 70 % of
the frame budget in use. Without a trustworthy timer it waits for 20 good windows. A step up that does not hold
locks stepping up for 30 s. GPU samples longer than the wall-clock frame are dropped, and the timer is abandoned
if it keeps producing them (software rasterisers report queue latency). The state is shown next to the HUD fps counter.

Detail knobs per preset: `detail` (tessellation factor through three-lod, 1.6 ultra / 1.3 high), `textureScale`
(procedural texture resolution in `Textures`), Earth feature set and sphere segments (`Earth.js` `FEATURES`, see below).
`App.fitShadow` fits the sun's shadow frustum to what the camera sees (38–165 m), snapped to shadow texels.

CPU per frame, all presets: transparent double-sided materials render in one pass (`forceSinglePass`), and
`App.splitMaterialVariants` gives materials shared between instanced and plain meshes separate instances,
unifies `receiveShadow` per material and gives instanced shadow casters their own depth material. Otherwise
three re-derives the program (`getParameters`, cache key) on every switch between such objects. The PMREM
environment target is reused on each refresh. `tools/cpuframe.mjs` reports main-thread JS time per frame with a CDP
profile (`--callers=<fn>` prints the stacks that lead to a hot function).

## Earth (`src/world/`)

* `Earth.js` — ground / cloud / aurora / atmosphere shells, Sun, Moon. `FEATURES[preset]` picks textures and shader
  detail (8K night, clouds and water on high/ultra when `maxTextureSize ≥ 8192`, cloud-detail octaves, cyclone /
  storm-cell / flash array sizes, aurora arcs and samples). 'lite' keeps the old cheap path: one ground shader with
  the cloud layer inlined, no weather, no aurora.
* `EarthTextures.js` — seasonal day map: the two Blue Marble NG months bracketing the sim date are blended once at
  load into a mipmapped render target (high/ultra: 8K October base + the 4K seasonal difference; medium/low: two 4K
  months; lite: the nearest month file). Also the 64³ noise texture of the weather shaders.
* `SurfaceDetail.js` (ultra) — 500 m Blue Marble tiles (`textures/earth/tiles/`) composited into a 2048² window
  (34°) around the sub-station point, double-buffered; the ground shader adds its high-pass near nadir.
* `Weather.js` — CPU weather state in the Earth-fixed frame: October tropical cyclones on deterministic tracks per
  basin, thunderstorm cells spawned around the visible cap from a convective climatology (ITCZ, afternoon land,
  night ocean, cyclone bands), lightning flashes in real time, aurora activity. Writes preallocated uniform arrays.
* `shaders/WeatherChunk.js` — cloud cover = NASA cloud map (slow drift) + growth/decay noise + sub-texel grain +
  afternoon cumulus + cyclones + storm cells; sea-surface wind for the Cox–Munk glint. `shaders/AuroraShaders.js` —
  analytic auroral curtains on a proxy shell (R + 335 km).
* Textures are built by `tools/prepare_earth_textures.py` from the sources fetched by `tools/fetch_earth_sources.sh`.
