import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { createRedisClient } from '../db/redis.js';
import { createClickhouseClient } from '../db/clickhouse.js';
import { runClickhouseMigrations } from '../db/clickhouse-migrate.js';
import { createLogsQuery } from '../query/logs.js';

// Seam 1 (spec issue #1, "Testing Decisions" section): post a
// probe-shaped payload to the ingest endpoint, read it back through the
// query function, assert the result. Runs against real Redis and
// ClickHouse — the buffer, the flusher, and the ClickHouse write path are
// exactly what's under test, so mocking them would prove nothing.
// Requires REDIS_URL/CLICKHOUSE_URL (+ CLICKHOUSE_USER/PASSWORD/DB) to
// point at live instances, e.g. `docker compose up -d redis clickhouse`.
test('Seam 1: logs posted to /v1/logs are searchable through searchLogs once the flusher drains them', async () => {
  const redis = createRedisClient();
  const clickhouse = createClickhouseClient();
  await runClickhouseMigrations({ clickhouse });

  const app = buildApp({ redis, clickhouse, logsFlushIntervalMs: 200 });
  const searchLogs = createLogsQuery({ clickhouse });

  const service = `seam1-web-${Date.now()}`;
  const from = new Date(Date.now() - 60_000).toISOString();

  const res = await app.inject({
    method: 'POST',
    url: '/v1/logs',
    payload: {
      service,
      lines: [
        'connection timeout after 30ms to 10.0.0.5',
        { level: 'error', message: 'pool exhausted, 2 of 10 connections available' },
        { level: 'error', message: 'pool exhausted, 9 of 10 connections available' },
      ],
    },
  });
  assert.equal(res.statusCode, 202);

  await new Promise((resolve) => setTimeout(resolve, 500));

  const to = new Date(Date.now() + 60_000).toISOString();
  const result = await searchLogs({ service, from, to });

  assert.equal(result.total, 3);
  assert.deepEqual(result.by_level, { info: 1, error: 2 });
  assert.ok(
    result.patterns.some((p) => p.template === 'pool exhausted, {N} of {N} connections available' && p.count === 2),
    `expected a clustered pool-exhausted pattern with count 2, got: ${JSON.stringify(result.patterns)}`,
  );

  await app.close();
  await redis.close();
});
