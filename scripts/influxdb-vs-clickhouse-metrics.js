// Comparison write-up #3 (fleet-monitor-docs.md §9, the contested-overlap
// one, §2.2): write the same metrics stream to both InfluxDB and
// ClickHouse and compare what retention + 5-minute downsampling actually
// costs in each — config/DDL effort, and query latency for the bucketed
// stats query `query/metrics.js` already runs in production. This is the
// timeboxed throwaway spike itself (fleet-monitor-docs.md §16); both sides
// are built in throwaway databases/tables and torn down at the end.
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createInfluxClient } from '../server/db/influx.js';
import { createClickhouseClient } from '../server/db/clickhouse.js';
import { toLineProtocol as toMetricsLineProtocol } from '../server/ingest/metrics.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ~230k points/day at the mesh's real rate (fleet-monitor-docs.md §12.1:
// 8 services x 5 fields / 15s).
const POINT_COUNT = 230_000;
const WINDOW_HOURS = 24;
const BUCKET_MINUTES = 5;
const SERVICES = [
  'web', 'checkout', 'api-gateway', 'auth-service',
  'payments', 'inventory', 'session-store', 'ledger-db',
];
const QUERY_FIELD = 'p95_latency_ms';
const QUERY_SERVICE = 'checkout';
const QUERY_REPEATS = 7;

const INFLUX_DB = 'metrics_bench';
const INFLUX_RETENTION = '7d';
const CH_RAW_TABLE = 'metrics_bench_raw';
const CH_AGG_TABLE = 'metrics_bench_5m';
const CH_MV = 'metrics_bench_5m_mv';

function generatePoints(count, nowMs) {
  const startMs = nowMs - WINDOW_HOURS * 60 * 60 * 1000;
  const points = [];
  for (let i = 0; i < count; i++) {
    const service = SERVICES[i % SERVICES.length];
    const timeMs = startMs + Math.floor((i / count) * (nowMs - startMs));
    points.push({
      service,
      host: 'local',
      timeMs,
      cpu_pct: 10 + Math.random() * 40,
      mem_mb: 100 + Math.random() * 80,
      req_per_sec: Math.random() * 20,
      error_rate: Math.random() * 0.02,
      p95_latency_ms: 60 + Math.random() * 200,
    });
  }
  return points;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function timeQuery(fn, repeats) {
  const timings = [];
  let result;
  for (let i = 0; i < repeats; i++) {
    const start = Date.now();
    result = await fn();
    timings.push(Date.now() - start);
  }
  return { medianMs: median(timings), timings, result };
}

// --- InfluxDB side -----------------------------------------------------
// Retention isn't reachable over the write/query HTTP API (server/db/
// influx.js), only the `influxdb3` CLI at database-create time — hence
// `docker compose exec`, not fetch. Config surface: one command, zero DDL.
function influxCreateDatabase() {
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'influxdb', 'influxdb3', 'create', 'database', INFLUX_DB, '--retention-period', INFLUX_RETENTION],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
}

function influxDeleteDatabase() {
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'influxdb', 'influxdb3', 'delete', 'database', INFLUX_DB, '--hard-delete', 'now', '-y'],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );
}

async function runInflux(points) {
  influxCreateDatabase();
  try {
    const influx = createInfluxClient({ database: INFLUX_DB });

    const start = Date.now();
    const BATCH = 5_000;
    for (let offset = 0; offset < points.length; offset += BATCH) {
      const batch = points.slice(offset, offset + BATCH);
      const lines = batch
        .map((p) => `${toMetricsLineProtocol(p)} ${p.timeMs}`)
        .join('\n');
      await influx.writeLineProtocol(lines);
    }
    const writeMs = Date.now() - start;

    // The exact query query/metrics.js runs in production: bucketed
    // min/max/mean/p95 for one service/field over a window, via date_bin —
    // no separate downsampled table required.
    const sql = `
      SELECT
        date_bin(INTERVAL '${BUCKET_MINUTES} minutes', time) AS bucket,
        min(${QUERY_FIELD}) AS min, max(${QUERY_FIELD}) AS max,
        avg(${QUERY_FIELD}) AS mean, approx_percentile_cont(${QUERY_FIELD}, 0.95) AS p95
      FROM metrics
      WHERE service = '${QUERY_SERVICE}' AND time > now() - INTERVAL '${WINDOW_HOURS} hours'
      GROUP BY bucket ORDER BY bucket
    `.trim();
    const query = await timeQuery(() => influx.querySql(sql), QUERY_REPEATS);

    return { writeMs, queryMedianMs: query.medianMs, bucketCount: query.result.length };
  } finally {
    influxDeleteDatabase();
  }
}

// --- ClickHouse side -----------------------------------------------------
async function runClickhouse(points) {
  const clickhouse = createClickhouseClient();

  await clickhouse.command(`DROP TABLE IF EXISTS ${CH_MV}`);
  await clickhouse.command(`DROP TABLE IF EXISTS ${CH_AGG_TABLE}`);
  await clickhouse.command(`DROP TABLE IF EXISTS ${CH_RAW_TABLE}`);

  try {
    // Retention: a TTL clause, same shape as the real `logs` table
    // (0001_logs.sql) — this part costs the same as InfluxDB's one flag.
    await clickhouse.command(`
      CREATE TABLE ${CH_RAW_TABLE} (
        ts             DateTime64(3),
        service        LowCardinality(String),
        host           LowCardinality(String),
        cpu_pct        Float64,
        mem_mb         Float64,
        req_per_sec    Float64,
        error_rate     Float64,
        p95_latency_ms Float64
      ) ENGINE = MergeTree
      ORDER BY (service, ts)
      TTL toDateTime(ts) + INTERVAL 7 DAY
    `);

    const start = Date.now();
    const BATCH = 1_000;
    for (let offset = 0; offset < points.length; offset += BATCH) {
      const batch = points.slice(offset, offset + BATCH).map((p) => ({
        ts: new Date(p.timeMs).toISOString().replace('T', ' ').replace('Z', ''),
        service: p.service,
        host: p.host,
        cpu_pct: p.cpu_pct,
        mem_mb: p.mem_mb,
        req_per_sec: p.req_per_sec,
        error_rate: p.error_rate,
        p95_latency_ms: p.p95_latency_ms,
      }));
      await clickhouse.insertRows(CH_RAW_TABLE, batch);
    }
    const writeMs = Date.now() - start;

    // Naive equivalent of InfluxDB's date_bin query: bucket the raw table
    // directly, no downsampled table. This is what "just query it" costs
    // without building anything extra.
    const rawBucketedSql = `
      SELECT
        toStartOfInterval(ts, INTERVAL ${BUCKET_MINUTES} MINUTE) AS bucket,
        min(${QUERY_FIELD}) AS min, max(${QUERY_FIELD}) AS max,
        avg(${QUERY_FIELD}) AS mean, quantile(0.95)(${QUERY_FIELD}) AS p95
      FROM ${CH_RAW_TABLE}
      WHERE service = '${QUERY_SERVICE}' AND ts > now() - INTERVAL ${WINDOW_HOURS} HOUR
      GROUP BY bucket ORDER BY bucket
    `.trim();
    const rawQuery = await timeQuery(() => clickhouse.querySql(rawBucketedSql), QUERY_REPEATS);

    // Real downsampling: a second table holding pre-aggregated state, and a
    // materialized view that keeps it in sync on every insert. This is the
    // part InfluxDB doesn't need at all — the DDL below is the hand-built
    // cost the write-up is measuring.
    await clickhouse.command(`
      CREATE TABLE ${CH_AGG_TABLE} (
        bucket  DateTime,
        service LowCardinality(String),
        min_state     AggregateFunction(min, Float64),
        max_state     AggregateFunction(max, Float64),
        avg_state     AggregateFunction(avg, Float64),
        p95_state     AggregateFunction(quantile(0.95), Float64)
      ) ENGINE = AggregatingMergeTree
      ORDER BY (service, bucket)
      TTL bucket + INTERVAL 90 DAY
    `);
    await clickhouse.command(`
      CREATE MATERIALIZED VIEW ${CH_MV} TO ${CH_AGG_TABLE} AS
      SELECT
        toStartOfInterval(ts, INTERVAL ${BUCKET_MINUTES} MINUTE) AS bucket,
        service,
        minState(${QUERY_FIELD}) AS min_state,
        maxState(${QUERY_FIELD}) AS max_state,
        avgState(${QUERY_FIELD}) AS avg_state,
        quantileState(0.95)(${QUERY_FIELD}) AS p95_state
      FROM ${CH_RAW_TABLE}
      GROUP BY bucket, service
    `);
    // The MV only fires on new inserts; existing raw rows need a manual
    // backfill pass to populate it — another step InfluxDB doesn't have.
    await clickhouse.command(`
      INSERT INTO ${CH_AGG_TABLE}
      SELECT
        toStartOfInterval(ts, INTERVAL ${BUCKET_MINUTES} MINUTE) AS bucket,
        service,
        minState(${QUERY_FIELD}), maxState(${QUERY_FIELD}),
        avgState(${QUERY_FIELD}), quantileState(0.95)(${QUERY_FIELD})
      FROM ${CH_RAW_TABLE}
      GROUP BY bucket, service
    `);

    const aggBucketedSql = `
      SELECT
        bucket,
        minMerge(min_state) AS min, maxMerge(max_state) AS max,
        avgMerge(avg_state) AS mean, quantileMerge(0.95)(p95_state) AS p95
      FROM ${CH_AGG_TABLE}
      WHERE service = '${QUERY_SERVICE}' AND bucket > now() - INTERVAL ${WINDOW_HOURS} HOUR
      GROUP BY bucket ORDER BY bucket
    `.trim();
    const aggQuery = await timeQuery(() => clickhouse.querySql(aggBucketedSql), QUERY_REPEATS);

    const [{ n: rawRowCount }] = await clickhouse.querySql(`SELECT count() AS n FROM ${CH_RAW_TABLE}`);
    const [{ n: aggRowCount }] = await clickhouse.querySql(`SELECT count() AS n FROM ${CH_AGG_TABLE}`);

    return {
      writeMs,
      rawQueryMedianMs: rawQuery.medianMs,
      aggQueryMedianMs: aggQuery.medianMs,
      bucketCount: aggQuery.result.length,
      rawRowCount: Number(rawRowCount),
      aggRowCount: Number(aggRowCount),
    };
  } finally {
    await clickhouse.command(`DROP TABLE IF EXISTS ${CH_MV}`);
    await clickhouse.command(`DROP TABLE IF EXISTS ${CH_AGG_TABLE}`);
    await clickhouse.command(`DROP TABLE IF EXISTS ${CH_RAW_TABLE}`);
  }
}

async function main() {
  const nowMs = Date.now();
  console.log(`Generating ${POINT_COUNT} synthetic points across ${SERVICES.length} services over ${WINDOW_HOURS}h...`);
  const points = generatePoints(POINT_COUNT, nowMs);

  console.log('\n--- InfluxDB ---');
  const influx = await runInflux(points);
  console.log(`  write: ${influx.writeMs}ms (${(POINT_COUNT / (influx.writeMs / 1000)).toFixed(0)} pts/sec)`);
  console.log(`  date_bin bucketed query (production code path): ${influx.queryMedianMs}ms median over ${QUERY_REPEATS} runs, ${influx.bucketCount} buckets`);

  console.log('\n--- ClickHouse ---');
  const ch = await runClickhouse(points);
  console.log(`  write: ${ch.writeMs}ms (${(POINT_COUNT / (ch.writeMs / 1000)).toFixed(0)} pts/sec)`);
  console.log(`  raw GROUP BY bucketed query (no MV): ${ch.rawQueryMedianMs}ms median over ${QUERY_REPEATS} runs`);
  console.log(`  AggregatingMergeTree + MV bucketed query: ${ch.aggQueryMedianMs}ms median over ${QUERY_REPEATS} runs, ${ch.bucketCount} buckets`);
  console.log(`  raw rows: ${ch.rawRowCount}, agg table rows: ${ch.aggRowCount} (${(ch.rawRowCount / ch.aggRowCount).toFixed(1)}x reduction)`);

  console.log('\n' + JSON.stringify({ POINT_COUNT, WINDOW_HOURS, BUCKET_MINUTES, influx, ch }, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
