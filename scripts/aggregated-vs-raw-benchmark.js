import { createClickhouseClient } from '../server/db/clickhouse.js';
import { createLogsQuery, createLogSamplesQuery } from '../server/query/logs.js';
import { estimateTokens } from '../server/agent/token-budget.js';

// Comparison write-up #4 (fleet-monitor-docs.md §9, spec issue #13): quantify
// what search_logs' clustering and get_log_samples' capping actually buy
// over a naive tool that hands the model raw matching rows. This is the
// timeboxed throwaway spike itself (fleet-monitor-docs.md §16); it writes
// its numbers to stdout for the write-up, not to a maintained benchmark
// suite. Runs against the real `logs` table (the same one search_logs and
// get_log_samples query in production) with a uniquely tagged service name
// so it never collides with real mesh data — the table's 7-day TTL cleans
// it up, same as every other seam test that tags rows this way.
//
// The full eval harness (#16/#17) doesn't exist yet, so "across several
// evals" here means across several realistic log-burst scenarios rather
// than through the harness itself — stated honestly, not silently
// substituted.

const clickhouse = createClickhouseClient();
const searchLogs = createLogsQuery({ clickhouse });
const getLogSamples = createLogSamplesQuery({ clickhouse });

// `logs` has a 7-day TTL keyed off each row's own `ts` (0001_logs.sql), not
// insertion time — a fixed past date here would make every synthetic row
// TTL-expired the instant it lands, racing ClickHouse's background TTL
// sweep against this script's own read and producing flaky results. Anchor
// to "now" instead so nothing is ever eligible for cleanup mid-run.
const NOW = Date.now();
const FROM = new Date(NOW).toISOString();
const TO = new Date(NOW + 60 * 60 * 1000).toISOString();

function tsAt(offsetMs) {
  return new Date(NOW + offsetMs).toISOString().replace('T', ' ').replace('Z', '');
}

const SCENARIOS = [
  {
    name: 'repeating-timeout-burst',
    description: '2000 lines, one dominant connection-timeout pattern with varying host/port',
    rows: (n) =>
      Array.from({ length: n }, (_, i) => ({
        message: `connection timeout after ${100 + (i % 50)}ms to 10.0.${i % 8}.${i % 255}:${5432 + (i % 4)}`,
        level: 'error',
      })),
  },
  {
    name: 'mixed-error-burst',
    description: '2000 lines across 5 distinct, evenly-mixed error templates',
    rows: (n) => {
      const templates = [
        (i) => `connection timeout after ${i}ms`,
        (i) => `pool exhausted, ${i % 10} of 10 connections available`,
        (i) => `failed to parse "payload-${i}"`,
        (i) => `session ${crypto.randomUUID()} expired`,
        (i) => `unexpected status 5${i % 10}${i % 10} from upstream`,
      ];
      return Array.from({ length: n }, (_, i) => ({ message: templates[i % templates.length](i), level: 'error' }));
    },
  },
  {
    name: 'high-cardinality-burst',
    description:
      '2000 lines that are nearly all unique free text — none of it digits/UUIDs/IPs/quoted ' +
      'strings, so clusterTemplate\'s normalization can\'t collapse it. Clustering\'s real worst ' +
      'case, included for honesty.',
    rows: (n) => {
      const words = [
        'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet',
        'kilo', 'lima', 'mike', 'november', 'oscar', 'papa', 'quebec', 'romeo', 'sierra', 'tango',
      ];
      const pick = (seed, salt) => words[(seed * 7 + salt * 13) % words.length];
      return Array.from({ length: n }, (_, i) => ({
        message: `event outcome ${pick(i, 1)} ${pick(i, 2)} ${pick(i, 3)} for subsystem ${pick(i, 4)} ${pick(i, 5)}`,
        level: 'info',
      }));
    },
  },
  {
    name: 'single-pattern-flood',
    description: '5000 lines (the search_logs row cap) sharing one template — the extreme compression case',
    rows: (n) =>
      Array.from({ length: n }, (_, i) => ({ message: `pool exhausted, ${i % 10} of 10 connections available`, level: 'warn' })),
  },
  {
    name: 'quiet-period',
    description: '50 lines, low volume — where aggregation has the least to do',
    rows: (n) => Array.from({ length: n }, (_, i) => ({ message: `heartbeat ok ${i}`, level: 'info' })),
  },
];

const ROW_COUNTS = { 'single-pattern-flood': 5000, 'quiet-period': 50 };

async function seedScenario(service, scenario) {
  const n = ROW_COUNTS[scenario.name] ?? 2000;
  const rows = scenario.rows(n).map((row, i) => ({
    ts: tsAt(i),
    service,
    level: row.level,
    message: row.message,
    trace_id: '',
  }));
  // insertRows ships one INSERT per call (fleet-monitor-docs.md §5.2) —
  // batch at the flusher's real size so seeding 5000 rows doesn't itself
  // become a TOO_MANY_PARTS spike on a shared dev instance.
  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await clickhouse.insertRows('logs', rows.slice(i, i + BATCH));
  }
  return rows.length;
}

async function fetchRaw(service) {
  const rows = await clickhouse.querySql(
    `SELECT ts, level, message FROM logs WHERE service = '${service}' AND ts >= parseDateTimeBestEffort('${FROM}') AND ts <= parseDateTimeBestEffort('${TO}') ORDER BY ts LIMIT 5000`,
  );
  return rows;
}

async function main() {
  console.log('scenario,row_count,raw_tokens,search_logs_tokens,get_log_samples_tokens,search_logs_reduction_x');
  for (const scenario of SCENARIOS) {
    const service = `writeup4-${scenario.name}-${Date.now()}`;
    const rowCount = await seedScenario(service, scenario);

    const [raw, aggregated, samples] = await Promise.all([
      fetchRaw(service),
      searchLogs({ service, from: FROM, to: TO }),
      getLogSamples({ service, from: FROM, to: TO }),
    ]);

    const rawTokens = estimateTokens(raw);
    const aggregatedTokens = estimateTokens(aggregated);
    const samplesTokens = estimateTokens(samples);
    const reduction = (rawTokens / aggregatedTokens).toFixed(1);

    console.log(`${scenario.name},${rowCount},${rawTokens},${aggregatedTokens},${samplesTokens},${reduction}x`);
  }

  await clickhouse.command('SELECT 1'); // confirm the connection is still healthy before exiting
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
