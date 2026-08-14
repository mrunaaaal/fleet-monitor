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

test('GET /v1/topology returns the whole mesh as nodes and edges', async () => {
  const neo4j = {
    run: async (cypher) =>
      /-\[:DEPENDS_ON\]->/.test(cypher)
        ? [{ from: 'web', to: 'api-gateway' }]
        : [{ service: 'web', tier: 'user-facing' }, { service: 'api-gateway', tier: 'internal' }],
  };
  const app = buildApp({ neo4j });

  const res = await app.inject({ method: 'GET', url: '/v1/topology' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    nodes: [{ service: 'web', tier: 'user-facing' }, { service: 'api-gateway', tier: 'internal' }],
    edges: [{ from: 'web', to: 'api-gateway' }],
  });
  await app.close();
});

test('GET /v1/topology/blast-radius returns affected services for the given service', async () => {
  const neo4j = { run: async () => [{ service: 'web', tier: 'user-facing', hops: 3 }] };
  const app = buildApp({ neo4j });

  const res = await app.inject({ method: 'GET', url: '/v1/topology/blast-radius?service=ledger-db' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), [{ service: 'web', tier: 'user-facing', hops: 3 }]);
  await app.close();
});

test('GET /v1/topology/blast-radius returns 400 when service is missing', async () => {
  const app = buildApp({ neo4j: { run: async () => [] } });

  const res = await app.inject({ method: 'GET', url: '/v1/topology/blast-radius' });

  assert.equal(res.statusCode, 400);
  await app.close();
});
