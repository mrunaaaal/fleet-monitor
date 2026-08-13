import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

test('POST /v1/heartbeat SETs alive:{service} via redis, upserts the registry, and returns 202', async () => {
  const redisCalls = [];
  const postgresCalls = [];
  const app = buildApp({
    influx: { writeLineProtocol: async () => {} },
    redis: { setWithTtl: async (key, value, ttlSeconds) => redisCalls.push({ key, value, ttlSeconds }) },
    postgres: { query: async (text, params) => postgresCalls.push({ text, params }) },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/heartbeat',
    payload: { service: 'web', tier: 'user-facing' },
  });

  assert.equal(res.statusCode, 202);
  assert.equal(redisCalls.length, 1);
  assert.equal(redisCalls[0].key, 'alive:web');
  assert.equal(postgresCalls.length, 1);
  assert.deepEqual(postgresCalls[0].params, ['web', 'user-facing']);
  await app.close();
});

test('POST /v1/heartbeat returns 400 for a payload missing service', async () => {
  const app = buildApp({
    influx: { writeLineProtocol: async () => {} },
    redis: { setWithTtl: async () => {} },
    postgres: { query: async () => {} },
  });

  const res = await app.inject({ method: 'POST', url: '/v1/heartbeat', payload: { tier: 'user-facing' } });

  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST /v1/heartbeat returns 400 for a payload missing tier', async () => {
  const app = buildApp({
    influx: { writeLineProtocol: async () => {} },
    redis: { setWithTtl: async () => {} },
    postgres: { query: async () => {} },
  });

  const res = await app.inject({ method: 'POST', url: '/v1/heartbeat', payload: { service: 'web' } });

  assert.equal(res.statusCode, 400);
  await app.close();
});
