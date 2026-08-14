import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFlusher, FLUSH_INTERVAL_MS, LOGBUF_KEY } from '../ingest/flusher.js';

function fakeStores(popped) {
  const calls = { lpopCount: [], insertRows: [] };
  const redis = {
    lpopCount: async (key, count) => {
      calls.lpopCount.push({ key, count });
      return popped;
    },
  };
  const clickhouse = {
    insertRows: async (table, rows) => calls.insertRows.push({ table, rows }),
  };
  return { redis, clickhouse, calls };
}

test('flushOnce LPOPs a batch and inserts it into ClickHouse as parsed rows', async () => {
  const raw = ['{"service":"web","message":"a"}', '{"service":"web","message":"b"}'];
  const { redis, clickhouse, calls } = fakeStores(raw);
  const flushed = [];
  const flusher = startFlusher({ redis, clickhouse, batchSize: 1000, onFlush: (n) => flushed.push(n) });

  await flusher.flushOnce();
  flusher.stop();

  assert.deepEqual(calls.lpopCount, [{ key: LOGBUF_KEY, count: 1000 }]);
  assert.equal(calls.insertRows.length, 1);
  assert.equal(calls.insertRows[0].table, 'logs');
  assert.deepEqual(calls.insertRows[0].rows, [
    { service: 'web', message: 'a' },
    { service: 'web', message: 'b' },
  ]);
  assert.deepEqual(flushed, [2]);
});

test('flushOnce is a no-op when the buffer is empty', async () => {
  const { redis, clickhouse, calls } = fakeStores([]);
  const flushed = [];
  const flusher = startFlusher({ redis, clickhouse, onFlush: (n) => flushed.push(n) });

  await flusher.flushOnce();
  flusher.stop();

  assert.equal(calls.insertRows.length, 0);
  assert.deepEqual(flushed, []);
});

test('the timer flushes on intervalMs', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const raw = ['{"service":"web","message":"a"}'];
  const { redis, clickhouse, calls } = fakeStores(raw);
  const flusher = startFlusher({ redis, clickhouse });

  t.mock.timers.tick(FLUSH_INTERVAL_MS);
  await new Promise((resolve) => setImmediate(resolve));
  flusher.stop();

  assert.equal(calls.insertRows.length, 1);
});

test('stop() clears the timer', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { redis, clickhouse, calls } = fakeStores([]);
  const flusher = startFlusher({ redis, clickhouse });

  flusher.stop();
  t.mock.timers.tick(FLUSH_INTERVAL_MS * 2);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.lpopCount.length, 0);
});
