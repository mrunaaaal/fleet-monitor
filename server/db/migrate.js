import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Applies every .sql file in migrationsDir, in filename order, via a plain
// (unparameterized) query so a file's semicolon-separated statements run
// together. Each file's CREATE ... IF NOT EXISTS makes re-running safe, so
// there's no migrations-tracking table to maintain.
export async function runMigrations({ postgres, migrationsDir = DEFAULT_MIGRATIONS_DIR }) {
  const entries = await readdir(migrationsDir);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await postgres.query(sql);
  }
}
