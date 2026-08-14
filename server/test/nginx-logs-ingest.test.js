import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNginxLogEntry, createNginxLogsIngestHandler } from '../ingest/nginx-logs.js';

const LINE = {
  time: '2024-01-01T00:00:00.000Z',
  remote_addr: '203.0.113.9',
  method: 'GET',
  path: '/api/health',
  status: 200,
  bytes_sent: 123,
  request_time: 0.042,
  referer: '-',
  user_agent: 'curl/8.0',
};

test('normalizeNginxLogEntry maps a parsed access-log line to a ClickHouse row', () => {
  const entry = normalizeNginxLogEntry(LINE);

  assert.deepEqual(entry, {
    ts: '2024-01-01 00:00:00.000',
    remote_addr: '203.0.113.9',
    method: 'GET',
    path: '/api/health',
    status: 200,
    bytes_sent: 123,
    request_time: 0.042,
    referer: '-',
    user_agent: 'curl/8.0',
  });
});

test('normalizeNginxLogEntry defaults optional fields', () => {
  const entry = normalizeNginxLogEntry({
    time: '2024-01-01T00:00:00.000Z',
    remote_addr: '203.0.113.9',
    method: 'GET',
    path: '/',
    status: 200,
  });

  assert.equal(entry.bytes_sent, 0);
  assert.equal(entry.request_time, 0);
  assert.equal(entry.referer, '');
  assert.equal(entry.user_agent, '');
});

test('normalizeNginxLogEntry throws when a required field is missing', () => {
  assert.throws(() => normalizeNginxLogEntry({ ...LINE, status: undefined }), /status/);
  assert.throws(() => normalizeNginxLogEntry({ ...LINE, path: undefined }), /path/);
});

test('createNginxLogsIngestHandler RPUSHes normalized JSON entries onto the edge-log buffer', async () => {
  const rpushCalls = [];
  const redis = { rpush: async (key, values) => (rpushCalls.push({ key, values }), values.length) };
  const ingestNginxLogs = createNginxLogsIngestHandler({ redis });

  await ingestNginxLogs({ lines: [LINE, LINE] });

  assert.equal(rpushCalls.length, 1);
  assert.equal(rpushCalls[0].key, 'nginxlogbuf');
  assert.equal(rpushCalls[0].values.length, 2);
  assert.deepEqual(JSON.parse(rpushCalls[0].values[0]).path, '/api/health');
});

test('createNginxLogsIngestHandler rejects a payload with an empty or missing lines array', async () => {
  const redis = { rpush: async () => 0 };
  const ingestNginxLogs = createNginxLogsIngestHandler({ redis });

  await assert.rejects(() => ingestNginxLogs({}), /lines/);
  await assert.rejects(() => ingestNginxLogs({ lines: [] }), /lines/);
});

test('createNginxLogsIngestHandler triggers an eager flush once the buffer crosses batchSize', async () => {
  const redis = { rpush: async () => 5 };
  const flushCalls = [];
  const flusher = { flushOnce: async () => flushCalls.push(1) };
  const ingestNginxLogs = createNginxLogsIngestHandler({ redis, flusher, batchSize: 5 });

  await ingestNginxLogs({ lines: [LINE] });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(flushCalls.length, 1);
});

test('createNginxLogsIngestHandler does not flush while the buffer stays under batchSize', async () => {
  const redis = { rpush: async () => 3 };
  const flushCalls = [];
  const flusher = { flushOnce: async () => flushCalls.push(1) };
  const ingestNginxLogs = createNginxLogsIngestHandler({ redis, flusher, batchSize: 5 });

  await ingestNginxLogs({ lines: [LINE] });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(flushCalls.length, 0);
});
