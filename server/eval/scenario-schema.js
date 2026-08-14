// The scenario format (spec issue #16, §8.1 of fleet-monitor-docs.md): the
// declarative unit the eval runner (#17) consumes — the chaos to apply, a
// warmup, the symptom handed to the agent, and the ground truth the scorer
// (./scorer.js) checks findings against.
import { CATEGORIES } from '../agent/submit-findings-tool.js';

// Mirrors mesh/shared/service.js CHAOS_MODES; duplicated because the mesh and
// server packages don't share a module tree.
const CHAOS_MODES = ['ok', 'slow', 'error', 'dead'];

export function validateScenario(scenario) {
  requireFields(scenario, ['id', 'chaos', 'warmup_seconds', 'symptom', 'expected'], 'scenario');

  if (typeof scenario.id !== 'string' || scenario.id.length === 0) {
    throw new Error('scenario id must be a non-empty string');
  }

  if (!Array.isArray(scenario.chaos) || scenario.chaos.length === 0) {
    throw new Error(`scenario ${scenario.id}: chaos must be a non-empty array`);
  }
  for (const step of scenario.chaos) {
    requireFields(step, ['service', 'mode'], `scenario ${scenario.id} chaos entry`);
    if (!CHAOS_MODES.includes(step.mode)) {
      throw new Error(`scenario ${scenario.id}: chaos mode must be one of ${CHAOS_MODES.join(', ')}`);
    }
  }

  if (typeof scenario.warmup_seconds !== 'number' || scenario.warmup_seconds < 0) {
    throw new Error(`scenario ${scenario.id}: warmup_seconds must be a non-negative number`);
  }

  if (typeof scenario.symptom !== 'string' || scenario.symptom.length === 0) {
    throw new Error(`scenario ${scenario.id}: symptom must be a non-empty string`);
  }

  const { expected } = scenario;
  requireFields(expected, ['root_causes', 'affected_services'], `scenario ${scenario.id} expected`);

  if (!Array.isArray(expected.root_causes)) {
    throw new Error(`scenario ${scenario.id}: expected.root_causes must be an array`);
  }
  for (const cause of expected.root_causes) {
    requireFields(cause, ['service', 'category'], `scenario ${scenario.id} expected root cause`);
    if (!CATEGORIES.includes(cause.category)) {
      throw new Error(`scenario ${scenario.id}: expected root cause category must be one of ${CATEGORIES.join(', ')}`);
    }
  }

  if (!Array.isArray(expected.affected_services)) {
    throw new Error(`scenario ${scenario.id}: expected.affected_services must be an array`);
  }

  return scenario;
}

export function validateScenarios(scenarios) {
  if (!Array.isArray(scenarios)) throw new Error('scenarios must be an array');

  const ids = new Set();
  for (const scenario of scenarios) {
    validateScenario(scenario);
    if (ids.has(scenario.id)) throw new Error(`duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
  }

  return scenarios;
}

function requireFields(obj, fields, label) {
  for (const field of fields) {
    if (!obj || obj[field] === undefined) throw new Error(`${label} requires ${field}`);
  }
}
