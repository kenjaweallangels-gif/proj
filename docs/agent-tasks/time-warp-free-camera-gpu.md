# Time warp, render frames and the free camera: verification and tuning on a real GPU

## Goal

The simulation core (time controls, render frames / floating origin, universe API, free camera, camera collisions)
was built and tested in a container without a GPU (SwiftShader, a few frames per second). Verify and tune it on the
user's desktop GPU at 1080p / 60 fps.

## Current state

* `src/core/Time.js` — `SimClock` (`ctx.time`): rate 0.1 … 10⁶, pause, jumps; events `time:rate`, `time:pause`,
  `time:jump`; `time.hitch` makes the QualityGovernor / dynamic resolution skip a measuring window.
* `src/core/Universe.js` — render frame (default = station LVLH, identical output), `setFrame()`, station root,
  bodies, gravity, propagation, adaptive near/far planes and the two-slice far scene (`farSplit`, `fx/Post.js`
  `renderFarSliced`).
* `src/core/FreeCamera.js` + `src/ui/FreePanel.js` — free camera (C), anchors station / Earth / Moon, jumps
  (`?view=free-station|free-earth|free-moon|free-moon-orbit|free-station-high|free-earth-low`).
* `src/core/CameraCollision.js` — free / observer camera vs hull, ships, compartment walls (falls back to analytic
  colliders until `ctx.collision` from `src/core/CollisionWorld.js` exists).
* `src/fx/Exposure.js` — spot metering of a distant Earth / large Moon (constants `moonRadiance`, `earthRadiance`).
* Tests: `npm run smoke` (time controls, free camera, collisions), `node tools/astro-test.mjs`.
* Default-mode screenshots (overview, eva, inside, earth, night) were pixel-compared before / after: identical scene
  content (draw calls and triangle counts equal); the new per-frame code does not show up among the hot functions of a CPU profile (each < 0.3 ms per frame; the
  container was heavily loaded, so the absolute numbers were noisy).

## What could not be verified here

1. 60 fps at ×3600 … ×10⁶ on ultra/high (weather, SurfaceDetail tile streaming around a fast-moving sub-point,
   ship fast-forward) and that the governor does not step down because of warp hitches.
2. Depth precision in the free camera: Earth clouds / ground / aurora shells seen from 30 000–400 000 km, the
   Moon in front of the Earth from lunar orbit (two far slices), no z-fighting or popping when the slice switches.
3. Exposure / lens flare / bloom look near the Moon and far from the Earth (the Moon shader is bright; the
   `moonRadiance` spot constant may need tuning together with the new Moon from the Moon/planets work).
4. Free camera feel: mouse sensitivity, speed steps, smoothing (`SMOOTH`), O (local vertical) mode, collisions
   (stop / slide) along the hull and inside modules, the observer camera never entering the hull.
5. SurfaceDetail (ultra 500 m window) when the camera is far from the Earth — it may stream tiles needlessly.

## Acceptance criteria

* ultra and high hold ≥ 58 fps at 1080p in: overview at ×1, ×600, ×3600, ×86400; free camera at the station,
  over the Earth (`free-earth`, `free-earth-low`), at the Moon (`free-moon`, `free-moon-orbit`).
* Governor level does not drop when the rate is changed or the clock jumps (watch the HUD fps line).
* No z-fighting / flicker of Earth layers from any distance; Earthrise view shows a clean lunar limb over the Earth.
* Exposure: the sunlit Moon and the full Earth are not blown out, the night side is not black.
* Free / observer camera never shows the inside of a hull part; inside a module it never leaves the cabin.
* `npm run smoke` passes.

## Prompt for a coding agent

```
You are working on a three.js r186 / Vite 8 space scene (README.md, docs/ARCHITECTURE.md — read the sections
"Time", "Universe and render frames", "Free camera"). Run `npm run dev` and open it in Chrome on this GPU machine.
1. With the HUD fps counter visible, measure ultra and high at 1080p in the views listed in
   docs/agent-tasks/time-warp-free-camera-gpu.md (time rate buttons in the observer / free-camera panel, keys
   [ ] T P, URL ?view=free-moon etc.). Profile any view below 58 fps (Chrome Performance panel) and fix the cause
   (e.g. skip SurfaceDetail updates when universe.camera.altitudeKm > 2000, throttle weather updates at high rates).
2. Fly the free camera (C; wheel = speed) from the station to the Moon and back (B). Look for depth artefacts
   between the Earth's ground / clouds / aurora / atmosphere shells and for popping when universe.farSplit toggles;
   tune Universe.updateCameras (near-plane factor 0.4, Earth depthTolerance 2 km) if needed.
3. Tune src/fx/Exposure.js (moonRadiance, earthRadiance, the spot ramp) so the Moon and the distant Earth expose well.
4. Check camera collisions (src/core/CameraCollision.js) along the hull, the ring and inside modules; if
   src/core/CollisionWorld.js (ctx.collision) exists, verify the sphereCast / resolveSphere path is used.
Keep the default view (station frame) pixel-identical; run `npm run smoke` and `npx vite build` before committing.
```
