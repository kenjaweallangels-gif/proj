// Топ самых «тяжёлых» функций из .cpuprofile: node tools/prof_top.mjs <dir>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const d = process.argv[2];
const f = readdirSync(d).filter((x) => x.endsWith('.cpuprofile')).sort().pop();
const p = JSON.parse(readFileSync(join(d, f), 'utf8'));
const idx = {}; p.nodes.forEach((n) => { idx[n.id] = n; });
const self = {};
p.samples.forEach((s, i) => { const n = idx[s], k = `${n.callFrame.functionName} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self[k] = (self[k] || 0) + p.timeDeltas[i] / 1000; });
Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach((e) => console.log(e[1].toFixed(0).padStart(7), e[0]));
