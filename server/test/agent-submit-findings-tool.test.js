import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSubmitFindingsTool } from '../agent/submit-findings-tool.js';

const VALID_FINDINGS = {
  root_cause_services: [{ service: 'ledger-db', category: 'latency', confidence: 'high' }],
  summary: 'ledger-db is slow, backing up payments and inventory.',
  evidence: [{ source: 'clickhouse', observation: '1,743 connection timeouts starting 14:02:11' }],
  affected_services: ['payments', 'inventory', 'checkout', 'web'],
  suggested_remediation: 'Restart ledger-db and check its connection pool size.',
};

test('submit_findings tool is the terminal tool: name, schema shape per ADR-0001', () => {
  const tool = createSubmitFindingsTool();

  assert.equal(tool.name, 'submit_findings');
  assert.deepEqual(tool.input_schema.required, [
    'root_cause_services',
    'summary',
    'evidence',
    'affected_services',
    'suggested_remediation',
  ]);
});

test('submit_findings tool echoes back valid findings unchanged', async () => {
  const tool = createSubmitFindingsTool();

  const result = await tool.handler(VALID_FINDINGS);

  assert.deepEqual(result, VALID_FINDINGS);
});

test('submit_findings tool accepts multiple independent root causes (ADR-0001: simultaneous double failures)', async () => {
  const tool = createSubmitFindingsTool();
  const findings = {
    ...VALID_FINDINGS,
    root_cause_services: [
      { service: 'auth-service', category: 'unavailable', confidence: 'high' },
      { service: 'payments', category: 'error', confidence: 'medium' },
    ],
  };

  const result = await tool.handler(findings);

  assert.equal(result.root_cause_services.length, 2);
});

test('submit_findings tool accepts an empty root_cause_services for an inconclusive investigation', async () => {
  const tool = createSubmitFindingsTool();
  const findings = { ...VALID_FINDINGS, root_cause_services: [] };

  const result = await tool.handler(findings);

  assert.deepEqual(result.root_cause_services, []);
});

test('submit_findings tool rejects a missing top-level field', async () => {
  const tool = createSubmitFindingsTool();
  const { summary, ...missingSummary } = VALID_FINDINGS;

  await assert.rejects(() => tool.handler(missingSummary), /summary/);
});

test('submit_findings tool rejects an invalid category', async () => {
  const tool = createSubmitFindingsTool();
  const findings = { ...VALID_FINDINGS, root_cause_services: [{ service: 'web', category: 'nope', confidence: 'high' }] };

  await assert.rejects(() => tool.handler(findings), /category/);
});

test('submit_findings tool rejects an invalid confidence', async () => {
  const tool = createSubmitFindingsTool();
  const findings = { ...VALID_FINDINGS, root_cause_services: [{ service: 'web', category: 'latency', confidence: 'certain' }] };

  await assert.rejects(() => tool.handler(findings), /confidence/);
});

test('submit_findings tool rejects a non-array evidence or affected_services', async () => {
  const tool = createSubmitFindingsTool();

  await assert.rejects(() => tool.handler({ ...VALID_FINDINGS, evidence: 'not an array' }), /evidence/);
  await assert.rejects(() => tool.handler({ ...VALID_FINDINGS, affected_services: 'not an array' }), /affected_services/);
});
