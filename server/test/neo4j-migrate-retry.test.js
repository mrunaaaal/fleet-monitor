import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runNeo4jMigrations } from '../db/neo4j-migrate.js';

function deadlockError() {
  const err = new Error('deadlock detected');
  err.retriable = true;
  return err;
}

async function withMigrationsDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'neo4j-migrations-'));
  try {
    await writeFile(path.join(dir, '0001_constraint.cypher'), 'CREATE CONSTRAINT service_name IF NOT EXISTS');
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('runNeo4jMigrations retries a retriable deadlock and succeeds', async () => {
  await withMigrationsDir(async (migrationsDir) => {
    let calls = 0;
    const neo4j = {
      run: async () => {
        calls += 1;
        if (calls < 3) throw deadlockError();
      },
    };

    await runNeo4jMigrations({ neo4j, migrationsDir });

    assert.equal(calls, 3);
  });
});

test('runNeo4jMigrations rethrows a non-retriable error immediately', async () => {
  await withMigrationsDir(async (migrationsDir) => {
    let calls = 0;
    const neo4j = {
      run: async () => {
        calls += 1;
        throw new Error('syntax error');
      },
    };

    await assert.rejects(() => runNeo4jMigrations({ neo4j, migrationsDir }), /syntax error/);
    assert.equal(calls, 1);
  });
});

test('runNeo4jMigrations gives up after MAX_ATTEMPTS retriable failures', async () => {
  await withMigrationsDir(async (migrationsDir) => {
    let calls = 0;
    const neo4j = {
      run: async () => {
        calls += 1;
        throw deadlockError();
      },
    };

    await assert.rejects(() => runNeo4jMigrations({ neo4j, migrationsDir }), /deadlock/);
    assert.equal(calls, 5);
  });
});
