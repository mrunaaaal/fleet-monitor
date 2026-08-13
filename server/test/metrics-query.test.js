import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetricsQuery } from '../query/metrics.js';

test('queryMetrics runs a date_bin SQL query scoped to the service, field, and window', async () => {
  let capturedSql;
  const queryMetrics = createMetricsQuery({
    influx: {
      querySql: async (sql) => {
        capturedSql = sql;
        return [];
      },
    },
  });

  await queryMetrics({ service: 'web', field: 'p95_latency_ms', windowMinutes: 30, bucketMinutes: 5 });

  assert.match(capturedSql, /FROM metrics/);
  assert.match(capturedSql, /service = 'web'/);
  assert.match(capturedSql, /INTERVAL '5 minutes'/);
  assert.match(capturedSql, /INTERVAL '30 minutes'/);
  assert.match(capturedSql, /min\(p95_latency_ms\)/);
  assert.match(capturedSql, /max\(p95_latency_ms\)/);
  assert.match(capturedSql, /avg\(p95_latency_ms\)/);
  assert.match(capturedSql, /approx_percentile_cont\(p95_latency_ms, 0\.95\)/);
});

test('queryMetrics maps result rows to { bucket, min, max, mean, p95 }', async () => {
  const queryMetrics = createMetricsQuery({
    influx: {
      querySql: async () => [
        { bucket: '2026-08-13T00:00:00', min: 1, max: 2, mean: 1.5, p95: 2 },
      ],
    },
  });

  const rows = await queryMetrics({ service: 'web', field: 'cpu_pct' });

  assert.deepEqual(rows, [{ bucket: '2026-08-13T00:00:00', min: 1, max: 2, mean: 1.5, p95: 2 }]);
});

test('queryMetrics rejects an unknown field so it can never be interpolated into SQL unchecked', async () => {
  const queryMetrics = createMetricsQuery({ influx: { querySql: async () => [] } });

  await assert.rejects(
    () => queryMetrics({ service: 'web', field: 'DROP TABLE metrics; --' }),
    /field must be one of/,
  );
});

test('queryMetrics requires a service', async () => {
  const queryMetrics = createMetricsQuery({ influx: { querySql: async () => [] } });

  await assert.rejects(() => queryMetrics({ field: 'cpu_pct' }), /service/);
});

test('queryMetrics rejects a non-finite windowMinutes so it can never be interpolated into SQL unchecked', async () => {
  const queryMetrics = createMetricsQuery({ influx: { querySql: async () => [] } });

  await assert.rejects(
    () => queryMetrics({ service: 'web', field: 'cpu_pct', windowMinutes: "60'; DROP TABLE metrics; --" }),
    /windowMinutes/,
  );
});

test('queryMetrics rejects a non-positive bucketMinutes', async () => {
  const queryMetrics = createMetricsQuery({ influx: { querySql: async () => [] } });

  await assert.rejects(
    () => queryMetrics({ service: 'web', field: 'cpu_pct', bucketMinutes: 0 }),
    /bucketMinutes/,
  );
});

test('queryMetrics escapes a single quote in the service name', async () => {
  let capturedSql;
  const queryMetrics = createMetricsQuery({
    influx: {
      querySql: async (sql) => {
        capturedSql = sql;
        return [];
      },
    },
  });

  await queryMetrics({ service: "o'brien", field: 'cpu_pct' });

  assert.match(capturedSql, /service = 'o''brien'/);
});
