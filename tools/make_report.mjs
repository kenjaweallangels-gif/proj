#!/usr/bin/env node
// Aggregates tools/test_all.sh step results into reports/validation.json (Документ §20: pass / fail / blocked / not_run,
// git revision, exact tool versions). Static entries state plainly what was not run in this environment and why.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stepsFile = path.resolve(process.argv[2] ?? path.join(repo, 'reports/tmp/steps.jsonl'));

function sh(cmd) {
  try { return execSync(cmd, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n')[0]; } catch { return null; }
}

const steps = new Map();
if (fs.existsSync(stepsFile)) {
  for (const line of fs.readFileSync(stepsFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const s = JSON.parse(line);
    steps.set(s.id, s);
  }
}

function fromStep(id) {
  const s = steps.get(id);
  if (!s) return { status: 'not_run', evidence: 'step not executed' };
  if (s.blocked) return { status: 'blocked', evidence: s.blocked };
  if (s.not_run) return { status: 'not_run', evidence: s.not_run };
  const tail = s.log && fs.existsSync(path.join(repo, s.log))
    ? fs.readFileSync(path.join(repo, s.log), 'utf8').trim().split('\n').slice(-3).join(' | ').slice(0, 400)
    : '';
  return { status: s.rc === 0 ? 'pass' : 'fail', evidence: `${s.log} (rc=${s.rc}, ${s.seconds}s) ${tail}` };
}

function findKey(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

function evalEntry(id, file, title) {
  const base = fromStep(id);
  const p = path.join(repo, file);
  if (base.status === 'pass' && fs.existsSync(p)) {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const violations = findKey(data, 'violations_admitted');
    if (typeof violations === 'number' && violations > 0) {
      return { id, title_ru: title, status: 'fail', evidence: `${file}: violations_admitted=${violations}` };
    }
    return { id, title_ru: title, ...base, evidence: `${file}: violations_admitted=${violations ?? 'n/a'}; ${base.evidence}` };
  }
  return { id, title_ru: title, ...base };
}

const directions = [
  { id: 'core_native', title_ru: 'Ядро C++20 (native): сборка и тесты контракта/симуляции', doc: '§3, §8–§14', ...fromStep('core_native') },
  { id: 'core_wasm', title_ru: 'То же ядро в WebAssembly: те же тесты и протокол', doc: '§1, §3', ...fromStep('core_wasm') },
  { id: 'typecheck', title_ru: 'Проверка типов TypeScript (шлюз, веб, eval)', doc: '§20', ...fromStep('typecheck') },
  { id: 'gateway', title_ru: 'Agent Gateway: адаптеры, статусы, сеть, ключи, квоты (фейковые серверы)', doc: '§15–§18', ...fromStep('gateway_tests') },
  { id: 'web_build', title_ru: 'Сборка браузерного клиента (WebGPU + WASM-ядро, один файл)', doc: '§7', ...fromStep('web_build') },
  { id: 'web_e2e', title_ru: 'E2E в headless Chromium (SwiftShader): сцена Миры, отказы authority, экран совместимости', doc: '§7, §9, §12', ...fromStep('web_e2e') },
  { id: 'web_csp', title_ru: 'Страница с CSP без WebAssembly: то же ядро в JS-сборке, сценарий D0 идёт', doc: '§7', ...fromStep('web_csp') },
  evalEntry('eval_rules', 'reports/eval/rules.json', 'Eval-сцены: обычный игровой ИИ (rules)'),
  evalEntry('eval_adversarial', 'reports/eval/mock_adversarial_unknown_field.json', 'Eval-сцены: враждебные ответы модели (mock)'),
  { id: 'hw_manifest', title_ru: 'E0: hardware manifest этой машины', doc: '§19, §22', ...fromStep('hw_manifest') },
  { id: 'native_dawn_renderer', title_ru: 'Нативный рендер C++/Dawn поверх Vulkan', doc: '§1, §3, §5', status: 'blocked',
    evidence: 'dawn.googlesource.com недоступен из среды; рендер реализован на TypeScript+WGSL в браузере, WGSL общий' },
  { id: 'emdawnwebgpu', title_ru: 'C++ → WASM рендер через Emdawnwebgpu', doc: '§1, §3', status: 'blocked',
    evidence: 'порт emdawnwebgpu скачивается с GitHub Releases — заблокировано политикой сети' },
  { id: 'rtx3060_60fps', title_ru: '60 FPS на RTX 3060 (контрольный маршрут, 3×10 мин)', doc: '§2, §19', status: 'not_run',
    evidence: 'в контейнере нет GPU; SwiftShader-замеры не являются доказательством; запуск — на ПК пользователя' },
  { id: 'local_llm', title_ru: 'Локальная модель (llama.cpp, Qwen3-1.7B Q4) CPU/GPU', doc: '§10, §11', status: 'not_run',
    evidence: 'веса моделей не скачаны (HuggingFace недоступен); адаптер llama.cpp проверен фейковым сервером' },
  { id: 'webllm', title_ru: 'WebLLM в worker', doc: '§10, §11', status: 'not_run', evidence: 'CDN недоступен; адаптер экспериментальный, выключен по умолчанию' },
  { id: 'external_apis', title_ru: 'OpenAI / Claude / Gemini / vLLM — реальные вызовы', doc: '§15–§18', status: 'not_run',
    evidence: 'ключей нет, платные API не вызывались; форматы проверены фейковыми серверами' },
  { id: 'ue_control', title_ru: 'Контрольная UE-ветка D0 для A/B', doc: '§1, §19', status: 'not_run', evidence: 'UE-проект не входит в репозиторий' },
  { id: 'windows', title_ru: 'Отдельная проверка Windows', doc: '§1', status: 'not_run', evidence: 'нет Windows-стенда' },
  { id: 'asset_pipeline', title_ru: 'Cooker ассетов (glTF → meshopt/KTX2, bake, manifest)', doc: '§6', status: 'not_run', evidence: 'сцена процедурная; исходных ассетов нет' },
  { id: 'physics', title_ru: 'Jolt Physics (native + WASM)', doc: '§6', status: 'not_run', evidence: 'вне объёма прототипа v0.1' },
  { id: 'voice', title_ru: 'TTS / ASR', doc: '§14', status: 'not_run', evidence: 'первая версия — субтитры и заранее записанные реплики' },
];

const report = {
  kind: 'zero-echo.validation.v1',
  generated_at: new Date().toISOString(),
  git_revision: sh('git rev-parse HEAD'),
  git_dirty: (sh('git status --porcelain') ?? '') !== '',
  environment: {
    note_ru: 'Облачный контейнер без GPU. WebGPU — SwiftShader (CPU). Производительность не измерялась на целевом железе.',
    gcc: sh('g++ --version'), clang: sh('clang++ --version'), cmake: sh('cmake --version'), node: sh('node --version'),
    emcc: sh('emcc --version'), python: sh('python3 --version'),
    chromium: sh('/opt/pw-browsers/chromium-1194/chrome-linux/chrome --version'),
  },
  summary: {},
  directions,
};
for (const d of directions) report.summary[d.status] = (report.summary[d.status] ?? 0) + 1;

fs.mkdirSync(path.join(repo, 'reports'), { recursive: true });
fs.writeFileSync(path.join(repo, 'reports/validation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`reports/validation.json: ${JSON.stringify(report.summary)}`);
process.exit(directions.some((d) => d.status === 'fail') ? 1 : 0);
