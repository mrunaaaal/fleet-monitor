import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startProbe } from '../index.js';

test('requires a serviceName', () => {
  assert.throws(() => startProbe({}), /serviceName/);
});

test('wires metrics, deps, heartbeat, and logger together', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const events = { metrics: 0, deps: [], heartbeat: 0, logs: [] };

  const probe = startProbe({
    serviceName: 'web',
    downstream: ['api-gateway'],
    hooks: {
      onMetricsTick: () => (events.metrics += 1),
      onDepsTick: (downstream) => events.deps.push(downstream),
      onHeartbeatTick: () => (events.heartbeat += 1),
      onLogFlush: (batch) => events.logs.push(batch),
    },
  });

  t.mock.timers.tick(60_000);
  probe.log('hello');
  probe.stop();

  assert.ok(events.metrics >= 1);
  assert.deepEqual(events.deps[0], ['api-gateway']);
  assert.ok(events.heartbeat >= 1);
  assert.deepEqual(events.logs, [['hello']]);
});

test('exposes recordRequest and ships metrics tagged with serviceName/host', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const shipped = [];

  const probe = startProbe({
    serviceName: 'web',
    host: 'local',
    shipMetrics: async (payload) => shipped.push(payload),
  });

  probe.recordRequest({ latencyMs: 12, isError: false });
  t.mock.timers.tick(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  probe.stop();

  assert.ok(shipped.length >= 1);
  assert.equal(shipped[0].service, 'web');
  assert.equal(shipped[0].host, 'local');
});

test('ships heartbeats tagged with serviceName', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const shipped = [];

  const probe = startProbe({
    serviceName: 'web',
    shipHeartbeat: async (payload) => shipped.push(payload),
  });

  t.mock.timers.tick(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  probe.stop();

  assert.ok(shipped.length >= 1);
  assert.equal(shipped[0].service, 'web');
});

test('ships heartbeats tagged with tier when one is given', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const shipped = [];

  const probe = startProbe({
    serviceName: 'web',
    tier: 'user-facing',
    shipHeartbeat: async (payload) => shipped.push(payload),
  });

  t.mock.timers.tick(60_000);
  await new Promise((resolve) => setImmediate(resolve));
  probe.stop();

  assert.ok(shipped.length >= 1);
  assert.equal(shipped[0].tier, 'user-facing');
});

test('ships flushed logs tagged with serviceName', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const shipped = [];

  const probe = startProbe({
    serviceName: 'web',
    shipLogs: async (payload) => shipped.push(payload),
  });

  probe.log('hello');
  probe.stop();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(shipped, [{ service: 'web', lines: ['hello'] }]);
});

test('works with no hooks at all', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const probe = startProbe({ serviceName: 'web' });
  assert.doesNotThrow(() => {
    t.mock.timers.tick(60_000);
    probe.log('line');
    probe.stop();
  });
});
