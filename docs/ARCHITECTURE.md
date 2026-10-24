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
src/station/interior/*     pressurised compartment interiors (zones), visibility, carving, interior lights / materials
src/player/Player.js       first-person astronaut: IVA (inside) + EVA physics, controls, airlock sequence, suit model
src/player/Iva.js          inside the station: zero-g glide, handrails, spin-gravity walking (Coriolis), ladders
src/ui/Hud.js              helmet HUD / visor overlay / menus / loading (DOM + canvas)
src/audio/Audio.js         procedural WebAudio (breathing, suit fans, radio, thrusters, hatch)
src/fx/Post.js             post-processing passes (bloom, final grade, SMAA) and lens flare
tools/screenshot.mjs       Playwright headless screenshot of any view (for visual verification)
tools/interior-stats.mjs   interior build statistics (zones, triangles, atlas use); interior-debug.mjs runs a probe
                           snippet against window.__app (optional --shot=out.png)
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
Airlock = { standPosition: Vector3 /* crew lock */, exitDirection: Vector3 /* unit */, lookDirection: Vector3,
            hatch: { open(): Promise<void>, close(): Promise<void>, isOpen, progress /*0..1*/ },   // outer EVA hatch
            innerHatch: { same API } /* equipment lock <-> crew lock */, innerHatchCenter, equipmentLockCenter,
            suitPosition, interiorColliders: Collider[] /* EVA colliders: crew-lock walls, cap ring, bulkhead */ }
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
  state: { mode: 'iva'|'airlock'|'eva'|'observer', tetherLength, tetherAttached, propellant /*0..1*/,
           o2 /*0..1*/, power, suitPressure, heartRate, holding: handrail|null,
           speedRelative, distanceToStation }
  update(dt, ctx)
}
```
Zero-g 6-DOF with momentum; SAFER thrusters (translation + rotation), tether to the airlock
with elastic limit, sphere-vs-collider collision (radius ~0.45 m), handrail grabbing/push-off.
Modes: 'iva' — inside without the suit (radius 0.3 m), 'airlock' — inside in the suit (0.42 m), 'eva' — outside.
Inside, `player.iva` (src/player/Iva.js) moves the body: zero-g glide in the station frame; in the ring zones (and the
hub's rotating collar) the state lives in ring-local coordinates (`iva.pL`, `iva.vL`, rotating frame with centrifugal
and Coriolis accelerations), walking on the deck, ladders in the spokes. `player.position/quaternion/velocity` are
always the world (inertial) values.

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

`player.setView('inside' | 'airlock' | 'eva' | 'eva-far' | <interior view>)` poses the player for screenshots;
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

## Station exterior detail, LOD and ambient occlusion (GPU presets)

* **Two levels of geometry.** Structural joints that read from any distance — bolted module end flanges,
  berthing (CBM-style) skirts with rubber seals and MLI vestibules, weld lands, MLI blanket edges, curved MMOD
  (Whipple) shield panels with folded edges, truss node blocks with gusset plates, spoke/pylon/SARJ flanges,
  grapple fixtures, camera/light units, bevelled ORUs — are merged into each part's `Builder` buckets (no extra
  draw calls, shadow casting). Generators: `latheAt` (profile rings with crisp corners), `bevelBoxAt` /
  `bevelBox` (chamfered boxes), `ringStack`, `Poly` in `parts/Builder.js`; hull kits in `parts/HullKit.js`;
  assemblies in `parts/Hardware.js`.
* **`parts/Detail.js` — `DetailSet` (`station.detail`, also `builder.detail`).** Small hardware (bolts, rivets,
  MLI tie-down buttons, latches, WIF sockets, P-clamps, QD couplings, connector panels, vents, handrail feet and
  stanchions, sleeves, hinge knuckles…) is appended into growable typed arrays and merged per
  (anchor Object3D, material, tier, spatial cell). Two vertex-coloured materials (`detailMetal`, `detailPaint`)
  carry all finishes, so a cell costs 1–2 draws. Cells are slices along the spine (fine: 16 m, mid: 64 m).
  `station.update` calls `detail.update(camera)`, which hides cells beyond their tier distance
  (ultra fine 30 m / mid 110 m, high 26/95, medium 18/65, low 12/45; × `quality.detailScale`, × `?detaildist=`).
  Rotating parts pass their group as `detail.anchor` while adding. Detail never casts sun shadows.
* **'lite' builds none of it** (`station.detail === null`, every part keeps its old geometry path), so the
  CPU-rasteriser preset and `StaticBatcher` are unchanged.
* **AO (`src/fx/AO.js`, `AOPass`)** runs after the near pass (ultra 12 samples, high 10, medium 6; half
  resolution, `?ao=0` disables). The composer targets carry a float `DepthTexture` (resolved from MSAA by three);
  the far scene is drawn first and depth is cleared, so pixels without station geometry stay at depth 1 and are
  passed through: Earth and sky are never darkened. View-space position and normal are reconstructed from depth,
  SAO on a spiral, depth-aware separable blur, joint-bilateral upsampling, colour × AO damped on brightly lit
  pixels and faded out beyond 160–320 m. Runtime: `post.grade.ao / aoStrength / aoRadius`.
* **QualityGovernor** gained two levels: detail distance × 0.6 (after the shadow-map steps) and AO off (before
  bloom off).
## Interiors (src/station/interior)

`station.interior` (StationInterior, created in the Station constructor, built in `Station.load()`): every pressurised
compartment is a zone `{ id, name (Russian), frame: 'station'|'ring', group, volumes, solids, rails, portals, lights,
windows, carve, up }` — logistics, lab, hab1/hab2, service, medical, greenhouse, stowage, the three nodes, cupola,
docking hub, service tunnel, the truss tunnel to the ring hub (spine), the airlock (airlockE equipment lock, airlockC
crew lock), the ring hub, six spokes, six sector halls (pod0..5) and six curved corridors (cor0..5). Sector geometry is
built once per variant (k mod 3) and shared by rotated meshes. Ring zones are children of `ring.group`.

* Geometry: `Mesh.js` writes raw vertex arrays per material bucket (fast for ~10^5 small parts); `Kit.js` equipment
  (ISPR racks, CBM / round hatches + vestibules, handrails, lights, cables, ducts, CTB bags, laptops, extinguishers,
  PBA, suits, plants, exercise devices…); `Atlas.js` one procedural canvas atlas (+ emissive) for all textured parts.
* Materials (`Materials.js`): GPU — MeshStandard with vertex colours (baked AO / light falloff), an interior PMREM
  environment, two interior point lights; the Sun lights a fragment only if the ray toward it leaves through one of
  the compartment's windows (analytic mask; hemisphere / ambient / spot lights removed, no sun shadow map). 'lite' —
  unlit MeshBasic with all lighting baked into the vertex colours. Interior meshes are on layer 4 (`INTERIOR_LAYER`).
* Visibility: the zone holding the camera + zones reached through open portals (frustum-tested, depth 4); from outside
  only zones with a window within 9 m (and the crew lock behind the open EVA hatch). Inside a windowless zone the
  camera drops the exterior layers, the far camera draws nothing and the sun shadow map is not re-rendered; window
  glow discs of the hull are hidden while inside. App calls `station.interior.afterMaterials()` after
  `splitMaterialVariants()`: exterior materials get a carve patch that discards fragments inside up to 12 active
  volumes (cones / boxes / the ring torus), so hull parts that poke into the cabins vanish (GPU presets only).
* Exposure: inside, `renderer.post.grade.autoExposure` is switched off and a fixed interior exposure is used.
* 'lite': portal walk depth 1, no carving (the exterior layers are simply not drawn inside); the far scene (Earth)
  is drawn through the windows only in the cupola, elsewhere the glass turns into an opaque haze. Interior meshes
  set their transform through position / quaternion / scale and carry `userData.noBatch` (the lite StaticBatcher
  calls `updateMatrix()` on everything and must not merge them). URL `?interior=0` skips the interiors entirely
  (A/B performance comparisons).
* Physics queries: `locate(worldPos, hint)`, `frameFor(zone, pos)`, `volumesFor(zone, frame)` (containment union,
  `Volumes.js`), `solidsFor(zone, frame)`, `handrails` (station frame), `ringRails`, `ladders` (ring-local).
  Hatch passages are volumes flagged `passage` that reach 1 m into both neighbours (so the containment union has no
  pinch at hatches); `locate` ignores them unless the point lies in no compartment proper.
* Views: `interior.views` — `inside` (start), `interior-lab|logistics|node1|node2|node3|hab1|hab2|greenhouse|medical|
  service|dock|stowage|tunnel|ringhub|spoke|ring|pod|cabin`, `cupola-inside`, `airlock-inside`; `player.hasView(name)`.
  URL `?start=inside|airlock` (menu: «НАЧАЛО»). The old `airlock` view = suited in the crew lock, inner hatch closed.
* Player state additions: `suited`, `inside`, `compartment` (zone name for the HUD), `frame`, `gravity` (g),
  `onLadder`, `autoLevel`, `nearSuit`, `nearInnerHatch`; sequences `don`, `doff`, `innerClose`, `innerOpen`.
