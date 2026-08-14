import { createPostgresClient } from '../server/db/postgres.js';
import { createClickhouseClient } from '../server/db/clickhouse.js';

// Comparison write-up #5 (fleet-monitor-docs.md §9, spec issue #18): the
// same 50k-line log corpus, queried via Postgres `tsvector` (GIN index) and
// via ClickHouse (`position()` + tokenbf_v1, the real search_logs query,
// server/query/logs.js), timing both a whole-word pattern query and a
// true substring query (a fragment that doesn't sit on a word boundary,
// e.g. mid-IP or mid-word). This is the timeboxed throwaway spike itself
// (fleet-monitor-docs.md §16); it writes its numbers to stdout for the
// write-up, not to a maintained benchmark suite. Both tables are throwaway
// and dropped at the end — this never touches the real `logs` table.
const TOTAL_ROWS = 50_000;
const INSERT_BATCH_SIZE = 1_000;
const QUERY_REPEATS = 5;
const PG_TABLE = 'logs_bench_pg';

const postgres = createPostgresClient();
const clickhouse = createClickhouseClient();

// Five templates mirroring the real mesh's error shapes (fleet-monitor-docs
// §7.2's clustering examples: connection timeouts with IPs, quoted
// payloads, digit-bearing ids) so the corpus stresses both a whole-word
// pattern ("timeout") and a mid-token substring ("10.0.4.") the way real
// log search does, not an artificially uniform string.
function makeRow(i) {
  const template = i % 5;
  switch (template) {
    case 0:
      return `connection timeout after ${100 + (i % 900)}ms to 10.0.${i % 8}.${i % 255}:${5432 + (i % 4)}`;
    case 1:
      return `request ${i} failed with status 500: "internal error processing order-${i}"`;
    case 2:
      return `cache miss for key user:${i % 10000}:profile, falling back to postgres`;
    case 3:
      return `retrying upstream call to inventory-service, attempt ${1 + (i % 3)} of 3`;
    default:
      return `payment webhook received for txn_${i}${(i % 97).toString(16)} amount=${(i % 500) + 0.99}`;
  }
}

async function resetPostgres() {
  await postgres.query(`DROP TABLE IF EXISTS ${PG_TABLE}`);
  await postgres.query(`
    CREATE TABLE ${PG_TABLE} (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL,
      service TEXT NOT NULL,
      message TEXT NOT NULL,
      search TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', message)) STORED
    )
  `);
  await postgres.query(`CREATE INDEX ${PG_TABLE}_search_idx ON ${PG_TABLE} USING GIN (search)`);
}

async function resetClickhouse() {
  const table = 'logs_bench_ch';
  await clickhouse.command(`DROP TABLE IF EXISTS ${table}`);
  await clickhouse.command(`
    CREATE TABLE ${table} (
      ts        DateTime64(3),
      service   LowCardinality(String),
      message   String,
      INDEX msg_idx message TYPE tokenbf_v1(8192, 3, 0) GRANULARITY 4
    ) ENGINE = MergeTree
    ORDER BY (service, ts)
  `);
  return table;
}

async function insertPostgres(rows) {
  const start = Date.now();
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE);
    const values = [];
    const placeholders = batch
      .map((row, j) => {
        const base = j * 3;
        values.push(row.ts, row.service, row.message);
        return `($${base + 1}, $${base + 2}, $${base + 3})`;
      })
      .join(', ');
    await postgres.query(`INSERT INTO ${PG_TABLE} (ts, service, message) VALUES ${placeholders}`, values);
  }
  return Date.now() - start;
}

async function insertClickhouse(table, rows) {
  const start = Date.now();
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE).map((row) => ({
      ts: row.ts.replace('T', ' ').replace('Z', ''),
      service: row.service,
      message: row.message,
    }));
    await clickhouse.insertRows(table, batch);
  }
  return Date.now() - start;
}

async function timePostgres(sql, params, repeats) {
  let rowCount = 0;
  const start = Date.now();
  for (let i = 0; i < repeats; i++) {
    const rows = await postgres.query(sql, params);
    rowCount = rows.length;
  }
  return { avgMs: (Date.now() - start) / repeats, rowCount };
}

async function timeClickhouse(sql, repeats) {
  let rowCount = 0;
  const start = Date.now();
  for (let i = 0; i < repeats; i++) {
    const rows = await clickhouse.querySql(sql);
    rowCount = rows.length;
  }
  return { avgMs: (Date.now() - start) / repeats, rowCount };
}

async function main() {
  console.log(`Generating ${TOTAL_ROWS} synthetic log lines (shared corpus)...`);
  const now = Date.now();
  const rows = Array.from({ length: TOTAL_ROWS }, (_, i) => ({
    ts: new Date(now + i).toISOString(),
    service: 'load-test',
    message: makeRow(i),
  }));

  console.log('Loading into Postgres (tsvector + GIN)...');
  await resetPostgres();
  const pgInsertMs = await insertPostgres(rows);
  console.log(`  loaded in ${pgInsertMs}ms`);

  console.log('Loading into ClickHouse (tokenbf_v1)...');
  const chTable = await resetClickhouse();
  const chInsertMs = await insertClickhouse(chTable, rows);
  console.log(`  loaded in ${chInsertMs}ms`);

  // Whole-word pattern query: "timeout" sits on word boundaries in every
  // occurrence (template 0), so this is the case tsvector is built for.
  console.log(`\nPattern query (whole word "timeout"), ${QUERY_REPEATS} repeats each...`);
  const pgPattern = await timePostgres(
    `SELECT id FROM ${PG_TABLE} WHERE search @@ plainto_tsquery('english', 'timeout')`,
    [],
    QUERY_REPEATS,
  );
  const chPattern = await timeClickhouse(
    `SELECT ts FROM ${chTable} WHERE position(message, 'timeout') > 0`,
    QUERY_REPEATS,
  );
  console.log(`  postgres tsvector: ${pgPattern.avgMs.toFixed(1)}ms avg, ${pgPattern.rowCount} rows`);
  console.log(`  clickhouse:        ${chPattern.avgMs.toFixed(1)}ms avg, ${chPattern.rowCount} rows`);

  // True substring query: "0.4." is a mid-token fragment inside the IP in
  // template 0 (e.g. "10.0.4.213") — it never sits on a word boundary, so
  // to_tsvector's tokenizer never produces "0.4." as a lexeme and the GIN
  // index has nothing to match. Postgres has no index-backed way to answer
  // this; ILIKE '%0.4.%' is the only correct fallback, and it's a full
  // sequential scan of the message column.
  console.log(`\nSubstring query (mid-token fragment "0.4."), ${QUERY_REPEATS} repeats each...`);
  const pgSubstringTsvector = await timePostgres(
    `SELECT id FROM ${PG_TABLE} WHERE search @@ plainto_tsquery('english', '0.4.')`,
    [],
    QUERY_REPEATS,
  );
  const pgSubstringIlike = await timePostgres(
    `SELECT id FROM ${PG_TABLE} WHERE message ILIKE '%0.4.%'`,
    [],
    QUERY_REPEATS,
  );
  const chSubstring = await timeClickhouse(`SELECT ts FROM ${chTable} WHERE position(message, '0.4.') > 0`, QUERY_REPEATS);
  console.log(
    `  postgres tsvector (wrong tool): ${pgSubstringTsvector.avgMs.toFixed(1)}ms avg, ${pgSubstringTsvector.rowCount} rows (expected to miss real matches)`,
  );
  console.log(`  postgres ILIKE (seq scan, correct fallback): ${pgSubstringIlike.avgMs.toFixed(1)}ms avg, ${pgSubstringIlike.rowCount} rows`);
  console.log(`  clickhouse:                                  ${chSubstring.avgMs.toFixed(1)}ms avg, ${chSubstring.rowCount} rows`);

  console.log(
    '\n' +
      JSON.stringify(
        {
          TOTAL_ROWS,
          pgInsertMs,
          chInsertMs,
          pattern: { pgPattern, chPattern },
          substring: { pgSubstringTsvector, pgSubstringIlike, chSubstring },
        },
        null,
        2,
      ),
  );

  await postgres.query(`DROP TABLE IF EXISTS ${PG_TABLE}`);
  await clickhouse.command(`DROP TABLE IF EXISTS ${chTable}`);
  await postgres.close();
}

main().catch(async (err) => {
  console.error(err);
  await postgres.close();
  process.exit(1);
});
