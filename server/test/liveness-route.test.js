import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

test('GET /v1/liveness reports up/down for every registered service', async () => {
  const postgres = { query: async () => [{ name: 'web', tier: 'user-facing' }, { name: 'checkout', tier: 'user-facing' }] };
  const redis = { mget: async (keys) => (keys[0] === 'alive:web' ? ['1786652060', null] : [null, null]) };
  const app = buildApp({ postgres, redis });

  const res = await app.inject({ method: 'GET', url: '/v1/liveness' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), [
    { service: 'web', up: true },
    { service: 'checkout', up: false },
  ]);
  await app.close();
});

test('GET /v1/liveness scopes to a services query param when given', async () => {
  const postgres = { query: async () => [] };
  const redis = { mget: async (keys) => { assert.deepEqual(keys, ['alive:web']); return ['1786652060']; } };
  const app = buildApp({ postgres, redis });

  const res = await app.inject({ method: 'GET', url: '/v1/liveness?services=web' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), [{ service: 'web', up: true }]);
  await app.close();
});

test('GET /v1/liveness returns an empty array when the registry is empty and no services given', async () => {
  const postgres = { query: async () => [] };
  const redis = { mget: async () => [] };
  const app = buildApp({ postgres, redis });

  const res = await app.inject({ method: 'GET', url: '/v1/liveness' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), []);
  await app.close();
});
