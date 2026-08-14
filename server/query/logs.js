import { escapeSqlString } from '../db/sql-escape.js';

// Written once, consumed by both a future log view and the agent's
// search_logs tool (fleet-monitor-docs.md §6/§7.2) — counts and clustered
// patterns, never raw lines, so a search over thousands of rows still fits
// a small tool-output budget.
const ROW_LIMIT = 5_000;
const TOP_N_PATTERNS = 5;

export function createLogsQuery({ clickhouse }) {
  return async function searchLogs({ service, level, pattern, from, to } = {}) {
    if (!service) throw new Error('searchLogs requires a service');
    if (!from || !to) throw new Error('searchLogs requires from and to');

    const conditions = [
      `service = '${escapeSqlString(service)}'`,
      `ts >= parseDateTimeBestEffort('${escapeSqlString(from)}')`,
      `ts <= parseDateTimeBestEffort('${escapeSqlString(to)}')`,
    ];
    if (level) conditions.push(`level = '${escapeSqlString(level)}'`);
    if (pattern) conditions.push(`position(message, '${escapeSqlString(pattern)}') > 0`);

    const sql = `
      SELECT ts, level, message
      FROM logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY ts
      LIMIT ${ROW_LIMIT}
    `.trim();

    const rows = await clickhouse.querySql(sql);
    return summarize(rows);
  };
}

function summarize(rows) {
  const byLevel = {};
  const counts = new Map();

  for (const row of rows) {
    byLevel[row.level] = (byLevel[row.level] ?? 0) + 1;
    const template = clusterTemplate(row.message);
    counts.set(template, (counts.get(template) ?? 0) + 1);
  }

  const patterns = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_PATTERNS)
    .map(([template, count]) => ({ template, count }));

  return {
    total: rows.length,
    by_level: byLevel,
    time_range: rows.length > 0 ? { first: rows[0].ts, last: rows[rows.length - 1].ts } : null,
    patterns,
  };
}

// Clustering algorithm (fleet-monitor-docs.md §7.2): normalize a message by
// replacing UUIDs, IPs, quoted strings, and digit runs with placeholders,
// so structurally identical lines collapse to one template regardless of
// their specific values. Order matters — UUIDs and IPs contain digits, and
// quoted strings can contain any of the above, so each is matched before
// the generic digit-run pass would otherwise mangle it.
export function clusterTemplate(message) {
  return String(message)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{UUID}')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '{IP}')
    .replace(/"[^"]*"/g, '"{STR}"')
    .replace(/'[^']*'/g, "'{STR}'")
    .replace(/\d+/g, '{N}');
}
