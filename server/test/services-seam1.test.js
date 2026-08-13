import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { createPostgresClient } from '../db/postgres.js';
import { runMigrations } from '../db/migrate.js';
import { createListServicesQuery } from '../query/services.js';

// Seam 1 (spec issue #6, mirroring the heartbeat/liveness seam from #5):
// post a probe-shaped heartbeat payload to /v1/heartbeat, read it back
// through listServices, assert the registry row. Runs against a real
// Postgres — mocking the store would prove nothing about the upsert SQL.
// Requires POSTGRES_URL to point at a live Postgres instance, e.g.
// `docker compose up -d postgres` (defaults to
// postgres://fleet:changeme@localhost:5432/fleet_monitor, matching
// .env.example). Redis is stubbed — this seam is about the Postgres
// registry, not liveness, which #5 already covers.
test('Seam 1: a heartbeating service appears in the registry with its tier', async () => {
  const postgres = createPostgresClient();
  await runMigrations({ postgres });

  const app = buildApp({ postgres, redis: { setWithTtl: async () => {} } });
  const listServices = createListServicesQuery({ postgres });

  const service = `seam1-web-${Date.now()}`;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/heartbeat',
    payload: { service, tier: 'user-facing' },
  });
  assert.equal(res.statusCode, 202);

  const services = await listServices();
  const registered = services.find((s) => s.name === service);

  assert.deepEqual(registered, { name: service, tier: 'user-facing' });

  await app.close();
  await postgres.close();
});

test('Seam 1: a second heartbeat updates the tier without duplicating the row', async () => {
  const postgres = createPostgresClient();
  await runMigrations({ postgres });

  const app = buildApp({ postgres, redis: { setWithTtl: async () => {} } });
  const listServices = createListServicesQuery({ postgres });

  const service = `seam1-retag-${Date.now()}`;

  await app.inject({ method: 'POST', url: '/v1/heartbeat', payload: { service, tier: 'internal' } });
  await app.inject({ method: 'POST', url: '/v1/heartbeat', payload: { service, tier: 'datastore' } });

  const services = await listServices();
  const matches = services.filter((s) => s.name === service);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].tier, 'datastore');

  await app.close();
  await postgres.close();
});

test('Seam 1: first_seen is set once and last_seen advances on later heartbeats', async () => {
  const postgres = createPostgresClient();
  await runMigrations({ postgres });

  const app = buildApp({ postgres, redis: { setWithTtl: async () => {} } });

  const service = `seam1-timestamps-${Date.now()}`;
  const selectSql = 'SELECT first_seen, last_seen FROM services WHERE name = $1';

  await app.inject({ method: 'POST', url: '/v1/heartbeat', payload: { service, tier: 'internal' } });
  const [firstRow] = await postgres.query(selectSql, [service]);

  await new Promise((resolve) => setTimeout(resolve, 10));
  await app.inject({ method: 'POST', url: '/v1/heartbeat', payload: { service, tier: 'internal' } });
  const [secondRow] = await postgres.query(selectSql, [service]);

  assert.deepEqual(secondRow.first_seen, firstRow.first_seen, 'first_seen must not move on later heartbeats');
  assert.ok(
    new Date(secondRow.last_seen) > new Date(firstRow.last_seen),
    'last_seen must advance on each heartbeat',
  );

  await app.close();
  await postgres.close();
});
