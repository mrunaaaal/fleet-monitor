const DEFAULT_BASE_URL = 'http://localhost:8123';
const DEFAULT_DATABASE = 'fleet_monitor';
// Matches .env.example's local-dev defaults (fleet/changeme/fleet_monitor)
// so this works out of the box against `docker compose up -d clickhouse`,
// the same way postgres.js defaults to fleet/changeme.
const DEFAULT_USER = 'fleet';
const DEFAULT_PASSWORD = 'changeme';

// Thin wrapper over the ClickHouse HTTP interface: JSONEachRow inserts and
// SQL reads are both plain POST bodies against `/`. No query building
// here — that's ingest/logs.js and query/logs.js.
export function createClickhouseClient({
  baseUrl = process.env.CLICKHOUSE_URL ?? DEFAULT_BASE_URL,
  database = process.env.CLICKHOUSE_DB ?? DEFAULT_DATABASE,
  user = process.env.CLICKHOUSE_USER ?? DEFAULT_USER,
  password = process.env.CLICKHOUSE_PASSWORD ?? DEFAULT_PASSWORD,
  fetchImpl = fetch,
} = {}) {
  async function command(sql) {
    const url = new URL('/', baseUrl);
    url.searchParams.set('database', database);
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'X-ClickHouse-User': user,
        'X-ClickHouse-Key': password,
      },
      body: sql,
    });
    if (!res.ok) {
      throw new Error(`ClickHouse request failed with status ${res.status}: ${await res.text()}`);
    }
    return res.text();
  }

  // rows land as a new on-disk part per INSERT (fleet-monitor-docs.md
  // §5.2) — always call this with the whole batch, never per row.
  async function insertRows(table, rows) {
    if (rows.length === 0) return;
    const body = rows.map((row) => JSON.stringify(row)).join('\n');
    await command(`INSERT INTO ${table} FORMAT JSONEachRow\n${body}`);
  }

  async function querySql(sql) {
    const text = await command(`${sql}\nFORMAT JSONEachRow`);
    if (!text.trim()) return [];
    return text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  }

  return { command, insertRows, querySql };
}
