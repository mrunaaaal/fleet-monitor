import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInfluxClient } from '../db/influx.js';

test('writeLineProtocol POSTs the line to /api/v3/write_lp with db and precision params', async () => {
  const calls = [];
  const influx = createInfluxClient({
    baseUrl: 'http://influxdb:8181',
    database: 'fleet_monitor',
    fetchImpl: async (url, opts) => {
      calls.push({ url: new URL(url), opts });
      return { ok: true, status: 204, text: async () => '' };
    },
  });

  await influx.writeLineProtocol('metrics,service=web,host=local cpu_pct=1');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/api/v3/write_lp');
  assert.equal(calls[0].url.searchParams.get('db'), 'fleet_monitor');
  assert.equal(calls[0].url.searchParams.get('precision'), 'millisecond');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.body, 'metrics,service=web,host=local cpu_pct=1');
});

test('writeLineProtocol throws with the response body on a non-ok status', async () => {
  const influx = createInfluxClient({
    baseUrl: 'http://influxdb:8181',
    fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'bad line protocol' }),
  });

  await assert.rejects(() => influx.writeLineProtocol('bogus'), /400.*bad line protocol/s);
});

test('querySql POSTs {db, q, format} JSON to /api/v3/query_sql and returns the parsed rows', async () => {
  const calls = [];
  const influx = createInfluxClient({
    baseUrl: 'http://influxdb:8181',
    database: 'fleet_monitor',
    fetchImpl: async (url, opts) => {
      calls.push({ url: new URL(url), opts });
      return { ok: true, status: 200, json: async () => [{ service: 'web' }] };
    },
  });

  const rows = await influx.querySql('SELECT * FROM metrics');

  assert.equal(calls[0].url.pathname, '/api/v3/query_sql');
  assert.equal(calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    db: 'fleet_monitor',
    q: 'SELECT * FROM metrics',
    format: 'json',
  });
  assert.deepEqual(rows, [{ service: 'web' }]);
});

test('querySql throws with the response body on a non-ok status', async () => {
  const influx = createInfluxClient({
    baseUrl: 'http://influxdb:8181',
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'bad sql' }),
  });

  await assert.rejects(() => influx.querySql('SELECT 1'), /500.*bad sql/s);
});

test('defaults baseUrl and database for local dev when not configured', async () => {
  const calls = [];
  const influx = createInfluxClient({
    fetchImpl: async (url, opts) => {
      calls.push(new URL(url));
      return { ok: true, status: 200, json: async () => [] };
    },
  });

  await influx.querySql('SELECT 1');

  assert.equal(calls[0].origin, 'http://localhost:8181');
});
