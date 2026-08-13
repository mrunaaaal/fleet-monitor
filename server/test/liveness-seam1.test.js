import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { createRedisClient } from '../db/redis.js';
import { createLivenessQuery } from '../query/liveness.js';

// Seam 1 (spec issue #1, "Testing Decisions" section): post a
// probe-shaped payload to the ingest endpoint, read it back through the
// query function, assert the result. Runs against a real Redis — no
// reaper process, so "death" is defined entirely by TTL expiry, and
// only a real store can prove that. Requires REDIS_URL to point at a
// live Redis, e.g. `docker compose up -d redis` (defaults to
// redis://localhost:6379).
test('Seam 1: a heartbeat posted to /v1/heartbeat reports up, then reports down once the TTL expires', async () => {
  const redis = createRedisClient();
  const app = buildApp({ redis, heartbeatTtlSeconds: 1 });
  const queryLiveness = createLivenessQuery({ redis });

  const service = `seam1-web-${Date.now()}`;

  const res = await app.inject({ method: 'POST', url: '/v1/heartbeat', payload: { service } });
  assert.equal(res.statusCode, 202);

  const upResult = await queryLiveness({ services: [service] });
  assert.deepEqual(upResult, [{ service, up: true }]);

  await new Promise((resolve) => setTimeout(resolve, 1300));

  const downResult = await queryLiveness({ services: [service] });
  assert.deepEqual(downResult, [{ service, up: false }]);

  await app.close();
  await redis.close();
});
