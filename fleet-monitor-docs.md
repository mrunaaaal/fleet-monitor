# Fleet Monitor

**A polyglot-persistence observability platform with an agentic root-cause analyst.**

---

## 1. Overview

### 1.1 What this is

A monitoring platform for a small fleet of services. Probes running inside each service ship metrics, logs, and dependency information to a central backend, which stores each kind of data in a store chosen for that data's shape. On top of that sits an AI agent that investigates incidents autonomously — given a symptom in plain English, it decides what to query, walks the service dependency graph, reads evidence, and produces a root-cause report.

The fleet being monitored is a purpose-built demo mesh with chaos controls, which means every failure is deliberately induced and the correct diagnosis is known in advance. That property is what makes the AI agent measurable rather than merely demonstrable.

### 1.2 Why it exists

Three learning goals, in priority order:

1. **Storage selection.** Build the same feature on Postgres first, hit its limits, then move to a specialized store and record the difference. Repeat for five stores.
2. **Ingest engineering.** Handle write volume properly — buffering, batching, backpressure, and the failure modes that appear when you don't.
3. **Agent engineering.** Build a tool-using agent with real guardrails, and — unusually for a side project — evaluate it against ground truth and publish the failure modes.

### 1.3 What it is not

This is a **learning platform**, not a product. A real team would run Grafana, or consolidate onto one or two datastores. The multi-store design exists so the trade-offs can be measured firsthand. That framing should appear in the README and in any conversation about the project — defending it as a production architecture would be the wrong move.

### 1.4 Explicit non-goals

| Not building | Why |
|---|---|
| Alerting and notification rules | A whole product on its own; cut for scope |
| Multi-tenancy, teams, RBAC | Single user, hardcoded auth |
| Distributed tracing / spans | Logs only |
| Configurable dashboards | Fixed panels |
| Write actions (restart, scale) | Agent is read-only by design |
| Log search UI page | The agent is the log interface |
| High availability, multi-region | Single-node everything |

---

## 2. Architecture

```
┌──────────────────────────────────────────┐
│              DEMO MESH                   │
│  8 Node services + probe                 │
│  each exposing POST /chaos               │
└───────────────┬──────────────────────────┘
                │ metrics · logs · topology · liveness
                ▼
┌──────────────────────────────────────────┐
│                 nginx                    │
│  TLS · static React · /api proxy         │
│  rate limiting · JSON access logs        │
└───────────────┬──────────────────────────┘
                ▼
┌──────────────────────────────────────────┐        ┌──────────┐
│              Fastify                     │───────▶│  Redis   │
│                                          │        │  buffer  │
│  ingest/  ─ metrics, logs, topology      │        │  liveness│
│  query/   ─ shared by UI and agent       │        └────┬─────┘
│  agent/   ─ investigation loop           │             │ flusher (2s)
└──┬────────┬────────┬─────────────────────┘             ▼
   │        │        │                              ┌──────────┐
   │        │        └─────────────────────────────▶│ClickHouse│  logs
   │        │                                       └──────────┘
   │        └──────────────────────────────────────▶  InfluxDB    metrics
   │                                                   Neo4j      topology
   └──────────────────────────────────────────────▶   Postgres   registry
                                                                  investigations
```

### 2.1 Store responsibilities

Each store has exactly one job. This constraint is deliberate — it keeps scope bounded and makes each justification crisp.

| Store | Job | Primary justification |
|---|---|---|
| **nginx** | TLS, static serving, proxy, rate limit | Standard edge; also a data source |
| **Redis** | Log write buffer, liveness TTLs | ClickHouse *fails* without batching |
| **ClickHouse** | Log storage and search | Columnar; high cardinality; fast scans |
| **InfluxDB 3** | Numeric time series | Retention + downsampling as config |
| **Neo4j** | Dependency graph, blast radius | Variable-depth traversal |
| **Postgres** | Service registry, investigation history | Relational core; FKs and transactions |

### 2.2 The one contested choice

ClickHouse and InfluxDB overlap. Both are columnar time-series stores, and a real team would pick one. The line drawn here:

- **InfluxDB** — regular-interval numeric measurements. Fixed shape, low cardinality, automatic downsampling and retention policies.
- **ClickHouse** — irregular high-cardinality events. Wide rows, arbitrary text, needle-in-haystack search.

This is the project's weakest justification and must be addressed head-on in comparison write-up #3 (§9). Without that document, InfluxDB reads as tool-collecting.

---

## 3. The demo mesh

### 3.1 Topology

Eight services, arranged to produce a graph with real depth and shape:

```
web ──────────┐
              ├──▶ api-gateway ──┬──▶ auth-service ──▶ session-store
checkout ─────┘                  ├──▶ payments ──────▶ ledger-db
                                 └──▶ inventory ─────▶ ledger-db
```

**Why eight and not three.** A three-node chain gives a maximum traversal depth of 2, which makes blast radius trivial and Neo4j decorative. This topology gives:

- **Depth 4** — real multi-hop traversal
- **A diamond** — `payments` and `inventory` both depend on `ledger-db`, so one failure produces two independent-looking symptom paths
- **Asymmetric impact** — breaking `auth-service` degrades `web` but leaves `checkout` partially working
- **Shared-ancestor queries** — given four alerting services, which single node is upstream of all of them?

Each service is one file plus a config listing its downstream targets, so eight costs roughly one extra day over three.

### 3.2 Service tiers

| Tier | Services |
|---|---|
| `user-facing` | web, checkout |
| `internal` | api-gateway, auth-service, payments, inventory |
| `datastore` | session-store, ledger-db |

Tiers matter for blast radius: "which *user-facing* services are affected" is the question that determines incident severity.

### 3.3 Chaos controls

Every mesh service exposes:

```
POST /chaos  { "mode": "ok" | "slow" | "error" | "dead" }
```

| Mode | Behaviour |
|---|---|
| `ok` | Normal operation |
| `slow` | 3s artificial delay before responding |
| `error` | Returns 500 with a realistic error body |
| `dead` | Stops responding entirely; connections hang until timeout |

### 3.4 Traffic generator

A small script hitting `web /work` and `checkout /work` at ~5 req/s with slight jitter. Runs continuously in development.

### 3.5 The probe library

`packages/probe/` — imported by every mesh service. Four responsibilities:

| Module | Interval | Action |
|---|---|---|
| `metrics.js` | 15s | Sample CPU, heap, request count, error count, latency histogram → `POST /v1/metrics` |
| `logger.js` | 2s or 50 lines | Batch and ship log lines → `POST /v1/logs` |
| `deps.js` | 60s | Report outbound call targets → `POST /v1/topology` |
| heartbeat | 15s | Liveness ping → refreshes Redis TTL key |

Latency is tracked as an in-memory histogram reset each interval, so p95 is computed at the source rather than reconstructed later.

---

## 4. Data models

### 4.1 Postgres

```sql
CREATE TABLE services (
  name       text PRIMARY KEY,
  tier       text NOT NULL
               CHECK (tier IN ('user-facing','internal','datastore')),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE investigations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symptom        text NOT NULL,
  findings       jsonb,                -- submit_findings payload, null if terminated
  trace          jsonb NOT NULL,       -- full tool-call sequence
  iterations     int NOT NULL,
  tool_calls     int NOT NULL,
  input_tokens   int NOT NULL,
  output_tokens  int NOT NULL,
  cost_usd       numeric(10,5) NOT NULL,
  duration_ms    int NOT NULL,
  terminated     text,                 -- null | 'budget_exceeded' | 'max_iterations'
  eval_scenario  text,                 -- set when run from the harness
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX investigations_scenario_idx
  ON investigations (eval_scenario, created_at DESC)
  WHERE eval_scenario IS NOT NULL;
```

The `investigations` table earns its place three times over: it backs the Investigate page's history view, it's where the eval harness writes results, and it lets you answer "did accuracy change when I rewrote the log summarizer?" with a query instead of a guess.

### 4.2 Redis

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `logbuf` | LIST | — | Write buffer. `RPUSH` on ingest, `LPOP` batch on flush |
| `alive:{service}` | STRING | 45s | Liveness. Value is a timestamp; expiry *is* the death detector |

The TTL approach means no reaper process. A service that stops heartbeating simply disappears from `MGET` results after 45 seconds.

### 4.3 ClickHouse

```sql
CREATE TABLE logs (
  ts        DateTime64(3),
  service   LowCardinality(String),
  level     LowCardinality(String),
  message   String,
  trace_id  String,
  INDEX msg_idx message TYPE tokenbf_v1(8192, 3, 0) GRANULARITY 4
) ENGINE = MergeTree
ORDER BY (service, ts)
TTL toDateTime(ts) + INTERVAL 7 DAY;
```

**Design notes:**

- `LowCardinality` dictionary-encodes columns with few distinct values — substantial compression on `service` and `level`
- `ORDER BY (service, ts)` because nearly every query filters by service first, then time range
- The token bloom filter lets substring searches skip granules rather than scanning every row
- TTL keeps the table bounded during long development runs

A second table `nginx_logs` with the same engine holds edge access logs.

### 4.4 InfluxDB 3

```
measurement: metrics
tags:        service, host
fields:      cpu_pct, mem_mb, req_per_sec, error_rate, p95_latency_ms
```

**The cardinality rule:** tags are indexed, fields are not. Never put a request ID, trace ID, or any unbounded value in a tag. Doing so is called a cardinality explosion and is the standard way people destroy a time-series database. `service` and `host` are both bounded at 8 and 1 respectively.

Use **InfluxDB 3 Core with the SQL interface**, not 2.x with Flux. Flux is a bespoke query language with no future; learning it is time you don't get back. Confirm current version specifics against the official docs at start — that ecosystem has moved considerably.

### 4.5 Neo4j

```cypher
CREATE CONSTRAINT service_name IF NOT EXISTS
FOR (s:Service) REQUIRE s.name IS UNIQUE;
```

Model: `(:Service {name, tier})-[:DEPENDS_ON {last_seen}]->(:Service)`

Upsert on each topology report:

```cypher
MERGE (a:Service {name: $from})
MERGE (b:Service {name: $to})
MERGE (a)-[r:DEPENDS_ON]->(b)
SET r.last_seen = timestamp()
```

**Blast radius** — the query that justifies the whole store:

```cypher
MATCH path = (down:Service {name: $failing})<-[:DEPENDS_ON*1..8]-(affected:Service)
RETURN DISTINCT affected.name AS service,
                affected.tier AS tier,
                min(length(path)) AS hops
ORDER BY hops, service
```

**Shared-ancestor narrowing** — given several alerting services, find common upstreams:

```cypher
UNWIND $alerting AS name
MATCH (s:Service {name: name})-[:DEPENDS_ON*1..8]->(candidate:Service)
WITH candidate, count(DISTINCT name) AS covers
WHERE covers = size($alerting)
RETURN candidate.name, covers
```

---

## 5. Ingest pipeline

### 5.1 Endpoints

| Endpoint | Destination | Path |
|---|---|---|
| `POST /v1/metrics` | InfluxDB | Direct write |
| `POST /v1/logs` | Redis → ClickHouse | Buffered |
| `POST /v1/topology` | Neo4j | Direct upsert |
| `POST /v1/heartbeat` | Redis | `SET` with 45s TTL |

### 5.2 The log buffer

```
agent → POST /v1/logs → RPUSH logbuf → 200 OK
                             │
                             ▼
                   flusher (setInterval 2s)
                   LPOP batch of 1000
                             │
                             ▼
                   single ClickHouse INSERT
```

**Why this is mandatory, not an optimization.** ClickHouse writes each `INSERT` as a new part on disk, then merges parts in the background. One insert per log line produces thousands of tiny parts, a merge queue that cannot keep up, and eventually a `TOO_MANY_PARTS` error that halts writes entirely. This is a hard failure, not a slowdown.

**Flush triggers:** every 2 seconds, or when the buffer exceeds 1000 entries, whichever comes first.

### 5.3 Durability trade-off

If Redis dies with unflushed entries, those logs are lost. This is **at-most-once delivery**, and it is the correct choice for observability data — losing a few log lines during an outage is acceptable; paying for durability on every log line is not.

At-least-once would require a Redis Stream with consumer groups and explicit acks, so entries stay in the pending-entries list until confirmed. **Know this answer; do not build it.** Naming a trade-off deliberately is worth more than implementing it unnecessarily.

---

## 6. Query layer

`server/query/` is written once and consumed twice — by the UI routes and by the agent's tools. The agent is not a parallel system; it is a different caller of the same functions.

| Module | Store | Function |
|---|---|---|
| `metrics.js` | InfluxDB | Time-bucketed stats for a service |
| `logs.js` | ClickHouse | Filtered search + pattern clustering |
| `topology.js` | Neo4j | Dependencies, blast radius, shared ancestors |
| `liveness.js` | Redis | `MGET` over `alive:*` keys |

The distinction between UI and agent consumption is in the **formatting layer** (§7.2), not the query layer.

---

## 7. The agent

### 7.1 Tools

Nine tools. Each is a thin wrapper over `query/`, plus a formatter.

| Tool | Store | Returns |
|---|---|---|
| `list_services` | Postgres | Names and tiers, one line each |
| `check_liveness` | Redis | Up/down per service |
| `query_metrics` | InfluxDB | Bucketed stats, trend direction, largest-change timestamp |
| `search_logs` | ClickHouse | Counts and clustered patterns — **not** raw lines |
| `get_log_samples` | ClickHouse | Max 5 lines, truncated to 200 chars each |
| `get_dependencies` | Neo4j | Downstream services a service calls — for walking symptom → cause |
| `find_shared_dependency` | Neo4j | Given several alerting services, the common downstream service they all depend on |
| `get_blast_radius` | Neo4j | Affected services with hop distance and tier |
| `submit_findings` | — | Terminal tool; structured report |

Example schema:

```js
{
  name: "search_logs",
  description:
    "Search logs for a service in a time window. Returns error counts and " +
    "clustered message patterns, not individual lines. Use get_log_samples " +
    "for specific examples once you know which pattern matters.",
  input_schema: {
    type: "object",
    properties: {
      service: { type: "string" },
      level:   { type: "string", enum: ["error", "warn", "info"] },
      pattern: { type: "string", description: "optional substring filter" },
      from:    { type: "string", description: "ISO 8601 timestamp" },
      to:      { type: "string", description: "ISO 8601 timestamp" }
    },
    required: ["service", "from", "to"]
  }
}
```

### 7.2 Summarization — the core engineering problem

A naive `search_logs` returns 5,000 rows, blows the context window, and costs a fortune. Tool output must be designed for a language model, not a human. This is a genuinely different skill and the most transferable thing in the project.

**Instead of raw lines:**

```json
{
  "total": 1847,
  "by_level": { "error": 1802, "warn": 45 },
  "time_range": { "first": "14:02:11.331", "last": "14:07:44.902" },
  "patterns": [
    { "count": 1743, "template": "connection timeout after {N}ms to {HOST}" },
    { "count": 59,   "template": "pool exhausted, {N} of {N} connections available" }
  ]
}
```

**Clustering algorithm:** normalize each message by replacing digit runs, UUIDs, quoted strings, and IP addresses with placeholders; group by normalized form; return the top 5 by count. Roughly 50 lines of code, and it converts an unusable tool into a good one.

**Metrics get the same treatment.** Never return 400 datapoints. Return min, max, mean, p95, trend direction, and the timestamp of the largest single change.

**Hard rule: every tool's output stays under ~800 tokens.** Write a test that asserts this.

### 7.3 System prompt

Contents, in order:

1. Role — an SRE investigating a live incident, with read-only access
2. Method — work from symptom toward cause by walking dependencies downstream
3. Cheap-first heuristic — check liveness before anything else
4. Aggregate-before-sample — use `search_logs` before `get_log_samples`
5. Termination — call `submit_findings` when confident; report low confidence rather than guessing when evidence is inconclusive
6. Context — tier meanings, and a one-paragraph description of the mesh

**Do not include the answer.** No hints about which services commonly fail.

### 7.4 The investigation loop

```js
async function investigate(symptom, { maxIterations = 10, maxCostUsd = 0.25 }) {
  const messages = [{ role: "user", content: symptom }];
  const trace = [];

  for (let i = 0; i < maxIterations; i++) {
    const res = await callModel({ messages, tools: TOOLS });
    messages.push({ role: "assistant", content: res.content });

    const calls = res.content.filter(c => c.type === "tool_use");
    if (calls.length === 0) break;

    const finish = calls.find(c => c.name === "submit_findings");
    if (finish) return { findings: finish.input, trace, iterations: i + 1 };

    const results = [];
    for (const call of calls) {
      const dup = trace.find(t => t.signature === sig(call));
      const out = dup
        ? { error: "Identical call already made. Use those results or try a different approach." }
        : await dispatch(call.name, call.input);
      trace.push({ signature: sig(call), name: call.name, input: call.input, out });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(out)
      });
    }
    messages.push({ role: "user", content: results });

    if (costSoFar() > maxCostUsd) break;
  }

  return { findings: null, trace, terminated: "budget_exceeded" };
}
```

**Four guardrails, each addressing an observed failure mode:**

| Guardrail | Failure it prevents |
|---|---|
| Iteration cap (10) | Unbounded exploration |
| Cost cap ($0.25) | Expensive runaway on a hard case |
| Duplicate-call detection | The most common failure — repeating a tool call with slightly shifted arguments when confused |
| Structured terminal tool | Ambiguous completion; no clean state to render |

The trace streams to the UI over SSE so the user watches the investigation unfold. That is the demo.

### 7.5 `submit_findings` schema

```js
{
  root_cause_services: [
    {
      service: "ledger-db",
      category: "latency" | "error" | "unavailable" | "resource" | "unknown",
      confidence: "high" | "medium" | "low"
    }
    // one entry per independent cause — a list, so simultaneous double failures are expressible
  ],
  summary: "one paragraph",
  evidence: [
    { source: "clickhouse", observation: "1,743 connection timeouts starting 14:02:11" },
    { source: "neo4j",      observation: "payments and inventory both depend on ledger-db" }
  ],
  affected_services: ["payments", "inventory", "checkout", "web"], // the analyst's blast-radius claim; scored for completeness
  suggested_remediation: "string"
}
```

### 7.6 Read-only by design

The agent proposes remediation; a human executes it. This is a deliberate constraint, stated explicitly in the README, with "human-approved actions" named as the natural next step. Restraint here is a stronger signal than autonomy.

---

## 8. Evaluation harness

The differentiator. Almost nobody building agent side projects can state how often theirs is correct.

### 8.1 Scenario format

`evals/scenarios.json`:

```json
{
  "id": "ledger_slow_diamond",
  "chaos": [{ "service": "ledger-db", "mode": "slow" }],
  "warmup_seconds": 90,
  "symptom": "Users report checkout is timing out",
  "expected": {
    "root_causes": [
      { "service": "ledger-db", "category": "latency" }
    ],
    "affected_services": ["payments", "inventory", "checkout", "web"]
  }
}
```

### 8.2 Coverage — 20 scenarios

| Category | Count | Purpose |
|---|---|---|
| Single-service, each mode | 9 | Baseline competence across the topology |
| Multi-hop cascade | 4 | Symptom is 3–4 hops from cause |
| Simultaneous double failure | 2 | Does it stop at the first plausible cause? |
| Red herring | 2 | A slow service that is *not* the cause of the reported symptom |
| Healthy false alarm | 2 | Correct answer is "nothing is wrong" |
| Insufficient data | 1 | Correct answer is low confidence |

Completeness varies across the cascade (4) and double-failure (2) scenarios, so the axis discriminates on roughly a third of the suite — not just the double failures.

### 8.3 Runner

```
for each scenario:
  reset all chaos to 'ok'
  wait for metrics to settle
  apply scenario chaos
  wait warmup_seconds
  invoke agent with symptom
  score result
  write to investigations table
reset all chaos
```

### 8.4 Capture and replay mode

A live run of 20 scenarios takes 40+ minutes, which is intolerable when iterating on prompts or summarizers.

**Capture mode:** run each scenario once for real, snapshot the resulting store state to fixture files in `evals/fixtures/`. **Replay mode:** the harness serves tool calls from fixtures instead of live stores. Iteration drops to about a minute.

Keep live runs for final published numbers. Roughly half a day to build; saves many hours.

### 8.5 Reporting

```
Scenario                     Correct  Cat  RC-Compl  BR-Compl  Calls   Cost
──────────────────────────────────────────────────────────────────────────
ledger_slow_diamond             ✓      ✓      1.0       1.0       6   $0.031
auth_dead_asymmetric            ✓      ✓      1.0       0.8       5   $0.024
double_failure_payments_auth    ✓      ✓      0.5       0.7      10   $0.052
healthy_false_alarm             ✓      —      1.0       1.0       4   $0.019
...
──────────────────────────────────────────────────────────────────────────
correct 17/20 · category 15/20 · root-cause completeness 0.86 · blast-radius completeness 0.79 · avg 6.2 calls · avg $0.028
```

**Publish the failures with explanations.** With the two-axis model, "correct root cause 17/20, but root-cause completeness drops to 0.5 on simultaneous double failures because it commits to the first plausible cause and stops" is more precise — and more impressive — than any single accuracy figure. Note the double-failure scenario now scores *correct but incomplete*, not wrong.

---

## 9. Comparison write-ups

Non-negotiable. Each is 2–4 paragraphs with real numbers, in `docs/comparisons/`. These documents are what carry an interview — more than the code.

| # | Comparison | Method | What it proves |
|---|---|---|---|
| 1 | Neo4j vs. recursive CTE | Write the Postgres version first; time both at depth 4 | Graph traversal choice was evaluated, not assumed |
| 2 | ClickHouse batched vs. per-row | Insert 50k lines both ways; watch `system.parts` | Redis buffer is required, not decorative |
| 3 | InfluxDB vs. ClickHouse for metrics | Store metrics in both; compare retention/downsampling effort | Addresses the weakest link head-on |
| 4 | Aggregated vs. raw tool outputs | Run 5 evals returning raw log lines | Quantifies the context-engineering work |
| 5 | Postgres FTS (`tsvector`) vs. ClickHouse log search | Same 50k lines; substring + pattern queries both ways | The log-store choice was evaluated, not assumed |

**Write-up #3 is the critical one.** The expected question is: *"You have ClickHouse. Why a second time-series database?"* The answer that works:

> I put metrics in both. InfluxDB gave me retention and downsampling as configuration; in ClickHouse I hand-built it with a materialized view and a TTL. At this scale ClickHouse was fine, and in production I'd consolidate — the operational cost of a second store isn't worth it. I kept both to have the comparison, and the numbers are in the write-up.

That converts the weakest choice into evidence of judgment. It only works if the document exists.

---

## 10. Frontend

React + Vite, built to static files, served by nginx. Not Next.js — there is no SSR or SEO requirement behind a login, and a plain SPA matches the architecture.

| Page | Content | Difficulty |
|---|---|---|
| **Overview** | Recharts line charts, one panel per service, 15s polling | Low |
| **Map** | `react-force-graph-2d`; nodes coloured by Redis liveness; click for blast radius | Medium — the fun one |
| **Investigate** | Text box → SSE stream → live tool-call trace → report card | High — real async state management |

The Investigate page is the hardest and most valuable: consuming a stream, appending trace entries as they arrive, rendering each tool result type differently, then the structured findings.

No log search page. The agent is the log interface.

---

## 11. Repository layout

```
fleet-monitor/
├── docker-compose.yml
├── .env.example
├── nginx/
│   ├── nginx.conf
│   └── certs/                    # self-signed, gitignored
├── packages/
│   └── probe/
│       ├── index.js
│       ├── metrics.js
│       ├── logger.js
│       └── deps.js
├── mesh/
│   ├── shared/service.js         # factory: all 8 built from this
│   ├── config.js                 # topology definition
│   └── traffic-generator.js
├── server/
│   ├── index.js
│   ├── config.js
│   ├── db/
│   │   ├── postgres.js
│   │   ├── redis.js
│   │   ├── clickhouse.js
│   │   ├── influx.js
│   │   ├── neo4j.js
│   │   └── migrations/
│   ├── ingest/
│   │   ├── metrics.js
│   │   ├── logs.js
│   │   ├── topology.js
│   │   └── flusher.js
│   ├── query/
│   │   ├── metrics.js
│   │   ├── logs.js
│   │   ├── topology.js
│   │   └── liveness.js
│   ├── agent/
│   │   ├── loop.js
│   │   ├── tools.js
│   │   ├── summarize.js
│   │   ├── prompt.js
│   │   └── budget.js
│   └── routes/
│       ├── api.js
│       └── investigate.js        # SSE
├── evals/
│   ├── scenarios.json
│   ├── run.js
│   ├── fixtures/
│   └── results/
├── scripts/
│   ├── backfill.js               # historical metrics for chart density
│   └── load-test.js              # burst writer for the ClickHouse benchmark
├── web/
│   └── src/pages/{Overview,Map,Investigate}.jsx
└── docs/
    ├── architecture.md
    └── comparisons/
```

**Key structural decision:** all eight mesh services are built from one factory in `mesh/shared/service.js`, parameterized by a topology config. Eight services, one implementation.

---

## 12. Data

Everything the agent queries is **self-generated by real processes**. No downloaded datasets, no Faker, no seeded rows.

### 12.1 Sources and volume

At ~5 req/s through the chain:

| Store | Rate | Per day |
|---|---|---|
| InfluxDB | 8 services × 5 fields / 15s | ~230k points |
| ClickHouse | ~10 log lines per request | ~4.3M rows |
| Neo4j | Static after discovery | 8 nodes, 12 edges |
| Postgres | Static + one row per investigation | 8 rows + history |
| Redis | Buffer drains every 2s | ~100 keys at rest |

An afternoon of running produces roughly 1.5M log rows — enough for ClickHouse to be doing real work. The 50k rows for the batching benchmark accumulate in about 15 minutes, or can be burst with `load-test.js`.

### 12.2 nginx as a data source

Configure `log_format` as JSON, tail the access log, ship to ClickHouse. Free real data, and the platform ends up monitoring its own front door.

### 12.3 Cold start

Two places where history is needed and won't exist:

**Empty charts.** `scripts/backfill.js` generates a week of plausible metrics with daily traffic cycles, weekend dips, and a few past incidents, written to InfluxDB with historical timestamps.

**Eval warmup.** Each scenario waits ~90s after applying chaos so metrics accumulate. Mitigated by capture/replay mode (§8.4).

### 12.4 The credibility line

| Must be real | Synthetic is fine |
|---|---|
| Everything the agent queries during an eval | Backfilled chart history |
| Metrics, logs, topology from actual failing processes | Load-test bursts for benchmarks |
| | Traffic generator request patterns |

**The rule:** never hand-write a log line saying "connection pool exhausted" so the agent can find it. Break the service and let it say that itself. State the backfill honestly in the README — nobody minds synthetic chart history; people mind synthetic evidence.

---

## 13. Milestones

| # | Deliverable | Time |
|---|---|---|
| **M0** | Compose up: nginx + Fastify + Postgres + Redis + ClickHouse + InfluxDB + Neo4j, all health checks green | 1 wk |
| **M1** | 8-service mesh from the factory, chaos endpoints, probe, traffic generator | 1 wk |
| **M2** | InfluxDB ingest + query + Overview page | 1 wk |
| **M3** | Redis buffer + flusher + ClickHouse logs + benchmark (write-up #2) | 1 wk |
| **M4** | Recursive CTE version, then Neo4j + blast radius + Map page (write-up #1) | 1 wk |
| **M5** | Tool layer: 7 tools, summarization, token budget tests (write-up #4) | 1 wk |
| **M6** | Agent loop, SSE streaming, Investigate page | 1 wk |
| **M7** | Eval harness, 20 scenarios, capture/replay, results table | 1 wk |
| **M8** | README, architecture diagram, write-up #3, polish | 0.5 wk |

**~8.5 weeks at 15 hrs/week.**

**Protect M7.** Pre-committed cut order when time runs short, decided in advance so week 6 is not a panic: (1) **drop InfluxDB** — metrics stay in ClickHouse, and write-up #3 downgrades from *measured* to "why I *didn't* add a second TSDB"; (2) minimize or cut the Overview page; (3) drop the `tsvector` spike (write-up #5). Do **not** reduce eval scenarios — the numbers are the differentiator, and cutting them to protect M7 is circular.

---

## 14. Known difficulties

**M0 is the worst week and it comes first.** Neo4j's initial password change flow, ClickHouse config volume permissions, InfluxDB 3's setup, and health checks reporting ready before the service actually is. Use `depends_on` with `condition: service_healthy` and expect iteration. Everything after M0 is more rewarding.

**Tool output size will surprise you.** The first `search_logs` implementation will return something enormous. Let that happen — the moment it does is when the summarization work makes sense. Don't pre-optimize.

**The agent will loop.** Around M6 you'll watch it call `query_metrics` four times with slightly shifted time windows. That is what the duplicate detector is for, and watching it happen firsthand teaches more than reading about it.

**Cardinality discipline in InfluxDB.** One careless tag with an unbounded value and the database degrades badly. Review tag choices before writing the ingest path.

---

## 15. Interview preparation

### 15.1 The three questions

**Q: Why six datastores when Postgres does JSONB, full-text search, and recursive CTEs?**

> At a company, one. I built this to find where each specialized tool actually pulls ahead. Every store has a write-up: what I tried in Postgres, where it fell short, what I measured after switching.

**Q: ClickHouse and InfluxDB overlap. Defend it.**

> See §9, write-up #3.

**Q: What would you do differently?**

> Drop InfluxDB and consolidate on ClickHouse. Use a Redis Stream with consumer groups instead of a list, if the durability were worth it. Add human-approved remediation actions as the next step for the agent.

Having this third answer ready is worth more than the architecture diagram.

**Q: Why not just use Grafana?**

> Because the goal was understanding storage trade-offs and having a controlled environment to evaluate an agent — not shipping a dashboard.

### 15.2 What makes it read as real

Three things, none of them architectural:

1. **The chaos mesh.** Most portfolio projects have seeded data. This one has a system that breaks on command and a cascade you can trigger live.
2. **The eval numbers.** "17/20, fails on simultaneous double failures because it commits early" is not a sentence anyone bluffs their way to.
3. **The comparison docs.** Every store has a *tried → limit → measured* paragraph.

### 15.3 The actual risk

Not the architecture. The risk is building all of this and skipping the four write-ups because they are less fun than code. Those documents are what carry the interview.

---

## 16. Build discipline

**Postgres first, every time.** Recursive CTE before Neo4j. `tsvector` before ClickHouse. Single-row inserts before the Redis buffer. These are **timeboxed throwaway spikes** (~2 hrs each) that run once under measurement and become a benchmark script or a write-up paragraph — *not* parallel production paths you maintain. If the timebox blows, "it took longer, and here's why" is itself the write-up finding; don't push it to production quality. This discipline is the entire justification for the polyglot design.

**Write the hard parts by hand.** The blast-radius Cypher, the log flusher, the pattern clusterer, the agent loop, the eval scorer. AI assistance for Compose files, nginx config, and CSS is fine. If you cannot explain the flusher from memory, it did not count.

**Deploy at M0.** Get one empty service deployed before it does anything. Deploying an empty app is easy; deploying a finished one for the first time is not.
