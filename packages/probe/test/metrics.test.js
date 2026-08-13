import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMetricsSampler, createMetricsRecorder, METRICS_INTERVAL_MS } from '../metrics.js';

function fakeClock(startNs = 0n) {
  let time = startNs;
  return { now: () => time, advanceMs: (ms) => { time += BigInt(ms) * 1_000_000n; } };
}

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

test('createMetricsRecorder: sample() reports zeroed stats before any request is recorded', () => {
  const clock = fakeClock();
  const recorder = createMetricsRecorder({
    now: clock.now,
    cpuUsage: () => ({ user: 0, system: 0 }),
    memoryUsage: () => ({ heapUsed: 0 }),
  });

  clock.advanceMs(1000);
  const metrics = recorder.sample();

  assert.equal(metrics.req_per_sec, 0);
  assert.equal(metrics.error_rate, 0);
  assert.equal(metrics.p95_latency_ms, 0);
});

test('createMetricsRecorder: sample() computes p95 latency by nearest-rank and resets the histogram', () => {
  const clock = fakeClock();
  const recorder = createMetricsRecorder({
    now: clock.now,
    cpuUsage: () => ({ user: 0, system: 0 }),
    memoryUsage: () => ({ heapUsed: 0 }),
  });

  for (let ms = 1; ms <= 20; ms += 1) recorder.recordRequest({ latencyMs: ms });
  clock.advanceMs(1000);

  const first = recorder.sample();
  assert.equal(first.p95_latency_ms, 19, 'nearest-rank p95 of 1..20ms is the 19th value');
  assert.equal(first.req_per_sec, 20);

  clock.advanceMs(1000);
  const second = recorder.sample();
  assert.equal(second.p95_latency_ms, 0, 'histogram is reset after each sample');
  assert.equal(second.req_per_sec, 0);
});

test('createMetricsRecorder: sample() computes error_rate as errorCount / requestCount', () => {
  const clock = fakeClock();
  const recorder = createMetricsRecorder({
    now: clock.now,
    cpuUsage: () => ({ user: 0, system: 0 }),
    memoryUsage: () => ({ heapUsed: 0 }),
  });

  recorder.recordRequest({ latencyMs: 5, isError: false });
  recorder.recordRequest({ latencyMs: 5, isError: true });
  recorder.recordRequest({ latencyMs: 5, isError: true });
  clock.advanceMs(1000);

  const metrics = recorder.sample();
  assert.equal(metrics.error_rate, 2 / 3);
});

test('createMetricsRecorder: sample() computes cpu_pct as CPU time used over elapsed wall time', () => {
  const clock = fakeClock();
  let usage = { user: 0, system: 0 };
  const recorder = createMetricsRecorder({
    now: clock.now,
    cpuUsage: () => usage,
    memoryUsage: () => ({ heapUsed: 0 }),
  });

  clock.advanceMs(1000);
  usage = { user: 400_000, system: 100_000 }; // 500ms of CPU time, in microseconds
  const metrics = recorder.sample();

  assert.equal(metrics.cpu_pct, 50);
});

test('ships sampled metrics tagged with service and host on each tick', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const shipped = [];
  const clock = fakeClock();
  const recorder = createMetricsRecorder({
    now: clock.now,
    cpuUsage: () => ({ user: 0, system: 0 }),
    memoryUsage: () => ({ heapUsed: 0 }),
  });

  const stop = startMetricsSampler({
    recorder,
    serviceName: 'web',
    host: 'local',
    shipMetrics: async (payload) => shipped.push(payload),
  });

  clock.advanceMs(METRICS_INTERVAL_MS);
  t.mock.timers.tick(METRICS_INTERVAL_MS);
  await new Promise((resolve) => setImmediate(resolve));

  stop();

  assert.equal(shipped.length, 1);
  assert.equal(shipped[0].service, 'web');
  assert.equal(shipped[0].host, 'local');
  assert.equal(shipped[0].p95_latency_ms, 0);
});

test('does not throw when shipMetrics rejects', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const stop = startMetricsSampler({
    serviceName: 'web',
    shipMetrics: async () => {
      throw new Error('ingest unreachable');
    },
  });

  assert.doesNotThrow(() => t.mock.timers.tick(METRICS_INTERVAL_MS));
  stop();
  // Let the rejected shipMetrics promise's .catch() run before the test exits.
  await new Promise((resolve) => setImmediate(resolve));
});

test('createMetricsRecorder: sample() reports mem_mb from heapUsed', () => {
  const clock = fakeClock();
  const recorder = createMetricsRecorder({
    now: clock.now,
    cpuUsage: () => ({ user: 0, system: 0 }),
    memoryUsage: () => ({ heapUsed: 10 * 1024 * 1024 }),
  });

  clock.advanceMs(1000);
  const metrics = recorder.sample();

  assert.equal(metrics.mem_mb, 10);
});
