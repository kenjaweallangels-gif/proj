# 03 — Body 1.8 m, exact collisions, automatic body actions

Goal: a full-weight 1.8 m body that never passes through geometry and moves like a real person by force: the player gives intent, the body acts. Complaints: dwarf/squashed height in the ring, passing through walls/"textures", movement does not feel physical.
Start from the main line after package 00 (wip/player-body-collision merged); read docs/agent-tasks/player-body-mechanics.md.
Do: eye height 1.68 m standing; capsule body (unsuited ~0.3 m radius; suited larger); BVH collisions everywhere (station, interiors, ships, ring in its rotating frame) with swept tests, no tunnelling; zero-g: automatic reach-grab-push on handrails when moving along a tunnel (hand-over-hand, momentum conserved, arm reach and muscle force limits, slight rotation from off-centre pushes), automatic braking with hands (head-first) or feet (feet-first) when approaching a wall over 0.2-0.4 s, gliding along surfaces; ring: walking with step cadence, acceleration limits, Coriolis, stairs/ladders with hand placement, jump landings absorbed by legs; suited motion slower and stiffer than unsuited; `player.body` targets/events for animation (package 05) and audio (package 06) in all modes.
Acceptance: smoke checks for auto-grab in the lab tunnel, wall braking, ring corridor walking, ladder, EVA hull contact, no wall pass-through at 5 m/s; a short screen recording (tools/demo.mjs) reviewed for smoothness; JS cost of collisions <= 0.3 ms/frame.

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `feat/body` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only src/player/* except SuitModel.js and suit/**, src/core/CollisionWorld.js, src/station/interior/* (proportion fixes only). Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/body/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
