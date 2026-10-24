# Orbital Station — architecture & module contracts

Browser 3D scene (Vite + three.js r186, WebGL2). A multi-module station in low Earth orbit,
first-person EVA in a spacesuit, docking traffic, orbital motion, day/night cycle, Earth below.

```
index.html                 DOM shell (#app canvas container, #ui overlay root)
src/main.js                bootstraps App
src/core/App.js            owns everything, update loop, module wiring, env-map, lights, debug views
src/core/Renderer.js       two-scene rendering (far km scene + near m scene) + post stack
src/core/Orbit.js          station orbit, Sun/Moon, Earth rotation, eclipse; frame outputs for the render frame
src/core/Time.js           SimClock (ctx.time): sim seconds, rate, pause, jumps, rate ladder / presets
src/core/Universe.js       ctx.universe: render frame (floating origin), station root, bodies, gravity, depth planes
src/core/Astro.js          gravity model (J2, Moon, Sun), RK4 / adaptive RK45, universal-variable Kepler, elements
src/core/FreeCamera.js     free camera (App mode 'free'): 6-DOF flight with anchors station / Earth / Moon
src/core/Materials.js      shared PBR material library (hull, MLI foil, truss, solar, glass, lights…)
src/core/Textures.js       procedural canvas textures (panel lines, MLI wrinkles, decals, text…)
src/core/Particles.js      GPU sprite particle pool (RCS puffs, vents, debris glints)
src/core/Input.js          keyboard/mouse/pointer-lock/gamepad state
src/core/CollisionWorld.js exact collisions against the render geometry (BVH, three-mesh-bvh): ctx.collision
src/core/constants.js      units, layers, quality presets
src/world/Earth.js         FAR scene: Earth (day/night/clouds/ocean/atmosphere), Sun disc, Moon
src/world/Sky.js           FAR scene: star catalogue + Milky Way
src/station/Station.js     NEAR scene: the station (composes src/station/parts/*)
src/ships/Ships.js         NEAR scene: ship types + docking traffic controller
src/station/interior/*     pressurised compartment interiors (zones), visibility, carving, interior lights / materials
src/player/Player.js       first-person astronaut: IVA (inside) + EVA physics, controls, airlock sequence, suit model
src/player/Iva.js          inside the station: zero-g glide, handrails, spin-gravity walking (Coriolis), ladders
src/player/Body.js         body dimensions (1.8 m, eye 1.68 m; suited 1.9 m) and collision shapes — shared with the suit / body visuals
src/player/Mechanics.js    body mechanics: hand over hand, auto-brake, move-and-slide, walking, ladders; IK targets + events
src/ui/Hud.js              helmet HUD / visor overlay / menus / loading (DOM + canvas)
src/audio/Audio.js         procedural WebAudio (breathing, suit fans, radio, thrusters, hatch)
src/fx/Post.js             post-processing passes (bloom, final grade, SMAA) and lens flare
tools/screenshot.mjs       Playwright headless screenshot of any view (for visual verification)
tools/astro-test.mjs       plain-Node unit checks of Astro.js / Time.js (also run at the end of npm run smoke)
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
* The LVLH description above is the **default render frame**. Physics truth lives in ECI (km, doubles);
  the render frame is (origin in ECI, orientation) and can be moved to any observer (`ctx.universe`,
  see "Universe and render frames" below). In the default frame everything is exactly as described here.

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
  time,                // SimClock (src/core/Time.js): sim, dt, realDt, rate (= scale), paused, elapsed, hitch, utc()
  universe,            // Universe (src/core/Universe.js): render frame, bodies, gravity, propagation
  stationRoot,         // near-scene Group holding everything in station coordinates (identity in the default frame)
  freeCam,             // FreeCamera (src/core/FreeCamera.js)
  sunLight,            // DirectionalLight (near scene, follows orbit.sunDir, casts shadows)
  hemiLight,           // earthshine HemisphereLight
  events,              // tiny emitter: events.on(name, fn), events.emit(name, data)
  earth, sky, station, ships, player, hud, audio,   // module instances (filled as created)
  collision,           // CollisionWorld (created after load; null if it failed) — see "Body and collisions" below
  mode,                // 'play' | 'observer' | 'free' (free camera)
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
with elastic limit, collisions against the real geometry (`ctx.collision`), handrail grabbing/push-off.
Modes: 'iva' — inside without the suit, 'airlock' — inside in the suit, 'eva' — outside.
`player.position` is the **eye** (= camera). Body: see "Body and collisions" below.
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
URL params: `?autostart=1` skip menu · `?observer=1` observer camera · `?view=overview|docking|ring|earth|airlock|eva|sunrise`
(free camera: `?view=free|free-station|free-earth|free-moon`)
· `?t=<sim seconds>` (600 day, 1165 sunset, 2000 night, 3200 sunrise) · `?utc=<ISO date>` start date · `?quality=ultra|high|medium|low`
· `?timescale=<n>` start rate · `?shot=1` (fixed dt).
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

## Body and collisions

**Body (`src/player/Body.js`, `BODY.unsuited` / `BODY.suited`)** — unsuited: 1.80 m, eye 1.68 m above the soles,
head top 0.12 m above the eye, neck 0.20 m below, body capsule radius 0.30 m around an axis 0.10 m behind the eye,
head sphere r 0.20 m, step height 0.30 m. Suited (EVA suit + PLSS/SAFER): 1.90 m, eye 1.72 m, radius 0.42 m (axis
0.16 m behind the eye), helmet sphere r 0.28 m. The suit / body visuals should match these numbers.
Collision model: rigid head sphere (keeps the camera ≥ 0.15 m off walls; camera near plane 0.05 m, FOV 60° vertical);
with spin gravity a rigid upright capsule from the head down to `stepHeight` above the soles + a downward sphere
cast for the floor (steps / stairs / curved deck, landing); in zero-g a compliant body capsule hanging from the neck
that trails behind the head when moving (head-first through hatches), relaxes toward "down" at rest and swings away
from what it touches. The compartment volumes (`interior.volumesFor`) stay as a coarse safety net for the eye only.

**Mechanics (`src/player/Mechanics.js`, `player.mech`)** — the same in IVA (unsuited: lighter, faster), the airlock
(suited) and EVA (suited, propulsion by SAFER): hand over hand (WASD intent: a free hand reaches the rail or wall
within arm's reach ahead, grips and pulls with limited muscle force — unsuited 2.4 m/s², suited 1.0 m/s²; the
other hand reaches mid-stroke; off-centre pushes give a small damped rotation; without any grip only a weak swim
acceleration), auto-brake (sphere cast along the velocity: the hands — the feet when moving feet-first — absorb
the approach speed over the remaining reach), move-and-slide in substeps (≤ 0.45 × head radius per substep, a
swept cast first for fast motion), ring walking (traction-limited by the apparent gravity, step cadence with planted
feet, landing compression), ladders (hands and feet on the rungs, 0.33 m), EVA hand over hand along the outside
rails with W/S near a rail that runs along the view (and onto the next rail at the end). The old gameplay colliders
(`station.colliders`, ship colliders, `Collision.js`) remain only for the HUD distance; surface motion of contacts
comes from the touched body (ring spin `omega × r`, `ship.velocity`).

**Body state for animation / audio — `player.body`** (the EvaPhysics instance; station-frame metres, every mode):
```js
player.body.handTargets.left|right = { position, normal, weight /*0..1*/, phase: 'free'|'reach'|'grip'|'brake'|'ladder'|'rail' }
player.body.footTargets.left|right = { position, normal, weight, phase: 'free'|'swing'|'plant'|'ladder'|'brake' }
player.body.bodyAxis      // unit vector neck -> feet
player.body.torsoLean     // { forward, side } radians relative to the view
player.body.crouch        // leg compression after a landing (m; the camera dips by it)
player.body.contact       // { touching, grounded, normal, point, speed /*impact m/s*/, surface: 'interior'|'exterior'|'ship'|'door'|'' }
player.body.events        // this frame's [{ type: 'grab'|'release'|'push'|'brake'|'step'|'land'|'bump', strength, position, limb }]
ctx.events.on('body', (ev) => …)   // the same events as they happen
```

**CollisionWorld (`src/core/CollisionWorld.js`, `ctx.collision`)** — built by `App.start` after the modules have
loaded (after `applyLite`, so 'lite' collides with its batched geometry). Every solid mesh of the station
(exterior, ring, arrays, antennas, airlock hatches), the interiors (station-frame zones and ring zones) and the ships
(L1 + shared holders, in each pivot's frame) is assigned to its parent (anchor); the anchor's triangles are merged
in the anchor frame, split into 12 m chunks with one BVH each; identical anchors (ring sectors, ships of a type)
share them. Queries read the anchors' current `matrixWorld`, so moving parts need no refit. BVHs are built lazily
(first query) and in the background (`collision.update()`, ≤ 3 ms per frame, nearest first): loading only collects.
Not solid: glow / halo / beam / plume / strobe / additive / depth-write-free transparent materials (glass *is*
solid), first-person and shadow-proxy meshes, DetailSet hardware, the spacesuits on their mounts, `userData.noCollide`.
Layers (`COLLIDE`): `EXTERIOR` 1, `INTERIOR` 2, `SHIPS` 4, `DOORS` 8 (under an `userData.animated` pivot), `ALL` 15.
IVA queries `INTERIOR | DOORS`; EVA everything (inside the crew lock `INTERIOR | DOORS`); the observer camera everything.
```js
// coordinates: station-frame metres (= world), or the local frame of opts.frame (e.g. station.ring.group)
// opts = { mask = COLLIDE.ALL, frame = null, ignore = <ship group> }
collision.resolveSphere(center, radius, outNormal?, opts?)   -> boolean  // pushes center out; contacts in collision.contacts[0..contactCount)
collision.resolveCapsule(a, b, radius, outNormal?, opts?)    -> boolean  // a and b move by the same push (collision.lastPush)
collision.sphereCast(from, to, radius, outHit?, opts?)       -> boolean  // outHit { t 0..1, distance, point, normal, body }
collision.raycast(origin, dir, far, outHit?, opts?)          -> boolean  // outHit { t (= distance, m), point, normal, body }
collision.closest(point, maxDistance, out, opts?)            -> boolean  // out { point, normal, distance, body }
collision.distance(point, maxDistance, opts?)                -> number
collision.surfaceVelocity(body, worldPoint, out)             // ring spin / ship velocity of a contact's body
```
Resolve calls do up to three push iterations; callers move in substeps of at most about half the radius (or sweep
first with `sphereCast`) so nothing tunnels. The observer camera (`App.constrainObserver`) sweeps from its last
valid position to where OrbitControls put it and stops at the first surface (radius 0.3 m), then pushes out any
overlap; a free camera should do the same: `sphereCast(prev, next, r, hit)` → stop at `hit.t`, then
`resolveSphere(pos, r)`.

## Time (`ctx.time`, src/core/Time.js)

`SimClock`: `sim` (seconds since `EPOCH_UTC_MS`, double), `dt` (scaled step of the frame, 0 while paused), `realDt`
(wall-clock step, clamped to 1/20 s, also while paused), `rate` (alias `scale`), `paused`, `elapsed` (unpaused real
seconds), `hitch` (true for a few frames after a rate change / pause / jump / traffic fast-forward: the quality governor
and the 'lite' dynamic resolution skip those windows), `utc(out?)`, `utcMs()`, `epochMs`.
Control: `setRate(r)` (0.1 … 10⁶), `faster()` / `slower()` (ladder `TIME_RATES`), `resetRate()`, `setPaused(b)`,
`togglePause()`, `jump(seconds)`, `setUtc(ms | Date)`. Events: `'time:rate' {rate, prev}`, `'time:pause' {paused}`,
`'time:jump' {from, to, delta}` (and the legacy `'timescale'`). `app.paused` is `time.paused` (the pause menu uses it).
Keys: P pause, T presets ×1/×10/×60/×600/×3600, `[` / `]` slower / faster, `\` ×1. UI: `src/ui/TimeControls.js`
(observer panel, free-camera panel, pause menu): pause, «, ×1, », presets ×1 … ×10⁶, UTC readout, −1 h / +1 h /
+1 day / +30 days, a UTC date field.

Behaviour at any rate:
* **Astronaut** (Player.js): physics in sim time, sub-steps ≤ 1/60 s up to `PLAYER_MAX_RATE` = ×10 (slow motion
  works too). Above ×10 the astronaut is **on rails**: position, velocity, sequences and suit consumables freeze
  relative to the station (or the ring deck, which keeps turning with them); the mouse still turns the view.
  `player.state.onRails`, event `'player:rails'`, HUD warning «ФИКСАЦИЯ…», notification.
* **Docking traffic** (Traffic.js): integrated in sub-steps up to 10 s per frame; larger steps and clock jumps
  `fastForward(dt)`: flights in progress jump to their end (docked / gone), the schedule runs event by event
  (≤ 64 per call). Ship radio notifications are muted above ×60 (the log keeps them).
* **Particles**: sim time, but at most ×10 visually; RCS puff look factor follows the same clamp.
* **Earth**: weather fades fine detail above ×10 (Weather.js), lightning in real time; audio runs in real time.
* The free camera and the mouse always run in real time (also while paused).

## Universe and render frames (`ctx.universe`, src/core/Universe.js)

Physics truth is ECI (km, km/s, doubles). The **render frame** = `universe.frame`: `{ name, isStation, axes,
originEci, velocityEci, renderToEci (Matrix4), eciToRender (Matrix4), quat (ECI -> render) }`. The far scene is the
render frame in km, the near scene the same frame in metres.

* Default (`useStationFrame()`): origin = station, axes = station LVLH — the historic frame, identical output.
* `setFrame({ originEci, velocityEci?, axes: 'inertial' | 'lvlh' | 'local' | Matrix4, center?, name })` — call
  every frame (before `universe.update()`; App runs camera controllers first). The orbit outputs are recomputed for
  that observer by `Orbit.applyFrame` (eclipse by the Earth's umbra / penumbra cones and by the Moon, earthLit,
  `earthshine` solid-angle scale, sub-point, `observerAltitudeKm`).
* `orbit.local` = the station's own outputs in station LVLH (sunDir, moonDir, moonPosFar, earthCenterFar, skyQuat,
  earthQuat, sunVisible, sunReddening, sunColor, earthLit, subLat/Lon). **Modules that work in station coordinates
  use `orbit.local`** (solar arrays, radiators, antennas, floodlights, interior window masks, ship views, the
  astronaut's suit temperature / lamp). Far-scene / post modules use the top-level outputs.
* `stationRoot` (near scene): the station, ships, particles, the astronaut's body and tether (App moves every near
  scene child except the camera and the lights into it after construction). Its transform maps station LVLH (m)
  into the render frame; identity by default. Hidden (in non-default frames / the free camera) beyond
  `STATION_VISIBLE_KM` = 300 km. Helpers: `stationToRender(pM, out)`, `renderToStation(pM, out)`,
  `cameraInStation(out)` (ship LOD and the lens-flare occlusion use it), `cameraEci(out)`.
* Transforms: `eciToRender(vKm, out)`, `renderToEci(vKm, out)`, `eciDirToRender(d, out)`, `renderDirToEci(d, out)`.
* Bodies: `addBody({ name, radius, getStateEci(t, outPos, outVel?), farObject?, nearObject?, nearRange? (km),
  orientEci? (Quaternion), depthTolerance?, shells? })` → record `{ positionEci, velocityEci, renderKm, distanceKm }`,
  placed every frame (`farObject` in the far scene in km; `nearObject` in the near scene in m within `nearRange`;
  add the objects to the scenes yourself). `removeBody(b)`, `body('earth' | 'moon' | name)`.
* Gravity: `accelerationEci(r, t, out, { j2, moon, sun })` — Earth μ + J2, Moon and Sun third-body terms
  (`GravityModel` in Astro.js). Ephemeris: `{ sunPositionEci(t, out), moonPositionEci(t, out) }` (sim seconds, km);
  default `OrbitEphemeris` (Orbit.js formulas); `setEphemeris(e)` swaps it for gravity **and** rendering (Orbit uses
  `orbit.ephemeris` for the Sun direction and the Moon when set) — the hook for src/core/Ephemeris.js.
* Propagation (Astro.js, also through the universe): `propagator(accel?)` → `Propagator` with `rk4(state, t, h)`,
  `rk4Span(state, t, dt, hMax)`, `rk45(state, t, dt, { tol, hMin, hMax, maxSteps })` (adaptive Dormand–Prince 5(4),
  either direction; `state = { r, v }`); `kepler(r0, v0, dt, outR, outV, mu?)` (universal variables, any dt, for
  on-rails at high rates); `elements(r, v, out?, mu?, bodyRadius?)` → `{ a, e, i, raan, argp, nu, M, E, p, h,
  energy, periapsis, apoapsis, periapsisAlt, apoapsisAlt, period }`; `stateFromElements(el, outR, outV, mu?)`;
  `apsides(r, v)`; `stationStateEci(t, outR, outV)`; constants `MU_EARTH`, `MU_MOON`, `R_EARTH`, `R_MOON`.
  No per-call allocations; reuse the state objects.
* Depth: in non-default frames (and with the free camera) `updateCameras()` fits the near camera's planes to the
  station / ships (near = 0.4 × clearance) and the far camera's near plane to the nearest body surface (0.4 ×
  clearance to the ground / cloud / aurora shell, ≥ 10 m). When a nearby body would leave a distant multi-shell body
  (`depthTolerance`, Earth: 2 km) with too little depth precision, `universe.farSplit` asks the far pass to draw two
  depth slices (fx/Post.js `renderFarSliced`: everything else first, depth cleared, then the near body on a spare
  layer with its own planes). In the default frame the planes stay 0.05 / 6000 m and 20 / 2.5·10⁶ km.
* Earth.js reads `earthCenterFar` every frame (positions of all shells), the Sun quads sit 10⁶ km from the camera;
  the aurora visibility uses the observer's local vertical. Exposure counts the Moon when it is > 1° across and the
  station cover from the station root; the lens flare tests the colliders in the station frame.

## Free camera (`ctx.freeCam`, src/core/FreeCamera.js; App mode 'free')

C toggles (from the astronaut or the observer camera; menu «СВОБОДНАЯ КАМЕРА», observer button), F → observer.
6-DOF: mouse look (pointer lock, or drag), Q/E roll, W/S A/D Space/Ctrl, Shift ×10, wheel / + / − change the cruise
speed logarithmically (`speedExp` = log10 m/s, −1 … 7.5: 0.1 m/s … 30 000 km/s). Anchors: `'station'` (offset in m in
station LVLH, co-moving; the default frame within 20 km, beyond that the origin follows the camera with LVLH axes;
left beyond 2000 km), `'earth'` (ECI, km), `'moon'` (km from the Moon centre, within
60 000 km); in the last two the render frame follows the camera (floating origin, camera at the render origin) with
inertial axes or the local vertical (O). B returns to the station (overview pose). API: `enter(prevMode)`, `exit()`,
`jumpTo('station' | 'earth' | 'moon')`, `lookAtBody(name)`, `setAxesMode('inertial' | 'local')`, `info(out)`
(altitude, distances to the station and the Moon, speed). App: `toggleFreeCamera()`, `leaveFreeCamera(to?)`.
HUD: `src/ui/FreePanel.js`. The camera never enters the Earth (1 km) or the Moon (200 m).
Collisions (`src/core/CameraCollision.js`, `CameraCollider.constrain(from, to, radius)`, station frame, m): the free
camera (radius 0.25 m, within 20 km of the station) and the observer orbit camera (user moves only; authored views
are placed as they are) stop and slide on the station hull, the airlock and the ships, and inside a compartment stay
within its volumes and off its equipment. Backend: `ctx.collision.sphereCast / resolveSphere` (exact BVH service,
src/core/CollisionWorld.js) when present, otherwise the analytic colliders and the interior volumes; fast moves are
swept in radius-sized steps. Jumps (B, «К …» buttons) teleport without sweeping.
