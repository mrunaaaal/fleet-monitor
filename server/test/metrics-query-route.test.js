import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

test('GET /v1/metrics runs the query for the given service/field and returns JSON rows', async () => {
  let capturedSql;
  const influx = {
    querySql: async (sql) => {
      capturedSql = sql;
      return [{ bucket: '2026-08-13T00:00:00', min: 1, max: 2, mean: 1.5, p95: 2 }];
    },
  };
  const app = buildApp({ influx, redis: { setWithTtl: async () => {} } });

  const res = await app.inject({
    method: 'GET',
    url: '/v1/metrics?service=web&field=cpu_pct&windowMinutes=30&bucketMinutes=5',
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), [{ bucket: '2026-08-13T00:00:00', min: 1, max: 2, mean: 1.5, p95: 2 }]);
  assert.match(capturedSql, /service = 'web'/);
  assert.match(capturedSql, /INTERVAL '30 minutes'/);
  assert.match(capturedSql, /INTERVAL '5 minutes'/);
  await app.close();
});

test('GET /v1/metrics returns 400 when service is missing', async () => {
  const app = buildApp({ influx: { querySql: async () => [] }, redis: { setWithTtl: async () => {} } });

  const res = await app.inject({ method: 'GET', url: '/v1/metrics?field=cpu_pct' });

  assert.equal(res.statusCode, 400);
  await app.close();
});

test('GET /v1/metrics returns 400 for an unknown field', async () => {
  const app = buildApp({ influx: { querySql: async () => [] }, redis: { setWithTtl: async () => {} } });

  const res = await app.inject({ method: 'GET', url: '/v1/metrics?service=web&field=nope' });

  assert.equal(res.statusCode, 400);
  await app.close();
});
