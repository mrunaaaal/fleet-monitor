import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeartbeatIngestHandler } from '../ingest/heartbeat.js';

test('createHeartbeatIngestHandler SETs alive:{service} with a 45s TTL by default', async () => {
  const calls = [];
  const ingestHeartbeat = createHeartbeatIngestHandler({
    redis: { setWithTtl: async (key, value, ttlSeconds) => calls.push({ key, value, ttlSeconds }) },
  });

  await ingestHeartbeat({ service: 'web' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'alive:web');
  assert.equal(calls[0].ttlSeconds, 45);
  assert.ok(typeof calls[0].value === 'string' && calls[0].value.length > 0);
});

test('createHeartbeatIngestHandler rejects a payload missing service', async () => {
  const ingestHeartbeat = createHeartbeatIngestHandler({
    redis: { setWithTtl: async () => {} },
  });

  await assert.rejects(() => ingestHeartbeat({}), /service/);
});

test('createHeartbeatIngestHandler accepts a ttlSeconds override', async () => {
  const calls = [];
  const ingestHeartbeat = createHeartbeatIngestHandler({
    redis: { setWithTtl: async (key, value, ttlSeconds) => calls.push({ key, value, ttlSeconds }) },
    ttlSeconds: 1,
  });

  await ingestHeartbeat({ service: 'web' });

  assert.equal(calls[0].ttlSeconds, 1);
});
