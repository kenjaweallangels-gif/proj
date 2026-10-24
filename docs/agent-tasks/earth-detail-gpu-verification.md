# Earth detail on a real GPU: verification and tuning

## Goal
Verify on the target PC (RTX 3060 6 GB, 1080p, Chrome) that the round-3 Earth (500 m day / night tiles, 1 km relief
with terrain shadows, translucent sub-texel clouds) looks right, stays within budget and holds 60 fps, and tune the
few parameters that could only be judged in SwiftShader screenshots here.

## Current state (what exists)
- `src/world/TileWindow.js` — toroidal tile windows (day 500 m ultra N=5, night 500 m high N=4 / ultra N=5, relief
  1 km high N=5 / ultra N=8) keyed to the camera's sub-point; ≤ 2 tiles composited per frame; layers fade out above
  ×60 time warp or 2500 km altitude.
- `src/world/Earth.js` — `FEATURES` per preset, `uRelief` (slope exaggeration global / tile, shadows on/off).
- `src/world/shaders/EarthShaders.js` — `GROUND_GPU`: tile sampling (`tileWindow`), relief lighting, terrain shadow
  march (11 steps, 1–58 km), coast refinement from the 500 m colour, night lights from tiles.
- `src/world/shaders/WeatherChunk.js` — sub-texel cloud elements (`cloudCover`), `cloudOpacity`.
- Assets: `public/textures/earth/tiles/{day,night,relief}/`, `tiles/manifest.json`, `earth_relief_{8192,2048}.webp`.

Estimated Earth VRAM: ultra ≈ 0.9 GB (seasonal 8K bake 179 MB, 8K night / clouds / water 43 MB each, 8K relief
~180 MB, day window 192 MB, night window 96 MB, relief window 123 MB), high ≈ 0.6 GB; transient +~250 MB while the
seasonal map is baked at load.

## What to check (acceptance criteria)
1. `?quality=ultra`, views `earth`, `eva`, `sunrise`, free camera; times t=600 (day), 1165 (sunset), 2000 / 2970 (night),
   3200 (sunrise), 71100 + Sun low over Tibet, 87510 (Alps / Italy). Compare with ISS photos (e.g. NASA Gateway to
   Astronaut Photography): mountains readable with shadows at sun elevations 10–40°, no over-exaggerated "embossed"
   look at noon; coasts crisp; no visible tile borders or popping while the window moves (watch at ×1 and ×60).
2. Night: towns are points / road strings, metro areas not saturated blobs; no texel blocks at nadir.
3. Clouds: broken cloud shows ground between elements; no hard white flakes, no regular pattern; cyclones intact.
4. Chrome `about:gpu` / `performance.memory` / WebGL memory extension or the browser task manager: Earth GPU memory
   ultra ≤ 1.2 GB, high ≤ 0.6 GB. Whole scene on ultra ≤ 5 GB.
5. GPU time (`EXT_disjoint_timer_query_webgl2`, shown by the quality governor): Earth ≤ 3–4 ms at 1080p ultra;
   no hitches > 8 ms when tiles stream (each composite regenerates the window's mip chain).
6. 'lite' unchanged; `npm run smoke` passes.

## Tuning knobs
- `uRelief` in `Earth.js` (x global slope gain 2.2, y tile slope gain 1.35, z shadows).
- Shadow ramp in `GROUND_GPU` (`150.0 + d * 25.0`, start lift `+ 60.0`), step count 11.
- Cloud elements: `soft`, the mix factor `(0.45 + 0.4 * smoothstep(0.1, 0.5, c))`, `cloudOpacity()`.
- Night: `core = pow(Ln, 2.2) * 0.36`, halo `0.006`.
- If mip regeneration stutters: batch the slot draws of one frame into a single render (one mip rebuild), or use
  `copyTextureToTexture` + a deferred `generateMipmap`.

## Prompt for a coding agent
> You are working in the orbital-station three.js project (see docs/ARCHITECTURE.md, section "Earth"). On this PC
> with an RTX 3060, run `npm run dev` and open `http://127.0.0.1:5173/?quality=ultra&observer=1&view=earth&t=87510`.
> Verify the acceptance criteria in docs/agent-tasks/earth-detail-gpu-verification.md (visual realism against real ISS
> photos at nadir, oblique and limb views, day / terminator / night; VRAM and GPU time budgets; no tile popping or
> streaming hitches at time scale 1 and 60). Tune only the knobs listed there (Earth.js FEATURES / uRelief,
> EarthShaders.js GROUND_GPU, WeatherChunk.js cloudCover), keep 'lite' unchanged, run `npm run smoke` and
> `npx vite build`, and report before/after screenshots and measured numbers.
