import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPersistInvestigationQuery } from '../query/investigations.js';

// Written once, consumed by the investigation loop's HTTP route (#14) —
// inserts one row per completed or terminated run into `investigations`
// (server/db/migrations/0001_service_registry.sql), matching every NOT
// NULL column and the nullable findings/terminated/eval_scenario.
test('persistInvestigation inserts every column, defaulting nullable fields', async () => {
  let captured;
  const postgres = { query: async (sql, params) => { captured = { sql, params }; } };
  const persistInvestigation = createPersistInvestigationQuery({ postgres });

  await persistInvestigation({
    symptom: 'checkout is timing out',
    findings: { root_cause_services: [{ service: 'ledger-db', category: 'latency', confidence: 'high' }] },
    trace: [{ name: 'check_liveness', input: {}, out: {} }],
    iterations: 3,
    toolCalls: 4,
    inputTokens: 1200,
    outputTokens: 300,
    costUsd: 0.014,
    durationMs: 4200,
  });

  assert.match(captured.sql, /INSERT INTO investigations/);
  assert.deepEqual(captured.params, [
    'checkout is timing out',
    JSON.stringify({ root_cause_services: [{ service: 'ledger-db', category: 'latency', confidence: 'high' }] }),
    JSON.stringify([{ name: 'check_liveness', input: {}, out: {} }]),
    3,
    4,
    1200,
    300,
    0.014,
    4200,
    null,
    null,
  ]);
});

test('persistInvestigation passes through terminated and eval_scenario when given', async () => {
  let captured;
  const postgres = { query: async (sql, params) => { captured = { sql, params }; } };
  const persistInvestigation = createPersistInvestigationQuery({ postgres });

  await persistInvestigation({
    symptom: 'checkout is timing out',
    findings: null,
    trace: [],
    iterations: 10,
    toolCalls: 10,
    inputTokens: 5000,
    outputTokens: 800,
    costUsd: 0.3,
    durationMs: 12000,
    terminated: 'budget_exceeded',
    evalScenario: 'ledger_slow_diamond',
  });

  assert.equal(captured.params[1], null); // findings null when terminated without a finding
  assert.equal(captured.params[9], 'budget_exceeded');
  assert.equal(captured.params[10], 'ledger_slow_diamond');
});

test('persistInvestigation requires symptom, trace, iterations, and toolCalls', async () => {
  const persistInvestigation = createPersistInvestigationQuery({ postgres: { query: async () => {} } });

  await assert.rejects(() => persistInvestigation({}), /symptom/);
});
