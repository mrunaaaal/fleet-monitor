import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMetricsSampler, METRICS_INTERVAL_MS } from '../metrics.js';

test('fires onTick every METRICS_INTERVAL_MS', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0;
  const stop = startMetricsSampler({ onTick: () => (calls += 1) });

  t.mock.timers.tick(METRICS_INTERVAL_MS);
  t.mock.timers.tick(METRICS_INTERVAL_MS);
  assert.equal(calls, 2);

  stop();
});

test('defaults onTick to a no-op so a service can start the probe with no hooks', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const stop = startMetricsSampler();
  assert.doesNotThrow(() => t.mock.timers.tick(METRICS_INTERVAL_MS));
  stop();
});
