// Written once, consumed by both the Map page and the agent's
// get_dependencies/get_blast_radius/find_shared_dependency tools
// (fleet-monitor-docs.md §4.5, §6).
const MAX_HOPS = 8;

const DEPENDENCIES_CYPHER = `
  MATCH (a:Service {name: $service})-[:DEPENDS_ON]->(b:Service)
  RETURN b.name AS service, b.tier AS tier
  ORDER BY b.name
`;

// The query that justifies the whole store (fleet-monitor-docs.md §4.5):
// walk DEPENDS_ON backwards from the failing service to find everything
// upstream of it, with hop distance (closest path per affected service)
// and tier so severity ("which user-facing services are affected") can
// be read straight off the result.
const BLAST_RADIUS_CYPHER = `
  MATCH path = (down:Service {name: $service})<-[:DEPENDS_ON*1..${MAX_HOPS}]-(affected:Service)
  RETURN affected.name AS service,
         affected.tier AS tier,
         min(length(path)) AS hops
  ORDER BY hops, service
`;

// Narrowing query for diamond/multi-failure incidents: given several
// independently-alerting services, find the downstream service(s) all of
// them depend on — the candidate that turns "these four are alerting"
// into "one common cause".
const SHARED_DEPENDENCY_CYPHER = `
  UNWIND $services AS name
  MATCH (s:Service {name: name})-[:DEPENDS_ON*1..${MAX_HOPS}]->(candidate:Service)
  WITH candidate, count(DISTINCT name) AS covers
  WHERE covers = size($services)
  RETURN candidate.name AS service, covers
  ORDER BY service
`;

// The whole-mesh query for the Map page (spec issue #11): every service as
// a node and every DEPENDS_ON relationship as an edge, so the frontend can
// render the graph itself rather than assembling it from per-service calls.
const ALL_NODES_CYPHER = `
  MATCH (a:Service)
  RETURN a.name AS service, a.tier AS tier
  ORDER BY a.name
`;

const ALL_EDGES_CYPHER = `
  MATCH (a:Service)-[:DEPENDS_ON]->(b:Service)
  RETURN a.name AS from, b.name AS to
  ORDER BY from, to
`;

// Aggregate/traversal-length results come back as neo4j-driver Integer
// objects, not plain numbers — this project's values are always small
// enough for toNumber() to be safe.
function toNumber(value) {
  return value != null && typeof value.toNumber === 'function' ? value.toNumber() : value;
}

export function createDependenciesQuery({ neo4j }) {
  return async function queryDependencies({ service } = {}) {
    if (!service) throw new Error('queryDependencies requires a service');
    const rows = await neo4j.run(DEPENDENCIES_CYPHER, { service });
    return rows.map((row) => ({ service: row.service, tier: row.tier }));
  };
}

export function createBlastRadiusQuery({ neo4j }) {
  return async function queryBlastRadius({ service } = {}) {
    if (!service) throw new Error('queryBlastRadius requires a service');
    const rows = await neo4j.run(BLAST_RADIUS_CYPHER, { service });
    return rows.map((row) => ({ service: row.service, tier: row.tier, hops: toNumber(row.hops) }));
  };
}

export function createSharedDependencyQuery({ neo4j }) {
  return async function querySharedDependency({ services } = {}) {
    if (!services || services.length === 0) {
      throw new Error('querySharedDependency requires a non-empty services list');
    }
    const rows = await neo4j.run(SHARED_DEPENDENCY_CYPHER, { services });
    return rows.map((row) => ({ service: row.service, covers: toNumber(row.covers) }));
  };
}

export function createGraphQuery({ neo4j }) {
  return async function queryGraph() {
    const [nodeRows, edgeRows] = await Promise.all([
      neo4j.run(ALL_NODES_CYPHER),
      neo4j.run(ALL_EDGES_CYPHER),
    ]);
    return {
      nodes: nodeRows.map((row) => ({ service: row.service, tier: row.tier })),
      edges: edgeRows.map((row) => ({ from: row.from, to: row.to })),
    };
  };
}
