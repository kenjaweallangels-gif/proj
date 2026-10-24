# GPU verification: station / ship surfaces, clear glass, closed geometry

## Goal
Confirm on a real GPU (target: RTX 3060 6 GB, 1920×1080, `ultra` and `high`) that the geometry-quality pass looks
and performs as intended — this could only be checked on SwiftShader (CPU rasteriser) when it was written.

## Current state (what was changed)
* Baked PBR texture sets in `public/textures/station/` (4K on ultra, 2K otherwise) for the hull paint, MLI, beta
  cloth, brushed / machined metal and an interior micro-detail set; loaded by `Textures.pbr()` (src/core/Textures.js),
  used by `Materials.js` (`hullWhite`, `hullWhiteAged`, `hullGray`, `mliGold`, `mliSilver`, `metalBare`, `betaCloth`,
  `metalMachined`) and the ships' `shipHull` / `shipMli`. Interior materials add tri-planar micro detail
  (src/station/interior/Materials.js, `DETAIL_*`).
* Clear glass (`clearGlass` in src/core/Materials.js; exterior `glass`, interior `int:glass`): reflection + Fresnel
  only, custom blending ONE / ONE_MINUS_SRC_ALPHA, 2–3 % absorption, scratch roughness map.
* Closed solids everywhere (airlock exterior + outer hatch, docking ports / hub, cupola, truss supports, hull parts
  wrapped onto the curved hulls, interior pressure-shell liners). See docs/ARCHITECTURE.md "Geometry quality".
* `tools/gapcheck.mjs` finds holes / cracks / back faces / z-fighting automatically.

## Files
src/core/Materials.js, src/core/Textures.js, src/station/parts/*.js, src/station/interior/*.js,
src/ships/ShipBuilder.js, src/ships/types/*.js, tools/bake_station_textures.py, tools/fetch_station_textures.py,
tools/gapcheck.mjs, tools/gapcheck/probe.js.

## Acceptance criteria
1. VRAM: with `?quality=ultra`, the textures of the station + ships (renderer.info.memory + a GPU memory tool) stay
   ≤ 1.5 GB; `high` ≤ 0.7 GB. If not, drop the 4K hull albedo/normal to 2K (`Textures.pbr`, `pbrHi`) or convert the
   sets to KTX2 (basisu) with `KTX2Loader`.
2. Frame rate: 60 fps at 1080p on ultra in the views `eva`, `airlock`, `hub`, `docking`, `inside`, `cupola-inside`
   (QualityGovernor may step down at most one level). Triangles ≤ ~6 M (EVA) / ≤ ~3.5 M (inside), draw calls
   ≤ ~1500 / ≤ ~800.
3. Glass: in `cupola-inside` at t=600 (day) and t=2000 (night) the Earth / stars are seen without any grey haze;
   reflections of the cabin appear only at grazing angles; the Sun's highlight shows faint scratches. Module windows,
   ring window bands and ship windows look the same way from outside.
4. Surfaces: hull paint reads as slightly off-white painted aluminium with visible panel seams, rivet rows, faint
   stencils and wear; MLI shows crinkles that sparkle; no visible texture tiling at 5–20 m; no moiré on the 4K maps
   (anisotropic filtering on).
5. `node tools/gapcheck.mjs --set=exterior --sample=60`, `--set=interior --sample=60`, `--set=ships` report no holes,
   cracks or z-fighting outside intended openings (open hatches, windows); back faces only where a camera sits in a
   tight spot.

## Prompt for a coding agent
"Open the project (three.js r186, Vite). Run `npm run dev` and check, on a GPU, the station surfaces and glass as
described in docs/agent-tasks/geometry-surfaces-gpu.md. Measure VRAM (Chrome task manager GPU memory or
`chrome://gpu`, and `renderer.info.memory`) and fps at 1920×1080 for `?quality=ultra` and `?quality=high` in the
views eva, airlock, hub, docking, inside, cupola-inside (`?view=<name>&autostart=1`). If VRAM exceeds the budget,
reduce `Textures.pbr` resolutions or add KTX2 compression; if the glass shows haze or banding, tune `clearGlass`
(absorb, Fresnel factor) in src/core/Materials.js. Run tools/gapcheck.mjs for the three sets and fix any reported
hole / crack / z-fight in src/station or src/ships with closed, thick geometry (see docs/ARCHITECTURE.md, 'Geometry
quality'). Keep 'lite' working. Commit with a clear message."
