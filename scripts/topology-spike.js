import { createPostgresClient } from '../server/db/postgres.js';
import { createNeo4jClient } from '../server/db/neo4j.js';
import { services, downstreamName } from '../mesh/config.js';

// Comparison write-up #1 (fleet-monitor-docs.md §9): build blast radius
// (walking DEPENDS_ON backwards from a failing service) two ways on the
// real mesh diamond — a Postgres recursive CTE, and the Neo4j Cypher
// query/topology.js actually ships — both capped at depth 4 as the PRD's
// M4 milestone specifies, and time both. This is the timeboxed throwaway
// spike itself (fleet-monitor-docs.md §16, "Postgres first, every time");
// it writes its numbers to stdout for the write-up, not to a maintained
// benchmark suite.
const ITERATIONS = 500;
const DEPTH = 4;
const FAILING_SERVICE = 'ledger-db';
const EDGES_TABLE = 'topology_bench_edges';
const SERVICES_TABLE = 'topology_bench_services';

const postgres = createPostgresClient();
const neo4j = createNeo4jClient();

async function resetPostgres() {
  await postgres.query(`DROP TABLE IF EXISTS ${EDGES_TABLE}`);
  await postgres.query(`DROP TABLE IF EXISTS ${SERVICES_TABLE}`);
  await postgres.query(`CREATE TABLE ${SERVICES_TABLE} (name text PRIMARY KEY, tier text NOT NULL)`);
  await postgres.query(`
    CREATE TABLE ${EDGES_TABLE} (
      from_service text NOT NULL,
      to_service   text NOT NULL,
      PRIMARY KEY (from_service, to_service)
    )
  `);

  for (const service of services) {
    await postgres.query(`INSERT INTO ${SERVICES_TABLE} (name, tier) VALUES ($1, $2)`, [service.name, service.tier]);
    for (const entry of service.downstream ?? []) {
      await postgres.query(`INSERT INTO ${EDGES_TABLE} (from_service, to_service) VALUES ($1, $2)`, [
        service.name,
        downstreamName(entry),
      ]);
    }
  }
}

async function resetNeo4j() {
  await neo4j.run('MATCH (s:Service) WHERE s.name STARTS WITH "spike-" DETACH DELETE s');
  for (const service of services) {
    await neo4j.run('MERGE (a:Service {name: $name}) SET a.tier = $tier', {
      name: `spike-${service.name}`,
      tier: service.tier,
    });
  }
  for (const service of services) {
    for (const entry of service.downstream ?? []) {
      await neo4j.run(
        `
          MATCH (a:Service {name: $from}), (b:Service {name: $to})
          MERGE (a)-[:DEPENDS_ON]->(b)
        `,
        { from: `spike-${service.name}`, to: `spike-${downstreamName(entry)}` },
      );
    }
  }
}

const RECURSIVE_CTE_SQL = `
  WITH RECURSIVE upstream(name, hops) AS (
    SELECT e.from_service, 1
    FROM ${EDGES_TABLE} e
    WHERE e.to_service = $1
    UNION
    SELECT e.from_service, u.hops + 1
    FROM ${EDGES_TABLE} e
    JOIN upstream u ON e.to_service = u.name
    WHERE u.hops < ${DEPTH}
  )
  SELECT u.name AS service, s.tier AS tier, min(u.hops) AS hops
  FROM upstream u
  JOIN ${SERVICES_TABLE} s ON s.name = u.name
  GROUP BY u.name, s.tier
  ORDER BY hops, service
`;

const NEO4J_CYPHER = `
  MATCH path = (down:Service {name: $service})<-[:DEPENDS_ON*1..${DEPTH}]-(affected:Service)
  RETURN affected.name AS service, affected.tier AS tier, min(length(path)) AS hops
  ORDER BY hops, service
`;

async function timeIterations(label, fn) {
  const timings = [];
  let lastResult;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = process.hrtime.bigint();
    lastResult = await fn();
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsedMs);
  }
  timings.sort((a, b) => a - b);
  const sum = timings.reduce((a, b) => a + b, 0);
  return {
    label,
    result: lastResult,
    avgMs: sum / timings.length,
    minMs: timings[0],
    maxMs: timings[timings.length - 1],
    p95Ms: timings[Math.floor(timings.length * 0.95)],
  };
}

function report(stats) {
  console.log(
    `  ${stats.label}: avg ${stats.avgMs.toFixed(3)}ms, p95 ${stats.p95Ms.toFixed(3)}ms, ` +
      `min ${stats.minMs.toFixed(3)}ms, max ${stats.maxMs.toFixed(3)}ms (${ITERATIONS} iterations)`,
  );
}

async function main() {
  console.log(`Blast radius from '${FAILING_SERVICE}' at depth ${DEPTH}, ${ITERATIONS} iterations each\n`);

  console.log('Seeding Postgres recursive-CTE table...');
  await resetPostgres();
  console.log('Seeding Neo4j subgraph...');
  await resetNeo4j();

  console.log('\nTiming recursive CTE...');
  const cte = await timeIterations('recursive CTE (Postgres)', () =>
    postgres.query(RECURSIVE_CTE_SQL, [FAILING_SERVICE]),
  );
  report(cte);

  console.log('Timing Cypher traversal...');
  const cypher = await timeIterations('variable-length traversal (Neo4j)', () =>
    neo4j.run(NEO4J_CYPHER, { service: `spike-${FAILING_SERVICE}` }),
  );
  report(cypher);

  const cteRows = cte.result.map((r) => ({ service: r.service, tier: r.tier, hops: Number(r.hops) }));
  const cypherRows = cypher.result.map((r) => ({
    service: r.service.replace(/^spike-/, ''),
    tier: r.tier,
    hops: typeof r.hops?.toNumber === 'function' ? r.hops.toNumber() : r.hops,
  }));
  const rowsMatch = JSON.stringify(cteRows) === JSON.stringify(cypherRows.sort((a, b) => a.hops - b.hops || a.service.localeCompare(b.service)));

  console.log(`\nResults agree: ${rowsMatch}`);
  console.log('recursive CTE rows:', cteRows);
  console.log('Cypher rows:', cypherRows);

  console.log(
    '\n' +
      JSON.stringify(
        {
          ITERATIONS,
          DEPTH,
          FAILING_SERVICE,
          recursiveCte: { avgMs: cte.avgMs, p95Ms: cte.p95Ms, minMs: cte.minMs, maxMs: cte.maxMs },
          cypher: { avgMs: cypher.avgMs, p95Ms: cypher.p95Ms, minMs: cypher.minMs, maxMs: cypher.maxMs },
          rowsMatch,
        },
        null,
        2,
      ),
  );

  await postgres.query(`DROP TABLE IF EXISTS ${EDGES_TABLE}`);
  await postgres.query(`DROP TABLE IF EXISTS ${SERVICES_TABLE}`);
  await neo4j.run('MATCH (s:Service) WHERE s.name STARTS WITH "spike-" DETACH DELETE s');

  await postgres.close();
  await neo4j.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
