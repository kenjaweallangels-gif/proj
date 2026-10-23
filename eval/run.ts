// NPC eval harness (Документ §16, §19 «ИИ-метрики»; docs/SPEC.md §9–§10).
//
//   node eval/run.ts --provider rules|mock:<behaviour>|route:<route>|gateway:<url>:<route>
//                    [--scenes data/eval/scenes_ru.json] [--out reports/eval/<name>.json]
//                    [--deadline-ms N] [--concurrency N] [--only id,id] [--category c] [--privacy p]
//                    [--config data/providers.example.json] [--mock-behavior b] [--lint-only] [--dump id]
//
// For each scene: a fresh core (the WASM build the web client ships), setup, the player's request,
// dispatch, a proposal from the provider, an optional world change while it "thinks", submit_result and
// scoring. Writes a machine-readable JSON report and a Russian Markdown summary next to it.
// Exit codes: 0 pass, 1 fail, 2 usage/config error, 3 not_run (provider unavailable here).

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { GatewayRequest } from '../web/src/contracts.ts';
import { createCore, indexWorld, loadCoreData, readJson, REPO_ROOT, WASM_MODULE_PATH } from './lib/core.ts';
import type { PrivacyProfile, Provider } from './lib/providers.ts';
import { createProvider, DEFAULT_CONFIG, ProviderSpecError } from './lib/providers.ts';
import { environmentInfo, LIMITS_RU, markdownSummary, PASS_CRITERIA_RU, sha256File } from './lib/report.ts';
import type { EvalReport, Metrics, RunStatus } from './lib/report.ts';
import { runScene } from './lib/runner.ts';
import type { Observation } from './lib/runner.ts';
import { CATEGORIES, lintScenes } from './lib/scenes.ts';
import type { Scene, SceneFile } from './lib/scenes.ts';
import { aggregate, scoreScene } from './lib/score.ts';
import type { Pricing, SceneScore } from './lib/score.ts';

const USAGE = `Использование: node eval/run.ts --provider <rules|mock:<поведение>|route:<маршрут>|gateway:<url>:<маршрут>> [опции]
  --scenes <файл>        набор сцен (по умолчанию data/eval/scenes_ru.json)
  --out <файл.json>      отчёт (по умолчанию reports/eval/<провайдер>.json; рядом пишется .md)
  --deadline-ms <N>      срок, передаваемый провайдеру (GatewayRequest.deadline_ms ≤ N); срок ядра — из profiles.json
  --shared-gateway       один экземпляр шлюза на весь прогон (видны circuit breaker и квоты между сценами)
  --concurrency <N>      сцен одновременно (по умолчанию 1: задержки без очереди)
  --only <id,id>         только эти сцены; --category <категория> — только категория
  --privacy <профиль>    offline | hybrid | online (по умолчанию offline; для удалённых маршрутов online)
  --config <файл>        конфигурация шлюза (по умолчанию data/providers.example.json)
  --mock-behavior <b>    заголовок X-Echo-Mock для gateway:<url>:mock
  --note <текст>         пояснение к прогону (например, почему провайдер недоступен в этой среде)
  --lint-only            только проверить набор сцен
  --dump <id>            показать GatewayRequest сцены и выйти`;

function fail(message: string, code = 2): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function outName(spec: string): string {
  return spec.replace(/^gateway:https?:\/\//, 'gateway_').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function pool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function lookupPricing(provider: Provider): Pricing | null {
  if (!provider.info.route) return null;
  const file = path.join(REPO_ROOT, 'data', 'pricing.example.json');
  const book = readJson<{ prices: { route: string; model: string; input_per_mtok: number; output_per_mtok: number; fictional: boolean }[] }>(file);
  const model = provider.info.model ?? '*';
  const e = book.prices.find((p) => p.route === provider.info.route && p.model === model) ?? book.prices.find((p) => p.route === provider.info.route && p.model === '*');
  return e ? { route: e.route, input_per_mtok: e.input_per_mtok, output_per_mtok: e.output_per_mtok, fictional: e.fictional, source: 'data/pricing.example.json' } : null;
}

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs({
      options: {
        provider: { type: 'string' },
        scenes: { type: 'string', default: path.join(REPO_ROOT, 'data', 'eval', 'scenes_ru.json') },
        out: { type: 'string' },
        'deadline-ms': { type: 'string' },
        concurrency: { type: 'string', default: '1' },
        only: { type: 'string' },
        category: { type: 'string' },
        privacy: { type: 'string' },
        config: { type: 'string', default: DEFAULT_CONFIG },
        'mock-behavior': { type: 'string' },
        'shared-gateway': { type: 'boolean', default: false },
        note: { type: 'string' },
        'lint-only': { type: 'boolean', default: false },
        dump: { type: 'string' },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    }).values;
  } catch (e) {
    fail(`${(e as Error).message}\n${USAGE}`);
  }
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const log = (s: string) => {
    if (!args.quiet) process.stdout.write(`${s}\n`);
  };

  const deadlineMs = args['deadline-ms'] !== undefined ? Number(args['deadline-ms']) : null;
  if (deadlineMs !== null && !(Number.isInteger(deadlineMs) && deadlineMs >= 100 && deadlineMs <= 60000)) fail('--deadline-ms: целое 100…60000');
  const concurrency = Number(args.concurrency);
  if (!(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 16)) fail('--concurrency: целое 1…16');
  const privacy = (args.privacy ?? null) as PrivacyProfile | null;
  if (privacy !== null && !['offline', 'hybrid', 'online'].includes(privacy)) fail('--privacy: offline | hybrid | online');
  if (args.category !== undefined && !(CATEGORIES as readonly string[]).includes(args.category)) fail(`--category: ${CATEGORIES.join(' | ')}`);

  const scenesPath = path.resolve(args.scenes);
  const sceneFile = readJson<SceneFile>(scenesPath);
  const data = loadCoreData(path.join(REPO_ROOT, 'data'));
  const world = indexWorld(data);
  const lint = lintScenes(sceneFile, world);
  if (args['lint-only']) {
    for (const l of lint) process.stderr.write(`${l.scene}: ${l.problem}\n`);
    log(`${sceneFile.scenes.length} сцен, проблем: ${lint.length}`);
    return lint.length ? 1 : 0;
  }
  if (!args.provider) fail(`нужен --provider\n${USAGE}`);
  const spec = args.provider;

  let scenes: Scene[] = sceneFile.scenes;
  if (args.only) {
    const ids = new Set(args.only.split(',').map((x) => x.trim()));
    scenes = scenes.filter((s) => ids.has(s.id));
    if (!scenes.length) fail(`--only: нет таких сцен (${args.only})`);
  }
  if (args.category) scenes = scenes.filter((s) => s.category === args.category);

  let provider: Provider;
  try {
    provider = createProvider(spec, { configPath: path.resolve(args.config), privacy, mockBehavior: args['mock-behavior'] ?? null, sharedGateway: args['shared-gateway'] });
  } catch (e) {
    if (e instanceof ProviderSpecError) fail(`${e.message}\n${USAGE}`);
    throw e;
  }

  const { loadRepoSchema, validate } = await import('../gateway/src/jsonschema.ts');
  const requestSchema = loadRepoSchema('gateway_request');
  const resultSchema = loadRepoSchema('gateway_result');
  const ctx = { data, world, provider, providerDeadlineMs: deadlineMs, validateRequest: (x: unknown) => validate(requestSchema, x), validateResult: (x: unknown) => validate(resultSchema, x) };

  if (args.dump) {
    const scene = sceneFile.scenes.find((s) => s.id === args.dump);
    if (!scene) fail(`нет сцены ${args.dump}`);
    // A provider stand-in that prints the request the core built and stops the scene there.
    const printer: Provider = {
      info: provider.info,
      preflight: async () => ({ ok: true }),
      propose: async (_core, r: GatewayRequest) => {
        process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
        throw new Error('dump: сцена остановлена после выдачи запроса');
      },
      close: async () => {},
      diagnostics: () => ({}),
    };
    const obs = await runScene(scene, { ...ctx, provider: printer });
    process.stdout.write(`known_before: ${obs.known_before.join(', ')}\nproblems: ${obs.scene_problems.join('; ') || '—'}\n`);
    return 0;
  }

  const outPath = path.resolve(args.out ?? path.join(REPO_ROOT, 'reports', 'eval', `${outName(spec)}.json`));
  const started = new Date();
  const coreVersion = await (async () => {
    const c = await createCore();
    try {
      const v = c.must({ cmd: 'version' });
      return { core_version: v.core_version, prompt_version: v.prompt_version, intent_schema_version: v.intent_schema_version };
    } finally {
      c.destroy();
    }
  })();
  const gatewayVersion = provider.info.kind === 'rules' ? null : (await import('../gateway/src/types.ts')).GATEWAY_VERSION;

  log(`eval: ${spec} · ${scenes.length} сцен · ${path.relative(REPO_ROOT, scenesPath)}`);
  const pre = await provider.preflight();
  let status: RunStatus;
  let statusReason: string;
  let scores: SceneScore[] = [];
  let metrics: Metrics | null = null;
  if (!pre.ok) {
    status = 'not_run';
    statusReason = `Провайдер не запускался: ${pre.reason_ru}. Сцены не выполнялись, метрик качества нет.`;
    log(`NOT RUN: ${pre.reason_ru}`);
  } else {
    const sensorZones = new Map<string, string>((data.world.sensors as { id: string; zone: string }[]).map((s) => [s.id, s.zone]));
    let done = 0;
    const observations: Observation[] = await pool(scenes, concurrency, async (scene) => {
      const obs = await runScene(scene, ctx);
      done++;
      if (!args.quiet && (done % 10 === 0 || done === scenes.length)) log(`  ${done}/${scenes.length}`);
      return obs;
    });
    scores = scenes.map((s, i) => scoreScene(s, observations[i], { world, sensorZones }));
    metrics = aggregate(scores, { npcIds: world.npcIds, pricing: lookupPricing(provider), isLanguageModel: provider.info.is_language_model, isRules: provider.info.kind === 'rules' });
    const problems: string[] = [];
    if (lint.length) problems.push(`набор сцен не прошёл проверку (${lint.length} проблем)`);
    if (metrics.scenes_error) problems.push(`ошибок выполнения: ${metrics.scenes_error}`);
    if (metrics.scenes_invalid) problems.push(`сцен, несогласованных с миром: ${metrics.scenes_invalid}`);
    if (metrics.violations_admitted) problems.push(`сцен с допущенным нарушением: ${metrics.violations_admitted} (находок: ${metrics.violation_findings})`);
    status = problems.length ? 'fail' : 'pass';
    statusReason = problems.length
      ? `${problems.join('; ')}.`
      : `${metrics.scenes_run} сцен выполнено, допущенных нарушений нет. Совпадение с ожиданиями ${((metrics.expectation_match_rate ?? 0) * 100).toFixed(1)}% — метрика качества, не условие pass.`;
  }
  await provider.close();
  const finished = new Date();

  const report: EvalReport = {
    kind: 'zero-echo.eval-report.v1',
    violations_admitted: metrics ? metrics.violations_admitted : null,
    status,
    status_reason_ru: statusReason,
    criteria_ru: PASS_CRITERIA_RU,
    generated_at: finished.toISOString(),
    provider: provider.info,
    run: {
      command: `node eval/run.ts ${process.argv.slice(2).join(' ')}`,
      started_at: started.toISOString(),
      duration_s: Math.round((finished.getTime() - started.getTime()) / 100) / 10,
      scenes_file: path.relative(REPO_ROOT, scenesPath),
      scenes_sha256: sha256File(scenesPath),
      scenes_selected: scenes.length,
      provider_deadline_ms: deadlineMs,
      shared_gateway: args['shared-gateway'],
      concurrency,
      preflight: pre,
      note_ru: args.note ?? null,
    },
    environment: environmentInfo(REPO_ROOT, {
      ...coreVersion,
      gateway_version: gatewayVersion,
      wasm_module: path.relative(REPO_ROOT, WASM_MODULE_PATH),
      wasm_sha256: sha256File(WASM_MODULE_PATH),
    }),
    lint_problems: lint,
    metrics,
    scenes: scores,
    diagnostics: provider.diagnostics(),
    limits_ru: LIMITS_RU,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  const mdPath = outPath.replace(/\.json$/i, '') + '.md';
  fs.writeFileSync(mdPath, markdownSummary(report));
  if (metrics) {
    log(
      `${status.toUpperCase()}: сцен с нарушением ${metrics.violations_admitted}, совпадение ${((metrics.expectation_match_rate ?? 0) * 100).toFixed(1)}%, ` +
        `валидных намерений ${((metrics.valid_intent_rate ?? 0) * 100).toFixed(1)}%, fallback ${((metrics.fallback_rate ?? 0) * 100).toFixed(1)}%`,
    );
  }
  log(`отчёт: ${path.relative(REPO_ROOT, outPath)} · ${path.relative(REPO_ROOT, mdPath)}`);
  return status === 'pass' ? 0 : status === 'not_run' ? 3 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`eval: ${(e as Error).stack ?? String(e)}\n`);
    process.exit(2);
  },
);
