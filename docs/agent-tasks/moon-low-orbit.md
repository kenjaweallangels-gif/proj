# Moon: surface detail for a 50–100 km lunar orbit

## Goal
Make the Moon convincing from a low lunar orbit (50–100 km altitude, the flight stage that follows) and give the
flight code height queries for altimetry / collision.

## Current state
* `src/world/Moon.js` (module, `ctx.moon`, the universe's built-in `moon` body) and
  `src/world/moon/MoonSurface.js` (cube-sphere quadtree, 16×16-cell patches with skirts, CPU displacement, LOD by
  projected cell size, `maxLevel` 10 = 0.17 km cells, horizon + frustum culling, ≤ 8 patch builds per frame, LRU).
* Heights: LOLA 4096×2048 (2.7 km/px) in `textures/moon/moon_height_4096.bin` (gzip, int16 row deltas, 0.5 m), CPU
  bilinear `heightKmDir(dir)` / `heightAt(lat, lon)`; half-float GPU copy for the terminator shadow march.
* Colour / normals: global 2K…8K, plus one 16K (0.67 km/px) colour + normal tile pair streamed under the view axis
  (`_loadDetail`), selected when the Moon is > 3500 px across.
* At 100 km (`?view=free-moon-orbit`) the surface reads well at large scale but is soft below ~1 km (no data).

## Work
1. Finer heights: build 16K-level LOLA height tiles (`ldem_64_uint.tif` via `tools/sky/fetch_svs.sh`, cut like
   `tools/sky/build_moon_tiles.py`, int16 deltas + gzip as `MHT1`) and stream the tile(s) under the camera; make
   `heightKmDir` sample the finest resident tile.
2. Procedural detail below the data: crater population (power-law sizes, fresh / degraded profiles) and regolith
   noise, deterministic per patch; add to the displacement in `MoonSurface._buildPatch` and as detail normals in
   the shader (fade by distance).
3. More than one 16K tile pair when the view spans a tile edge (or a virtual-texture page cache), within the VRAM
   budget (sky + Moon + planets ≤ ~800 MB on ultra).
4. Per-patch bounding boxes (min / max height) for culling; expose `moon.raycast(originBody, dirBody)` and
   `moon.altitudeAt(posBody)` for the flight code.

## Acceptance criteria
* From 50–100 km at 1080p: craters down to ~100 m scale visible near the camera, no cracks / popping between LOD
  levels, terminator shadows consistent with the geometry, ≥ 60 fps on an RTX 3060-class GPU.
* `heightAt` agrees with LOLA to ±10 m where data exists.
* `npm run smoke` / `npx vite build` pass; `?view=free-moon-orbit` screenshots before / after.

## Prompt for a coding agent
> In the orbital-station project (docs/ARCHITECTURE.md, section "Moon"), extend `src/world/Moon.js` and
> `src/world/moon/MoonSurface.js` for a 50–100 km lunar orbit following docs/agent-tasks/moon-low-orbit.md: stream
> 16K-level LOLA height tiles (new build script in tools/sky/), add deterministic procedural crater / regolith detail
> below the data resolution in the patch builder and the shader, support more than one 16K colour / normal tile, add
> per-patch height bounds and `raycast` / `altitudeAt` helpers. Keep the camera-relative patch matrices, the layer
> sync for the universe's depth split and the VRAM budget. Verify with `?view=free-moon-orbit` on a GPU, run
> `npm run smoke` and `npx vite build`, commit with screenshots.
