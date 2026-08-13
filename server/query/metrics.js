import { FIELD_NAMES } from '../db/metrics-schema.js';

// Written once, consumed by both the Overview page and the agent's
// query_metrics tool (fleet-monitor-docs.md §6) — the UI/agent split
// lives in a formatting layer above this, not here.
const DEFAULT_WINDOW_MINUTES = 60;
const DEFAULT_BUCKET_MINUTES = 5;

export function createMetricsQuery({ influx }) {
  return async function queryMetrics({
    service,
    field,
    windowMinutes = DEFAULT_WINDOW_MINUTES,
    bucketMinutes = DEFAULT_BUCKET_MINUTES,
  } = {}) {
    if (!service) throw new Error('queryMetrics requires a service');
    // field becomes a bare SQL identifier below, so it must come from a
    // fixed allowlist rather than being interpolated unchecked.
    if (!FIELD_NAMES.includes(field)) {
      throw new Error(`queryMetrics field must be one of ${FIELD_NAMES.join(', ')}`);
    }
    // windowMinutes/bucketMinutes are spliced into the SQL below as bare
    // numeric literals, so they must be validated numbers, not just
    // trusted — the same injection risk that field's allowlist guards.
    if (!(Number.isFinite(windowMinutes) && windowMinutes > 0)) {
      throw new Error('queryMetrics windowMinutes must be a positive number');
    }
    if (!(Number.isFinite(bucketMinutes) && bucketMinutes > 0)) {
      throw new Error('queryMetrics bucketMinutes must be a positive number');
    }

    const sql = `
      SELECT
        date_bin(INTERVAL '${bucketMinutes} minutes', time) AS bucket,
        min(${field}) AS min,
        max(${field}) AS max,
        avg(${field}) AS mean,
        approx_percentile_cont(${field}, 0.95) AS p95
      FROM metrics
      WHERE service = '${escapeSqlString(service)}'
        AND time > now() - INTERVAL '${windowMinutes} minutes'
      GROUP BY bucket
      ORDER BY bucket
    `.trim();

    const rows = await influx.querySql(sql);
    return rows.map((row) => ({
      bucket: row.bucket,
      min: row.min,
      max: row.max,
      mean: row.mean,
      p95: row.p95,
    }));
  };
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}
