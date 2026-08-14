import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreFindings } from '../eval/scorer.js';

function findings({ causes = [], affected = [] } = {}) {
  return {
    root_cause_services: causes.map((service) => ({ service, category: 'latency', confidence: 'high' })),
    summary: 'summary',
    evidence: [],
    affected_services: affected,
    suggested_remediation: 'remediation',
  };
}

function expected({ causes = [], affected = [] } = {}) {
  return {
    root_causes: causes.map((service) => ({ service, category: 'latency' })),
    affected_services: affected,
  };
}

test('single-cause: exact match scores correct and fully complete', () => {
  const score = scoreFindings(
    findings({ causes: ['ledger-db'], affected: ['payments', 'inventory'] }),
    expected({ causes: ['ledger-db'], affected: ['payments', 'inventory'] }),
  );

  assert.deepEqual(score, { correctness: true, root_cause_completeness: 1, blast_radius_completeness: 1 });
});

test('double-failure: naming one of two real causes is correct but partially complete', () => {
  const score = scoreFindings(
    findings({ causes: ['auth-service'], affected: ['checkout'] }),
    expected({ causes: ['auth-service', 'payments'], affected: ['checkout', 'web'] }),
  );

  assert.equal(score.correctness, true);
  assert.equal(score.root_cause_completeness, 0.5);
  assert.equal(score.blast_radius_completeness, 0.5);
});

test('red herring: naming a service that is not a real cause is incorrect (false positive)', () => {
  const score = scoreFindings(
    findings({ causes: ['session-store'], affected: ['web'] }),
    expected({ causes: ['ledger-db'], affected: ['payments'] }),
  );

  assert.equal(score.correctness, false);
  // the real cause was still missed entirely
  assert.equal(score.root_cause_completeness, 0);
});

test('healthy: no causes expected and none named scores correct with vacuous completeness', () => {
  const score = scoreFindings(findings(), expected());

  assert.deepEqual(score, { correctness: true, root_cause_completeness: 1, blast_radius_completeness: 1 });
});

test('healthy: naming a cause when none exists is a false positive', () => {
  const score = scoreFindings(findings({ causes: ['payments'] }), expected());

  assert.equal(score.correctness, false);
});

test('completeness credits every matched cause and affected service, not just the first', () => {
  const score = scoreFindings(
    findings({ causes: ['auth-service', 'payments'], affected: ['checkout', 'web', 'session-store'] }),
    expected({ causes: ['auth-service', 'payments'], affected: ['checkout', 'web', 'session-store'] }),
  );

  assert.deepEqual(score, { correctness: true, root_cause_completeness: 1, blast_radius_completeness: 1 });
});
