# 18 — Station systems, emergencies, procedures and missions

Goal: the station is a living system and the player is a crew member with duties.
Do: (1) system models with real-order numbers: ECLSS (O2 generation, CO2 removal, humidity, water recovery, per-module atmosphere), power (array tracking, batteries discharging in eclipse, load shedding), thermal (ammonia loops, radiators), attitude (CMGs with momentum saturation and thruster desaturation), comms windows with ground (MCC-Moscow/Houston, Russian/English phraseology, blackout zones); (2) caution & warning: panels, tones, PA voice, real procedures for fire (spherical flames, extinguisher, gas masks), depressurisation (leak search, closing hatches, Δp readings), toxic atmosphere, debris avoidance; (3) suit consumables and EVA prep: O2 prebreathe/denitrogenation timer, leak check, cuff checklist, suit cooling control, overheating/fogging with high workload, CO2 in the helmet; (4) crew day timeline (wake, conference, exercise 2.5 h, science, maintenance, cargo transfer, sleep) and missions: ORU replacement EVA with torque tool and foot restraint, MMOD damage inspection, payload install, cargo unloading from Progress/Dragon, emergency drills; scoring by safety, time and procedure adherence; (5) neutral buoyancy training mode (underwater mock-up, buoyancy, drag, safety divers) as a stretch goal.
Acceptance: each system visible in HUD panels with plausible values over a full orbit; scripted emergencies runnable from the menu with procedures; at least three missions playable start-to-finish; smoke checks for emergency start/resolve.

Also read docs/handoff/SIMULATOR-DESIGN.md and VISION.md (the project is a hyper-realistic astronaut simulator).

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `feat/systems` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only src/systems/** (new: ECLSS, power, thermal, attitude, comms, alarms), src/missions/** (new), HUD panels in src/ui/. Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/systems/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
