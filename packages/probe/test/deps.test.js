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
