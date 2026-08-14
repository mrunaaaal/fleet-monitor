import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'neo4j-migrations');
const MAX_ATTEMPTS = 5;

// Applies every .cypher file in migrationsDir, in filename order. Mirrors
// migrate.js's shape; each file's IF NOT EXISTS makes re-running safe, so
// there's no migrations-tracking table to maintain.
export async function runNeo4jMigrations({ neo4j, migrationsDir = DEFAULT_MIGRATIONS_DIR }) {
  const entries = await readdir(migrationsDir);
  const files = entries.filter((name) => name.endsWith('.cypher')).sort();

  for (const file of files) {
    const cypher = await readFile(path.join(migrationsDir, file), 'utf8');
    await runWithDeadlockRetry(() => neo4j.run(cypher));
  }
}

// A schema change (e.g. CREATE CONSTRAINT) takes a schema-wide lock, so
// two processes running migrations at the same time — as happens when
// node's test runner starts multiple seam test files concurrently, each
// calling runNeo4jMigrations — routinely deadlock each other. Neo4j marks
// these transient/retriable; retrying with jittered backoff is the
// documented way to handle them, not a sign of a broken migration.
async function runWithDeadlockRetry(fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!err.retriable || attempt >= MAX_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, attempt * 50 * Math.random()));
    }
  }
}
