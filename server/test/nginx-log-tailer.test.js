import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNginxLogTailer } from '../nginx-log-tailer.js';

function fakeIo({ sizes, contents = [] }) {
  const stats = [...sizes];
  const chunks = [...contents];
  const fetchCalls = [];
  return {
    statFn: () => ({ size: stats.shift() }),
    readBytesFn: async () => chunks.shift(),
    fetchImpl: async (url, opts) => {
      fetchCalls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true };
    },
    fetchCalls,
  };
}

test('pollOnce sets the initial offset without shipping on the first call', async () => {
  const { statFn, readBytesFn, fetchImpl, fetchCalls } = fakeIo({ sizes: [0] });
  const tailer = createNginxLogTailer({ accessLogPath: '/x', ingestUrl: 'http://ingest', statFn, readBytesFn, fetchImpl });

  await tailer.pollOnce();

  assert.equal(fetchCalls.length, 0);
});

test('pollOnce ships a batch once flushBatchSize is reached', async () => {
  const line = '{"status":200,"path":"/api/health"}\n';
  const { statFn, readBytesFn, fetchImpl, fetchCalls } = fakeIo({
    sizes: [0, line.length, line.length],
    contents: [line],
  });
  const tailer = createNginxLogTailer({
    accessLogPath: '/x',
    ingestUrl: 'http://ingest',
    statFn,
    readBytesFn,
    fetchImpl,
    flushBatchSize: 1,
  });

  await tailer.pollOnce();
  await tailer.pollOnce();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'http://ingest/v1/nginx-logs');
  assert.deepEqual(fetchCalls[0].body, { lines: [{ status: 200, path: '/api/health' }] });
});

test('pollOnce ships a batch once flushIntervalMs has elapsed, even under flushBatchSize', async () => {
  const line = '{"status":200,"path":"/api/health"}\n';
  const { statFn, readBytesFn, fetchImpl, fetchCalls } = fakeIo({
    sizes: [0, line.length, line.length],
    contents: [line],
  });
  const tailer = createNginxLogTailer({
    accessLogPath: '/x',
    ingestUrl: 'http://ingest',
    statFn,
    readBytesFn,
    fetchImpl,
    flushBatchSize: 100,
    flushIntervalMs: 0,
  });

  await tailer.pollOnce();
  await tailer.pollOnce();
  await tailer.pollOnce();

  assert.equal(fetchCalls.length, 1);
});

test('pollOnce carries a partial trailing line across calls', async () => {
  const first = '{"status":200,';
  const second = '"path":"/api/health"}\n';
  const { statFn, readBytesFn, fetchImpl, fetchCalls } = fakeIo({
    sizes: [0, first.length, first.length + second.length, first.length + second.length],
    contents: [first, second],
  });
  const tailer = createNginxLogTailer({
    accessLogPath: '/x',
    ingestUrl: 'http://ingest',
    statFn,
    readBytesFn,
    fetchImpl,
    flushBatchSize: 1,
  });

  await tailer.pollOnce();
  await tailer.pollOnce();
  await tailer.pollOnce();

  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(fetchCalls[0].body.lines, [{ status: 200, path: '/api/health' }]);
});

test('pollOnce does nothing when the file has not grown', async () => {
  const { statFn, readBytesFn, fetchImpl, fetchCalls } = fakeIo({ sizes: [10, 10] });
  const tailer = createNginxLogTailer({ accessLogPath: '/x', ingestUrl: 'http://ingest', statFn, readBytesFn, fetchImpl });

  await tailer.pollOnce();
  await tailer.pollOnce();

  assert.equal(fetchCalls.length, 0);
});

test('pollOnce is a no-op when statFn throws (file not yet created)', async () => {
  const fetchCalls = [];
  const tailer = createNginxLogTailer({
    accessLogPath: '/missing',
    ingestUrl: 'http://ingest',
    statFn: () => {
      throw new Error('ENOENT');
    },
    readBytesFn: async () => '',
    fetchImpl: async (url, opts) => (fetchCalls.push({ url, opts }), { ok: true }),
  });

  await tailer.pollOnce();

  assert.equal(fetchCalls.length, 0);
});
