import pg from 'pg';

const { Pool } = pg;

// Matches .env.example's local-dev defaults (fleet/changeme/fleet_monitor)
// so this works out of the box against `docker compose up -d postgres`,
// the same way redis.js/influx.js default to their unauthenticated ports.
const DEFAULT_CONNECTION_STRING = 'postgres://fleet:changeme@localhost:5432/fleet_monitor';

// Thin wrapper over node-postgres: query() runs SQL (parameterized or, for
// migrations, plain multi-statement text via the simple query protocol when
// no params are given). No SQL building here — that's ingest/ and query/.
export function createPostgresClient({
  connectionString = process.env.POSTGRES_URL ?? DEFAULT_CONNECTION_STRING,
  poolFactory = (config) => new Pool(config),
} = {}) {
  const pool = poolFactory({ connectionString });

  async function query(text, params) {
    const result = params === undefined ? await pool.query(text) : await pool.query(text, params);
    return result.rows;
  }

  async function close() {
    await pool.end();
  }

  return { query, close };
}
