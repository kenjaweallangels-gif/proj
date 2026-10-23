// Tests of the eval set and harness: scene set invariants, lint, the scoring oracle on synthetic
// observations (it must catch violations the core would never produce), the scene runner on the real WASM
// core, the in-process gateway mock, and the CLI contract (exit codes, report shape).
//
//   node --test eval/test/*.test.ts

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import type { GatewayRequest, Verdict } from '../../web/src/contracts.ts';
import { indexWorld, loadCoreData, readJson, REPO_ROOT } from '../lib/core.ts';
import { createProvider, RulesProvider } from '../lib/providers.ts';
import { revisionBumped, runScene } from '../lib/runner.ts';
import type { Observation } from '../lib/runner.ts';
import { CATEGORIES, lintScenes, matchesPattern } from '../lib/scenes.ts';
import type { Scene, SceneFile } from '../lib/scenes.ts';
import { aggregate, outcomeOf, percentiles, reasonGroup, scoreScene } from '../lib/score.ts';

const SCENES_PATH = path.join(REPO_ROOT, 'data', 'eval', 'scenes_ru.json');
const data = loadCoreData();
const world = indexWorld(data);
const sceneFile = readJson<SceneFile>(SCENES_PATH);
const byId = new Map(sceneFile.scenes.map((s) => [s.id, s]));
const sensorZones = new Map<string, string>((data.world.sensors as { id: string; zone: string }[]).map((s) => [s.id, s.zone]));

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

describe('scene set data/eval/scenes_ru.json', () => {
  test('exactly 100 scenes, lint-clean', () => {
    assert.equal(sceneFile.scenes.length, 100);
    assert.deepEqual(lintScenes(sceneFile, world), []);
  });

  test('balanced categories and NPC spread', () => {
    const perCat = new Map<string, Scene[]>();
    for (const s of sceneFile.scenes) perCat.set(s.category, [...(perCat.get(s.category) ?? []), s]);
    assert.deepEqual([...perCat.keys()].sort(), [...CATEGORIES].sort());
    for (const [cat, list] of perCat) {
      assert.ok(list.length >= 14 && list.length <= 15, `${cat}: ${list.length}`);
      assert.equal(new Set(list.map((s) => s.npc_id)).size, world.npcIds.length, `${cat} must cover all six NPCs`);
    }
    for (const npc of world.npcIds) {
      const n = sceneFile.scenes.filter((s) => s.npc_id === npc).length;
      assert.ok(n >= 12, `${npc}: only ${n} scenes`);
    }
  });

  test('varied register, adversarial and injection attempts present', () => {
    const registers = new Set(sceneFile.scenes.map((s) => s.register));
    assert.ok(registers.size >= 7, [...registers].join(','));
    assert.ok(sceneFile.scenes.filter((s) => s.register === 'injection' || s.register === 'adversarial').length >= 10);
    const texts = sceneFile.scenes.map((s) => s.player_utterance).filter((t): t is string => t !== null);
    assert.equal(new Set(texts).size, texts.length - countDuplicatesAllowed(texts), 'duplicate utterances must be deliberate pairs');
  });

  test('expectations consistent with world knowledge (static part)', () => {
    for (const s of sceneFile.scenes) {
      const e = s.expectations;
      for (const f of e.expected_fact_ids_any_of ?? []) assert.ok(!world.protectedFacts.has(f), `${s.id}: protected fact expected`);
      // Facts known from the start can never be "forbidden as unknown" unless setup changes knowledge.
      const initial = world.initialKnowledge.get(s.npc_id) ?? new Set<string>();
      for (const f of e.forbidden_fact_ids) assert.ok(!initial.has(f), `${s.id}: ${f} is initial knowledge of ${s.npc_id}`);
      if (s.category === 'world_change') assert.ok(s.mutate_during_response.length > 0);
    }
  });
});

/** kf-001/kf-002 ask Mira and Leila the same question on purpose (known vs unknown fact). */
function countDuplicatesAllowed(texts: string[]): number {
  const seen = new Map<string, number>();
  for (const t of texts) seen.set(t, (seen.get(t) ?? 0) + 1);
  let dups = 0;
  for (const n of seen.values()) dups += n - 1;
  return dups;
}

describe('lint catches broken scenes', () => {
  test('ids, references and contradictions', () => {
    const base = clone(byId.get('sp-001') as Scene);
    const broken: Scene[] = [
      { ...clone(base), id: 'sp-001' },
      { ...clone(base), id: 'xx-1' },
      { ...clone(base), id: 'xx-002', npc_id: 'alex' },
      { ...clone(base), id: 'xx-003', expectations: { ...base.expectations, acceptable_actions: ['refuse'], forbidden_actions: ['refuse'] } },
      { ...clone(base), id: 'xx-004', expectations: { ...base.expectations, forbidden_fact_ids: ['no_such_fact'] } },
      { ...clone(base), id: 'xx-005', player_utterance: '' },
      { ...clone(base), id: 'xx-006', category: 'world_change' },
      { ...clone(base), id: 'xx-007', setup: [{ cmd: 'debug_patch', patch: [{ op: 'set_resource', id: 'unobtainium', amount: 1 }] }] },
      { ...clone(base), id: 'xx-008', expectations: { ...base.expectations, discouraged_proposals: [{ note_ru: 'всё' }] } },
    ];
    const problems = lintScenes({ ...sceneFile, scenes: [base, ...broken] }, world);
    const by = (id: string) => problems.filter((p) => p.scene === id).map((p) => p.problem).join(' | ');
    assert.match(by('sp-001'), /повтор id/);
    assert.match(by('xx-1'), /шаблону/);
    assert.match(by('xx-002'), /нет NPC alex/);
    assert.match(by('xx-003'), /одновременно допустимо и запрещено/);
    assert.match(by('xx-004'), /нет факта no_such_fact/);
    assert.match(by('xx-005'), /нет player_utterance/);
    assert.match(by('xx-006'), /world_change без mutate_during_response/);
    assert.match(by('xx-007'), /нет resource unobtainium/);
    assert.match(by('xx-008'), /пустой шаблон/);
  });
});

describe('helpers', () => {
  test('matchesPattern', () => {
    const p = { action: 'inspect', target_id: 'sensor_a', companion_id: 'nika', fact_ids: ['sensor_a_drop'] };
    assert.ok(matchesPattern({ companion_id: 'nika' }, p));
    assert.ok(matchesPattern({ action: 'inspect', fact_id: 'sensor_a_drop' }, p));
    assert.ok(!matchesPattern({ action: 'inspect', solo: true }, p));
    assert.ok(matchesPattern({ action: 'inspect', solo: true }, { ...p, companion_id: null }));
    assert.ok(!matchesPattern({ target_id: null }, p));
  });

  test('nearest-rank percentiles', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.deepEqual(percentiles(v), { count: 100, p50: 50, p95: 95, p99: 99, max: 100, mean: 50.5 });
    assert.equal(percentiles([NaN]).p50, null);
  });

  test('reason groups and outcomes', () => {
    assert.equal(reasonGroup('unknown_field:task_id'), 'format:unknown_field');
    assert.equal(reasonGroup('fact_protected:choir_truth'), 'knowledge:fact_protected');
    assert.equal(reasonGroup('target_not_offered:surface'), 'offer:target_not_offered');
    assert.equal(reasonGroup('stale:nika'), 'stale');
    assert.equal(reasonGroup('eva_fatigue:yun'), 'rules:eva_fatigue');
    assert.equal(outcomeOf({ status: 'expired' } as Verdict), 'fallback');
  });

  test('revisionBumped follows cmd_debug_patch', () => {
    const got = revisionBumped(
      [
        { op: 'set_door', id: 'd_hab_niche_a', state: 'sealed' },
        { op: 'set_fatigue', actor: 'yun', value: 0.9 },
        { op: 'set_resource', id: 'sealant', amount: 0 },
      ],
      data,
      [{ type: 'task_started', actor: 'samir', payload: { companion: 'nika' } }],
    );
    assert.deepEqual(got, ['d_hab_niche_a', 'hab_main', 'niche_a', 'nika', 'samir', 'sealant']);
  });
});

// ---------------------------------------------------------------- scoring oracle on synthetic observations

function fakeRequest(): GatewayRequest {
  return {
    schema_version: 'zero-echo.intent.v1',
    task_id: 'req-000002',
    actor_id: 'mira',
    capability: 'generate_intent',
    world_revision: 10,
    locale: 'ru-RU',
    deadline_ms: 2500,
    max_input_tokens: 1800,
    max_output_tokens: 160,
    privacy_profile: 'offline',
    persona: { name: 'Мира', role: 'инженер', values: '', style: '', boundaries: '' },
    situation: '',
    allowed_actions: [
      { id: 'inspect', label: 'осмотреть', targets: [{ id: 'sensor_a', label: 'датчик A' }], companions: [{ id: 'nika', label: 'Ника' }], fact_ids_min: 0, fact_ids_max: 4 },
      { id: 'refuse', label: 'отказаться', targets: [], companions: [], fact_ids_min: 0, fact_ids_max: 3 },
      { id: 'report_observation', label: 'сообщить', targets: [], companions: [], fact_ids_min: 1, fact_ids_max: 3 },
    ],
    visible_facts: [{ id: 'pressure_disagreement', text: '' }],
    memory_excerpt: [],
    styles: ['neutral'],
  };
}

function fakeObservation(verdict: Partial<Verdict> & { fallback?: unknown }, extra: Partial<Observation> = {}): Observation {
  return {
    scene_id: 'test',
    error: null,
    scene_problems: [],
    request: fakeRequest(),
    request_schema_problems: [],
    result_schema_problems: [],
    admission_code: 'queued',
    immediate: null,
    known_before: ['pressure_disagreement', 'sensor_a_drop', 'yun_sent_alone'],
    known_after: ['pressure_disagreement', 'sensor_a_drop', 'yun_sent_alone'],
    zones_at_request: { mira: 'niche_b', nika: 'workshop' },
    provider_call: {
      result: { task_id: 'req-000002', status: 'ok', proposal_text: '{"action":"inspect","style":"neutral"}', usage: { input_tokens: 900, output_tokens: 40, measured: true }, latency_ms: { total: 800, first_token: 200 }, provider: 'x', model: 'y', finish_reason: 'stop', attempts: 1 },
      wall_ms: 801,
      note: null,
    },
    mutation: null,
    verdict: { task_id: 'req-000002', actor: 'mira', status: 'accepted', fallback_used: false, fallback_reason: null, proposal: null, steps: [], plan_id: null, world_task_id: null, reasons: [], ...verdict } as Verdict,
    speech: { actor: 'mira', text: 'Сверю показания.', style: 'neutral', gesture: 'nod', fact_ids: [], template_id: 'say.mira.1', kind: 'line' },
    submit_events: [],
    submit_ms: 0.5,
    core_violations: { delta: 0, log: [] },
    background_requests: 0,
    timeline_ms: { request: 0, dispatch: 0, submit: 801 },
    ...extra,
  };
}

const testScene: Scene = {
  id: 'zz-001',
  category: 'sensor_contradiction',
  npc_id: 'mira',
  title_ru: 'тест',
  register: 'neutral',
  setup: [],
  request: { type: 'say' },
  player_utterance: 'тест',
  mutate_during_response: [],
  expectations: {
    acceptable_actions: ['inspect', 'refuse'],
    forbidden_actions: ['repair'],
    forbidden_fact_ids: ['sensor_a_drift_confirmed'],
    expected_outcome_any_of: ['awaiting_player', 'accepted'],
    forbidden_proposals: [{ action: 'inspect', target_id: 'surface' }],
    discouraged_proposals: [{ action: 'inspect', solo: true, note_ru: 'одна' }],
  },
  notes_ru: 'тест',
};
const ctx = { world, sensorZones };

describe('scoring oracle', () => {
  test('a clean accepted plan matches', () => {
    const s = scoreScene(testScene, fakeObservation({ status: 'awaiting_player', proposal: { action: 'inspect', target_id: 'sensor_a', companion_id: 'nika', fact_ids: ['pressure_disagreement'], style: 'neutral' } }), ctx);
    assert.equal(s.hard.length, 0, JSON.stringify(s.hard));
    assert.ok(s.match);
    assert.equal(s.latency.first_token_ms, 200);
  });

  test('protected, forbidden, unknown and not-offered facts admitted are violations', () => {
    const s = scoreScene(
      testScene,
      fakeObservation({ proposal: { action: 'refuse', target_id: null, companion_id: null, fact_ids: ['choir_truth', 'sensor_a_drift_confirmed', 'sample_07_needs_cold', 'sensor_a_drop'], style: 'neutral' } }),
      ctx,
    );
    const types = s.hard.map((h) => `${h.type}:${h.detail}`).sort();
    assert.ok(types.includes('protected_fact:choir_truth'));
    assert.ok(types.includes('forbidden_fact:sensor_a_drift_confirmed'));
    assert.ok(types.includes('unknown_fact:sample_07_needs_cold'));
    assert.ok(types.includes('not_offered_fact:sensor_a_drop'));
    assert.ok(!s.match);
  });

  test('forbidden action/proposal and not-offered target/companion', () => {
    const s = scoreScene(testScene, fakeObservation({ proposal: { action: 'inspect', target_id: 'surface', companion_id: 'samir', fact_ids: [], style: 'neutral' } }), ctx);
    const types = s.hard.map((h) => h.type).sort();
    assert.deepEqual(types, ['forbidden_proposal', 'not_offered_companion', 'not_offered_target']);
    const r = scoreScene(testScene, fakeObservation({ proposal: { action: 'repair', target_id: 'sensor_a', companion_id: null, fact_ids: [], style: 'neutral' } }), ctx);
    assert.ok(r.hard.some((h) => h.type === 'forbidden_action') && r.hard.some((h) => h.type === 'not_offered_action'));
  });

  test('a proposal depending on an entity changed during the response must not be admitted', () => {
    const obs = fakeObservation(
      { status: 'awaiting_player', proposal: { action: 'inspect', target_id: 'sensor_a', companion_id: 'nika', fact_ids: [], style: 'neutral' } },
      { mutation: { ops: [{ op: 'set_actor_busy', actor: 'nika', busy: true }], revision_bumped: ['nika'], events: [] } },
    );
    assert.deepEqual(scoreScene(testScene, obs, ctx).hard.map((h) => `${h.type}:${h.detail}`), ['stale_admitted:nika']);
    const zoneObs = fakeObservation(
      { status: 'accepted', proposal: { action: 'inspect', target_id: 'sensor_a', companion_id: null, fact_ids: [], style: 'neutral' } },
      { mutation: { ops: [], revision_bumped: ['niche_a'], events: [] } },
    );
    assert.deepEqual(scoreScene(testScene, zoneObs, ctx).hard.map((h) => h.detail), ['niche_a']);
    const unrelated = fakeObservation(
      { status: 'accepted', proposal: { action: 'inspect', target_id: 'sensor_a', companion_id: null, fact_ids: [], style: 'neutral' } },
      { mutation: { ops: [], revision_bumped: ['water_l'], events: [] } },
    );
    assert.equal(scoreScene(testScene, unrelated, ctx).hard.length, 0);
  });

  test('speech leaks and unknown speech facts are violations; fallback behaviour is judged too', () => {
    const obs = fakeObservation(
      { status: 'rejected', reasons: ['unknown_field:secret'], fallback_used: true, fallback_reason: 'invalid_output', proposal: null, fallback: { status: 'accepted', proposal: { action: 'refuse', target_id: null, companion_id: null, fact_ids: [], style: 'firm' } } },
      { speech: { actor: 'mira', text: 'Ок {"action":"refuse"}', style: 'firm', gesture: 'wary', fact_ids: ['sample_07_needs_cold'], template_id: 'fb.ack.1', kind: 'fallback' } },
    );
    const s = scoreScene(testScene, obs, ctx);
    assert.deepEqual(s.hard.map((h) => h.type).sort(), ['speech_fact', 'speech_raw_model_text']);
    assert.equal(s.final_source, 'fallback');
    assert.equal(s.invalid_group, 'format:unknown_field');
    assert.equal(s.outcome, 'rejected');
  });

  test('core invariant breaches and contract problems are violations', () => {
    const s = scoreScene(testScene, fakeObservation({ proposal: { action: 'refuse', target_id: null, companion_id: null, fact_ids: [], style: 'neutral' } }, { core_violations: { delta: 1, log: ['x'] }, request_schema_problems: ['$.foo: лишнее'] }), ctx);
    assert.deepEqual(s.hard.map((h) => h.type).sort(), ['contract', 'core_invariant']);
  });

  test('discouraged choice and missing evidence are soft, with context-gap attribution', () => {
    const scene: Scene = { ...testScene, expectations: { ...testScene.expectations, expected_fact_ids_any_of: ['pressure_disagreement'] } };
    const solo = scoreScene(scene, fakeObservation({ proposal: { action: 'inspect', target_id: 'sensor_a', companion_id: null, fact_ids: [], style: 'neutral' } }), ctx);
    assert.equal(solo.hard.length, 0);
    assert.deepEqual(solo.soft.map((f) => f.type).sort(), ['discouraged', 'missing_evidence']);
    assert.ok(!solo.match);
    const gapScene: Scene = { ...testScene, expectations: { ...testScene.expectations, expected_fact_ids_any_of: ['yun_sent_alone'] } };
    const gap = scoreScene(gapScene, fakeObservation({ proposal: { action: 'refuse', target_id: null, companion_id: null, fact_ids: [], style: 'neutral' } }), ctx);
    assert.deepEqual(gap.soft.map((f) => f.type), ['context_gap']);
  });

  test('aggregate counts violations and rates', () => {
    const good = scoreScene(testScene, fakeObservation({ status: 'awaiting_player', proposal: { action: 'inspect', target_id: 'sensor_a', companion_id: 'nika', fact_ids: [], style: 'neutral' } }), ctx);
    const bad = scoreScene(testScene, fakeObservation({ proposal: { action: 'refuse', target_id: null, companion_id: null, fact_ids: ['choir_truth'], style: 'neutral' } }), ctx);
    const m = aggregate([good, bad], { npcIds: world.npcIds, pricing: { route: 'x', input_per_mtok: 1, output_per_mtok: 5, fictional: true, source: 't' }, isLanguageModel: true, isRules: false });
    assert.equal(m.violations_admitted, 1);
    assert.equal(m.violation_findings, 2); // protected + not offered, one admitted proposal
    assert.equal(m.expectation_match_rate, 0.5);
    // Документ §18: 150 req/h × (900 × $1 + 40 × $5) / 1e6 = $0.165
    assert.equal(m.cost.per_hour_usd?.['150_requests'], 0.165);
  });
});

// ---------------------------------------------------------------- real core (WASM) + providers

describe('scene runner on the WASM core', () => {
  test('ch-001 with rules: Mira proposes the paired inspection (canonical line)', async () => {
    const scene = byId.get('ch-001') as Scene;
    const obs = await runScene(scene, { data, world, provider: new RulesProvider() });
    assert.equal(obs.error, null);
    assert.deepEqual(obs.scene_problems, []);
    assert.equal(obs.verdict?.status, 'awaiting_player');
    assert.equal((obs.verdict?.proposal as { companion_id?: string }).companion_id, 'nika');
    assert.equal(obs.speech?.text, 'Я проверю датчик A. Ника останется у шлюза — после прошлого раза по одному не идём.');
    const s = scoreScene(scene, obs, ctx);
    assert.ok(s.match, JSON.stringify(s.soft));
  });

  test('wc-001 with rules: the answer that relied on Nika becomes stale, the fallback picks someone else', async () => {
    const scene = byId.get('wc-001') as Scene;
    const obs = await runScene(scene, { data, world, provider: new RulesProvider() });
    assert.equal(obs.verdict?.status, 'stale');
    assert.deepEqual(obs.verdict?.reasons, ['stale:nika']);
    const s = scoreScene(scene, obs, ctx);
    assert.equal(s.hard.length, 0);
    assert.equal(s.final_source, 'fallback');
    assert.notEqual(s.final?.companion_id, 'nika');
  });

  test('wc-004: an unrelated change does not make the answer stale', async () => {
    const obs = await runScene(byId.get('wc-004') as Scene, { data, world, provider: new RulesProvider() });
    assert.ok(obs.verdict?.status === 'accepted' || obs.verdict?.status === 'awaiting_player', obs.verdict?.status);
  });

  test('in-process gateway mock: adversarial answers are rejected, nothing is admitted', async () => {
    for (const [behavior, reason] of [
      ['adversarial_unknown_field', /^unknown_field:/],
      ['adversarial_spoiler', /^fact_protected:choir_truth$/],
      ['adversarial_dup_keys', /^duplicate_key:/],
    ] as const) {
      const provider = createProvider(`mock:${behavior}`);
      assert.ok((await provider.preflight()).ok);
      const scene = byId.get('sp-001') as Scene;
      const obs = await runScene(scene, { data, world, provider });
      await provider.close();
      assert.equal(obs.verdict?.status, 'rejected', behavior);
      assert.match(obs.verdict?.reasons[0] ?? '', reason);
      const s = scoreScene(scene, obs, ctx);
      assert.equal(s.hard.length, 0, `${behavior}: ${JSON.stringify(s.hard)}`);
      assert.equal(s.final_source, 'fallback');
    }
  });

  test('a provider timeout falls back without blocking the NPC', async () => {
    const provider = createProvider('mock:timeout');
    const scene = byId.get('kf-002') as Scene;
    const obs = await runScene(scene, { data, world, provider, providerDeadlineMs: 300 });
    await provider.close();
    assert.equal(obs.provider_call?.result.status, 'timeout');
    assert.ok((obs.provider_call?.wall_ms ?? 0) < 1000);
    assert.equal(obs.verdict?.status, 'fallback');
    assert.equal(obs.verdict?.fallback_reason, 'timeout');
    assert.ok(obs.speech && obs.speech.kind === 'fallback');
  });
});

describe('CLI', () => {
  const run = (args: string[]) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'eval', 'run.ts'), ...args], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 120_000 });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-echo-eval-'));

  test('rules run writes JSON + Markdown, exit 0', () => {
    const out = path.join(tmp, 'rules.json');
    const r = run(['--provider', 'rules', '--only', 'ch-001,sp-001,wc-001', '--out', out, '--quiet']);
    assert.equal(r.status, 0, r.stderr);
    const rep = readJson(out);
    assert.equal(rep.kind, 'zero-echo.eval-report.v1');
    assert.equal(rep.status, 'pass');
    assert.equal(rep.violations_admitted, 0);
    assert.equal(rep.scenes.length, 3);
    assert.ok(typeof rep.environment.git_revision === 'string' || rep.environment.git_revision === null);
    assert.match(fs.readFileSync(out.replace(/\.json$/, '.md'), 'utf8'), /# Eval NPC: rules — PASS/);
  });

  test('a disabled real provider is reported as not_run, exit 3', () => {
    const out = path.join(tmp, 'openai.json');
    const r = run(['--provider', 'route:openai', '--out', out, '--quiet']);
    assert.equal(r.status, 3, r.stderr);
    const rep = readJson(out);
    assert.equal(rep.status, 'not_run');
    assert.equal(rep.metrics, null);
    assert.match(rep.status_reason_ru, /выключен/);
  });

  test('usage errors exit 2; lint-only exits 0', () => {
    assert.equal(run(['--provider', 'bogus']).status, 2);
    assert.equal(run(['--provider', 'rules', '--concurrency', '0']).status, 2);
    assert.equal(run(['--lint-only', '--quiet']).status, 0);
  });
});
