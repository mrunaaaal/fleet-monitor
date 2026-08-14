import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { createNeo4jClient } from '../db/neo4j.js';
import { runNeo4jMigrations } from '../db/neo4j-migrate.js';
import { createDependenciesQuery } from '../query/topology.js';

// Seam 1 (spec issue #8, mirroring the metrics/heartbeat/logs seams from
// #4/#5/#7): post probe-shaped topology payloads to /v1/topology, read
// them back through queryDependencies, assert the edges. Runs against a
// real Neo4j — mocking the store would prove nothing about the MERGE
// upsert or the Cypher traversal.
// Requires NEO4J_URL to point at a live Neo4j instance, e.g.
// `docker compose up -d neo4j` (defaults to bolt://localhost:7687,
// matching .env.example).
test('Seam 1: a reported downstream target is retrievable through queryDependencies', async () => {
  const neo4j = createNeo4jClient();
  await runNeo4jMigrations({ neo4j });

  const app = buildApp({ neo4j });
  const queryDependencies = createDependenciesQuery({ neo4j });

  const suffix = Date.now();
  const from = `seam1-web-${suffix}`;
  const to = `seam1-gateway-${suffix}`;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/topology',
    payload: { service: from, tier: 'user-facing', downstream: [to] },
  });
  assert.equal(res.statusCode, 202);
  await app.inject({
    method: 'POST',
    url: '/v1/topology',
    payload: { service: to, tier: 'internal', downstream: [] },
  });

  const deps = await queryDependencies({ service: from });

  assert.deepEqual(deps, [{ service: to, tier: 'internal' }]);

  await app.close();
  await neo4j.close();
});

test('Seam 1: re-reporting the same edge does not duplicate it', async () => {
  const neo4j = createNeo4jClient();
  await runNeo4jMigrations({ neo4j });

  const app = buildApp({ neo4j });
  const queryDependencies = createDependenciesQuery({ neo4j });

  const suffix = Date.now();
  const from = `seam1-retag-${suffix}`;
  const to = `seam1-retag-target-${suffix}`;

  await app.inject({
    method: 'POST',
    url: '/v1/topology',
    payload: { service: from, tier: 'internal', downstream: [to] },
  });
  await app.inject({
    method: 'POST',
    url: '/v1/topology',
    payload: { service: from, tier: 'internal', downstream: [to] },
  });

  const deps = await queryDependencies({ service: from });

  assert.equal(deps.length, 1);

  await app.close();
  await neo4j.close();
});
