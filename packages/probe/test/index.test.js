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

test('works with no hooks at all', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const probe = startProbe({ serviceName: 'web' });
  assert.doesNotThrow(() => {
    t.mock.timers.tick(60_000);
    probe.log('line');
    probe.stop();
  });
});
