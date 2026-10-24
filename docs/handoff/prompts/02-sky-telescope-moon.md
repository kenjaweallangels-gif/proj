# 02 — Real sky, telescope, Moon for low orbit

Goal: the night sky as close as possible to the real one, and a telescope to observe planets, a realistic Moon surface, nebulae and galaxies. Complaints: sparse sky, some stars blink like artificial lights, the Milky Way looks like blotches, the Sun does not look real (the Sun itself belongs to package 09).
Start from the main line after package 00 (wip/sky-telescope merged); read docs/agent-tasks/sky-telescope-gpu-verification.md and moon-low-orbit.md.
Do: verify star brightness/colour/PSF stability on the GPU (no shimmer while turning or during exposure changes), Milky Way fine structure at full 8K, correct dark-adapted vs sunlit exposure, planets' magnitudes/phases, Moon phase/earthshine/libration; telescope UX (search, tracking, zoom 60°..0.05°, DSO tiles placement, Gaia stars appearing with zoom); Moon for low orbit: chunked LOD with LOLA displacement and 16K colour/normal tiles so that the view from 50-100 km above the Moon is convincing (procedural craters/regolith detail below tile resolution), works with the free camera (`?view=free-moon-orbit`) and later with the piloted shuttle.
Acceptance: screenshots vs Stellarium/real photos for Orion, Sagittarius (Milky Way core), Pleiades, Moon at 3 phases, Jupiter with moons, Saturn with rings, M42/M31 in the telescope, the Moon from 80 km; sky+Moon VRAM <= 0.8 GB, normal view sky cost <= 1 ms.

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `feat/sky` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only src/world/Sky*.js, src/world/Moon*.js, src/world/shaders/Sky*, src/core/Ephemeris.js, src/ui/Telescope*.js, public/data/**, public/textures/sky/**, public/textures/moon/**. Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/sky/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
