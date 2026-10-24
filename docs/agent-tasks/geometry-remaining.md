# Remaining geometry / surface work (station, ships)

## Goal
Finish the "no gaps, full-weight, realistic" pass where it was not completed: the remaining items below are known,
reproducible with `tools/gapcheck.mjs`, and each is small and local.

## Current state
See docs/ARCHITECTURE.md "Geometry quality". gapcheck (sampled, 512×288, high) went from — exterior 69 holes /
6 cracks / 77 back faces / 32 z-fight clusters, interior 137 / 6 / 115 / 9, ships 11 / 7 / 32 / 16 — to the numbers in
the final report of that pass (z-fighting gone, interior holes mostly gone); what is left is listed here.

## Items
1. **Curved decals.** `Builder.labelAt` places flat text planes; on small radii (port id plates, module numbers on
   the cone caps) the plane's edges dip into or float off the surface. Add a cylinder-wrapped label variant
   (bend the plane's vertices onto the HullFrame radius, like `HullKit.conformLatheAt`).
2. **Module end cones.** The cone caps are a frustum + flat discs; at berthed joints two cones meet nose to nose.
   Replace with a CBM-like flush joint (passive / active ring pair with the module skirts), keeping the colliders.
3. **Parallel cable / pipe runs** (truss sides, node tops): gapcheck reports a few small enclosed gaps between parallel
   lines and their clamps. Either bundle the lines (touching, with straps) or tune gapcheck's `inSurface` test
   (border pixels two steps away from the silhouette).
4. **Ship windows.** Ship portholes are an emissive warm disc in a frame (lit cabin); add a real pane (clear glass,
   see `Materials.clearGlass`) in front with the interior hint behind it — needs a glass bucket in `ShipBuilder`.
5. **Interior back faces** in the ring corridors / pods: a few remaining one-sided surfaces seen through doorways
   (gapcheck interior set, areas cor*, pod*); close them or add `shellTube`-style liners for the polar volumes.
6. **Handrail stand-offs over MLI bands**: rails stand on the hull and pierce the blankets; give the stanchions a
   boot / grommet where they pass through the MLI.

## Acceptance criteria
`node tools/gapcheck.mjs --set=exterior --sample=60`, `--set=interior --sample=60`, `--set=ships` report no hole /
crack / z-fight / back-face clusters except intended openings (open hatches, windows, truss bays, handrail
stand-offs); screenshots (`tools/screenshot.mjs`, views eva, airlockExt, hub, docking, cupola, inside,
interior-lab, cupola-inside) show no visual regressions; 'lite' still renders; `npm run smoke` passes.

## Prompt for a coding agent
"Read docs/ARCHITECTURE.md ('Geometry quality') and docs/agent-tasks/geometry-remaining.md. Work through the items in
order in src/station/parts, src/station/interior and src/ships, using the existing kit helpers (latheAt with closed
counter-clockwise profiles, bevelBoxAt, plate, conformLatheAt, conformSlab, shellTube). After each item run
`node tools/gapcheck.mjs` for the affected set (use --areas / --zones to focus) and look at the review PNGs; take
before/after screenshots with tools/screenshot.mjs. Keep draw calls per material merged, keep the 'lite' preset
working, run `npx vite build` and `npm run smoke` at the end, and commit each item separately."
