# Fleet Monitor — PRD

Requirements layer over the design doc. The design doc (`../fleet-monitor-docs.md`) says *how*; this says *what must be true* and slices the work into independently-grabbable milestones. Domain language is in `../CONTEXT.md`; recorded decisions in `adr/`.

## 1. Purpose and success criteria

A learning platform — **not a product** (§1.3 of the design doc). Success is measured by three learning goals and one differentiator, in priority order:

1. **Storage selection.** Five stores, each with a *tried → limit → measured* comparison write-up backed by real numbers.
2. **Ingest engineering.** A working buffer/batch/backpressure path whose necessity is *demonstrated*, not asserted.
3. **Agent engineering.** A tool-using, read-only analyst with guardrails.
4. **The differentiator (protect above all):** an eval harness that scores the agent against known ground truth and *publishes its failure modes*.

**Definition of done for the project:** the eval harness runs 20 scenarios and produces a results table (correctness + completeness), and all five comparison write-ups exist with real numbers. Shipping without eval numbers is failure, regardless of how much else works.

## 2. Scope

In scope: the demo mesh, polyglot ingest/query, the agent, the eval harness, three frontend pages, five comparison write-ups. Non-goals are fixed in design-doc §1.4 (no alerting, no multi-tenancy, no tracing, no configurable dashboards, no write-actions, no log-search UI, single-node only).

## 3. Decisions of record (from grilling)

These are settled. Do not relitigate during implementation.

- **Eval scoring is two-axis.** `submit_findings` reports `root_cause_services` as a **list** of `{service, category, confidence}`. Scored on **correctness** (no false causes) and **completeness** (fractional; root-cause + blast-radius sub-scores). See `adr/0001-eval-scoring-correctness-and-completeness.md`.
- **Postgres-first is timeboxed throwaway spikes** (~2 hrs each), not parallel production paths. A blown timebox is itself the write-up finding.
- **InfluxDB is kept but is first on the cut list** if the schedule slips (write-up #3 stays *measured* while it survives).
- **Naming:** the telemetry library is the **probe** (`packages/probe/`); **"agent"** means only the AI analyst.
- **The agent has 9 tools**, including `get_dependencies` (downstream walk) and `find_shared_dependency` (multi-alert narrowing) — so its stated method is actually supported by its tools.

## 4. Milestones (issue-slicing spine)

Each milestone is one grabbable unit with explicit acceptance criteria. Detail and rationale live in the design-doc sections referenced.

| # | Deliverable | Acceptance criteria | Produces |
|---|---|---|---|
| **M0** | Compose stack (design §14) | `docker compose up` brings nginx + Fastify + Postgres + Redis + ClickHouse + InfluxDB + Neo4j to green health checks, using `depends_on: service_healthy`. One empty Fastify service deployed. | — |
| **M1** | Mesh + probe (§3) | 8 services built from the one factory; each exposes `POST /chaos` with all four modes; `packages/probe/` ships metrics/logs/deps/heartbeat; traffic generator runs at ~5 req/s. | — |
| **M2** | Metrics path (§4.4, §5, §10) | `POST /v1/metrics` → InfluxDB; `query/metrics.js` returns bucketed stats; Overview page renders per-service charts, 15s polling; **no unbounded tag** in the write path. | — |
| **M3** | Log path + buffer (§4.3, §5.2) | `POST /v1/logs` → Redis `logbuf` → 2s/1000-entry flusher → single ClickHouse INSERT; pattern-cluster query works; 50k-line benchmark run captured. | Write-ups #2, #5 |
| **M4** | Topology + graph (§4.5, §10) | Recursive-CTE blast radius spiked first and timed at depth 4; Neo4j upsert + blast-radius + dependencies + shared-ancestor queries work; Map page renders liveness-coloured graph with click-to-blast-radius. | Write-up #1 |
| **M5** | Tool layer (§7.1, §7.2) | All 9 tools implemented as thin wrappers + formatters; every tool's output asserted **< ~800 tokens** by a test; log/metric summarization implemented. | Write-up #4 |
| **M6** | Agent loop (§7.4, §10) | Investigation loop with all four guardrails (iteration cap, cost cap, duplicate detection, terminal tool); trace streams to Investigate page over SSE; findings render as a card. | — |
| **M7** | **Eval harness (protected)** (§8) | 20 scenarios run end-to-end; runner resets/warms/applies chaos/scores/persists to `investigations`; **two-axis scoring** (correctness + root-cause + blast-radius completeness); capture/replay mode; results table. | Results table |
| **M8** | Polish + write-up #3 (§9, §15) | README states the learning framing honestly; architecture diagram; write-up #3 (InfluxDB vs ClickHouse for metrics) with real numbers. | Write-up #3 |

**Dependencies:** M0 → M1 → {M2, M3, M4 can parallelize once M1 lands} → M5 → M6 → M7 → M8. M7 must not be cut.

## 5. Cross-cutting requirements

- **Tool output ceiling:** every agent tool returns < ~800 tokens; enforced by test (§7.2).
- **Cardinality discipline:** no unbounded value ever becomes an InfluxDB tag (§4.4).
- **Credibility line:** everything the agent queries during an eval is self-generated by real failing processes — never hand-written evidence (§12.4). Synthetic is allowed only for backfilled chart history and load-test bursts, stated honestly in the README.
- **Write the hard parts by hand:** flusher, pattern clusterer, blast-radius Cypher, agent loop, eval scorer (§16).
- **Read-only agent:** proposes remediation; a human executes (§7.6).

## 6. Risks and pre-committed cut order

Primary risk (design §15.3): building everything and skipping the write-ups. Mitigation: write-ups are milestone deliverables, not afterthoughts.

Schedule slip cut order, decided in advance (design §13): (1) drop InfluxDB, (2) minimize/cut Overview, (3) drop the `tsvector` spike. **Never** reduce eval scenarios.
