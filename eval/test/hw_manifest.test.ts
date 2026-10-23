// tools/hw_manifest.py: its own parser tests on simulated machines, and a real run on this machine whose
// output must state unknowns as null with a reason (never an invented value).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { REPO_ROOT } from '../lib/core.ts';

const TOOL = path.join(REPO_ROOT, 'tools', 'hw_manifest.py');
const py = (args: string[]) => spawnSync('python3', [TOOL, ...args], { encoding: 'utf8', timeout: 60_000 });

describe('tools/hw_manifest.py', () => {
  test('self-test (simulated gaming PC and headless VM)', () => {
    const r = py(['--self-test']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /OK/);
  });

  test('real run: schema, explicit unknowns, no invented GPU', () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zero-echo-hw-')), 'manifest.json');
    const r = py(['--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const m = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(m.kind, 'zero-echo.hardware-manifest.v1');
    for (const key of ['git', 'os', 'cpu', 'memory', 'gpu', 'vulkan', 'display', 'power', 'storage', 'browsers', 'toolchain', 'target_comparison', 'unknowns']) {
      assert.ok(key in m, key);
    }
    assert.ok(m.cpu.logical_threads >= 1);
    assert.ok(m.memory.total_gib > 0);
    for (const u of m.unknowns) assert.ok(typeof u.reason === 'string' && u.reason.length > 0, JSON.stringify(u));
    const hasNvidiaSmi = spawnSync('sh', ['-c', 'command -v nvidia-smi'], { encoding: 'utf8' }).status === 0;
    if (!hasNvidiaSmi) {
      assert.equal(m.gpu.nvidia, null);
      assert.ok(m.gpu.nvidia_reason);
      assert.equal(m.target_comparison.is_target_bench, false);
    }
    if (m.display.session_type === null) assert.ok(m.display.session_reason);
    if (m.power.profile === null) assert.ok(m.power.profile_reason);
  });
});
