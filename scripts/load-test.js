import { createClickhouseClient } from '../server/db/clickhouse.js';

// Comparison write-up #2 (fleet-monitor-docs.md §9): insert 50k log rows
// both ways — one INSERT per row, and one INSERT per 1000-row batch (the
// flusher's real batch size, fleet-monitor-docs.md §5.2) — against real
// ClickHouse, and watch `system.parts` for each. This is the timeboxed
// throwaway spike itself (fleet-monitor-docs.md §16); it writes its
// numbers to stdout for the write-up, not to a maintained benchmark suite.
const TOTAL_ROWS = 50_000;
const BATCH_SIZE = 1_000;
const PERROW_CONCURRENCY = 200;
const PARTS_POLL_MS = 100;

const clickhouse = createClickhouseClient();

function makeRow(table, i) {
  return {
    ts: new Date().toISOString().replace('T', ' ').replace('Z', ''),
    service: 'load-test',
    level: 'info',
    message: `benchmark row ${i} for ${table}`,
    trace_id: '',
  };
}

async function resetTable(table) {
  await clickhouse.command(`DROP TABLE IF EXISTS ${table}`);
  await clickhouse.command(`
    CREATE TABLE ${table} (
      ts        DateTime64(3),
      service   LowCardinality(String),
      level     LowCardinality(String),
      message   String,
      trace_id  String
    ) ENGINE = MergeTree
    ORDER BY (service, ts)
  `);
}

async function activePartsCount(table) {
  const rows = await clickhouse.querySql(
    `SELECT count() AS n FROM system.parts WHERE table = '${table}' AND active`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function runPerRow(table) {
  let next = 0;
  async function worker() {
    while (next < TOTAL_ROWS) {
      const i = next;
      next += 1;
      await clickhouse.insertRows(table, [makeRow(table, i)]);
    }
  }

  // Background merges run continuously, so the parts count sampled only
  // after the run understates the real number ever created — poll while
  // inserting and keep the peak, which is what a sustained burst actually
  // does to the merge queue in production.
  let polling = true;
  let maxParts = 0;
  const poller = (async () => {
    while (polling) {
      maxParts = Math.max(maxParts, await activePartsCount(table));
      await new Promise((resolve) => setTimeout(resolve, PARTS_POLL_MS));
    }
  })();

  const start = Date.now();
  await Promise.all(Array.from({ length: PERROW_CONCURRENCY }, worker));
  const elapsedMs = Date.now() - start;
  polling = false;
  await poller;
  const partsImmediately = await activePartsCount(table);
  return { elapsedMs, partsImmediately, maxPartsDuringRun: maxParts };
}

async function runBatched(table) {
  let polling = true;
  let maxParts = 0;
  const poller = (async () => {
    while (polling) {
      maxParts = Math.max(maxParts, await activePartsCount(table));
      await new Promise((resolve) => setTimeout(resolve, PARTS_POLL_MS));
    }
  })();

  const start = Date.now();
  for (let offset = 0; offset < TOTAL_ROWS; offset += BATCH_SIZE) {
    const rows = Array.from({ length: Math.min(BATCH_SIZE, TOTAL_ROWS - offset) }, (_, j) =>
      makeRow(table, offset + j),
    );
    await clickhouse.insertRows(table, rows);
  }
  const elapsedMs = Date.now() - start;
  polling = false;
  await poller;
  const partsImmediately = await activePartsCount(table);
  return { elapsedMs, partsImmediately, maxPartsDuringRun: maxParts };
}

async function main() {
  console.log(`Benchmarking ${TOTAL_ROWS} rows: per-row inserts vs ${BATCH_SIZE}-row batches\n`);

  const perRowTable = 'logs_bench_perrow';
  await resetTable(perRowTable);
  console.log(`Running per-row inserts (concurrency=${PERROW_CONCURRENCY})...`);
  const perRow = await runPerRow(perRowTable);
  console.log(
    `  per-row:  ${perRow.elapsedMs}ms total, ${(TOTAL_ROWS / (perRow.elapsedMs / 1000)).toFixed(0)} rows/sec, ` +
      `peak ${perRow.maxPartsDuringRun} active parts during the run`,
  );

  const batchedTable = 'logs_bench_batched';
  await resetTable(batchedTable);
  console.log('Running batched inserts...');
  const batched = await runBatched(batchedTable);
  console.log(
    `  batched:  ${batched.elapsedMs}ms total, ${(TOTAL_ROWS / (batched.elapsedMs / 1000)).toFixed(0)} rows/sec, ` +
      `peak ${batched.maxPartsDuringRun} active parts during the run`,
  );

  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const perRowPartsAfterWait = await activePartsCount(perRowTable);
  const batchedPartsAfterWait = await activePartsCount(batchedTable);
  console.log(`\nAfter a 5s settle (background merges have a chance to run):`);
  console.log(`  per-row active parts:  ${perRowPartsAfterWait}`);
  console.log(`  batched active parts:  ${batchedPartsAfterWait}`);

  console.log(JSON.stringify({ TOTAL_ROWS, BATCH_SIZE, PERROW_CONCURRENCY, perRow, batched, perRowPartsAfterWait, batchedPartsAfterWait }, null, 2));

  await clickhouse.command(`DROP TABLE IF EXISTS ${perRowTable}`);
  await clickhouse.command(`DROP TABLE IF EXISTS ${batchedTable}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
