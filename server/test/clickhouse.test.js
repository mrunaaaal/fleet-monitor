import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClickhouseClient } from '../db/clickhouse.js';

test('insertRows POSTs an INSERT ... FORMAT JSONEachRow body with one line per row', async () => {
  const calls = [];
  const clickhouse = createClickhouseClient({
    baseUrl: 'http://clickhouse:8123',
    database: 'fleet_monitor',
    user: 'fleet',
    password: 'changeme',
    fetchImpl: async (url, opts) => {
      calls.push({ url: new URL(url), opts });
      return { ok: true, status: 200, text: async () => '' };
    },
  });

  await clickhouse.insertRows('logs', [
    { ts: '2024-01-01T00:00:00.000Z', service: 'web', level: 'info', message: 'a', trace_id: '' },
    { ts: '2024-01-01T00:00:01.000Z', service: 'web', level: 'error', message: 'b', trace_id: '' },
  ]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('database'), 'fleet_monitor');
  assert.equal(calls[0].opts.headers['X-ClickHouse-User'], 'fleet');
  assert.equal(calls[0].opts.headers['X-ClickHouse-Key'], 'changeme');
  assert.ok(calls[0].opts.body.startsWith('INSERT INTO logs FORMAT JSONEachRow\n'));
  const lines = calls[0].opts.body.split('\n').slice(1);
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { ts: '2024-01-01T00:00:00.000Z', service: 'web', level: 'info', message: 'a', trace_id: '' });
});

test('insertRows is a no-op for an empty row set', async () => {
  const calls = [];
  const clickhouse = createClickhouseClient({
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, text: async () => '' };
    },
  });

  await clickhouse.insertRows('logs', []);

  assert.equal(calls.length, 0);
});

test('querySql appends FORMAT JSONEachRow and parses newline-delimited JSON rows', async () => {
  const calls = [];
  const clickhouse = createClickhouseClient({
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, text: async () => '{"service":"web"}\n{"service":"checkout"}\n' };
    },
  });

  const rows = await clickhouse.querySql('SELECT service FROM logs');

  assert.ok(calls[0].opts.body.endsWith('SELECT service FROM logs\nFORMAT JSONEachRow'));
  assert.deepEqual(rows, [{ service: 'web' }, { service: 'checkout' }]);
});

test('querySql returns an empty array for an empty result', async () => {
  const clickhouse = createClickhouseClient({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '' }),
  });

  assert.deepEqual(await clickhouse.querySql('SELECT 1'), []);
});

test('command throws with the response body on a non-ok status', async () => {
  const clickhouse = createClickhouseClient({
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'bad query' }),
  });

  await assert.rejects(() => clickhouse.querySql('SELECT 1'), /500.*bad query/s);
});

test('defaults baseUrl, database, and local-dev credentials when not configured', async () => {
  const calls = [];
  const clickhouse = createClickhouseClient({
    fetchImpl: async (url, opts) => {
      calls.push({ url: new URL(url), opts });
      return { ok: true, status: 200, text: async () => '' };
    },
  });

  await clickhouse.querySql('SELECT 1');

  assert.equal(calls[0].url.origin, 'http://localhost:8123');
  assert.equal(calls[0].url.searchParams.get('database'), 'fleet_monitor');
  assert.equal(calls[0].opts.headers['X-ClickHouse-User'], 'fleet');
});
