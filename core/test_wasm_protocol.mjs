#!/usr/bin/env node
// Echo Runtime core — WebAssembly protocol test.
// Imports core/build-wasm/echo_core.mjs (the module the web client uses), loads the D0 data, drives the full
// Mira scenario through echo_call from JavaScript and asserts the same outcomes as the native protocol test
// (tests/test_scenario.cpp). Then compares the final state hash with the native echo_cli run of the same
// scenario: identical hashes mean identical behaviour of the one C++ codebase on both targets.
//
//   node core/test_wasm_protocol.mjs [--seconds 300] [--no-native]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const args = process.argv.slice(2);
const seconds = Number(args.includes('--seconds') ? args[args.indexOf('--seconds') + 1] : 300);
const skipNative = args.includes('--no-native');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const modulePath = path.join(here, 'build-wasm', 'echo_core.mjs');
if (!fs.existsSync(modulePath)) {
  console.error(`нет ${modulePath}: сначала core/build_wasm.sh`);
  process.exit(1);
}
const { default: createEchoCore } = await import(modulePath);
const M = await createEchoCore();

function makeCore() {
  const handle = M._echo_create();
  return {
    call(req) {
      const ptr = M.stringToNewUTF8(typeof req === 'string' ? req : JSON.stringify(req));
      try {
        return JSON.parse(M.UTF8ToString(M._echo_call(handle, ptr)));
      } finally {
        M._free(ptr);
      }
    },
    destroy() {
      M._echo_destroy(handle);
    },
  };
}

// Same files and layout subset as core/cli/data_files.cpp (host::load_data_dir).
function loadData() {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(repo, 'data', rel), 'utf8'));
  const layout = read('scene/d0_layout.json');
  return {
    world: read('world/zero_echo_d0.json'),
    npcs: read('npcs.json'),
    actions: read('actions.json'),
    profiles: read('profiles.json'),
    speech: read('speech_ru.json'),
    director: read('director_events.json'),
    biography: read('biography_details.json'),
    layout: { anchors: layout.anchors, zone_stand_points: layout.zone_stand_points },
  };
}

// The scenario loop of echo_cli (provider rules, auto-accept): tick 0.5 s, accept plans, answer requests.
function runScenario(core, secs) {
  const events = [];
  const plans = [];
  let now = 0;
  const absorb = (r) => {
    for (const e of r.events ?? []) {
      events.push(e);
      if (e.type === 'plan_created') plans.push(e.payload.plan_id);
    }
  };
  const acceptPlans = () => {
    while (plans.length) {
      const plan = plans.shift();
      const r = core.call({ cmd: 'player_decide', plan_id: plan, decision: 'accept', now_ms: now });
      if (r.ok) absorb(r);
    }
  };
  const steps = Math.round(secs / 0.5);
  for (let i = 0; i < steps; i++) {
    now += 500;
    absorb(core.call({ cmd: 'tick', dt_s: 0.5, now_ms: now }));
    acceptPlans();
    for (let guard = 0; guard < 16; guard++) {
      const d = core.call({ cmd: 'dispatch', now_ms: now, backend: 'rules' });
      absorb(d);
      if (!d.request) break;
      const taskId = d.request.task_id;
      const p = core.call({ cmd: 'rules_propose', task_id: taskId });
      const result = {
        task_id: taskId, status: 'ok', proposal_text: p.proposal_text,
        usage: { input_tokens: 0, output_tokens: 0, measured: false }, latency_ms: { total: 0, first_token: null },
        provider: 'rules', model: 'utility-policy', finish_reason: 'stop', attempts: 1,
      };
      absorb(core.call({ cmd: 'submit_result', result, now_ms: now }));
      acceptPlans();
    }
  }
  return { events, now };
}

console.log(`Echo core WASM (${(fs.statSync(modulePath).size / 1024).toFixed(0)} KiB) · сценарий D0 через echo_call, ${seconds} с`);
const data = loadData();
const core = makeCore();

// --- protocol basics
check('version без init', core.call({ cmd: 'version' }).prompt_version === 'zero-echo.prompt.ru.v1');
check('битый JSON → bad_json', core.call('{"cmd":').error?.code === 'bad_json');
check('дубликат ключа в запросе → bad_json', core.call('{"cmd":"tick","cmd":"state"}').error?.code === 'bad_json');
check('tick до init → not_initialized', core.call({ cmd: 'tick', dt_s: 0.5, now_ms: 0 }).error?.code === 'not_initialized');
const init = core.call({ cmd: 'init', data });
check('init', init.ok === true && init.summary.npcs === 6, `data ${init.data_hash}`);

// --- the scenario
const t0 = performance.now();
const { events, now } = runScenario(core, seconds);
const runMs = performance.now() - t0;
const find = (type, actor) => events.find((e) => e.type === type && (!actor || e.actor === actor));
const alarm = find('trigger_fired');
check('тревога давления на 20 с', alarm && alarm.t === 20);
const miraPlan = find('plan_created', 'mira');
check('Мира предлагает осмотр sensor_a с Никой', miraPlan && miraPlan.payload.action === 'inspect' &&
  miraPlan.payload.target === 'sensor_a' && miraPlan.payload.companion === 'nika');
const canonical = 'Я проверю датчик A. Ника останется у шлюза — после прошлого раза по одному не идём.';
check('каноническая реплика Миры', events.some((e) => e.type === 'speech' && e.payload.text === canonical));
const thomasPlan = find('plan_created', 'thomas');
check('Томас предлагает отдых Юну', thomasPlan && thomasPlan.payload.target === 'yun');
const factsOf = (npc) => core.call({ cmd: 'memory', npc_id: npc }).known_facts;
const miraDrift = factsOf('mira').find((f) => f.id === 'sensor_a_drift_confirmed');
check('Мира знает о дрейфе (источник observation:sensor_a)', miraDrift && miraDrift.source === 'observation:sensor_a');
check('Ника знает о дрейфе', factsOf('nika').some((f) => f.id === 'sensor_a_drift_confirmed'));
check('Алекс узнал о дрейфе из доклада', factsOf('alex').some((f) => f.id === 'sensor_a_drift_confirmed' && f.source === 'reported_by:mira'));
check('датчик откалиброван', events.some((e) => e.type === 'sensor_repaired'));
const state = core.call({ cmd: 'state', debug: true, now_ms: now });
check('аварийный свет выключен', state.emergency_lights === false);
const sensorA = state.sensors.find((s) => s.id === 'sensor_a');
check('показание = истина 101.2', sensorA.reading.value === 101.2 && sensorA.truth.value === 101.2);
check('образец 07 в холоде', state.items.find((i) => i.id === 'sample_07').preserved === true);
check('уплотнитель списан один раз', state.resources.find((r) => r.id === 'spare_seals').amount === 3);
check('биография места ≥ 3 деталей', state.biography.length >= 3, state.biography.map((b) => b.detail_id).join(', '));
check('общая раскладка Миры и Ники в мастерской', state.biography.some((b) => b.detail_id === 'shared_tool_layout' && b.anchor === 'ws_wall_tools'));
const metrics = core.call({ cmd: 'metrics' });
check('допущенных нарушений 0', metrics.ai.violations_admitted === 0);
check('неверных намерений 0 (rules)', metrics.ai.invalid_intents === 0);
check('события несут text_ru', events.every((e) => typeof e.text_ru === 'string' && e.text_ru.length > 0));

// --- authority from JS: a host-owned field in a model answer is rejected, fallback keeps the NPC useful
{
  const c2 = makeCore();
  c2.call({ cmd: 'init', data });
  let t = 0;
  for (let i = 0; i < 41; i++) c2.call({ cmd: 'tick', dt_s: 0.5, now_ms: (t += 500) });
  let req = null;
  for (let g = 0; g < 8 && !req; g++) {
    const d = c2.call({ cmd: 'dispatch', now_ms: t, backend: 'cpu' });
    if (!d.request) break;
    if (d.request.actor_id === 'mira') req = d.request;
    else c2.call({ cmd: 'cancel', task_id: d.request.task_id, now_ms: t });
  }
  const bad = c2.call({
    cmd: 'submit_result', now_ms: t,
    result: { task_id: req.task_id, status: 'ok', proposal_text: '{"action":"inspect","target_id":"sensor_a","style":"concerned","world_revision":0}',
      usage: { input_tokens: 1, output_tokens: 1, measured: true }, latency_ms: { total: 900, first_token: 300 },
      provider: 'js', model: 'fixture', finish_reason: 'stop', attempts: 1 },
  });
  check('поле хоста от модели → rejected + fallback', bad.verdict.status === 'rejected' && bad.verdict.fallback_used &&
    bad.verdict.reasons[0] === 'unknown_field:world_revision');
  check('fallback-реплика контролируемая', bad.speech?.kind === 'fallback' && !bad.speech.text.includes('{'));
  const dup = c2.call({
    cmd: 'submit_result', now_ms: t,
    result: { task_id: req.task_id, status: 'ok', proposal_text: '{"action":"acknowledge","style":"neutral"}',
      usage: { input_tokens: 1, output_tokens: 1, measured: true }, latency_ms: { total: 900 },
      provider: 'js', model: 'fixture', finish_reason: 'stop', attempts: 1 },
  });
  check('повторная доставка → duplicate', dup.verdict.status === 'duplicate');
  c2.destroy();
}

// --- save/load inside WASM reproduces the hash
const save = core.call({ cmd: 'save' }).save;
const c3 = makeCore();
c3.call({ cmd: 'init', data });
const loaded = c3.call({ cmd: 'load', save });
check('save/load → тот же хеш', loaded.ok && loaded.hash === state.hash, loaded.hash);
c3.destroy();

// --- native vs WASM: same seed, same commands, same hash
let nativeHash = null;
const cli = path.join(here, 'build', 'echo_cli');
if (skipNative) {
  console.log('  skip  сравнение с native (--no-native)');
} else if (!fs.existsSync(cli)) {
  check('native echo_cli собран', false, `нет ${cli}: core/build_native.sh`);
} else {
  const out = execFileSync(cli, ['scenario', '--provider', 'rules', '--seconds', String(seconds), '--json', '--data-dir', path.join(repo, 'data')], { encoding: 'utf8', maxBuffer: 64 << 20 });
  nativeHash = JSON.parse(out).hash;
  check('хеш состояния native == WASM', nativeHash === state.hash, `native ${nativeHash} · wasm ${state.hash}`);
}
core.destroy();

const failed = results.filter((r) => !r.ok);
console.log(`\nИтого: ${results.length} проверок, ${results.length - failed.length} пройдено, ${failed.length} провалено. ` +
  `Прогон ${seconds} с симуляции в WASM за ${runMs.toFixed(0)} мс (CPU этой машины, не показатель FPS). Хеш: ${state.hash}`);
const report = {
  kind: 'zero-echo.core-wasm-protocol.v1', status: failed.length ? 'fail' : 'pass', seconds,
  wasm_hash: state.hash, native_hash: nativeHash, checks: results, module_bytes: fs.statSync(modulePath).size,
};
fs.writeFileSync(path.join(here, 'build-wasm', 'wasm_protocol_report.json'), JSON.stringify(report, null, 2));
process.exit(failed.length ? 1 : 0);
