import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

test('POST /v1/topology upserts via neo4j and returns 202', async () => {
  const runs = [];
  const app = buildApp({ neo4j: { run: async (cypher, params) => runs.push({ cypher, params }) } });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/topology',
    payload: { service: 'web', tier: 'user-facing', downstream: ['api-gateway'] },
  });

  assert.equal(res.statusCode, 202);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0].params, { service: 'web', tier: 'user-facing', downstream: ['api-gateway'] });
  await app.close();
});

test('POST /v1/topology returns 400 for a payload missing service', async () => {
  const app = buildApp({ neo4j: { run: async () => {} } });

  const res = await app.inject({ method: 'POST', url: '/v1/topology', payload: { downstream: [] } });

  assert.equal(res.statusCode, 400);
  await app.close();
});
