import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runClickhouseMigrations } from '../db/clickhouse-migrate.js';

async function withMigrationsDir(files, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'fleet-monitor-ch-migrations-'));
  try {
    for (const [name, sql] of Object.entries(files)) {
      await writeFile(path.join(dir, name), sql);
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('runClickhouseMigrations applies .sql files in filename order', async () => {
  await withMigrationsDir(
    {
      '0002_second.sql': 'SELECT 2',
      '0001_first.sql': 'SELECT 1',
      'not-sql.txt': 'ignore me',
    },
    async (migrationsDir) => {
      const calls = [];
      const clickhouse = { command: async (sql) => calls.push(sql) };

      await runClickhouseMigrations({ clickhouse, migrationsDir });

      assert.deepEqual(calls, ['SELECT 1', 'SELECT 2']);
    },
  );
});

test('runClickhouseMigrations does nothing for an empty directory', async () => {
  await withMigrationsDir({}, async (migrationsDir) => {
    const calls = [];
    const clickhouse = { command: async (sql) => calls.push(sql) };

    await runClickhouseMigrations({ clickhouse, migrationsDir });

    assert.deepEqual(calls, []);
  });
});

test('runClickhouseMigrations defaults to the clickhouse-migrations/ directory next to this module', async () => {
  const calls = [];
  const clickhouse = { command: async (sql) => calls.push(sql) };

  await runClickhouseMigrations({ clickhouse });

  assert.ok(calls.length >= 1);
  assert.match(calls[0], /CREATE TABLE IF NOT EXISTS logs/);
});
