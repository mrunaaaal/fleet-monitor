# Write-up #1: Neo4j vs. recursive CTE for blast radius

**Question this answers:** is Neo4j earning its place as a fifth store, or would a recursive CTE on Postgres (which the project already has, for the service registry) have done the job? fleet-monitor-docs.md §9, comparison #1.

## Tried

`scripts/topology-spike.js` builds the real mesh diamond (`mesh/config.js`, fleet-monitor-docs.md §3.1 — 8 services, `payments`/`inventory` both depending on `ledger-db`) into two throwaway stores against the real `postgres` and `neo4j` containers from `docker compose up`:

- **Postgres**: a `WITH RECURSIVE` CTE walking `DEPENDS_ON` edges backwards from the failing service, capped at 4 hops.
- **Neo4j**: the variable-length Cypher pattern `query/topology.js` actually ships — `(down:Service)<-[:DEPENDS_ON*1..N]-(affected:Service)` — same depth cap.

Both compute blast radius from `ledger-db` (the diamond's shared dependency) and are timed over 500 iterations each, per the PRD's M4 milestone ("recursive-CTE spiked first and timed at depth 4").

## Limit

| | Recursive CTE (Postgres) | Cypher traversal (Neo4j) | Ratio |
|---|---|---|---|
| Avg | 1.257ms | 7.437ms | **~5.9x slower** |
| p95 | 2.302ms | 14.947ms | **~6.5x slower** |
| Min | 0.694ms | 2.343ms | **~3.4x slower** |
| Max | 8.370ms | 157.178ms | **~18.8x slower** |

Both return identical rows (`inventory`/`payments` at 1 hop, `api-gateway` at 2, `web`/`checkout` at 3 — the exact diamond shape). On this 8-node, 7-edge graph, Neo4j is slower on every percentile, not faster. Two things explain why: the pg driver here uses an already-warm connection-pool round trip, while `neo4j-driver`'s bolt protocol opens a session per call (`server/db/neo4j.js` mirrors the ingest/query split's real usage pattern — see the seam1 test at `server/test/topology-seam1.test.js`, which took ~200-1400ms on a cold first connection for the same reason); and the CTE's search space is genuinely tiny, so Postgres never pays for an index it doesn't need. Neither store is under real load here — this measures per-query overhead on a graph too small for algorithmic traversal cost to matter.

The recursive CTE also isn't free to maintain: `topology-spike.js` needed a second schema (`topology_bench_edges`/`topology_bench_services`) and a hand-written `GROUP BY ... min(hops)` to get the same "closest path per node" semantics Cypher's `min(length(path))` gives directly. That query complexity, not raw speed, is where Neo4j's argument actually lives — `find_shared_dependency`'s multi-source `UNWIND` + `count(DISTINCT name) = size($services)` narrowing (`query/topology.js`) has no equally direct SQL equivalent; it would need a recursive CTE per alerting service, unioned and intersected by hand.

## Measured

At the mesh's actual scale (8 services, depth 4), a Postgres recursive CTE is **~6x faster** than Neo4j's Cypher traversal for the same blast-radius query and returns identical results — so the speed argument for a fifth store does not hold at this scale, and taken alone this comparison argues for Postgres. Neo4j earns its place instead on query *expressiveness*: the shared-dependency narrowing query (`MATCH (s:Service {name: name})-[:DEPENDS_ON*1..8]->(candidate:Service) WITH candidate, count(DISTINCT name) AS covers WHERE covers = size($alerting)`) reads as one graph pattern instead of a hand-built per-service CTE union, and that gap widens as hop count and alerting-service count grow — neither of which this 8-node mesh is large enough to demonstrate. Honestly: this project's mesh is too small for Neo4j's traversal-complexity advantage to show up in the numbers; the choice is justified by query ergonomics and by what a larger topology would eventually cost in hand-rolled SQL, not by measured throughput here.

## Method notes (for reproducing)

- Reproduce with: `docker compose up -d postgres neo4j && node scripts/topology-spike.js` (reads `POSTGRES_URL` and `NEO4J_URL`/`NEO4J_USER`/`NEO4J_PASSWORD` from the environment, matching `server/db/postgres.js` / `server/db/neo4j.js`).
- The script creates and drops its own `topology_bench_edges`/`topology_bench_services` Postgres tables and `spike`-prefixed Neo4j nodes — it never touches the real `services` table or the real `(:Service)` graph.
- This was run once, timeboxed, per fleet-monitor-docs.md §16 ("Postgres first, every time... these are timeboxed throwaway spikes that run once under measurement and become a benchmark script or a write-up paragraph — not parallel production paths you maintain"). `scripts/topology-spike.js` is that spike; it is not part of the ingest or query path (`server/ingest/topology.js` and `server/query/topology.js` are the real, maintained implementation, and both are Neo4j-only).
