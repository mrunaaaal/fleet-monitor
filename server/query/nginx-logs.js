import { escapeSqlString } from '../db/sql-escape.js';
import { clusterTemplate } from './logs.js';

// Mirrors query/logs.js's searchLogs so edge logs are queryable the same
// way service logs are (fleet-monitor-docs.md §12.2) — counts and
// clustered path patterns, not raw rows, sharing the same clusterTemplate
// so a `{N}`/`{UUID}` in a path reads the same as one in a log message.
const ROW_LIMIT = 5_000;
const TOP_N_PATTERNS = 5;

export function createNginxLogsQuery({ clickhouse }) {
  return async function searchNginxLogs({ status, method, pattern, from, to } = {}) {
    if (!from || !to) throw new Error('searchNginxLogs requires from and to');

    const conditions = [
      `ts >= parseDateTimeBestEffort('${escapeSqlString(from)}')`,
      `ts <= parseDateTimeBestEffort('${escapeSqlString(to)}')`,
    ];
    if (status !== undefined) conditions.push(`status = ${Number(status)}`);
    if (method) conditions.push(`method = '${escapeSqlString(method)}'`);
    if (pattern) conditions.push(`position(path, '${escapeSqlString(pattern)}') > 0`);

    const sql = `
      SELECT ts, status, method, path
      FROM nginx_logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY ts
      LIMIT ${ROW_LIMIT}
    `.trim();

    const rows = await clickhouse.querySql(sql);
    return summarize(rows);
  };
}

function summarize(rows) {
  const byStatus = {};
  const counts = new Map();

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    const template = `${row.method} ${clusterTemplate(row.path)}`;
    counts.set(template, (counts.get(template) ?? 0) + 1);
  }

  const patterns = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_PATTERNS)
    .map(([template, count]) => ({ template, count }));

  return {
    total: rows.length,
    by_status: byStatus,
    time_range: rows.length > 0 ? { first: rows[0].ts, last: rows[rows.length - 1].ts } : null,
    patterns,
  };
}
