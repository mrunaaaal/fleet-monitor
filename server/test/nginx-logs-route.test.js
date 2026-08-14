import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

const LINE = {
  time: '2024-01-01T00:00:00.000Z',
  remote_addr: '203.0.113.9',
  method: 'GET',
  path: '/api/health',
  status: 200,
  bytes_sent: 123,
  request_time: 0.042,
  referer: '-',
  user_agent: 'curl/8.0',
};

test('POST /v1/nginx-logs RPUSHes the batch onto the edge-log buffer and returns 202', async () => {
  const rpushCalls = [];
  const app = buildApp({
    influx: { writeLineProtocol: async () => {} },
    redis: { rpush: async (key, values) => (rpushCalls.push({ key, values }), values.length), lpopCount: async () => [] },
    clickhouse: { insertRows: async () => {} },
  });

  const res = await app.inject({ method: 'POST', url: '/v1/nginx-logs', payload: { lines: [LINE] } });

  assert.equal(res.statusCode, 202);
  assert.equal(rpushCalls.length, 1);
  assert.equal(rpushCalls[0].key, 'nginxlogbuf');
  assert.equal(rpushCalls[0].values.length, 1);
  await app.close();
});

test('POST /v1/nginx-logs returns 400 for a payload with an empty lines array', async () => {
  const app = buildApp({
    influx: { writeLineProtocol: async () => {} },
    redis: { rpush: async () => 0, lpopCount: async () => [] },
    clickhouse: { insertRows: async () => {} },
  });

  const res = await app.inject({ method: 'POST', url: '/v1/nginx-logs', payload: { lines: [] } });

  assert.equal(res.statusCode, 400);
  await app.close();
});

test('POST /v1/nginx-logs returns 400 for a line missing a required field', async () => {
  const app = buildApp({
    influx: { writeLineProtocol: async () => {} },
    redis: { rpush: async () => 0, lpopCount: async () => [] },
    clickhouse: { insertRows: async () => {} },
  });

  const res = await app.inject({ method: 'POST', url: '/v1/nginx-logs', payload: { lines: [{ time: LINE.time }] } });

  assert.equal(res.statusCode, 400);
  await app.close();
});
