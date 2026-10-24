# 08 — Interior equipment of complex shape and loose items with physics

Goal: inside the station, things have complex real shapes and obey physics: in zero-g loose items float, drift, rotate and react to the player's pushes and collisions; in the ring they fall and slide; tethered items (bungees, velcro) stay attached unless pulled off.
Do: a rigid-body engine (e.g. Rapier via @dimforge/rapier3d-compat in a Web Worker, or a custom solver) with convex hulls/compound shapes from the render meshes; zero-g in modules (station frame), centrifugal + Coriolis in the ring frame; sleeping, CCD for small fast items; interaction: the player's body (package 03) pushes items, can grab/carry/throw them (E), items bump softly; content: CTB bags with straps, tools (wrenches, drills), laptops on arms (articulated), cables, food packs, drink pouches, cameras, checklists on velcro, notebooks, pens on tethers, water bubbles (optional) — modelled with real shapes and textures; 50-150 dynamic items per module, sleeping when idle; persistence while moving between zones.
Acceptance: smoke checks (an item drifts after a push and stops on a wall; an item falls on the ring deck); physics step <= 1 ms on the worker, main thread cost <= 0.3 ms; screenshots of populated lab, galley, ring cabin.

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `feat/props` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only src/station/interior/props/** (new), a physics worker if used, minimal hooks in Interior.js. Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/props/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
