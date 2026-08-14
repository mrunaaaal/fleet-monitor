import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveFixture, loadFixture, createReplayDispatch } from '../fixtures.js';

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), 'fleet-monitor-eval-fixtures-'));
}

test('saveFixture writes the trace as JSON, loadFixture reads it back', async () => {
  const dir = path.join(await tempDir(), 'nested');
  const trace = [{ signature: 'check_liveness:{}', name: 'check_liveness', input: {}, out: { liveness: [] } }];

  await saveFixture(dir, 'ledger_slow_diamond', trace);
  const raw = JSON.parse(await readFile(path.join(dir, 'ledger_slow_diamond.json'), 'utf8'));
  assert.deepEqual(raw, trace);

  const loaded = await loadFixture(dir, 'ledger_slow_diamond');
  assert.deepEqual(loaded, trace);
});

test('createReplayDispatch serves a recorded call by name + input signature', async () => {
  const trace = [
    { signature: 'check_liveness:{}', name: 'check_liveness', input: {}, out: { liveness: [{ service: 'web', up: true }] } },
    {
      signature: 'get_dependencies:{"service":"web"}',
      name: 'get_dependencies',
      input: { service: 'web' },
      out: { downstream: ['api-gateway'] },
    },
  ];
  const dispatch = createReplayDispatch(trace);

  assert.deepEqual(await dispatch('check_liveness', {}), { liveness: [{ service: 'web', up: true }] });
  assert.deepEqual(await dispatch('get_dependencies', { service: 'web' }), { downstream: ['api-gateway'] });
});

test('createReplayDispatch ignores from/to on search_logs and get_log_samples, since the model picks those itself with no fixed "now"', async () => {
  const trace = [
    {
      signature: 'search_logs:{"service":"payments","level":"error","from":"2026-08-14T09:58:00.000Z","to":"2026-08-14T10:00:00.000Z"}',
      name: 'search_logs',
      input: { service: 'payments', level: 'error', from: '2026-08-14T09:58:00.000Z', to: '2026-08-14T10:00:00.000Z' },
      out: { total: 12, patterns: [] },
    },
  ];
  const dispatch = createReplayDispatch(trace);

  // A replay run's model call generates its own from/to, different from
  // what was captured — the recorded output must still be served.
  const result = await dispatch('search_logs', {
    service: 'payments',
    level: 'error',
    from: '2026-08-14T10:15:00.000Z',
    to: '2026-08-14T10:17:00.000Z',
  });

  assert.deepEqual(result, { total: 12, patterns: [] });
});

test('createReplayDispatch still distinguishes search_logs calls by service/level/pattern, only ignoring from/to', async () => {
  const trace = [
    {
      signature: 'x',
      name: 'search_logs',
      input: { service: 'payments', level: 'error', from: 'a', to: 'b' },
      out: { total: 12 },
    },
    {
      signature: 'y',
      name: 'search_logs',
      input: { service: 'auth-service', level: 'error', from: 'a', to: 'b' },
      out: { total: 3 },
    },
  ];
  const dispatch = createReplayDispatch(trace);

  assert.deepEqual(await dispatch('search_logs', { service: 'auth-service', level: 'error', from: 'x', to: 'y' }), {
    total: 3,
  });
});

test('createReplayDispatch throws a recapture-pointing error for an unrecorded call', async () => {
  const dispatch = createReplayDispatch([]);

  await assert.rejects(() => dispatch('check_liveness', {}), /recapture/);
});

test('createReplayDispatch routes submit_findings to the injected live dispatch instead of the trace', async () => {
  const liveCalls = [];
  const liveDispatch = async (name, input) => {
    liveCalls.push({ name, input });
    return input;
  };
  const dispatch = createReplayDispatch([], { liveDispatch });

  const findings = { summary: 'new findings text that never appeared during capture' };
  const result = await dispatch('submit_findings', findings);

  assert.deepEqual(result, findings);
  assert.deepEqual(liveCalls, [{ name: 'submit_findings', input: findings }]);
});
