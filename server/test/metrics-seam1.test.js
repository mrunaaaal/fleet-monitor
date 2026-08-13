import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { createInfluxClient } from '../db/influx.js';
import { createMetricsQuery } from '../query/metrics.js';

// Seam 1 (spec issue #1, "Testing Decisions" section): post a
// probe-shaped payload to the ingest endpoint, read it back through the
// query function, assert the result. Runs against a real InfluxDB —
// mocking the store would prove nothing about the write path or the SQL
// shape.
// Requires INFLUXDB_URL to point at a live InfluxDB 3 instance, e.g.
// `docker compose up -d influxdb` (defaults to http://localhost:8181).
test('Seam 1: a metrics payload posted to /v1/metrics is retrievable through queryMetrics', async () => {
  const influx = createInfluxClient();
  const app = buildApp({ influx });
  const queryMetrics = createMetricsQuery({ influx });

  const service = `seam1-web-${Date.now()}`;
  const host = 'local';
  const samples = [
    { cpu_pct: 10, mem_mb: 50, req_per_sec: 4, error_rate: 0, p95_latency_ms: 20 },
    { cpu_pct: 15, mem_mb: 55, req_per_sec: 6, error_rate: 0.1, p95_latency_ms: 40 },
    { cpu_pct: 20, mem_mb: 60, req_per_sec: 8, error_rate: 0.2, p95_latency_ms: 60 },
  ];

  for (const sample of samples) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/metrics',
      payload: { service, host, ...sample },
    });
    assert.equal(res.statusCode, 202);
  }

  const rows = await queryMetrics({
    service,
    field: 'p95_latency_ms',
    windowMinutes: 60,
    bucketMinutes: 60,
  });

  assert.equal(rows.length, 1, 'all samples land in a single 60-minute bucket');
  assert.equal(rows[0].min, 20);
  assert.equal(rows[0].max, 60);
  assert.equal(rows[0].mean, 40);
  assert.ok(
    rows[0].p95 >= 40 && rows[0].p95 <= 60,
    `approx p95 ${rows[0].p95} should fall between the median and the max`,
  );

  await app.close();
});
