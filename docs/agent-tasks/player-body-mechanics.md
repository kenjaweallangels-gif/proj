# Player body, collisions and body mechanics — verification and tuning on a GPU desktop

## Goal
The astronaut is a 1.8 m body (eye 1.68 m) that never passes through geometry and moves by its own force:
hand-over-hand along rails, braking with the hands at walls, realistic ring walking, ladders, EVA rail crawling.
This was built and tested in a container without a GPU (SwiftShader, 4 shared cores). The feel (forces, timings),
the GPU-preset frame budget and the visual scale must be confirmed on the user's PC (1080p / 60 fps).

## Current state
- `src/core/CollisionWorld.js` (`ctx.collision`): BVH (three-mesh-bvh 0.9.15) over the render geometry, lazy +
  background builds, layers EXTERIOR / INTERIOR / SHIPS / DOORS, `resolveSphere / resolveCapsule / sphereCast /
  raycast / closest / distance`. Built in `App.start` after `afterMaterials()`; observer camera constrained in
  `App.constrainObserver()`.
- `src/player/Body.js`: body dimensions (shared with the suit / body visuals).
- `src/player/Mechanics.js` (`player.mech`): zero-g mover (head sphere + compliant body), hand over hand,
  auto-brake, walking, ladders, IK targets and events on `player.body` (see docs/ARCHITECTURE.md, "Body and collisions").
- `src/player/Iva.js`, `src/player/Player.js`: use the above in every mode. FOV 60° vertical.
- Ring corridors: ceiling lowered from 3.4 m to 2.45 m (`RingInterior.js`, `CEIL`), vestibule doors 2.2 m.
- `npm run smoke` covers: eye height, hand over hand, auto-brake, lab wall / cabin wall / module hull / docked ship
  ram tests, observer camera.

## Files
src/core/CollisionWorld.js, src/player/{Body,Mechanics,Iva,Player,EvaPhysics}.js, src/core/App.js (wiring),
src/station/interior/RingInterior.js (ceiling), tools/smoke.mjs.

## Acceptance criteria (on the GPU desktop)
1. `ultra` and `high`: no extra load hitch > 300 ms from collisions; `window.__app.collision.stats.buildMs` (all
   chunks built after ~1 min of play) reasonable; per-frame JS of the player update < 0.3 ms
   (`node tools/cpuframe.mjs --quality=ultra --view=inside --callers=update`).
2. Walking the ring corridor, cabins and the gym, floating through the lab, node 1, the airlock and the cupola,
   EVA along the hull: the camera never shows the inside of a wall, the body never ends up behind a wall.
3. Feel: unsuited hand-over-hand ~1.5 m/s cruising, suited ~1 m/s; braking at a wall is soft (0.2–0.4 s), no
   bounce; ring walking accelerates within ~0.5 s; landings dip the view slightly.
4. Scale: doors ~2 m, handrails at hand height, ring ceilings 2.45 m read naturally at FOV 60°.

## Prompt for a coding agent
> In this repo (three.js r186 / Vite space station, see docs/ARCHITECTURE.md "Body and collisions"), verify and tune
> the player body mechanics on a GPU machine. Run `npm run dev`, open `?autostart=1&quality=ultra`, play through:
> lab -> node 1 -> airlock (don the suit, EVA, return), the ring (`?view=interior-ring`, `interior-cabin`,
> `interior-pod`, `interior-spoke`). Check acceptance criteria 1–4 in docs/agent-tasks/player-body-mechanics.md.
> Tune only the constants in src/player/Mechanics.js (`PARAMS`) and src/player/Body.js unless a real bug shows up;
> report places where the camera clips into geometry with `window.__app.player.position` and the view name.
> Keep `npm run smoke` and `npx vite build` passing.
