import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';

const VALID_PAYLOAD = {
  service: 'web',
  host: 'local',
  cpu_pct: 12.5,
  mem_mb: 88.25,
  req_per_sec: 5.1,
  error_rate: 0.2,
  p95_latency_ms: 42,
};

test('POST /v1/metrics writes the payload via influx and returns 202', async () => {
  const written = [];
  const app = buildApp({ influx: { writeLineProtocol: async (line) => written.push(line) } });

  const res = await app.inject({ method: 'POST', url: '/v1/metrics', payload: VALID_PAYLOAD });

  assert.equal(res.statusCode, 202);
  assert.equal(written.length, 1);
  await app.close();
});

test('POST /v1/metrics returns 400 for a payload missing required fields', async () => {
  const app = buildApp({ influx: { writeLineProtocol: async () => {} } });

  const { cpu_pct, ...incomplete } = VALID_PAYLOAD;
  const res = await app.inject({ method: 'POST', url: '/v1/metrics', payload: incomplete });

  assert.equal(res.statusCode, 400);
  await app.close();
});
