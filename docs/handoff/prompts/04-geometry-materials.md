# 04 — Geometry without gaps, thick walls, finished models, realistic surfaces, clear glass

Goal: everything full-weight: no gaps, no see-through seams, real wall thickness at visible edges, no placeholder primitives, realistic PBR textures (2K-4K), more equipment inside and outside, optically clear glass. Applies equally to the station, all docking modules/adapters and every ship (and the shuttle of package 12 should reuse the kit).
Start from the main line after package 00 (wip/geometry-materials merged); read docs/agent-tasks/geometry-remaining.md and geometry-surfaces-gpu.md.
Do: run `node tools/gapcheck.mjs` (key-colour hole detection from many viewpoints) until it reports none; close every remaining open shell, add thickness/frames/fillets/flanges, replace primitive-looking parts; textures: higher quality hull paint, MLI with crinkle normals, beta cloth, anodised and bare metals, interior plastics/fabrics/labels, wear and grime via curvature/AO bakes; more installed equipment inside (fixed racks, panels, cable runs) and outside (payloads, cameras, antennas, handrails, WIFs) — loose items belong to package 08; glass: thin, clear, multi-pane with edge thickness, grazing-angle reflections only, no haze.
Acceptance: gapcheck clean; before/after screenshots of airlock, lab, node, ring deck, cupola (day and night), hub with docked ships, each ship type close up (`?shipshow=clean`); within BUDGETS.md (station+ships VRAM <= 1.5 GB).

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `feat/geometry` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only src/station/**, src/ships/**, src/core/Materials.js, src/core/Textures.js, tools/gapcheck.mjs, public/textures/station/**. Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/geometry/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
