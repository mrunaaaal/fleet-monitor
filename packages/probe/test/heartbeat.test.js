import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHeartbeat, HEARTBEAT_INTERVAL_MS } from '../heartbeat.js';

test('fires onTick every HEARTBEAT_INTERVAL_MS', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0;
  const stop = startHeartbeat({ onTick: () => (calls += 1) });

  t.mock.timers.tick(HEARTBEAT_INTERVAL_MS);
  t.mock.timers.tick(HEARTBEAT_INTERVAL_MS);
  assert.equal(calls, 2);

  stop();
});

test('ships a heartbeat tagged with the service name on each tick', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const shipped = [];

  const stop = startHeartbeat({
    serviceName: 'web',
    shipHeartbeat: async (payload) => shipped.push(payload),
  });

  t.mock.timers.tick(HEARTBEAT_INTERVAL_MS);
  await new Promise((resolve) => setImmediate(resolve));
  stop();

  assert.deepEqual(shipped, [{ service: 'web' }]);
});

test('ships a heartbeat tagged with the tier when one is given', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const shipped = [];

  const stop = startHeartbeat({
    serviceName: 'web',
    tier: 'user-facing',
    shipHeartbeat: async (payload) => shipped.push(payload),
  });

  t.mock.timers.tick(HEARTBEAT_INTERVAL_MS);
  await new Promise((resolve) => setImmediate(resolve));
  stop();

  assert.deepEqual(shipped, [{ service: 'web', tier: 'user-facing' }]);
});

test('does not throw when shipHeartbeat rejects', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const stop = startHeartbeat({
    serviceName: 'web',
    shipHeartbeat: async () => {
      throw new Error('ingest unreachable');
    },
  });

  assert.doesNotThrow(() => t.mock.timers.tick(HEARTBEAT_INTERVAL_MS));
  stop();
  await new Promise((resolve) => setImmediate(resolve));
});
