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
