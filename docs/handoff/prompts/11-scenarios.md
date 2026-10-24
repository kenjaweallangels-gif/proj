# 11 — Scenarios: asteroid flyby, comet, launch -> rendezvous -> docking -> undocking -> landing

Use ctx.universe (bodies, gravity, propagators, setFrame) and ctx.time (rates, jumps). All in real time with time acceleration available; launch from Baikonur when the station's ground track passes nearby.
1. Asteroid flyby: an object several times larger than the station (e.g. 400-600 m, irregular shape with craters/boulders, real-looking regolith albedo ~0.1-0.2) on a hyperbolic geocentric trajectory (not captured by Earth), passing at a distance where its shape is clearly visible but it is not close (e.g. 20-60 km), with Earth's surface behind it; scripted start from the menu and at a given UTC; tracking hints; optional telescope target.
2. Comet: heliocentric orbit (use real elements from public data or a plausible invented one), visible over weeks at x86400-x10^6: brightening, coma and two tails (dust curved, ion straight anti-sunward, physically oriented), tail growth near perihelion, fading and disappearance; observable from the station and in the telescope.
3. Launch and return: a Soyuz-2-class rocket from Baikonur seen from orbit (plume, staging: boosters at ~T+118 s (cross), core at ~T+287 s, fairing, third stage), insertion, fast rendezvous (~3 h, two orbits) with burns, approach to the 150 m hold, docking to a port (reuse Ships/Traffic docking); after N days (time warp) undocking, deorbit burn, module separation, reentry plasma trail visible from orbit, landing near the launch region in Kazakhstan; radio messages in Russian; HUD timeline.
Acceptance: each scenario launchable from the menu and by URL (`?scenario=asteroid|comet|launch`), smoke checks for scenario start and key milestones at high time rates, screenshots of key moments.

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `feat/scenarios` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only src/scenarios/** (new), bodies via ctx.universe, menu entries in src/ui/Menu.js. Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/scenarios/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
