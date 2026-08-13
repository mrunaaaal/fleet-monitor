import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLineProtocol, createMetricsIngestHandler } from '../ingest/metrics.js';

const SAMPLE_PAYLOAD = {
  service: 'web',
  host: 'local',
  cpu_pct: 12.5,
  mem_mb: 88.25,
  req_per_sec: 5.1,
  error_rate: 0.2,
  p95_latency_ms: 42,
};

test('toLineProtocol encodes service/host as tags and the five metrics as fields', () => {
  const line = toLineProtocol(SAMPLE_PAYLOAD);

  assert.equal(
    line,
    'metrics,service=web,host=local cpu_pct=12.5,mem_mb=88.25,req_per_sec=5.1,error_rate=0.2,p95_latency_ms=42',
  );
});

test('toLineProtocol never promotes an extra payload field to a tag — only service/host are tags', () => {
  const line = toLineProtocol({ ...SAMPLE_PAYLOAD, requestId: 'req-9f3a-unbounded' });

  assert.ok(!line.includes('requestId'), 'unbounded fields must never reach the tag set or line at all');
  const [tagSection] = line.split(' ');
  assert.equal(tagSection, 'metrics,service=web,host=local');
});

test('toLineProtocol escapes spaces, commas, and equals signs in tag values', () => {
  const line = toLineProtocol({ ...SAMPLE_PAYLOAD, service: 'web, prod=1' });

  assert.ok(
    line.startsWith('metrics,service=web\\,\\ prod\\=1,host=local '),
    `expected escaped tag section, got: ${line}`,
  );
});

test('createMetricsIngestHandler writes the encoded line via the injected influx client', async () => {
  const written = [];
  const ingestMetrics = createMetricsIngestHandler({
    influx: { writeLineProtocol: async (line) => written.push(line) },
  });

  await ingestMetrics(SAMPLE_PAYLOAD);

  assert.equal(written.length, 1);
  assert.ok(written[0].startsWith('metrics,service=web,host=local'));
});

test('createMetricsIngestHandler rejects a payload missing a required field', async () => {
  const ingestMetrics = createMetricsIngestHandler({
    influx: { writeLineProtocol: async () => {} },
  });

  const { cpu_pct, ...incomplete } = SAMPLE_PAYLOAD;

  await assert.rejects(() => ingestMetrics(incomplete), /cpu_pct/);
});
