# AGENTS.md — rules for coding agents (Codex CLI, Claude Code, Kimi Code)

This file is read automatically by Codex CLI (and is a good first read for any agent). Read it fully before
touching code, then read `docs/ARCHITECTURE.md` (module contracts) and `docs/handoff/README.md` (where the
project stands, what to do next).

## The project in one paragraph

«Аврора» is a browser/desktop 3D space simulation: a large station in a 410 km / 51.64° orbit (pressurised
modules with full interiors, a rotating artificial-gravity ring, docking hub, truss, arrays), real-vehicle-class
visiting ships with docking traffic, a playable first-person astronaut (unsuited inside the station, suited on
EVA through a two-section airlock), a physically based Earth (NASA imagery, weather, cyclones, lightning, city
lights, aurora), real sky (star catalogues, Milky Way, planets, Moon) and a telescope, time controls and a free
camera that can fly to the Moon. The goal is maximum realism (visual and physical) at **1080p / 60 fps on an
NVIDIA RTX 3060 6 GB under Ubuntu**, later a higher tier for an RTX 3060 12 GB (see `docs/handoff/ROADMAP.md`).
All UI text is **Russian**; code, comments and commit messages are **English**.

## Stack and layout

- three.js r186 (WebGL2), Vite 8, plain ES modules, no framework, no TypeScript. `three` is aliased to
  `src/core/three-lod.js` (geometry detail factor); the original is `three-original`.
- `src/core` (App loop, Renderer, Orbit, Universe/render frames, Time, Materials, Textures, QualityGovernor,
  StaticBatcher, collisions), `src/world` (Earth, Sky, Moon, weather), `src/station` (exterior parts, interiors),
  `src/ships`, `src/player`, `src/ui`, `src/audio`, `src/fx` (post-processing, AO, flare, exposure),
  `public/` (textures, data, audio), `tools/` (headless verification tools), `docs/`.
- Two scenes: the **far** scene in km (Earth, sky, Moon) is drawn first, depth is cleared, then the **near** scene
  in metres (station, ships, player). Physics truth for anything orbital is ECI (km, double precision); see
  "Universe and render frames" in `docs/ARCHITECTURE.md`.

## Commands

```bash
npm ci                         # install (Node 20+ LTS)
npm run dev                    # http://127.0.0.1:5173/
npx vite build                 # must pass before every commit
npm run smoke                  # end-to-end game-flow test (headless Chromium); must pass before merging
node tools/smoke.mjs --only=core   # fast subset: time controls, free camera, astro unit checks
node tools/astro-test.mjs      # orbital-mechanics unit checks (plain Node)
node tools/screenshot.mjs --quality=ultra --w=1920 --h=1080 --views=overview,eva,inside --t=600 --out=shots/x
node tools/fps.mjs --quality=ultra --w=1920 --h=1080 --views=eva,overview,inside --seconds=10 --params="nolock=1"
node tools/cpuframe.mjs --quality=ultra --w=1920 --h=1080 --view=eva --seconds=20   # main-thread JS per frame
```

**Use the real GPU on your machine:** prefix tools with `GPU=1` (ANGLE on Vulkan); if the headless shell does not
get the GPU on your driver stack, add `HEADED=1` (opens a window). Without `GPU=1` the tools use SwiftShader
(CPU, slow, only for correctness). Check what you got: the screenshot/fps output prints draw calls and the app
logs the WebGL renderer string; it must name the NVIDIA GPU.

Useful URL params: `?quality=ultra|high|medium|low|lite`, `?view=<name>` (see `App.setView`, station.viewpoints,
interior views `interior-*`, `cupola-inside`, `airlock-inside`, free-camera views `free-*`), `?t=<sim s>`
(600 day, 1165 sunset, 2000 night, 3200 sunrise), `?timescale=`, `?utc=<ISO>`, `?start=inside|airlock`,
`?governor=0`, `?minh=<lines>`, `?ao=0`, `?interior=0`, `?shipshow=clean`, `?shipsoff=1`, `?autostart=1`,
`?nolock=1`, `?shot=1` (fixed dt, used by tools).

## Hard rules

1. **Never break the running app.** After every change: `npx vite build`; before merging a branch: `npm run smoke`
   (all checks) and screenshots of the views your change touches. Do not delete or skip smoke checks; fix them.
2. **Performance budgets** (RTX 3060 6 GB, 1920×1080, ultra preset) are in `docs/handoff/BUDGETS.md`. Measure
   with `GPU=1 node tools/fps.mjs` and `cpuframe.mjs` before/after. 60 fps must hold in the standard views;
   the QualityGovernor may lower effects, never the 1080-line floor.
3. **No per-frame allocations** in update/render paths (reuse scratch vectors/matrices). Merge static geometry
   per material; InstancedMesh for repeats; never share one material between instanced and plain meshes
   (see `App.splitMaterialVariants`). Mark non-solid meshes `userData.noCollide = true`.
4. **Keep contracts** in `docs/ARCHITECTURE.md` stable; when you extend one, update that document in the same
   commit. Keep `README.md` (Russian, user-facing) in sync with controls/params.
5. **Assets:** only redistributable licences, credited in `public/textures/CREDITS.md` (or the matching
   CREDITS file); each file < 95 MB (GitHub limit); add the build script under `tools/` for anything derived.
   Total VRAM on ultra ≤ 5 GB.
6. **Style:** match the surrounding code (naming, comment density, compact helpers). English comments explain
   *why*. Russian strings for anything shown to the user. Run `node --check <file>` on every touched file.
7. **Git:** one work package per branch (`feat/<topic>`), small focused commits with clear messages, merge into
   the main line only when build + smoke + screenshots are clean. Never rewrite published history.
8. **Realism first:** physical units (m, kg, s, km for far scene), real reference data (NASA/ESA/JPL), real
   hardware proportions. If you invent something, make it plausible and say so in a comment.

## Where to start

`docs/handoff/README.md` → `docs/handoff/STATUS.md` → pick the next package in `docs/handoff/ROADMAP.md` →
use its prompt in `docs/handoff/prompts/`.
