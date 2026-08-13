# Fleet Monitor

A learning platform: a chaos-controlled service mesh monitored by a polyglot backend, with an AI analyst that investigates induced failures against known ground truth.

## Language

### Incidents and diagnosis

**Symptom**:
The plain-English complaint that starts an investigation ("checkout is timing out"). It is what an operator observes, never the cause.
_Avoid_: alert, error

**Incident**:
A period during which one or more root causes are active. An incident always has at least one root cause and may have several independent ones.

**Root cause**:
A service whose induced failure independently produces the symptom. An incident may have more than one — simultaneous independent failures are distinct root causes, not one.
_Avoid_: culprit, source, fault

**Blast radius**:
The set of services affected by a given root cause, walking the graph *upstream* (who depends on the failing service), with hop distance and tier. Distinct from the root cause(s): a single cause can have a wide blast radius.

**Dependency**:
A service that a given service calls — the `DEPENDS_ON` edge followed forward, *downstream*. The agent walks downstream, from a symptomatic service toward its dependencies, to reach a cause. The opposite direction from blast radius.

**Shared dependency**:
A single service that several independently-alerting services all depend on downstream — the narrowing query that turns "these four are alerting" into "one common cause." The primary tool for diagnosing diamond and multi-failure incidents.

### Evaluation axes

The harness scores each investigation on two orthogonal axes. A diagnosis that names one real cause out of two is *correct but incomplete* — the two axes keep those separate rather than collapsing an incomplete-but-true finding into "wrong."

**Correctness**:
Whether every cause the analyst names is a real induced cause (no false positives). A high-confidence finding that names a service which did not fail is incorrect even if it also named the real one.

**Completeness**:
The fraction of true elements the analyst found (recall). Scored fractionally, as two independent sub-scores:

**Root-cause completeness**:
Fraction of the incident's induced root-cause services the analyst named.

**Blast-radius completeness**:
Fraction of the incident's actually-affected services the analyst identified.

### Components and topology

**Agent**:
The AI investigator — the tool-using loop that reads evidence and produces a root-cause report. "**Analyst**" is an acceptable synonym when stressing its read-only SRE role. Never used for the telemetry library.
_Avoid_: bot, assistant, agent-lib

**Probe**:
The telemetry library (`packages/probe/`) imported by every mesh service; it samples metrics, batches and ships logs, reports dependency targets, and heartbeats. It does not investigate anything.
_Avoid_: agent, agent-lib, collector

**Service**:
One of the eight Node processes in the demo mesh that the platform monitors. Not the Fastify backend, and not a backend store.
_Avoid_: node (ambiguous with Neo4j nodes), app

**Mesh**:
The eight-service demo topology whose real, chaos-induced failures generate all telemetry the agent queries.

**Store**:
A backend persistence engine in the polyglot layer — Postgres, Redis, ClickHouse, InfluxDB, or Neo4j.
_Avoid_: datastore (reserved for the mesh tier below)

**Datastore tier**:
One of the three mesh service tiers. Its members (`session-store`, `ledger-db`) are ordinary Node services that emulate stateful backends — they are not real databases and not backend stores.
_Avoid_: using "datastore" to mean a backend store
