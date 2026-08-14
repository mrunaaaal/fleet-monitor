import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

test('POST /v1/logs RPUSHes the batch via redis and returns 202', async () => {
  const rpushCalls = [];
  const app = buildApp({
    influx: { writeLineProtocol: async () => {} },
    redis: { rpush: async (key, values) => (rpushCalls.push({ key, values }), values.length), lpopCount: async () => [] },
    clickhouse: { insertRows: async () => {} },
  });

  const res = await app.inject({
    method: 'POST',
    url: '/v1/logs',
    payload: { service: 'web', lines: ['connection timeout', { level: 'error', message: 'pool exhausted' }] },
  });

  assert.equal(res.statusCode, 202);
  assert.equal(rpushCalls.length, 1);
  assert.equal(rpushCalls[0].key, 'logbuf');
  assert.equal(rpushCalls[0].values.length, 2);
  await app.close();
});

test('POST /v1/logs returns 400 for a payload missing service', async () => {
  const app = buildApp({
    influx: { writeLineProtocol: async () => {} },
    redis: { rpush: async () => 0, lpopCount: async () => [] },
    clickhouse: { insertRows: async () => {} },
  });

  const res = await app.inject({ method: 'POST', url: '/v1/logs', payload: { lines: ['x'] } });

  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST /v1/logs returns 400 for a payload with an empty lines array', async () => {
  const app = buildApp({
    influx: { writeLineProtocol: async () => {} },
    redis: { rpush: async () => 0, lpopCount: async () => [] },
    clickhouse: { insertRows: async () => {} },
  });

  const res = await app.inject({ method: 'POST', url: '/v1/logs', payload: { service: 'web', lines: [] } });

  assert.equal(res.statusCode, 400);
  await app.close();
});
