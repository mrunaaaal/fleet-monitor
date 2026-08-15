import { escapeSqlString } from '../db/sql-escape.js';
import { summarizeByPattern } from './log-summary.js';

// Written once, consumed by both a future log view and the agent's
// search_logs tool (fleet-monitor-docs.md §6/§7.2) — counts and clustered
// patterns, never raw lines, so a search over thousands of rows still fits
// a small tool-output budget.
const ROW_LIMIT = 5_000;
// get_log_samples (fleet-monitor-docs.md §7.1): "max 5 lines, truncated to
// 200 chars each" — the raw-sample counterpart to search_logs' clustering,
// for once the agent already knows which pattern matters.
const SAMPLE_LIMIT = 5;
const MESSAGE_TRUNCATE_LENGTH = 200;

// Shared by searchLogs and getLogSamples — both filter the same `logs`
// table the same way (service + time range, optionally level/pattern);
// only the SELECT/ORDER BY/LIMIT differ (clustered summary vs raw sample).
function buildLogConditions({ service, level, pattern, from, to }) {
  if (!service) throw new Error('requires a service');
  if (!from || !to) throw new Error('requires from and to');

  const conditions = [
    `service = '${escapeSqlString(service)}'`,
    `ts >= parseDateTimeBestEffort('${escapeSqlString(from)}')`,
    `ts <= parseDateTimeBestEffort('${escapeSqlString(to)}')`,
  ];
  if (level) conditions.push(`level = '${escapeSqlString(level)}'`);
  if (pattern) conditions.push(`position(message, '${escapeSqlString(pattern)}') > 0`);
  return conditions;
}

export function createLogsQuery({ clickhouse }) {
  return async function searchLogs({ service, level, pattern, from, to } = {}) {
    let conditions;
    try {
      conditions = buildLogConditions({ service, level, pattern, from, to });
    } catch (err) {
      throw new Error(`searchLogs ${err.message}`);
    }

    const sql = `
      SELECT ts, level, message
      FROM logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY ts
      LIMIT ${ROW_LIMIT}
    `.trim();

    const rows = await clickhouse.querySql(sql);
    return summarizeByPattern(rows, {
      groupField: 'level',
      groupKey: 'by_level',
      templateFn: (row) => clusterTemplate(row.message),
    });
  };
}

export function createLogSamplesQuery({ clickhouse }) {
  return async function getLogSamples({ service, level, pattern, from, to } = {}) {
    let conditions;
    try {
      conditions = buildLogConditions({ service, level, pattern, from, to });
    } catch (err) {
      throw new Error(`getLogSamples ${err.message}`);
    }

    const sql = `
      SELECT ts, level, message
      FROM logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY ts DESC
      LIMIT ${SAMPLE_LIMIT}
    `.trim();

    const rows = await clickhouse.querySql(sql);
    return rows.map((row) => ({ ts: row.ts, level: row.level, message: truncate(row.message) }));
  };
}

function truncate(message) {
  const str = String(message);
  return str.length > MESSAGE_TRUNCATE_LENGTH ? `${str.slice(0, MESSAGE_TRUNCATE_LENGTH)}…` : str;
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
