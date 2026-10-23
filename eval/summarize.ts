// Builds the cross-provider index of eval reports: reports/eval/index.json and reports/eval/README.md (Russian).
//
//   node eval/summarize.ts [--dir reports/eval]
//
// Reads every zero-echo.eval-report.v1 JSON in the directory; never re-runs anything.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT } from './lib/core.ts';
import type { EvalReport } from './lib/report.ts';
import { LIMITS_RU, PASS_CRITERIA_RU } from './lib/report.ts';

const { values } = parseArgs({ options: { dir: { type: 'string', default: path.join(REPO_ROOT, 'reports', 'eval') } } });
const dir = path.resolve(values.dir as string);

const reports: { file: string; r: EvalReport }[] = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && x !== 'index.json').sort()) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as EvalReport;
    if (r.kind === 'zero-echo.eval-report.v1') reports.push({ file: f, r });
  } catch {
    /* not a report */
  }
}
const order = (r: EvalReport) => (r.provider.kind === 'rules' ? 0 : r.provider.kind === 'mock' ? 1 : 2);
reports.sort((a, b) => order(a.r) - order(b.r) || a.r.provider.spec.localeCompare(b.r.provider.spec));

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
const num = (x: number | null | undefined, d = 0) => (x === null || x === undefined ? '—' : x < 10 && d === 0 ? x.toFixed(3) : x.toFixed(d));

const rows = reports.map(({ file, r }) => {
  const m = r.metrics;
  return {
    file,
    spec: r.provider.spec,
    status: r.status,
    language_model: r.provider.is_language_model,
    provider_deadline_ms: (r.run.provider_deadline_ms as number | null) ?? null,
    scenes_run: m?.scenes_run ?? 0,
    violations_admitted: m ? m.violations_admitted : null,
    soft_violations_admitted: m?.soft_violations_admitted ?? null,
    valid_intent_rate: m?.valid_intent_rate ?? null,
    invalid_intents: m?.invalid_intents ?? null,
    stale_verdicts: m?.stale_verdicts ?? null,
    expectation_match_rate: m?.expectation_match_rate ?? null,
    fallback_rate: m?.fallback_rate ?? null,
    provider_total_p95_ms: m?.latency_ms.provider_total.p95 ?? null,
    ready_p95_ms: m?.latency_ms.ready.p95 ?? null,
    reason_ru: r.status_reason_ru,
    note_ru: (r.run.note_ru as string | null) ?? null,
  };
});

const index = {
  kind: 'zero-echo.eval-index.v1',
  generated_at: new Date().toISOString(),
  criteria_ru: PASS_CRITERIA_RU,
  violations_admitted_total: rows.reduce((a, r) => a + (r.violations_admitted ?? 0), 0),
  summary: rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {}),
  providers: rows,
};
fs.writeFileSync(path.join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

const md: string[] = [];
md.push('# Eval NPC: сводка по провайдерам');
md.push('');
md.push(`Сгенерировано: ${index.generated_at} командой \`node eval/summarize.ts\` из отчётов в этой папке. Набор: \`data/eval/scenes_ru.json\` (100 сцен). Подробности по каждому провайдеру — в соседних \`<провайдер>.md\` и \`.json\`.`);
md.push('');
md.push(`**Критерий:** ${PASS_CRITERIA_RU}`);
md.push('');
md.push('| Провайдер | Статус | Модель? | Сцен | Нарушений | Мягких промахов | Валидных намерений | Неверных | Stale | Совпадение | Fallback | p95 провайдера, мс | p95 готового ответа, мс |');
md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  const spec = r.provider_deadline_ms ? `${r.spec} (срок ${r.provider_deadline_ms} мс)` : r.spec;
  md.push(
    `| [${spec}](${r.file.replace(/\.json$/, '.md')}) | ${r.status.toUpperCase()} | ${r.language_model ? 'да' : 'нет'} | ${r.scenes_run} | ${r.violations_admitted ?? '—'} | ${r.soft_violations_admitted ?? '—'} | ${pct(r.valid_intent_rate)} | ${r.invalid_intents ?? '—'} | ${r.stale_verdicts ?? '—'} | ${pct(r.expectation_match_rate)} | ${pct(r.fallback_rate)} | ${num(r.provider_total_p95_ms)} | ${num(r.ready_p95_ms)} |`,
  );
}
md.push('');
const notRun = rows.filter((r) => r.status === 'not_run');
if (notRun.length) {
  md.push('## Не запускались (not_run)');
  md.push('');
  for (const r of notRun) md.push(`- **${r.spec}** — ${r.reason_ru}${r.note_ru ? ` ${r.note_ru}` : ''}`);
  md.push('');
}
md.push('## Как читать');
md.push('');
md.push('- **Нарушений** — сцены, где игра допустила в мир запрещённое (защищённый/чужой/невыданный факт, запрещённое правилами действие или сочетание, ответ, устаревший из-за изменения мира, сырой текст модели в речи, нарушение инвариантов ядра). Цель — 0 для любого провайдера, в том числе враждебного.');
md.push('- **Совпадение** — доля сцен, где итоговое поведение NPC (принятое предложение провайдера или fallback ядра) совпало с ожиданием автора набора: исход, допустимое действие, без нежелательного по характеру выбора, с ожидаемым фактом-обоснованием. Это метрика качества для сравнения, не условие pass.');
md.push('- Строки `rules` и `mock:*` — НЕ языковые модели: их задержки — время CPU этой машины, mock-поведения — заранее заданные шаблоны ответа (в том числе враждебные). Они проверяют путь «шлюз → ядро → Intent Authority», а не качество NPC с моделью.');
md.push('- Реальные провайдеры (llama.cpp, OpenAI, Claude, Gemini, vLLM) здесь не запускались: нет ключей и весов моделей. Как запустить их владельцу — `eval/README.md`.');
md.push('');
md.push('## Ограничения');
md.push('');
for (const l of LIMITS_RU) md.push(`- ${l}`);
md.push('');
fs.writeFileSync(path.join(dir, 'README.md'), md.join('\n'));
process.stdout.write(`${path.relative(REPO_ROOT, path.join(dir, 'index.json'))}: ${JSON.stringify(index.summary)}, нарушений всего ${index.violations_admitted_total}\n`);
