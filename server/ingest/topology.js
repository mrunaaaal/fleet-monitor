// Topology upsert (fleet-monitor-docs.md §4.5): MERGE keeps this
// idempotent across repeated 60s deps-reporter ticks, and SET on the edge
// each time keeps `last_seen` current without ever duplicating a node or
// relationship — the service_name uniqueness constraint (migration 0001)
// is what makes MERGE on name alone safe.
const UPSERT_CYPHER = `
  MERGE (a:Service {name: $service})
  SET a.tier = coalesce($tier, a.tier)
  WITH a
  UNWIND $downstream AS target
  MERGE (b:Service {name: target})
  MERGE (a)-[r:DEPENDS_ON]->(b)
  SET r.last_seen = timestamp()
`;

// Even with no downstream targets, the service itself must still land as
// a node (e.g. session-store, ledger-db — leaf services with no
// dependencies of their own).
const UPSERT_NODE_ONLY_CYPHER = `
  MERGE (a:Service {name: $service})
  SET a.tier = coalesce($tier, a.tier)
`;

export function createTopologyIngestHandler({ neo4j }) {
  return async function ingestTopology(payload) {
    if (!payload.service) {
      throw new Error('topology payload missing required field: service');
    }
    const downstream = payload.downstream ?? [];
    const params = { service: payload.service, tier: payload.tier ?? null, downstream };
    await neo4j.run(downstream.length > 0 ? UPSERT_CYPHER : UPSERT_NODE_ONLY_CYPHER, params);
  };
}
