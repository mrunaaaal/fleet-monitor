import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

function sseEvents(body) {
  return body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)));
}

function scriptedCallModel(responses) {
  let i = 0;
  return async () => {
    const res = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return res;
  };
}

const FINDINGS = {
  root_cause_services: [{ service: 'ledger-db', category: 'latency', confidence: 'high' }],
  summary: 'ledger-db is slow',
  evidence: [],
  affected_services: ['payments'],
  suggested_remediation: 'restart it',
};

test('POST /v1/investigate returns 400 when symptom is missing', async () => {
  const app = buildApp({ redis: { mget: async () => [] } });

  const res = await app.inject({ method: 'POST', url: '/v1/investigate', payload: {} });

  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST /v1/investigate streams tool_call and terminated events over SSE, then persists the investigation', async () => {
  const insertedRows = [];
  const postgres = {
    query: async (sql, params) => {
      if (sql.includes('SELECT name, tier')) return [{ name: 'web', tier: 'user-facing' }];
      if (sql.includes('INSERT INTO investigations')) insertedRows.push(params);
      return [];
    },
  };
  const redis = { mget: async (keys) => keys.map(() => '1') };
  const callModel = scriptedCallModel([
    { content: [{ type: 'tool_use', id: 'c1', name: 'check_liveness', input: {} }], usage: { inputTokens: 100, outputTokens: 20 }, costUsd: 0.001 },
    { content: [{ type: 'tool_use', id: 'c2', name: 'submit_findings', input: FINDINGS }], usage: { inputTokens: 150, outputTokens: 40 }, costUsd: 0.002 },
  ]);

  const app = buildApp({ postgres, redis, callModel });

  const res = await app.inject({ method: 'POST', url: '/v1/investigate', payload: { symptom: 'checkout is slow' } });

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/event-stream/);

  const events = sseEvents(res.body);
  const eventTypes = events.map((e) => e.type);
  assert.deepEqual(eventTypes, ['tool_call', 'tool_call', 'terminated', 'result']);
  assert.equal(events[0].name, 'check_liveness');
  assert.equal(events[1].name, 'submit_findings');

  const resultEvent = events[events.length - 1];
  assert.deepEqual(resultEvent.findings, FINDINGS);
  assert.equal(resultEvent.terminated, null);

  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0][0], 'checkout is slow');
  await app.close();
});

test('POST /v1/investigate passes evalScenario through to persistence when given', async () => {
  const insertedRows = [];
  const postgres = {
    query: async (sql, params) => {
      if (sql.includes('SELECT name, tier')) return [];
      if (sql.includes('INSERT INTO investigations')) insertedRows.push(params);
      return [];
    },
  };
  const redis = { mget: async () => [] };
  const callModel = scriptedCallModel([
    { content: [{ type: 'tool_use', id: 'c1', name: 'submit_findings', input: FINDINGS }], usage: { inputTokens: 10, outputTokens: 10 }, costUsd: 0 },
  ]);

  const app = buildApp({ postgres, redis, callModel });

  await app.inject({
    method: 'POST',
    url: '/v1/investigate',
    payload: { symptom: 'checkout is slow', evalScenario: 'ledger_slow_diamond' },
  });

  assert.equal(insertedRows[0][10], 'ledger_slow_diamond');
  await app.close();
});

test('POST /v1/investigate sends a structured error event and ends the stream when something throws after headers are sent', async () => {
  const postgres = { query: async () => { throw new Error('postgres is down'); } };
  const redis = { mget: async () => [] };
  const callModel = scriptedCallModel([{ content: [], usage: {}, costUsd: 0 }]);

  const app = buildApp({ postgres, redis, callModel });

  const res = await app.inject({ method: 'POST', url: '/v1/investigate', payload: { symptom: 'checkout is slow' } });

  assert.equal(res.statusCode, 200); // headers were already committed before the failure
  const events = sseEvents(res.body);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'error');
  assert.match(events[0].message, /postgres is down/);
  await app.close();
});
