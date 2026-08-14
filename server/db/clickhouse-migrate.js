import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'clickhouse-migrations');

// Applies every .sql file in migrationsDir, in filename order. Mirrors
// migrate.js's shape, but each file is sent to ClickHouse as a single
// statement — unlike Postgres's simple query protocol, the ClickHouse HTTP
// interface doesn't run semicolon-separated statements together.
export async function runClickhouseMigrations({ clickhouse, migrationsDir = DEFAULT_MIGRATIONS_DIR }) {
  const entries = await readdir(migrationsDir);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    await clickhouse.command(sql);
  }
}
