// Shared by query/metrics.js (InfluxDB SQL) and query/logs.js (ClickHouse
// SQL) — both interpolate string values into single-quoted SQL literals,
// so both need the same single-quote doubling to stay injection-safe.
export function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}
