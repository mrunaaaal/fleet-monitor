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
