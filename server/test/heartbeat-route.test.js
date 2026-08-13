import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

test('POST /v1/heartbeat SETs alive:{service} via redis and returns 202', async () => {
  const calls = [];
  const app = buildApp({
    influx: { writeLineProtocol: async () => {} },
    redis: { setWithTtl: async (key, value, ttlSeconds) => calls.push({ key, value, ttlSeconds }) },
  });

  const res = await app.inject({ method: 'POST', url: '/v1/heartbeat', payload: { service: 'web' } });

  assert.equal(res.statusCode, 202);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'alive:web');
  await app.close();
});

test('POST /v1/heartbeat returns 400 for a payload missing service', async () => {
  const app = buildApp({
    influx: { writeLineProtocol: async () => {} },
    redis: { setWithTtl: async () => {} },
  });

  const res = await app.inject({ method: 'POST', url: '/v1/heartbeat', payload: {} });

  assert.equal(res.statusCode, 400);
  await app.close();
});
