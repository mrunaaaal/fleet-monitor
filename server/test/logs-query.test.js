import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogsQuery, clusterTemplate } from '../query/logs.js';

test('clusterTemplate normalizes digit runs to {N}', () => {
  assert.equal(clusterTemplate('pool exhausted, 3 of 10 connections available'), 'pool exhausted, {N} of {N} connections available');
});

test('clusterTemplate normalizes UUIDs to {UUID}', () => {
  assert.equal(
    clusterTemplate('session 550e8400-e29b-41d4-a716-446655440000 expired'),
    'session {UUID} expired',
  );
});

test('clusterTemplate normalizes IPv4 addresses to {IP}', () => {
  assert.equal(clusterTemplate('connection timeout to 10.0.0.42'), 'connection timeout to {IP}');
});

test('clusterTemplate normalizes quoted strings to {STR}', () => {
  assert.equal(clusterTemplate('failed to parse "user input here"'), 'failed to parse "{STR}"');
});

test('clusterTemplate handles a message combining all placeholder kinds', () => {
  const message = 'req 550e8400-e29b-41d4-a716-446655440000 from 10.0.0.1 failed after 30ms: "bad token"';
  assert.equal(clusterTemplate(message), 'req {UUID} from {IP} failed after {N}ms: "{STR}"');
});

test('searchLogs requires service, from, and to', async () => {
  const searchLogs = createLogsQuery({ clickhouse: { querySql: async () => [] } });

  await assert.rejects(() => searchLogs({}), /service/);
  await assert.rejects(() => searchLogs({ service: 'web' }), /from/);
  await assert.rejects(() => searchLogs({ service: 'web', from: 'a' }), /to/);
});

test('searchLogs filters by service and time range, optionally level and pattern', async () => {
  const calls = [];
  const searchLogs = createLogsQuery({
    clickhouse: { querySql: async (sql) => (calls.push(sql), []) },
  });

  await searchLogs({ service: 'web', level: 'error', pattern: 'timeout', from: '2024-01-01T00:00:00Z', to: '2024-01-01T01:00:00Z' });

  assert.match(calls[0], /service = 'web'/);
  assert.match(calls[0], /level = 'error'/);
  assert.match(calls[0], /position\(message, 'timeout'\) > 0/);
  assert.match(calls[0], /parseDateTimeBestEffort\('2024-01-01T00:00:00Z'\)/);
});

test('searchLogs escapes single quotes in string inputs', async () => {
  const calls = [];
  const searchLogs = createLogsQuery({
    clickhouse: { querySql: async (sql) => (calls.push(sql), []) },
  });

  await searchLogs({ service: "o'brien", pattern: "can't", from: 'a', to: 'b' });

  assert.match(calls[0], /service = 'o''brien'/);
  assert.match(calls[0], /position\(message, 'can''t'\) > 0/);
});

test('searchLogs summarizes rows into total, by_level, time_range, and top-N patterns', async () => {
  const rows = [
    { ts: '2024-01-01 00:00:01.000', level: 'error', message: 'timeout after 10ms' },
    { ts: '2024-01-01 00:00:02.000', level: 'error', message: 'timeout after 20ms' },
    { ts: '2024-01-01 00:00:03.000', level: 'error', message: 'timeout after 30ms' },
    { ts: '2024-01-01 00:00:04.000', level: 'warn', message: 'pool low' },
  ];
  const searchLogs = createLogsQuery({ clickhouse: { querySql: async () => rows } });

  const result = await searchLogs({ service: 'web', from: 'a', to: 'b' });

  assert.equal(result.total, 4);
  assert.deepEqual(result.by_level, { error: 3, warn: 1 });
  assert.deepEqual(result.time_range, { first: '2024-01-01 00:00:01.000', last: '2024-01-01 00:00:04.000' });
  assert.deepEqual(result.patterns[0], { template: 'timeout after {N}ms', count: 3 });
});

test('searchLogs caps patterns at the top 5 by count', async () => {
  const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
  const rows = [];
  words.forEach((word, i) => {
    // word i's template repeated (6 - i) times, so all 6 templates are distinct and rankable
    for (let j = 0; j < 6 - i; j += 1) {
      rows.push({ ts: `t${i}-${j}`, level: 'info', message: `${word} occurred` });
    }
  });
  const searchLogs = createLogsQuery({ clickhouse: { querySql: async () => rows } });

  const result = await searchLogs({ service: 'web', from: 'a', to: 'b' });

  assert.equal(result.patterns.length, 5);
  assert.equal(result.patterns[0].template, 'alpha occurred');
  assert.equal(result.patterns[0].count, 6);
});

test('searchLogs returns a null time_range when there are no matching rows', async () => {
  const searchLogs = createLogsQuery({ clickhouse: { querySql: async () => [] } });

  const result = await searchLogs({ service: 'web', from: 'a', to: 'b' });

  assert.equal(result.total, 0);
  assert.equal(result.time_range, null);
  assert.deepEqual(result.patterns, []);
});
