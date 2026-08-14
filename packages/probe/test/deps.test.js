import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDepsReporter, DEPS_INTERVAL_MS } from '../deps.js';

test('fires onTick with the configured downstream targets every DEPS_INTERVAL_MS', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const seen = [];
  const stop = startDepsReporter({ downstream: ['api-gateway'], onTick: (d) => seen.push(d) });

  t.mock.timers.tick(DEPS_INTERVAL_MS);
  assert.deepEqual(seen, [['api-gateway']]);

  stop();
});

test('defaults to an empty downstream list', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const seen = [];
  const stop = startDepsReporter({ onTick: (d) => seen.push(d) });

  t.mock.timers.tick(DEPS_INTERVAL_MS);
  assert.deepEqual(seen, [[]]);

  stop();
});

test('ships topology tagged with the service name, tier, and downstream targets on each tick', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const shipped = [];

  const stop = startDepsReporter({
    serviceName: 'web',
    tier: 'user-facing',
    downstream: ['api-gateway'],
    shipTopology: async (payload) => shipped.push(payload),
  });

  t.mock.timers.tick(DEPS_INTERVAL_MS);
  await new Promise((resolve) => setImmediate(resolve));
  stop();

  assert.deepEqual(shipped, [{ service: 'web', tier: 'user-facing', downstream: ['api-gateway'] }]);
});

test('ships topology without a tier when none is given', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const shipped = [];

  const stop = startDepsReporter({
    serviceName: 'ledger-db',
    downstream: [],
    shipTopology: async (payload) => shipped.push(payload),
  });

  t.mock.timers.tick(DEPS_INTERVAL_MS);
  await new Promise((resolve) => setImmediate(resolve));
  stop();

  assert.deepEqual(shipped, [{ service: 'ledger-db', downstream: [] }]);
});

test('does not throw when shipTopology rejects', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const stop = startDepsReporter({
    serviceName: 'web',
    shipTopology: async () => {
      throw new Error('ingest unreachable');
    },
  });

  assert.doesNotThrow(() => t.mock.timers.tick(DEPS_INTERVAL_MS));
  stop();
  await new Promise((resolve) => setImmediate(resolve));
});
