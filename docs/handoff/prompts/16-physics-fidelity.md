# 16 — Physics fidelity: orbital relative motion, rigid bodies, reaction forces, fixed step

Goal: no physics shortcuts anywhere near the station.
Do: (1) a fixed-step physics loop (240 Hz accumulator, interpolated rendering) shared by the player, rope, props and ships; (2) free-flying objects near the station (astronaut without tether, dropped tools, debris, props that leave through the hatch) move by relative orbital dynamics (Clohessy-Wiltshire / full ECI propagation via ctx.universe) — a tool released with 0.1 m/s radial velocity must trace the correct loop and drift; (3) rigid bodies with full inertia tensors and undamped free rotation (intermediate-axis instability/Dzhanibekov effect visible on a spun wing nut); (4) Newton's third law for every hand action: torque on a bolt rotates the astronaut unless anchored (foot restraint/APFR, handrail grip, tether), pushing a 100 kg cargo bag moves both, momentum conserved; (5) ring: g gradient head-to-feet, Coriolis deflection of falling objects, optional head-turn cross-coupling discomfort; (6) orbit decay from drag with a density model and occasional reboosts from a docked cargo ship (felt as a gentle push, heard through structure).
Acceptance: unit tests in tools/astro-test.mjs comparing CW drift against analytic solutions; smoke checks: released tool drift after 10 min sim time matches CW within 5 %, spun asymmetric body flips (intermediate axis), unanchored bolt torque spins the astronaut; physics JS <= 1.5 ms/frame total.

Also read docs/handoff/SIMULATOR-DESIGN.md and VISION.md (the project is a hyper-realistic astronaut simulator).

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `feat/physics-fidelity` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only src/core/Physics*.js (new), src/player/* physics parts, free-body/props integration hooks, tools/astro-test.mjs. Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/physics/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
