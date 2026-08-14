import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { createNeo4jClient } from '../db/neo4j.js';
import { runNeo4jMigrations } from '../db/neo4j-migrate.js';
import { createBlastRadiusQuery, createSharedDependencyQuery } from '../query/topology.js';
import { services, downstreamName } from '../../mesh/config.js';

// Acceptance criterion (spec issue #8): blast radius and shared
// dependency asserted on the known diamond topology (mesh/config.js,
// fleet-monitor-docs.md §3.1) — payments and inventory both depend on
// ledger-db, so a ledger-db failure has two independent-looking upstream
// paths that should collapse back into one shared dependency.
// Requires NEO4J_URL to point at a live Neo4j instance, e.g.
// `docker compose up -d neo4j`.
test('blast radius and shared dependency are correct on the mesh diamond', async () => {
  const neo4j = createNeo4jClient();
  await runNeo4jMigrations({ neo4j });

  const app = buildApp({ neo4j });
  const queryBlastRadius = createBlastRadiusQuery({ neo4j });
  const querySharedDependency = createSharedDependencyQuery({ neo4j });

  const suffix = `diamond-${Date.now()}`;
  const tagged = (name) => `${name}-${suffix}`;

  for (const service of services) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/topology',
      payload: {
        service: tagged(service.name),
        tier: service.tier,
        downstream: (service.downstream ?? []).map((entry) => tagged(downstreamName(entry))),
      },
    });
    assert.equal(res.statusCode, 202);
  }

  const blastRadius = await queryBlastRadius({ service: tagged('ledger-db') });
  const byService = Object.fromEntries(blastRadius.map((row) => [row.service, row]));

  assert.deepEqual(byService[tagged('payments')], { service: tagged('payments'), tier: 'internal', hops: 1 });
  assert.deepEqual(byService[tagged('inventory')], { service: tagged('inventory'), tier: 'internal', hops: 1 });
  assert.deepEqual(
    byService[tagged('api-gateway')],
    { service: tagged('api-gateway'), tier: 'internal', hops: 2 },
  );
  assert.deepEqual(byService[tagged('web')], { service: tagged('web'), tier: 'user-facing', hops: 3 });
  assert.deepEqual(byService[tagged('checkout')], { service: tagged('checkout'), tier: 'user-facing', hops: 3 });
  assert.equal(blastRadius.length, 5, 'auth-service/session-store must not appear: they are not upstream of ledger-db');

  const sharedDependency = await querySharedDependency({
    services: [tagged('payments'), tagged('inventory')],
  });

  assert.deepEqual(sharedDependency, [{ service: tagged('ledger-db'), covers: 2 }]);

  await app.close();
  await neo4j.close();
});
