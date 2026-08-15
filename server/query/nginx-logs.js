import { escapeSqlString } from '../db/sql-escape.js';
import { clusterTemplate } from './logs.js';
import { summarizeByPattern } from './log-summary.js';

// Mirrors query/logs.js's searchLogs so edge logs are queryable the same
// way service logs are (fleet-monitor-docs.md §12.2) — counts and
// clustered path patterns, not raw rows, sharing the same clusterTemplate
// so a `{N}`/`{UUID}` in a path reads the same as one in a log message.
const ROW_LIMIT = 5_000;

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
    return summarizeByPattern(rows, {
      groupField: 'status',
      groupKey: 'by_status',
      templateFn: (row) => `${row.method} ${clusterTemplate(row.path)}`,
    });
  };
}
