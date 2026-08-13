const DEFAULT_BASE_URL = 'http://localhost:8181';
const DEFAULT_DATABASE = 'fleet_monitor';

// Thin wrapper over the InfluxDB 3 Core HTTP API: line-protocol writes via
// POST /api/v3/write_lp, SQL reads via POST /api/v3/query_sql. No query
// building here — that's query/metrics.js.
export function createInfluxClient({
  baseUrl = process.env.INFLUXDB_URL ?? DEFAULT_BASE_URL,
  database = process.env.INFLUXDB_DB ?? DEFAULT_DATABASE,
  fetchImpl = fetch,
} = {}) {
  async function writeLineProtocol(line) {
    const url = new URL('/api/v3/write_lp', baseUrl);
    url.searchParams.set('db', database);
    url.searchParams.set('precision', 'millisecond');

    const res = await fetchImpl(url, { method: 'POST', body: line });
    if (!res.ok) {
      throw new Error(`InfluxDB write failed with status ${res.status}: ${await res.text()}`);
    }
  }

  async function querySql(sql) {
    const url = new URL('/api/v3/query_sql', baseUrl);
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ db: database, q: sql, format: 'json' }),
    });
    if (!res.ok) {
      throw new Error(`InfluxDB query failed with status ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }

  return { writeLineProtocol, querySql };
}
