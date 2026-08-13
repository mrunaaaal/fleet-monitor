import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeartbeatIngestHandler } from '../ingest/heartbeat.js';

function fakePostgres() {
  const calls = [];
  return { postgres: { query: async (text, params) => calls.push({ text, params }) }, calls };
}

test('createHeartbeatIngestHandler SETs alive:{service} with a 45s TTL by default', async () => {
  const calls = [];
  const { postgres } = fakePostgres();
  const ingestHeartbeat = createHeartbeatIngestHandler({
    redis: { setWithTtl: async (key, value, ttlSeconds) => calls.push({ key, value, ttlSeconds }) },
    postgres,
  });

  await ingestHeartbeat({ service: 'web', tier: 'user-facing' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'alive:web');
  assert.equal(calls[0].ttlSeconds, 45);
  assert.ok(typeof calls[0].value === 'string' && calls[0].value.length > 0);
});

test('createHeartbeatIngestHandler rejects a payload missing service', async () => {
  const { postgres } = fakePostgres();
  const ingestHeartbeat = createHeartbeatIngestHandler({
    redis: { setWithTtl: async () => {} },
    postgres,
  });

  await assert.rejects(() => ingestHeartbeat({ tier: 'user-facing' }), /service/);
});

test('createHeartbeatIngestHandler rejects a payload missing tier', async () => {
  const { postgres } = fakePostgres();
  const ingestHeartbeat = createHeartbeatIngestHandler({
    redis: { setWithTtl: async () => {} },
    postgres,
  });

  await assert.rejects(() => ingestHeartbeat({ service: 'web' }), /tier/);
});

test('createHeartbeatIngestHandler accepts a ttlSeconds override', async () => {
  const calls = [];
  const { postgres } = fakePostgres();
  const ingestHeartbeat = createHeartbeatIngestHandler({
    redis: { setWithTtl: async (key, value, ttlSeconds) => calls.push({ key, value, ttlSeconds }) },
    postgres,
    ttlSeconds: 1,
  });

  await ingestHeartbeat({ service: 'web', tier: 'user-facing' });

  assert.equal(calls[0].ttlSeconds, 1);
});

test('createHeartbeatIngestHandler upserts the service registry with name and tier', async () => {
  const { postgres, calls } = fakePostgres();
  const ingestHeartbeat = createHeartbeatIngestHandler({
    redis: { setWithTtl: async () => {} },
    postgres,
  });

  await ingestHeartbeat({ service: 'web', tier: 'user-facing' });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO services/);
  assert.match(calls[0].text, /ON CONFLICT \(name\) DO UPDATE/);
  assert.deepEqual(calls[0].params, ['web', 'user-facing']);
});
