import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

test('GET /v1/services returns the registry rows as JSON', async () => {
  const postgres = {
    query: async () => [
      { name: 'api-gateway', tier: 'internal' },
      { name: 'web', tier: 'user-facing' },
    ],
  };
  const app = buildApp({ postgres, redis: { setWithTtl: async () => {} } });

  const res = await app.inject({ method: 'GET', url: '/v1/services' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), [
    { name: 'api-gateway', tier: 'internal' },
    { name: 'web', tier: 'user-facing' },
  ]);
  await app.close();
});

test('GET /v1/services returns an empty array when the registry is empty', async () => {
  const postgres = { query: async () => [] };
  const app = buildApp({ postgres, redis: { setWithTtl: async () => {} } });

  const res = await app.inject({ method: 'GET', url: '/v1/services' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), []);
  await app.close();
});
