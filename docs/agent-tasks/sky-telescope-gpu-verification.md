# Sky, Moon and telescope: verification and tuning on a real GPU

## Goal
Confirm on the target machine (desktop GPU, RTX 3060 6 GB class, 1080p) that the night sky, the Moon and the
telescope look right and fit the frame / memory budgets, and tune the few perceptual constants that could only be
judged on SwiftShader at 960×540 during development.

## Current state
* `src/world/Sky.js` + `src/world/sky/*`: physically based star PSF (energy-conserving, no twinkle), magnitude-limited
  star prefixes per preset (ultra 586k stars), NASA Deep Star Maps 8K Milky Way, zodiacal light, planets, overlays.
  Perceptual constants: `DARK_ADAPTED = 2e5` (Sky.js), `MW_BOOST = 3.5` (Sky.js), PSF wing 0.12 / saturation
  exponent 0.175 (eye) and 0.05 / 0.1 (telescope) in `Sky._applyGains`, star threshold `0.0026 / E`.
* `src/world/Moon.js` + `moon/MoonSurface.js`: chunked LOD Moon, LOLA 4K heights, LROC colour 2K→4K→8K, normals
  4K→8K, 16K tile pair under the telescope axis; textures evicted after 15 s.
* `src/telescope/Telescope.js`: zoom 60°…0.05°, tracking, camera exposure model, solar filter.
* Verified only headless (SwiftShader, 960×540, a few fps): screenshots in the PR / report; `npm run smoke` covers the
  telescope flow (open, search, wheel zoom, track Jupiter at 0.05°, Esc, overlay key N).

## What to check / tune
1. **Frame time** (ultra, 1080p, `?governor=0`, fps counter / GPU timer): normal night view toward the Milky Way
   (`?observer=1&view=overview&t=2000`, look up) — the sky (stars + Milky Way) should cost ≤ ~1 ms;
   telescope views `tele-M42-1.5`, `tele-jupiter-0.06`, `tele-moon-0.06` should stay ≥ 60 fps.
   If the deep star cells are too heavy, lower the deep chunk use (e.g. skip `stars_gaia.bin` below 1.5 M
   magnification) in `StarField.loadDeep` / `Telescope._exposure` (`setDeepVisible`).
2. **VRAM** (Chrome task manager / `nvidia-smi`): sky + Moon + planets + telescope ≤ ~800 MB resident on ultra,
   including after zooming on the Moon (16K tile) and visiting several DSO tiles and planets.
3. **Look** (compare with Stellarium and real ISS night photos):
   * dark-adapted sky away from the Earth: naked-eye limit ~6.5–7 mag at 1080p; Orion / Cygnus / Crux recognisable;
     the Milky Way visible with dust lanes, not blotchy; no star twinkles while the station turns
     (watch at ×1 for a minute) or when the exposure adapts (sunrise / sunset, turning toward the sunlit Earth);
   * over the sunlit Earth only the brightest stars / planets remain;
   * telescope: Jupiter bands + moons, Saturn rings and shadows, Moon terminator shadows, M42 / M31 / M51 tiles.
   Tune `DARK_ADAPTED`, `MW_BOOST`, the PSF wing / saturation exponent, `KEY` / `X_DARK` in Telescope.js.
4. **Lite** must still work (no fps target binding): `?quality=lite`.

## Acceptance criteria
* ≥ 60 fps at 1080p ultra in the views above on an RTX 3060-class GPU (governor off), no hitches > 50 ms when the
  telescope streams data (deep stars, 16K tiles).
* VRAM within budget as above.
* Visual checks pass; screenshots attached.
* `npm run smoke` and `npx vite build` pass.

## Prompt for a coding agent
> You are working in the orbital-station three.js project (see docs/ARCHITECTURE.md, sections "Ephemeris", "Sky",
> "Moon", "Telescope"). On this machine with a real GPU, run `npm run dev` and open
> `http://127.0.0.1:5173/?quality=ultra&observer=1&view=overview&t=2000&governor=0`. Measure the frame time of the
> normal night sky and of the telescope views `tele-M42-1.5`, `tele-jupiter-0.06`, `tele-moon-0.06`
> (`window.__app.setView(name)` in the console), and the VRAM use after zooming the telescope on the Moon to 0.05°.
> Compare the sky with Stellarium for 2026-10-22 10:03 UTC as seen from orbit. Tune only the perceptual constants
> listed in docs/agent-tasks/sky-telescope-gpu-verification.md (Sky.js, Telescope.js, sky/StarField.js) so that the
> acceptance criteria hold; keep the radiometric model. Run `npm run smoke` and `npx vite build`; commit with
> before/after screenshots and measured numbers in the message.
