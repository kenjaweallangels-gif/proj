# 05 — Realistic spacesuits and a full first-person body (suited and unsuited) with IK

Goal: suits rebuilt after real ones (primary: Russian Orlan-MKS; second: EMU/xEMU-class) with all details and textures; a full-weight first-person body: looking down shows torso, legs, feet; hands with five articulated fingers grip rails; the same quality unsuited (crew clothing: polo/shirt with seams and patches, cargo trousers with pockets and velcro, socks/shoes, watch; realistic skin shading).
Start from wip/spacesuit (merged in package 00) and the `player.body` interface from package 03.
Do: skinned or rigid-segment rig with two-bone IK for arms/legs driven by player.body.handTargets/footTargets, finger curl on grip, torso lean, neutral zero-g posture, idle micro-motion; camera inside the helmet/head without clipping; full-body model for the observer camera and the suits on the airlock mounts (Orlan with the open backpack hatch); SAFER backpack with nozzle clusters and the waist tether reel visible (package 10 animates them); LOD0..LOD2; `userData.noCollide = true` on all body meshes.
Acceptance: `?suitshow=1` views front/back/side/detail compared with photos of Orlan-MKS and EMU; first-person screenshots looking down suited and unsuited in the lab, ring and EVA; grip on a handrail close-up; budgets: first-person <= 60 draw calls / 0.3 M tris, all suits+bodies VRAM <= 0.35 GB.

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `feat/suit` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only src/player/SuitModel.js, src/player/suit/**, src/player/Body*.js (visual rig), suit meshes in src/station/interior/AirlockInterior.js, src/ui/Helmet.js (visor visuals). Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/suit/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
