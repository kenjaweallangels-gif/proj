# 00 — Merge the WIP branches into the main line

Task: integrate the remote branches wip/sky-telescope, wip/player-body-collision, wip/geometry-materials, wip/earth (in this order), then wip/spacesuit, wip/audio, wip/desktop-electron (these three are 8-9 commits behind; merge the main line into each first, in a separate worktree).
For each branch: `git merge --no-ff origin/wip/<name>`; resolve conflicts by keeping BOTH sides' intent (they own different subsystems; see the "Owns files" column in docs/handoff/ROADMAP.md); run `npx vite build`, `npm run smoke`, and screenshots of overview, eva, inside, interior-ring, cupola-inside, earth, free-moon. If a branch breaks the smoke test, fix the integration (not by deleting checks). If a WIP branch is clearly unfinished and breaks things you cannot fix in reasonable time, merge it behind a URL flag or revert the offending commit and record it in STATUS.md.
Known integration points: CollisionWorld (wip/player-body-collision) must be set as ctx.collision so src/core/CameraCollision.js uses it; the Moon module (wip/sky-telescope) is registered as universe body 'moon' and Ephemeris via universe.setEphemeris; geometry/materials touched src/station/** and src/ships/** widely — keep its fixes, re-apply small changes from other branches by hand if needed; wip/earth adds ~3500 tile files (fine).
Acceptance: one main line containing all seven branches, smoke green, screenshots reviewed, STATUS.md rewritten to the new state.

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `integrate/wip` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only any file (merge resolution). Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/merge/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
