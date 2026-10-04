// Сводный отчёт до/после: читает dist/perf/cpu_*.json (perf_cpu.mjs) и логи/JSON perf_probe.mjs, печатает таблицы и пишет dist/perf/report.json.
//   node tools/perf_report.mjs [--base-log=path/to/baseline_low.log]
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { root, arg } from './lib/harness.mjs';

const read = (f) => (existsSync(`${root}/dist/perf/${f}`) ? JSON.parse(readFileSync(`${root}/dist/perf/${f}`, 'utf8')) : null);
const cpuB = read('cpu_baseline.json'), cpuA = read('cpu_after.json');
const cpuBm = read('cpu_baseline_med.json'), cpuAm = read('cpu_after_med.json');
const afterProbe = read('after_low.json');

// baseline GPU-проба: только текстовый лог (строки вида "[low] start cpu ... draw 102 tri 844k prog 37 | casters 9/107 | ...")
const baseLog = arg('base-log', '');
const baseProbe = {};
if (baseLog && existsSync(baseLog)) {
  for (const l of readFileSync(baseLog, 'utf8').split('\n')) {
    const m = /^\[(\w+)\]\s+(\w+)\s+cpu\s+([\d.]+)ms render\s+([\d.]+)ms \| draw\s+(\d+) tri\s+(\d+)k prog (\d+) \| casters (\d+)\/(\d+)/.exec(l);
    if (m) (baseProbe[m[1]] ||= {})[m[2]] = { cpuMs: +m[3], renderMs: +m[4], draws: +m[5], trisK: +m[6], programs: +m[7], casters: +m[8], meshes: +m[9] };
  }
}

const f = (v, d = 1) => (v === undefined || v === null ? '–' : (+v).toFixed(d));
function cpuTable(title, B, A) {
  if (!B || !A) return;
  console.log(`\n### ${title}: JS-логика на тик (мс; медиана, без рендера)\n`);
  console.log('| точка | до | после | ускорение | игрок до→после | companions до→после | worm до→после | p95 до→после |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const k of Object.keys(B.points)) {
    const b = B.points[k], a = A.points[k]; if (!a) continue;
    const m = (o, n) => o.mods[n]?.med ?? 0;
    console.log(`| ${k} | ${f(b.totalMed)} | ${f(a.totalMed)} | ×${f(b.totalMed / Math.max(0.05, a.totalMed))} | ${f(m(b, 'player'), 2)}→${f(m(a, 'player'), 2)} | ${f(m(b, 'companions'), 2)}→${f(m(a, 'companions'), 2)} | ${f(m(b, 'worm'), 2)}→${f(m(a, 'worm'), 2)} | ${f(b.totalP95)}→${f(a.totalP95)} |`);
  }
}
cpuTable('low', cpuB, cpuA);
cpuTable('med', cpuBm, cpuAm);

if (Object.keys(baseProbe).length && afterProbe) {
  console.log('\n### GPU-прокси (low, 640×360, SwiftShader): draw calls / треугольники / программы шейдеров\n');
  console.log('| точка | draws до→после | tris до→после | programs до | programs после (с прогревом) |');
  console.log('|---|---|---|---|---|');
  for (const [k, a] of Object.entries(afterProbe.results.low)) {
    if (k.startsWith('__')) continue; const b = baseProbe.low?.[k]; if (!b) continue;
    console.log(`| ${k} | ${b.draws}→${a.calls} | ${b.trisK}k→${Math.round(a.triangles / 1000)}k | ${b.programs} | ${a.programs} |`);
  }
}
const report = { when: new Date().toISOString(), note: 'cpu_* — JS-логика на тик без рендера (perf_cpu.mjs); gpuProxy — draw calls/треугольники/программы (perf_probe.mjs, SwiftShader)', cpu: { low: { baseline: cpuB, after: cpuA }, med: { baseline: cpuBm, after: cpuAm } }, gpuProxy: { baselineLow: baseProbe.low, afterLow: afterProbe?.results?.low } };
writeFileSync(`${root}/dist/perf/report.json`, JSON.stringify(report, null, 1));
console.log('\nreport →', `${root}/dist/perf/report.json`);
