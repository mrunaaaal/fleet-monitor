import { FIELD_NAMES } from '../db/metrics-schema.js';
import { escapeSqlString } from '../db/sql-escape.js';

// Written once, consumed by both the Overview page and the agent's
// query_metrics tool (fleet-monitor-docs.md §6) — the UI/agent split
// lives in a formatting layer above this, not here.
const DEFAULT_WINDOW_MINUTES = 60;
const DEFAULT_BUCKET_MINUTES = 5;
// A since right at (or a hair after) query time would otherwise clamp the
// window to ~0 and silently return no rows instead of erroring — this is
// the same floor bucketMinutes already enforces, just applied to the
// since-narrowed window rather than the caller-supplied one.
const MIN_WINDOW_MINUTES = 1;

export function createMetricsQuery({ influx, now = () => new Date() }) {
  return async function queryMetrics({
    service,
    field,
    windowMinutes = DEFAULT_WINDOW_MINUTES,
    bucketMinutes = DEFAULT_BUCKET_MINUTES,
    since,
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

    // since (issue #26): callers investigating a bounded incident window
    // (the eval harness, one scenario at a time) pass the incident's start
    // so a stale, still-in-range windowMinutes can't reach back into an
    // unrelated earlier incident. It only ever narrows the window, never
    // widens it — a since further back than windowMinutes is a no-op.
    let effectiveWindowMinutes = windowMinutes;
    if (since !== undefined) {
      const sinceDate = new Date(since);
      if (Number.isNaN(sinceDate.getTime())) {
        throw new Error('queryMetrics since must be a valid date');
      }
      const minutesSinceSince = (now().getTime() - sinceDate.getTime()) / 60_000;
      if (minutesSinceSince >= 0) {
        effectiveWindowMinutes = Math.max(Math.min(windowMinutes, minutesSinceSince), MIN_WINDOW_MINUTES);
      }
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
        AND time > now() - INTERVAL '${effectiveWindowMinutes} minutes'
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
