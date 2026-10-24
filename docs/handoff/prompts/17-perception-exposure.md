# 17 — Perception: eye adaptation, helmet optics, ISS-camera mode, phenomena seen from orbit

Goal: what the player sees must be what an astronaut's eye (or an ISS camera) would see.
Do: (1) human eye model: photopic/mesopic/scotopic luminance adaptation with realistic time constants (bright-to-dark minutes for rods: stars and the Milky Way appear gradually after entering eclipse or after looking away from the sunlit Earth; dark-to-bright seconds), Purkinje shift in darkness, glare from the Sun without camera-style lens flares in eye mode; (2) helmet: real visor frame vignette and field of view limits, gold sun visor that can be lowered (key), fogging when the suit is hot, smudges/scratches visible against bright light, visor reflections of the interior/sun; (3) ISS camera mode (toggle): sensor noise, limited dynamic range, white balance, slight chromatic aberration, lens flare/ghosts — so frames match NASA photography; (4) phenomena: noctilucent clouds near the summer pole, sprites above strong thunderstorms (rare), meteors burning below the station, satellite flares, a Starlink train, glints from the station's own arrays; (5) thruster plumes: invisible cold gas except brief ice crystals; hypergolic puffs with a short flash.
Acceptance: screenshot sequences entering eclipse (0, 30, 90, 300 s), looking from the sunlit Earth to deep space, eye vs camera mode of the same scene; compared with ISS photos; post cost <= 1 ms extra.

Also read docs/handoff/SIMULATOR-DESIGN.md and VISION.md (the project is a hyper-realistic astronaut simulator).

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `feat/perception` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only src/fx/Exposure.js, src/fx/Post.js (exposure/eye model only), src/ui/Helmet.js (visor optics), camera-mode post in src/fx/CameraMode.js (new). Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/perception/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
