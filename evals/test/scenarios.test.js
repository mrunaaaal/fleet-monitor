import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScenarios } from '../../server/eval/scenario-schema.js';
import { services } from '../../mesh/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadScenarios() {
  const raw = await readFile(path.join(__dirname, '..', 'scenarios.json'), 'utf8');
  return JSON.parse(raw);
}

// Coverage table, fleet-monitor-docs.md §8.2.
const EXPECTED_COVERAGE = {
  single_service: 9,
  cascade: 4,
  double_failure: 2,
  red_herring: 2,
  healthy_false_alarm: 2,
  insufficient_data: 1,
};

test('scenarios.json validates against the scenario schema', async () => {
  const scenarios = await loadScenarios();
  assert.doesNotThrow(() => validateScenarios(scenarios));
});

test('scenarios.json has exactly 20 scenarios matching the §8.2 coverage table', async () => {
  const scenarios = await loadScenarios();
  assert.equal(scenarios.length, 20);

  const counts = {};
  for (const scenario of scenarios) {
    counts[scenario.category] = (counts[scenario.category] ?? 0) + 1;
  }
  assert.deepEqual(counts, EXPECTED_COVERAGE);
});

test('every single_service scenario names exactly one root cause under one chaos step', async () => {
  const scenarios = await loadScenarios();
  for (const scenario of scenarios.filter((s) => s.category === 'single_service')) {
    assert.equal(scenario.chaos.length, 1, scenario.id);
    assert.equal(scenario.expected.root_causes.length, 1, scenario.id);
  }
});

test('single_service scenarios cover every service in the mesh at least once', async () => {
  const scenarios = await loadScenarios();
  const single = scenarios.filter((s) => s.category === 'single_service');
  const coveredServices = new Set(single.map((s) => s.chaos[0].service));
  for (const service of services) {
    assert.ok(coveredServices.has(service.name), `expected single_service coverage for ${service.name}`);
  }
});

// Only session-store and ledger-db sit 3 edges (the "3-4 hops" from
// fleet-monitor-docs.md §8.2, counting nodes the way §3.1's "Depth 4"
// does) below a user-facing service (web/checkout -> api-gateway ->
// {auth-service|payments|inventory} -> {session-store|ledger-db}) — any
// other root cause is at most 2 edges from a user-facing symptom, no
// deeper than the single_service baseline already covers.
const DEEP_APEX_SERVICES = new Set(['session-store', 'ledger-db']);

test('cascade scenarios name a root cause that is genuinely 3-4 hops from a user-facing symptom', async () => {
  const scenarios = await loadScenarios();
  for (const scenario of scenarios.filter((s) => s.category === 'cascade')) {
    assert.equal(scenario.expected.root_causes.length, 1, scenario.id);
    const [cause] = scenario.expected.root_causes;
    assert.ok(DEEP_APEX_SERVICES.has(cause.service), `${scenario.id}: root cause ${cause.service} is not a deep apex service`);
  }
});

test('double_failure scenarios apply exactly two independent chaos steps and name two root causes', async () => {
  const scenarios = await loadScenarios();
  for (const scenario of scenarios.filter((s) => s.category === 'double_failure')) {
    assert.equal(scenario.chaos.length, 2, scenario.id);
    assert.equal(scenario.expected.root_causes.length, 2, scenario.id);
  }
});

test('red_herring scenarios apply a decoy chaos step alongside the true cause, but name only the true cause', async () => {
  const scenarios = await loadScenarios();
  for (const scenario of scenarios.filter((s) => s.category === 'red_herring')) {
    assert.equal(scenario.chaos.length, 2, scenario.id);
    assert.equal(scenario.expected.root_causes.length, 1, scenario.id);
    const trueCause = scenario.expected.root_causes[0].service;
    const decoys = scenario.chaos.map((c) => c.service).filter((service) => service !== trueCause);
    assert.equal(decoys.length, 1, scenario.id);
  }
});

test('healthy_false_alarm and insufficient_data scenarios expect no root causes and no affected services', async () => {
  const scenarios = await loadScenarios();
  for (const scenario of scenarios.filter((s) => ['healthy_false_alarm', 'insufficient_data'].includes(s.category))) {
    assert.deepEqual(scenario.expected.root_causes, [], scenario.id);
    assert.deepEqual(scenario.expected.affected_services, [], scenario.id);
  }
});

test('every chaos step and root-cause service name is a real service in the mesh', async () => {
  const scenarios = await loadScenarios();
  const names = new Set(services.map((s) => s.name));
  for (const scenario of scenarios) {
    for (const step of scenario.chaos) assert.ok(names.has(step.service), `${scenario.id}: unknown service ${step.service}`);
    for (const cause of scenario.expected.root_causes) {
      assert.ok(names.has(cause.service), `${scenario.id}: unknown root cause service ${cause.service}`);
    }
    for (const service of scenario.expected.affected_services) {
      assert.ok(names.has(service), `${scenario.id}: unknown affected service ${service}`);
    }
  }
});
