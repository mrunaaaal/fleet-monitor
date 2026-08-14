import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { createRedisClient } from '../db/redis.js';
import { createClickhouseClient } from '../db/clickhouse.js';
import { runClickhouseMigrations } from '../db/clickhouse-migrate.js';
import { createLogsQuery } from '../query/logs.js';
import { createNginxLogsQuery } from '../query/nginx-logs.js';

// Seam: post a service log to /v1/logs and an edge access log to
// /v1/nginx-logs, then confirm both are independently searchable through
// their respective query functions once the flushers drain them — the
// "queryable alongside service logs" half of issue #9's acceptance
// criteria. Runs against real Redis and ClickHouse, same as
// logs-seam1.test.js. Requires REDIS_URL/CLICKHOUSE_URL (+
// CLICKHOUSE_USER/PASSWORD/DB) to point at live instances, e.g.
// `docker compose up -d redis clickhouse`.
test('Seam: nginx access logs posted to /v1/nginx-logs are searchable through searchNginxLogs alongside service logs', async () => {
  const redis = createRedisClient();
  const clickhouse = createClickhouseClient();
  await runClickhouseMigrations({ clickhouse });

  const app = buildApp({ redis, clickhouse, logsFlushIntervalMs: 200 });
  const searchLogs = createLogsQuery({ clickhouse });
  const searchNginxLogs = createNginxLogsQuery({ clickhouse });

  const service = `seam-web-${Date.now()}`;
  const from = new Date(Date.now() - 60_000).toISOString();

  const logsRes = await app.inject({
    method: 'POST',
    url: '/v1/logs',
    payload: { service, lines: ['request handled'] },
  });
  assert.equal(logsRes.statusCode, 202);

  const nginxRes = await app.inject({
    method: 'POST',
    url: '/v1/nginx-logs',
    payload: {
      lines: [
        {
          time: new Date().toISOString(),
          remote_addr: '203.0.113.9',
          method: 'GET',
          path: `/api/${service}`,
          status: 500,
          bytes_sent: 42,
          request_time: 0.01,
          referer: '-',
          user_agent: 'seam-test',
        },
      ],
    },
  });
  assert.equal(nginxRes.statusCode, 202);

  await new Promise((resolve) => setTimeout(resolve, 500));

  const to = new Date(Date.now() + 60_000).toISOString();
  const [logsResult, nginxResult] = await Promise.all([
    searchLogs({ service, from, to }),
    searchNginxLogs({ status: 500, pattern: service, from, to }),
  ]);

  assert.equal(logsResult.total, 1);
  assert.equal(nginxResult.total, 1);
  assert.deepEqual(nginxResult.by_status, { 500: 1 });

  await app.close();
  await redis.close();
});
