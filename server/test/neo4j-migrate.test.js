import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNeo4jClient } from '../db/neo4j.js';
import { runNeo4jMigrations } from '../db/neo4j-migrate.js';

// Requires NEO4J_URL/NEO4J_USER/NEO4J_PASSWORD to point at a live Neo4j
// instance, e.g. `docker compose up -d neo4j` (defaults match
// .env.example).
test('runNeo4jMigrations creates the service_name uniqueness constraint, idempotently', async () => {
  const neo4j = createNeo4jClient();

  await runNeo4jMigrations({ neo4j });
  await runNeo4jMigrations({ neo4j }); // re-running must not throw

  const rows = await neo4j.run('SHOW CONSTRAINTS YIELD name WHERE name = $name', { name: 'service_name' });
  assert.equal(rows.length, 1);

  await neo4j.close();
});
