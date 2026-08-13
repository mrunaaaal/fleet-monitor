import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startInterval } from '../interval-trigger.js';

test('fires onTick repeatedly at the given interval', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0;
  const stop = startInterval(1000, () => {
    calls += 1;
  });

  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  assert.equal(calls, 2);

  stop();
  t.mock.timers.tick(1000);
  assert.equal(calls, 2, 'no more ticks after stop');
});
