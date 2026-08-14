import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNginxLogsQuery } from '../query/nginx-logs.js';

test('searchNginxLogs requires from and to', async () => {
  const searchNginxLogs = createNginxLogsQuery({ clickhouse: { querySql: async () => [] } });

  await assert.rejects(() => searchNginxLogs({}), /from/);
  await assert.rejects(() => searchNginxLogs({ from: 'a' }), /to/);
});

test('searchNginxLogs filters by time range, optionally status, method, and path pattern', async () => {
  const calls = [];
  const searchNginxLogs = createNginxLogsQuery({
    clickhouse: { querySql: async (sql) => (calls.push(sql), []) },
  });

  await searchNginxLogs({
    status: 500,
    method: 'POST',
    pattern: '/checkout',
    from: '2024-01-01T00:00:00Z',
    to: '2024-01-01T01:00:00Z',
  });

  assert.match(calls[0], /status = 500/);
  assert.match(calls[0], /method = 'POST'/);
  assert.match(calls[0], /position\(path, '\/checkout'\) > 0/);
  assert.match(calls[0], /FROM nginx_logs/);
});

test('searchNginxLogs escapes single quotes in string inputs', async () => {
  const calls = [];
  const searchNginxLogs = createNginxLogsQuery({
    clickhouse: { querySql: async (sql) => (calls.push(sql), []) },
  });

  await searchNginxLogs({ method: "O'Brien", from: 'a', to: 'b' });

  assert.match(calls[0], /method = 'O''Brien'/);
});

test('searchNginxLogs summarizes rows into total, by_status, time_range, and top-N patterns', async () => {
  const rows = [
    { ts: '2024-01-01 00:00:01.000', status: 500, method: 'GET', path: '/api/orders/1' },
    { ts: '2024-01-01 00:00:02.000', status: 500, method: 'GET', path: '/api/orders/2' },
    { ts: '2024-01-01 00:00:03.000', status: 200, method: 'GET', path: '/api/health' },
  ];
  const searchNginxLogs = createNginxLogsQuery({ clickhouse: { querySql: async () => rows } });

  const result = await searchNginxLogs({ from: 'a', to: 'b' });

  assert.equal(result.total, 3);
  assert.deepEqual(result.by_status, { 500: 2, 200: 1 });
  assert.deepEqual(result.time_range, { first: '2024-01-01 00:00:01.000', last: '2024-01-01 00:00:03.000' });
  assert.deepEqual(result.patterns[0], { template: 'GET /api/orders/{N}', count: 2 });
});

test('searchNginxLogs returns a null time_range when there are no matching rows', async () => {
  const searchNginxLogs = createNginxLogsQuery({ clickhouse: { querySql: async () => [] } });

  const result = await searchNginxLogs({ from: 'a', to: 'b' });

  assert.equal(result.total, 0);
  assert.equal(result.time_range, null);
  assert.deepEqual(result.patterns, []);
});
