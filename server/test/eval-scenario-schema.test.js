import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateScenario, validateScenarios } from '../eval/scenario-schema.js';

function validScenario(overrides = {}) {
  return {
    id: 'ledger_slow_diamond',
    chaos: [{ service: 'ledger-db', mode: 'slow' }],
    warmup_seconds: 90,
    symptom: 'Users report checkout is timing out',
    expected: {
      root_causes: [{ service: 'ledger-db', category: 'latency' }],
      affected_services: ['payments', 'inventory', 'checkout', 'web'],
    },
    ...overrides,
  };
}

test('accepts a well-formed scenario and returns it unchanged', () => {
  const scenario = validScenario();

  assert.equal(validateScenario(scenario), scenario);
});

test('rejects a scenario missing a required top-level field', () => {
  const scenario = validScenario();
  delete scenario.symptom;

  assert.throws(() => validateScenario(scenario), /symptom/);
});

test('rejects an empty chaos list', () => {
  assert.throws(() => validateScenario(validScenario({ chaos: [] })), /chaos/);
});

test('rejects an unknown chaos mode', () => {
  assert.throws(
    () => validateScenario(validScenario({ chaos: [{ service: 'ledger-db', mode: 'exploded' }] })),
    /mode/,
  );
});

test('rejects a negative warmup_seconds', () => {
  assert.throws(() => validateScenario(validScenario({ warmup_seconds: -1 })), /warmup_seconds/);
});

test('rejects an unknown expected root-cause category', () => {
  assert.throws(
    () =>
      validateScenario(
        validScenario({ expected: { root_causes: [{ service: 'ledger-db', category: 'explosive' }], affected_services: [] } }),
      ),
    /category/,
  );
});

test('healthy scenarios may declare zero expected root causes', () => {
  const scenario = validScenario({ expected: { root_causes: [], affected_services: [] } });

  assert.equal(validateScenario(scenario), scenario);
});

test('validateScenarios accepts a list of valid, uniquely-id\'d scenarios', () => {
  const scenarios = [validScenario(), validScenario({ id: 'auth_dead_asymmetric' })];

  assert.equal(validateScenarios(scenarios), scenarios);
});

test('validateScenarios rejects duplicate scenario ids', () => {
  const scenarios = [validScenario(), validScenario()];

  assert.throws(() => validateScenarios(scenarios), /duplicate/);
});
