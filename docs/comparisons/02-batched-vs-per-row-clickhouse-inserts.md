# Write-up #2: batched vs. per-row ClickHouse inserts

**Question this answers:** is the Redis log buffer + flusher (`server/ingest/flusher.js`) actually load-bearing, or is it decorative complexity? fleet-monitor-docs.md §9, comparison #2.

## Tried

`scripts/load-test.js` writes 50,000 synthetic log rows to a throwaway ClickHouse table two ways, against the real `clickhouse` container from `docker compose up`:

- **Per-row**: one `INSERT` per row, 200 requests in flight at a time (`PERROW_CONCURRENCY`) so the run isn't just serialized HTTP latency.
- **Batched**: one `INSERT ... FORMAT JSONEachRow` per 1,000 rows — the flusher's real batch size (`FLUSH_BATCH_SIZE`, `server/ingest/flusher.js`) — 50 requests total.

While each run was in flight, the script polled `system.parts` every 100ms and kept the peak, since ClickHouse merges parts in the background continuously — sampling only after the run understates how bad it gets mid-burst, which is the failure mode that actually matters.

## Limit

Per-row inserts hit a wall on two axes at once:

| | Per-row | Batched (1,000/insert) | Ratio |
|---|---|---|---|
| Wall time for 50k rows | 66,784ms | 645ms | **~104x slower** |
| Throughput | 749 rows/sec | 77,519 rows/sec | **~104x lower** |
| Peak active parts during the run | **1,441** | 6 | **~240x more parts** |

ClickHouse's own defaults on this instance (`system.merge_tree_settings`):

```
parts_to_delay_insert = 1000   -- inserts start being throttled past this
parts_to_throw_insert = 3000   -- inserts start failing past this
```

The per-row run's peak of 1,441 active parts already blew past `parts_to_delay_insert` — at this rate, ClickHouse would have started deliberately slowing writes down to let merges catch up, and a sustained burst (or a few concurrent load generators) would reach `parts_to_throw_insert` and start rejecting inserts outright. This is the `TOO_MANY_PARTS` failure named in fleet-monitor-docs.md §5.2: not a slowdown, a write-halting error. At 50k rows on a single local instance we got within 2x of the throttling threshold; at the mesh's real sustained log volume (~10 lines/request × ~5 req/s across 8 services, fleet-monitor-docs.md §12.1) without a buffer, parts would accumulate continuously with nothing to periodically collapse them back down.

The batched run peaked at 6 active parts — the buffer's whole job is converting "one part per log line" into "one part per flush," and the numbers show it doing exactly that.

## Measured

Batching log inserts into 1,000-row `INSERT`s instead of one per line is **~104x faster** and creates **~240x fewer on-disk parts** at the same row count, and keeps the mesh nowhere near ClickHouse's own insert-throttling thresholds. The Redis buffer + flusher (`logbuf` → `POST /v1/logs` → 2s-or-1000-entries drain → single `INSERT`) is required, not decorative — per-row inserts at the mesh's real volume would eventually trip `TOO_MANY_PARTS` and halt writes, which is a hard failure of the whole log path, not a performance nit.

## Method notes (for reproducing)

- Reproduce with: `docker compose up -d clickhouse && node scripts/load-test.js` (reads `CLICKHOUSE_URL`/`CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`/`CLICKHOUSE_DB` from the environment the same way `server/db/clickhouse.js` does).
- The script creates and drops its own `logs_bench_perrow` / `logs_bench_batched` tables — it never touches the real `logs` table.
- This was run once, timeboxed, per fleet-monitor-docs.md §16 ("Postgres first, every time... these are timeboxed throwaway spikes that run once under measurement and become a benchmark script or a write-up paragraph — not parallel production paths you maintain"). `scripts/load-test.js` is that spike; it is not part of the ingest path.
