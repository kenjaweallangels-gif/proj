# 07 — Desktop application for Ubuntu (no browser), smooth frame pacing

Goal: run the project as a native app on Ubuntu (RTX 3060) without a browser or local server, with no fps drops and no quality loss.
Start from wip/desktop-electron (merged in package 00): Electron shell serving dist/ over app://.
Do: AppImage + .deb + unpacked dir (`npm run dist:linux`), `.desktop` launcher with icon, `start-desktop.sh`; Chromium switches for games (ignore-gpu-blocklist, gpu rasterization, zero-copy, ANGLE Vulkan backend option, WebGPU enabled, background throttling off, optional uncapped frame rate/vsync off, larger V8 heap); `--gpu-info` diagnostic printing the WebGL/WebGPU renderer and active GPU; PRIME offload notes for hybrid laptops; X11/Wayland flags; settings file and CLI flags (`--quality=ultra --fullscreen --vsync=off`); F11 fullscreen; native error dialog without WebGL2; Russian user guide desktop/README-RU.md.
Acceptance: the AppImage starts on the user's Ubuntu PC and `--gpu-info` names the RTX 3060; fps equal or better than Chrome in the same views; smoke still passes in the browser.

## Common instructions

Read AGENTS.md, docs/ARCHITECTURE.md, docs/handoff/README.md, STATUS.md, BUDGETS.md, DIAGRAMS.md and QA-CHECKLIST.md first.
Work on branch `feat/desktop` (create it from the current main line; if a WIP branch is named below, start from it and merge the main line in).
Target: Ubuntu, NVIDIA RTX 3060 6 GB, 1920x1080 at 60 fps on the ultra preset; run the tools with GPU=1 so you measure the real GPU.
Scope: you may edit only desktop/**, package.json scripts/devDependencies, electron-builder config, README launch section. Anything else: minimal hooks, listed in your final summary.
Definition of done: everything in "Acceptance" below, `npx vite build` passes, `npm run smoke` passes (extend it with checks for your feature), screenshots of the affected views at ultra 1920x1080 day (t=600) and night (t=2000) saved under shots/desktop/ and reviewed critically against real photos/references, performance within BUDGETS.md (fps.mjs with governor=0, cpuframe.mjs before/after), docs updated (ARCHITECTURE.md, README.md in Russian, CREDITS.md for assets, docs/handoff/STATUS.md). Commit in small steps with clear English messages. Finish with a short report: what changed, measurements, screenshots, open issues.
