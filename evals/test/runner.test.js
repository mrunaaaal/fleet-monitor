import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEvalRunner, scoreCategory } from '../runner.js';

function scenario(overrides = {}) {
  return {
    id: 'ledger_slow_diamond',
    chaos: [{ service: 'ledger-db', mode: 'slow' }],
    warmup_seconds: 90,
    symptom: 'checkout is timing out',
    expected: {
      root_causes: [{ service: 'ledger-db', category: 'latency' }],
      affected_services: ['payments', 'inventory'],
    },
    ...overrides,
  };
}

function findings({ causes = [], affected = [] } = {}) {
  return {
    root_cause_services: causes.map(([service, category]) => ({ service, category, confidence: 'high' })),
    summary: 's',
    evidence: [],
    affected_services: affected,
    suggested_remediation: 'r',
  };
}

function fakeChaos() {
  const calls = [];
  return {
    calls,
    reset: async () => calls.push({ op: 'reset' }),
    apply: async (steps) => calls.push({ op: 'apply', steps }),
  };
}

function investigateResult(overrides = {}) {
  return {
    findings: findings({ causes: [['ledger-db', 'latency']], affected: ['payments', 'inventory'] }),
    terminated: null,
    trace: [{ signature: 'check_liveness:{}', name: 'check_liveness', input: {}, out: {} }],
    iterations: 2,
    toolCalls: 2,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.01,
    durationMs: 500,
    ...overrides,
  };
}

// scoreCategory --------------------------------------------------------

test('scoreCategory: every named cause matches its expected category -> true', () => {
  const result = scoreCategory(findings({ causes: [['ledger-db', 'latency']] }), {
    root_causes: [{ service: 'ledger-db', category: 'latency' }],
  });
  assert.equal(result, true);
});

test('scoreCategory: a named cause with the wrong category -> false', () => {
  const result = scoreCategory(findings({ causes: [['ledger-db', 'error']] }), {
    root_causes: [{ service: 'ledger-db', category: 'latency' }],
  });
  assert.equal(result, false);
});

test('scoreCategory: correct but incomplete (double failure) still scores category true for the named cause', () => {
  const result = scoreCategory(findings({ causes: [['auth-service', 'unavailable']] }), {
    root_causes: [
      { service: 'auth-service', category: 'unavailable' },
      { service: 'payments', category: 'latency' },
    ],
  });
  assert.equal(result, true);
});

test('scoreCategory: nothing expected and nothing named (healthy) -> null (not applicable)', () => {
  const result = scoreCategory(findings(), { root_causes: [] });
  assert.equal(result, null);
});

test('scoreCategory: no findings at all -> false', () => {
  const result = scoreCategory(null, { root_causes: [{ service: 'ledger-db', category: 'latency' }] });
  assert.equal(result, false);
});

// createEvalRunner -------------------------------------------------------

test('live mode: resets, settles, applies chaos, warms up, investigates, scores, and persists', async () => {
  const chaos = fakeChaos();
  const sleeps = [];
  const persisted = [];
  const dispatch = async () => ({});
  const callModel = async () => ({ content: [], usage: {}, costUsd: 0 });
  const investigate = investigateResult();

  const runner = createEvalRunner({
    mode: 'live',
    chaos,
    dispatch,
    callModel,
    systemPrompt: 'sys',
    tools: [],
    settleSeconds: 5,
    sleep: async (ms) => sleeps.push(ms),
    persistInvestigation: async (row) => persisted.push(row),
    createLoop: () => ({ investigate: async () => investigate }),
  });

  const row = await runner.runScenario(scenario());

  assert.deepEqual(chaos.calls, [
    { op: 'reset' },
    { op: 'apply', steps: [{ service: 'ledger-db', mode: 'slow' }] },
  ]);
  assert.deepEqual(sleeps, [5000, 90000]);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].evalScenario, 'ledger_slow_diamond');
  assert.equal(row.score.correctness, true);
  assert.equal(row.score.root_cause_completeness, 1);
  assert.equal(row.categoryCorrect, true);
});

test('live mode: stamps metricsWindow.since before reset/settle so it covers this scenario only', async () => {
  const chaos = fakeChaos();
  const metricsWindow = {};
  const investigate = investigateResult();

  const runner = createEvalRunner({
    mode: 'live',
    chaos,
    dispatch: async () => ({}),
    callModel: async () => ({ content: [], usage: {}, costUsd: 0 }),
    systemPrompt: 'sys',
    tools: [],
    settleSeconds: 5,
    sleep: async () => {},
    createLoop: () => ({ investigate: async () => investigate }),
    metricsWindow,
    now: () => new Date('2026-08-16T12:00:00.000Z'),
  });

  await runner.runScenario(scenario());

  assert.equal(metricsWindow.since, '2026-08-16T12:00:00.000Z');
});

test('replay mode: leaves metricsWindow untouched (no live store to scope)', async () => {
  const metricsWindow = {};
  const investigate = investigateResult();

  const runner = createEvalRunner({
    mode: 'replay',
    chaos: fakeChaos(),
    dispatch: async () => ({}),
    callModel: async () => ({ content: [], usage: {}, costUsd: 0 }),
    systemPrompt: 'sys',
    tools: [],
    sleep: async () => {},
    createLoop: () => ({ investigate: async () => investigate }),
    loadFixture: async () => [],
    metricsWindow,
  });

  await runner.runScenario(scenario());

  assert.equal(metricsWindow.since, undefined);
});

test('replay mode: skips chaos and sleeping entirely, and builds its dispatch from a fixture', async () => {
  const chaos = fakeChaos();
  const sleeps = [];
  const investigate = investigateResult();
  const loadedFixtures = [];

  const runner = createEvalRunner({
    mode: 'replay',
    chaos,
    dispatch: async () => ({}),
    callModel: async () => ({ content: [], usage: {}, costUsd: 0 }),
    systemPrompt: 'sys',
    tools: [],
    sleep: async (ms) => sleeps.push(ms),
    createLoop: () => ({ investigate: async () => investigate }),
    loadFixture: async (dir, id) => {
      loadedFixtures.push(id);
      return [];
    },
  });

  await runner.runScenario(scenario());

  assert.deepEqual(chaos.calls, []);
  assert.deepEqual(sleeps, []);
  assert.deepEqual(loadedFixtures, ['ledger_slow_diamond']);
});

test('capture mode: runs live (chaos + sleep) and saves the resulting trace to a fixture', async () => {
  const chaos = fakeChaos();
  const saved = [];
  const investigate = investigateResult({ trace: [{ signature: 'x', name: 'x', input: {}, out: {} }] });

  const runner = createEvalRunner({
    mode: 'capture',
    chaos,
    dispatch: async () => ({}),
    callModel: async () => ({ content: [], usage: {}, costUsd: 0 }),
    systemPrompt: 'sys',
    tools: [],
    sleep: async () => {},
    createLoop: () => ({ investigate: async () => investigate }),
    saveFixture: async (dir, id, trace) => saved.push({ dir, id, trace }),
  });

  await runner.runScenario(scenario());

  assert.equal(chaos.calls.length, 2);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'ledger_slow_diamond');
  assert.deepEqual(saved[0].trace, investigate.trace);
});

test('a scenario with no findings (terminated) scores as incorrect and zero completeness, not a crash', async () => {
  const runner = createEvalRunner({
    mode: 'replay',
    chaos: fakeChaos(),
    dispatch: async () => ({}),
    callModel: async () => ({ content: [], usage: {}, costUsd: 0 }),
    systemPrompt: 'sys',
    tools: [],
    sleep: async () => {},
    createLoop: () => ({ investigate: async () => investigateResult({ findings: null, terminated: 'max_iterations' }) }),
    loadFixture: async () => [],
  });

  const row = await runner.runScenario(scenario());

  assert.deepEqual(row.score, { correctness: false, root_cause_completeness: 0, blast_radius_completeness: 0 });
  assert.equal(row.categoryCorrect, false);
});

test('run() executes every scenario in order and resets chaos once at the end in live mode', async () => {
  const chaos = fakeChaos();
  const investigate = investigateResult();

  const runner = createEvalRunner({
    mode: 'live',
    chaos,
    dispatch: async () => ({}),
    callModel: async () => ({ content: [], usage: {}, costUsd: 0 }),
    systemPrompt: 'sys',
    tools: [],
    sleep: async () => {},
    createLoop: () => ({ investigate: async () => investigate }),
  });

  const rows = await runner.run([scenario({ id: 'a' }), scenario({ id: 'b' })]);

  assert.equal(rows.length, 2);
  assert.deepEqual(chaos.calls.at(-1), { op: 'reset' });
  assert.equal(chaos.calls.filter((c) => c.op === 'reset').length, 3); // per-scenario + final
});
