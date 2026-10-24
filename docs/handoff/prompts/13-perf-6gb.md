# 13 — No fps drops on the RTX 3060 6 GB without quality loss

Do: KTX2 texture pipeline (toktx/basisu: BC7/UASTC for colour, BC5 for normals; KTX2Loader with transcoder) for all large textures with a build script and fallbacks; streaming with priorities and eviction to keep VRAM <= 5 GB on ultra; move weather CPU work, tile decoding, physics (props, rope) and audio synthesis prep to Web Workers; eliminate GC spikes (allocation profiler) and shader compiles during play; frame pacing (requestAnimationFrame timing, avoid long tasks > 4 ms); governor using real GPU timers; occlusion/zone culling audit; measure p50/p95/p99 frame times in standard views and during transitions (zone changes, docking, tile loads, time warp).
Acceptance: p99 frame time <= 20 ms and p50 <= 15 ms on ultra 1080p in all QA views on the user's RTX 3060 6 GB; VRAM report; no visible quality loss (side-by-side screenshots).

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `feat/perf` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only loaders/texture pipeline, tools/, workers, QualityGovernor. Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/perf/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
