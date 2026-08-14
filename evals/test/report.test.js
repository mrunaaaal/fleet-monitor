import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, formatResultsTable, formatFailures } from '../report.js';

function row({
  id = 'ledger_slow_diamond',
  correctness = true,
  categoryCorrect = true,
  rootCauseCompleteness = 1,
  blastRadiusCompleteness = 1,
  calls = 6,
  costUsd = 0.031,
  namedCauses = ['ledger-db'],
  expectedCauses = ['ledger-db'],
} = {}) {
  return {
    scenario: { id, expected: { root_causes: expectedCauses.map((service) => ({ service, category: 'latency' })) } },
    result: {
      toolCalls: calls,
      costUsd,
      findings: { root_cause_services: namedCauses.map((service) => ({ service, category: 'latency', confidence: 'high' })) },
    },
    score: {
      correctness,
      root_cause_completeness: rootCauseCompleteness,
      blast_radius_completeness: blastRadiusCompleteness,
    },
    categoryCorrect,
  };
}

test('summarize aggregates correctness, category, completeness, calls, and cost across rows', () => {
  const rows = [
    row({ id: 'a', correctness: true, categoryCorrect: true, rootCauseCompleteness: 1, blastRadiusCompleteness: 1, calls: 6, costUsd: 0.03 }),
    row({ id: 'b', correctness: false, categoryCorrect: false, rootCauseCompleteness: 0, blastRadiusCompleteness: 0, calls: 4, costUsd: 0.01 }),
  ];

  const summary = summarize(rows);

  assert.equal(summary.total, 2);
  assert.equal(summary.correct, 1);
  assert.equal(summary.categoryCorrect, 1);
  assert.equal(summary.categoryApplicable, 2);
  assert.equal(summary.avgRootCauseCompleteness, 0.5);
  assert.equal(summary.avgBlastRadiusCompleteness, 0.5);
  assert.equal(summary.avgCalls, 5);
  assert.equal(summary.avgCostUsd, 0.02);
});

test('summarize excludes not-applicable (null) category scores from the category denominator', () => {
  const rows = [
    row({ id: 'a', categoryCorrect: true }),
    row({ id: 'b', categoryCorrect: null, namedCauses: [], expectedCauses: [] }),
  ];

  const summary = summarize(rows);

  assert.equal(summary.categoryApplicable, 1);
  assert.equal(summary.categoryCorrect, 1);
});

test('formatResultsTable renders one line per scenario with checkmarks and a summary footer', () => {
  const rows = [row({ id: 'ledger_slow_diamond' }), row({ id: 'healthy_false_alarm', categoryCorrect: null, namedCauses: [], expectedCauses: [] })];

  const table = formatResultsTable(rows);

  assert.match(table, /ledger_slow_diamond/);
  assert.match(table, /healthy_false_alarm/);
  assert.match(table, /✓/);
  assert.match(table, /—/); // dash for not-applicable category
  assert.match(table, /correct 2\/2/);
  assert.match(table, /category 1\/1/);
});

test('formatResultsTable marks an incorrect scenario with a cross', () => {
  const rows = [row({ id: 'red_herring', correctness: false, namedCauses: ['session-store'], expectedCauses: ['ledger-db'] })];

  const table = formatResultsTable(rows);

  assert.match(table, /red_herring\s+✗/);
});

test('formatFailures explains a false-positive root cause', () => {
  const rows = [row({ id: 'red_herring', correctness: false, namedCauses: ['session-store'], expectedCauses: ['ledger-db'] })];

  const text = formatFailures(rows);

  assert.match(text, /red_herring/);
  assert.match(text, /session-store/);
  assert.match(text, /false cause/);
});

test('formatFailures explains a false alarm on an otherwise-healthy scenario', () => {
  const rows = [row({ id: 'healthy_false_alarm', correctness: false, namedCauses: ['payments'], expectedCauses: [] })];

  const text = formatFailures(rows);

  assert.match(text, /false alarm/);
});

test('formatFailures reports no failures when every scenario is correct', () => {
  const rows = [row({ id: 'a' })];

  assert.match(formatFailures(rows), /no incorrect/i);
});
