#!/usr/bin/env node
/**
 * Astronaut model statistics without a browser: builds the Orlan suit and the crew body at every LOD and
 * prints triangles / draw calls (material buckets) per level, NaN checks and build times.
 *   node tools/suit-stats.mjs
 */
import { Rig, joints } from '../src/player/suit/Rig.js';
import { SkinBuilder } from '../src/player/suit/Geo.js';
import { buildOrlan, ORLAN_VARIANTS } from '../src/player/suit/Orlan.js';
import { buildCrew } from '../src/player/suit/Crew.js';

const atlas = { uv: () => ({ u0: 0, v0: 0, u1: 0.1, v1: 0.1 }) };
const outfits = [
  ['orlan', 'suit', (B, J, o) => buildOrlan(B, J, { variant: ORLAN_VARIANTS.blue, ...o })],
  ['crew', 'crew', (B, J, o) => buildCrew(B, J, o)],
];
let fail = 0;
for (const [name, kind, fn] of outfits) {
  for (const [label, d, o] of [['LOD0', 1, {}], ['LOD1', 0.42, {}], ['LOD2', 0.13, {}], ['FP', 1, { fp: true, upm: true }], ['mount', 1, { hatchInterior: true }], ['lite', 0.3, { fp: true, upm: true }]]) {
    const rig = new Rig(joints(kind));
    const B = new SkinBuilder(rig.index, d); B.atlas = atlas;
    const t0 = performance.now();
    fn(B, rig.J, o);
    const g = B.build();
    let tris = 0, bad = 0;
    for (const geo of g.values()) {
      tris += geo.userData.tris;
      for (const a of ['position', 'normal', 'uv', 'skinWeight']) for (const x of geo.attributes[a].array) if (!Number.isFinite(x)) bad++;
    }
    if (bad) fail++;
    console.log(`${name.padEnd(6)} ${label.padEnd(6)} ${String(tris).padStart(7)} tris  ${String(g.size).padStart(2)} draws  ${bad ? bad + ' NaN!  ' : ''}${(performance.now() - t0).toFixed(0)} ms   ${[...g].map(([k, x]) => `${k}:${x.userData.tris}`).join(' ')}`);
  }
}
process.exit(fail ? 1 : 0);
