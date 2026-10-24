# 14 — Port to Unreal Engine 5 (second PC: Ubuntu, RTX 3060 12 GB)

First read docs/agent-tasks/ue5-port/ if present (from wip/desktop-electron) and docs/handoff/DIAGRAMS.md. Produce and then execute a phased plan:
0. Build UE5 from source on Ubuntu (Epic account linked to GitHub), Vulkan, NVIDIA driver; verify Lumen and hardware ray tracing support on Linux/Vulkan first (decisive risk).
1. Project skeleton (C++ + Blueprints), Large World Coordinates, floating origin; port Orbit/Universe/Time/Ephemeris to C++ (double precision ECI).
2. Earth: SkyAtmosphere + VolumetricCloud + planet material with the existing NASA textures (virtual textures), night lights, weather.
3. Station/ships: exporter from this codebase (Node/Playwright script building the scene and exporting glTF per part/LOD with GLTFExporter), import, Nanite, materials mapped to UE PBR.
4. Interiors and lighting (Lumen, hardware RT, rect lights). 5. Player body/IVA/EVA (custom zero-g movement component, Control Rig IK). 6. Ships/traffic/docking. 7. Sky/telescope/Moon. 8. Audio (MetaSounds). 9. Scenarios and shuttle. 10. Linux packaging.
Each phase: acceptance criteria mirroring docs/handoff/QA-CHECKLIST.md, one branch per phase, interface contracts written before parallel work.

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `ue5 (new repository)` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only a new UE5 project repository. Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/ue5/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
