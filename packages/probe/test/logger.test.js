import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLogger, LOG_FLUSH_INTERVAL_MS, LOG_FLUSH_SIZE } from '../logger.js';

test('flushes on the size trigger without waiting for the timer', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const flushes = [];
  const { log, stop } = startLogger({ onFlush: (batch) => flushes.push(batch) });

  for (let i = 0; i < LOG_FLUSH_SIZE; i += 1) log(`line ${i}`);

  assert.equal(flushes.length, 1);
  assert.equal(flushes[0].length, LOG_FLUSH_SIZE);
  stop();
});

test('flushes on the time trigger even under the size threshold', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const flushes = [];
  const { log, stop } = startLogger({ onFlush: (batch) => flushes.push(batch) });

  log('one line');
  t.mock.timers.tick(LOG_FLUSH_INTERVAL_MS);

  assert.deepEqual(flushes, [['one line']]);
  stop();
});

test('does not flush an empty buffer on the timer', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const flushes = [];
  const { stop } = startLogger({ onFlush: (batch) => flushes.push(batch) });

  t.mock.timers.tick(LOG_FLUSH_INTERVAL_MS);
  t.mock.timers.tick(LOG_FLUSH_INTERVAL_MS);

  assert.equal(flushes.length, 0);
  stop();
});

test('starts a fresh buffer after each flush', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const flushes = [];
  const { log, stop } = startLogger({ onFlush: (batch) => flushes.push(batch) });

  log('a');
  t.mock.timers.tick(LOG_FLUSH_INTERVAL_MS);
  log('b');
  t.mock.timers.tick(LOG_FLUSH_INTERVAL_MS);

  assert.deepEqual(flushes, [['a'], ['b']]);
  stop();
});

test('stop flushes any remaining buffered lines', () => {
  const flushes = [];
  const { log, stop } = startLogger({ onFlush: (batch) => flushes.push(batch) });

  log('leftover');
  stop();

  assert.deepEqual(flushes, [['leftover']]);
});

test('stop is a no-op flush when the buffer is empty', () => {
  const flushes = [];
  const { stop } = startLogger({ onFlush: (batch) => flushes.push(batch) });

  stop();

  assert.equal(flushes.length, 0);
});
