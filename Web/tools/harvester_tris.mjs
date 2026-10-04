// Счётчик треугольников геометрии харвестера без браузера: node tools/harvester_tris.mjs
import { buildHarvester } from '../src/harvester/hull.js';
for (const q of ['low', 'med', 'high']) {
  const t0 = performance.now();
  const G = buildHarvester(q);
  const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  const out = {};
  for (const k of ['main', 'glow', 'sand', 'scoop', 'auger', 'drum', 'fan', 'radar', 'far']) out[k] = Math.round(tri(G[k]));
  console.log(q, JSON.stringify(out), 'build ms', Math.round(performance.now() - t0), 'posts', G.posts.length, 'bolts', G.bolts.length);
}
