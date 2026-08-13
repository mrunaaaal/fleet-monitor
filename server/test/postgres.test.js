import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresClient } from '../db/postgres.js';

function fakePool() {
  const calls = { query: [], end: 0 };
  const pool = {
    query: async (text, params) => {
      calls.query.push({ text, params });
      return { rows: [{ ok: true }] };
    },
    end: async () => {
      calls.end += 1;
    },
  };
  return { pool, calls };
}

test('query() runs the given SQL with params and returns the rows', async () => {
  const { pool, calls } = fakePool();
  const postgres = createPostgresClient({
    connectionString: 'postgres://fleet:changeme@postgres:5432/fleet_monitor',
    poolFactory: () => pool,
  });

  const rows = await postgres.query('SELECT * FROM services WHERE name = $1', ['web']);

  assert.deepEqual(calls.query, [
    { text: 'SELECT * FROM services WHERE name = $1', params: ['web'] },
  ]);
  assert.deepEqual(rows, [{ ok: true }]);
});

test('query() without params runs as a simple query (no params arg passed to the pool)', async () => {
  const { pool, calls } = fakePool();
  const postgres = createPostgresClient({
    connectionString: 'postgres://fleet:changeme@postgres:5432/fleet_monitor',
    poolFactory: () => pool,
  });

  await postgres.query('CREATE TABLE IF NOT EXISTS foo (id int)');

  assert.equal(calls.query.length, 1);
  assert.equal(calls.query[0].text, 'CREATE TABLE IF NOT EXISTS foo (id int)');
  assert.equal(calls.query[0].params, undefined);
});

test('close() ends the pool', async () => {
  const { pool, calls } = fakePool();
  const postgres = createPostgresClient({
    connectionString: 'postgres://fleet:changeme@postgres:5432/fleet_monitor',
    poolFactory: () => pool,
  });

  await postgres.close();

  assert.equal(calls.end, 1);
});

test('defaults connectionString for local dev when not configured', () => {
  let passedConfig;
  createPostgresClient({
    poolFactory: (config) => {
      passedConfig = config;
      return fakePool().pool;
    },
  });

  assert.equal(passedConfig.connectionString, 'postgres://fleet:changeme@localhost:5432/fleet_monitor');
});
