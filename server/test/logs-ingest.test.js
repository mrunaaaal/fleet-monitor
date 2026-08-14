import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLogEntry, createLogsIngestHandler } from '../ingest/logs.js';

test('normalizeLogEntry treats a bare string line as the message, defaulting level to info', () => {
  const entry = normalizeLogEntry('web', 'connection timeout');

  assert.equal(entry.service, 'web');
  assert.equal(entry.level, 'info');
  assert.equal(entry.message, 'connection timeout');
  assert.equal(entry.trace_id, '');
  assert.ok(entry.ts);
});

test('normalizeLogEntry preserves level/message/trace_id/ts from an object line', () => {
  const entry = normalizeLogEntry('web', {
    level: 'error',
    message: 'pool exhausted',
    trace_id: 'abc-123',
    ts: '2024-01-01T00:00:00.000Z',
  });

  assert.deepEqual(entry, {
    ts: '2024-01-01 00:00:00.000',
    service: 'web',
    level: 'error',
    message: 'pool exhausted',
    trace_id: 'abc-123',
  });
});

test('normalizeLogEntry throws for an object line missing a message', () => {
  assert.throws(() => normalizeLogEntry('web', { level: 'error' }), /message/);
});

test('createLogsIngestHandler RPUSHes normalized JSON entries onto logbuf', async () => {
  const rpushCalls = [];
  const redis = { rpush: async (key, values) => (rpushCalls.push({ key, values }), values.length) };
  const ingestLogs = createLogsIngestHandler({ redis });

  await ingestLogs({ service: 'web', lines: ['one', 'two'] });

  assert.equal(rpushCalls.length, 1);
  assert.equal(rpushCalls[0].key, 'logbuf');
  assert.equal(rpushCalls[0].values.length, 2);
  assert.deepEqual(JSON.parse(rpushCalls[0].values[0]).message, 'one');
});

test('createLogsIngestHandler rejects a payload missing service', async () => {
  const redis = { rpush: async () => 0 };
  const ingestLogs = createLogsIngestHandler({ redis });

  await assert.rejects(() => ingestLogs({ lines: ['x'] }), /service/);
});

test('createLogsIngestHandler rejects a payload with an empty or missing lines array', async () => {
  const redis = { rpush: async () => 0 };
  const ingestLogs = createLogsIngestHandler({ redis });

  await assert.rejects(() => ingestLogs({ service: 'web' }), /lines/);
  await assert.rejects(() => ingestLogs({ service: 'web', lines: [] }), /lines/);
});

test('createLogsIngestHandler triggers an eager flush once the buffer crosses batchSize', async () => {
  const redis = { rpush: async () => 5 };
  const flushCalls = [];
  const flusher = { flushOnce: async () => flushCalls.push(1) };
  const ingestLogs = createLogsIngestHandler({ redis, flusher, batchSize: 5 });

  await ingestLogs({ service: 'web', lines: ['one'] });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(flushCalls.length, 1);
});

test('createLogsIngestHandler does not flush while the buffer stays under batchSize', async () => {
  const redis = { rpush: async () => 3 };
  const flushCalls = [];
  const flusher = { flushOnce: async () => flushCalls.push(1) };
  const ingestLogs = createLogsIngestHandler({ redis, flusher, batchSize: 5 });

  await ingestLogs({ service: 'web', lines: ['one'] });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(flushCalls.length, 0);
});
