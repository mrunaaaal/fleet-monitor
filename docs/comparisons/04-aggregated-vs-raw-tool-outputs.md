# Write-up #4: aggregated vs. raw tool outputs

**Question this answers:** is `search_logs`' clustering (and `get_log_samples`' capping) actually load-bearing, or would handing the model raw matching rows work just as well? fleet-monitor-docs.md §7.2, comparison #4.

**A note on scope.** The design doc's plan for this write-up was to run it "across several evals" — through the full eval harness (§8). That harness is issues #16/#17, both still open; this ticket (#13) only builds the tools it would exercise. So this write-up measures across five realistic log-burst *scenarios* directly against the real `search_logs`/`get_log_samples` tools instead, stated honestly rather than silently substituted. Once #16/#17 ship, this is worth re-running through the harness itself.

## Tried

`scripts/aggregated-vs-raw-benchmark.js` seeds five scenarios into the real `logs` table (ClickHouse, via `docker compose up -d clickhouse`), each under a uniquely tagged service name, then measures `estimateTokens()` (the same ~4-chars-per-token estimate `server/agent/token-budget.js` uses to enforce every tool's ~800-token ceiling) on three things for the same underlying data:

- **raw** — every matching row (`ts`, `level`, `message`), capped at the same 5,000-row limit `search_logs` itself uses, exactly what a naive tool would hand the model
- **`search_logs`** — the real clustered output (`total`, `by_level`, `time_range`, top-5 `patterns`)
- **`get_log_samples`** — the real capped-and-truncated output (≤5 rows, messages truncated to 200 chars)

The five scenarios, chosen to bracket the honest range rather than cherry-pick a favorable one:

| Scenario | Rows | What it stresses |
|---|---|---|
| `repeating-timeout-burst` | 2,000 | one dominant pattern (varying host/port) — clustering's best case |
| `mixed-error-burst` | 2,000 | 5 evenly-mixed error templates — a realistic incident |
| `high-cardinality-burst` | 2,000 | free text with no digits/UUIDs/IPs/quoted strings — `clusterTemplate`'s normalization can't collapse it; clustering's real worst case |
| `single-pattern-flood` | 5,000 | `search_logs`' own row cap, one template — the extreme compression case |
| `quiet-period` | 50 | low volume — where aggregation has the least to do |

One correctness note from building this: an early version seeded rows with a fixed 2024 timestamp. `logs`' 7-day TTL is keyed off each row's own `ts` (`0001_logs.sql`), not insertion time, so those synthetic rows were TTL-expired the instant they landed — ClickHouse's background TTL sweep raced the benchmark's own read and produced flaky, order-dependent numbers between runs. Anchoring every scenario's timestamps to the real "now" fixed it. Left as a comment in the script since it's the kind of bug that looks like a benchmark-harness fluke and isn't.

## Limit

```
scenario,row_count,raw_tokens,search_logs_tokens,get_log_samples_tokens,reduction
repeating-timeout-burst,2000,55281,52,139,1063.1x
mixed-error-burst,2000,50390,109,127,462.3x
high-cardinality-burst,2000,59501,143,148,416.1x
single-pattern-flood,5000,132501,53,133,2500.0x
quiet-period,50,948,44,96,21.5x
```

Every raw-row scenario above ~2,000 rows blows straight through the ~800-token ceiling `token-budget.js` enforces on every tool — `search_logs` on `repeating-timeout-burst` alone would need a **~55,000-token** raw response, roughly 69x the ceiling, before an agent could even start reasoning about it. Even the smallest scenario (`quiet-period`, 50 lines) already costs 948 raw tokens, over the ceiling on its own.

`high-cardinality-burst` is the honest worst case for `clusterTemplate`'s specific normalization (digit runs, UUIDs, IPs, quoted strings): with none of those present, unrelated messages don't collapse into the same template. Its reduction (416x) is still the smallest of the five, but it's nowhere near parity with raw output — `search_logs` still reports `total`/`by_level`/`time_range` in constant space regardless of how well the individual messages cluster, so cost never scales with row count.

`get_log_samples`' cost is nearly flat across every scenario (96–148 tokens) because it's bounded by construction — 5 rows × 200 truncated chars, independent of how many rows actually matched. It never comes close to `search_logs`' clustering, but it isn't supposed to: it's the tool for "show me examples of the pattern I already found," used after `search_logs`, not instead of it (fleet-monitor-docs.md §7.3: aggregate-before-sample).

## Measured

Clustering log search output cuts token cost by **416x–2,500x** versus raw rows across five realistic scenarios, and caps sample output to a near-constant ~100–150 tokens regardless of match volume. The reduction holds even in clustering's worst case (free text that its normalization can't collapse) — the aggregation itself (counts, by-level breakdown, time range) is what keeps output small, not just the clustering. Every raw-row scenario tested would have blown the ~800-token ceiling on its own; every `search_logs`/`get_log_samples` result stayed 4–8x *under* it. The summarization work in #13 isn't a nice-to-have on top of a working naive tool — a naive `search_logs` returning raw matches would be unusable at the mesh's real log volume.

## Method notes (for reproducing)

- Reproduce with: `docker compose up -d clickhouse && node scripts/aggregated-vs-raw-benchmark.js` (reads `CLICKHOUSE_URL`/`CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`/`CLICKHOUSE_DB` from the environment the same way `server/db/clickhouse.js` does).
- Writes into the real `logs` table under service names tagged `writeup4-<scenario>-<timestamp>`, the same tagging convention `server/test/*-seam1.test.js` uses to avoid colliding with real mesh data; the table's 7-day TTL cleans the rows up on its own.
- This was run once, timeboxed, per fleet-monitor-docs.md §16 ("these are timeboxed throwaway spikes... not parallel production paths you maintain"). `scripts/aggregated-vs-raw-benchmark.js` is that spike, not a maintained benchmark suite.
