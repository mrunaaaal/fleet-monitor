# Write-up #5: Postgres `tsvector` vs. ClickHouse for log search

**Question this answers:** was ClickHouse the right choice for log search, or would Postgres full-text search have done the job with one fewer datastore to run? fleet-monitor-docs.md §9, comparison #5.

## Tried

`scripts/tsvector-vs-clickhouse.js` loads the same 50,000-line synthetic corpus into a throwaway Postgres table (`message TEXT` plus a `tsvector` generated column backed by a GIN index) and a throwaway ClickHouse table (`message String` with a `tokenbf_v1` index — the same shape as the real `logs` table, `0001_logs.sql`), against the real `postgres` and `clickhouse` containers from `docker compose up`. The corpus mirrors real mesh error shapes (connection timeouts with embedded IPs, quoted payloads, cache keys), 20% of rows per template, so both a whole-word query and a mid-token substring query have real matches to find.

Two query shapes were timed, 5 repeats each, matching what `search_logs` (`server/query/logs.js`) actually runs against ClickHouse — `position(message, pattern) > 0`:

- **Pattern query**: the whole word `"timeout"`, which sits on token boundaries everywhere it appears — the case `tsvector`'s lexeme-based tokenizer is built for. Run as `search @@ plainto_tsquery('english', 'timeout')` against Postgres, `position(message, 'timeout') > 0` against ClickHouse.
- **Substring query**: `"0.4."`, a fragment of an IP address (`10.0.4.213`) that never sits on a word boundary. Run against Postgres two ways — as a `tsvector` match (to show what happens if you use the wrong tool) and as `message ILIKE '%0.4.%'` (the correct fallback) — and against ClickHouse as `position(message, '0.4.') > 0`.

## Limit

| Query | Postgres `tsvector` | Postgres `ILIKE` | ClickHouse |
|---|---|---|---|
| Whole word (`"timeout"`, 10,000 matches) | **18.0ms** | — | 27.6ms |
| Mid-token substring (`"0.4."`, 1,250 matches) | **0 rows returned** (wrong tool) | 62.0ms | **18.6ms** |

On a whole-word query, `tsvector` + GIN actually beat ClickHouse — 18.0ms vs. 27.6ms on this corpus and hardware. That's the case full-text search is designed for, and it does it well.

The substring query is where the semantic mismatch shows up. `to_tsvector` tokenizes on word boundaries, so `"0.4."` inside `10.0.4.213` is never produced as a lexeme — the `tsvector @@` query against it isn't slow, it's *wrong*: it silently returns 0 rows instead of the 1,250 real matches. The only correct fallback is `ILIKE '%0.4.%'`, which Postgres has no index for on this column (a GIN trigram index would help but is a separate extension and a separate index to maintain, not something `tsvector` gives you) — it's a sequential scan, and at 62.0ms it's the slowest result in the table, **~3.3x** ClickHouse's 18.6ms for the same query and row count.

This is not a corner case for this project. Real log search needs fragments of IPs, hex ids, trace ids, and partial hostnames — none of which land on word boundaries — which is exactly what the clustering algorithm in `search_logs` normalizes away (`clusterTemplate`, `server/query/logs.js`: UUIDs, IPs, quoted strings, digit runs). ClickHouse's `position()` does true substring matching unconditionally, with the `tokenbf_v1` index accelerating the token-level cases and a full but fast scan covering the rest; Postgres has a fast, indexed answer only for the query shape that's the *less* representative one here.

## Measured

For whole-word queries, Postgres `tsvector` is competitive with (here, faster than) ClickHouse — 18.0ms vs. 27.6ms on 50k rows. But log search's real query shape is substring matching over IPs, ids, and partial tokens, and `tsvector` can't do that at all (0 rows, not slow — wrong): the only correct Postgres answer is an unindexed `ILIKE` scan at 62.0ms, **~3.3x** slower than ClickHouse's 18.6ms for the identical query and result set. The log-store choice was evaluated, not assumed: ClickHouse wins on the query shape log search actually needs, and Postgres's full-text search is the wrong tool for it, not just a slower one.

## Method notes (for reproducing)

- Reproduce with: `docker compose up -d postgres clickhouse && node scripts/tsvector-vs-clickhouse.js` (reads `POSTGRES_URL`/`CLICKHOUSE_URL`/`CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`/`CLICKHOUSE_DB` the same way `server/db/postgres.js`/`server/db/clickhouse.js` do).
- The script creates and drops its own `logs_bench_pg` / `logs_bench_ch` tables — it never touches the real `logs` table.
- This was run once, timeboxed, per fleet-monitor-docs.md §16 ("Postgres first, every time... `tsvector` before ClickHouse... these are timeboxed throwaway spikes that run once under measurement and become a benchmark script or a write-up paragraph — not parallel production paths you maintain"). `scripts/tsvector-vs-clickhouse.js` is that spike; it is not part of the log search path.
