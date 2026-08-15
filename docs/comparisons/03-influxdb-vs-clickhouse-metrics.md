# Write-up #3: InfluxDB vs. ClickHouse for metrics

**Question this answers:** ClickHouse already stores logs — why run a second time-series database for metrics? fleet-monitor-docs.md §2.2, §9. This is the project's weakest storage justification, and the one an interviewer will ask about first.

## Tried

`scripts/influxdb-vs-clickhouse-metrics.js` writes the same 230,000-point synthetic metrics stream (the mesh's real daily volume at 8 services × 5 fields / 15s, fleet-monitor-docs.md §12.1) to both stores, against the real `influxdb` and `clickhouse` containers from `docker compose up`, then builds retention and 5-minute downsampling in each and times the bucketed-stats query `query/metrics.js` runs in production (`date_bin`/bucketed min/max/mean/p95 for one service over a 24h window):

- **InfluxDB**: retention is a single `influxdb3 create database metrics_bench --retention-period 7d` — not reachable over the write/query HTTP API, so the script shells out to the CLI via `docker compose exec`. Downsampling costs nothing extra: `query/metrics.js`'s existing `date_bin(...)` query already buckets the raw, full-resolution data at read time — the same code this write-up is measuring is the code already running in the app.
- **ClickHouse**: retention is a `TTL` clause on the raw table, the same one line the real `logs` table already uses (`0001_logs.sql`). Downsampling is not built in — getting the same bucketed stats without rescanning raw data on every query requires a second table (`AggregatingMergeTree`, storing partial aggregate states), a `MATERIALIZED VIEW` to keep it in sync on every insert, and a one-time backfill `INSERT` for rows written before the view existed, then a query rewritten to use `...Merge` functions against that table instead of plain aggregates.

## Limit

Config/schema effort, counted directly from the two code paths:

| | InfluxDB | ClickHouse |
|---|---|---|
| Retention | 1 CLI flag at db-create | 1 `TTL` clause (already paid for by `logs`) |
| Downsampling | **0** — existing `date_bin` query, no new schema | 1 `AggregatingMergeTree` table + 1 `MATERIALIZED VIEW` + 1 backfill `INSERT` + a rewritten query (~40 lines of DDL/SQL, `runClickhouse()` in the script) |

Query latency, 230k rows, 7 repeats, median, identical bucketed shape (24h window, 5-minute buckets, one service):

| | Write (230k pts) | Bucketed query |
|---|---|---|
| InfluxDB (`date_bin`, raw data) | 45,850ms — 5,016 pts/sec | **59ms**, 289 buckets |
| ClickHouse (raw `GROUP BY`, no MV) | 2,934ms — 78,391 pts/sec | **19ms** |
| ClickHouse (`AggregatingMergeTree` + MV) | — (built after write) | **21ms**, 288 buckets |

Two things fall out of this that don't match the intuitive story:

1. **ClickHouse doesn't need the materialized view to be fast here.** A naive `GROUP BY` straight against the 230k-row raw table (19ms) is statistically indistinguishable from the pre-aggregated MV (21ms) — at this row count, ClickHouse's columnar scan is already faster than InfluxDB's bucketed query (59ms) either way. The MV's payoff is row-count reduction for long-term storage (230,000 raw rows → 2,312 aggregated rows, a **99.5x** reduction), not query speed at this scale — it would start mattering once raw retention runs into years of history, not a few weeks.
2. **ClickHouse's write path is ~15.6x faster** in this script (78,391 vs. 5,016 pts/sec) — but that's an artifact of transport, not storage engine: the InfluxDB client here writes 46 sequential HTTP round-trips of 5,000 line-protocol lines each (`server/db/influx.js` has no batched/pipelined write mode), while the ClickHouse client's `insertRows` posts each 1,000-row batch as a single `JSONEachRow` body. It's a real number, but it answers "how fast is this HTTP client," not "which storage engine is faster."

## Measured

The honest version of the pitch in fleet-monitor-docs.md §9 holds up under real numbers: InfluxDB gives retention and downsampling as configuration — one CLI flag and zero new schema, because `date_bin` already buckets raw data cheaply (59ms at 230k rows). ClickHouse gets there too, but only after hand-building an `AggregatingMergeTree` + `MATERIALIZED VIEW` + backfill (~40 lines), and at this project's scale that effort doesn't even buy a query-speed win — the naive raw `GROUP BY` (19ms) and the hand-built MV (21ms) are the same speed, both faster than InfluxDB's bucketed query. What the MV *does* buy is a 99.5x row-count reduction for whatever gets kept long-term.

That is the real trade-off, not "ClickHouse is too slow for metrics": at this scale, either store answers the query fine, and in production I'd consolidate on ClickHouse and drop InfluxDB — one fewer store to run outweighs config convenience for numeric time series specifically. I kept both here because the comparison, not the architecture, is the point of a learning platform.

## Method notes (for reproducing)

- Reproduce with: `docker compose up -d influxdb clickhouse && node scripts/influxdb-vs-clickhouse-metrics.js` (reads `CLICKHOUSE_URL`/`CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`/`CLICKHOUSE_DB` and `INFLUXDB_URL`/`INFLUXDB_DB` the same way `server/db/clickhouse.js`/`server/db/influx.js` do; the retention step additionally shells out to `docker compose exec influxdb influxdb3`, so it must run from a checkout with the compose stack up, not against a remote instance).
- The script creates and drops its own `metrics_bench` InfluxDB database and `metrics_bench_raw`/`metrics_bench_5m`/`metrics_bench_5m_mv` ClickHouse tables — it never touches the real `metrics` measurement.
- This was run once, timeboxed, per fleet-monitor-docs.md §16 ("Postgres first, every time... these are timeboxed throwaway spikes that run once under measurement and become a benchmark script or a write-up paragraph — not parallel production paths you maintain"). `scripts/influxdb-vs-clickhouse-metrics.js` is that spike; production metrics stay in InfluxDB only (`server/ingest/metrics.js`, `server/query/metrics.js`) — this write-up does not add ClickHouse to the metrics ingest path.
