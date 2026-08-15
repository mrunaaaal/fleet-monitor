import { reportOnTrigger, intervalTrigger } from './report-on-trigger.js';

export const METRICS_INTERVAL_MS = 15_000;

// Tracks request/error counts and a latency histogram in memory, plus
// CPU/heap sampling, reset on every sample() call so p95 is computed at
// the source from that interval's requests rather than reconstructed
// later from raw datapoints.
export function createMetricsRecorder({
  now = () => process.hrtime.bigint(),
  cpuUsage = () => process.cpuUsage(),
  memoryUsage = () => process.memoryUsage(),
} = {}) {
  let requestCount = 0;
  let errorCount = 0;
  let latencies = [];
  let lastCpu = cpuUsage();
  let lastTime = now();

  function recordRequest({ latencyMs, isError = false } = {}) {
    requestCount += 1;
    if (isError) errorCount += 1;
    if (typeof latencyMs === 'number') latencies.push(latencyMs);
  }

  function sample() {
    const currentTime = now();
    const currentCpu = cpuUsage();
    const elapsedMs = Number(currentTime - lastTime) / 1e6;
    const cpuMs = (currentCpu.user - lastCpu.user + (currentCpu.system - lastCpu.system)) / 1000;
    lastTime = currentTime;
    lastCpu = currentCpu;

    const metrics = {
      cpu_pct: elapsedMs > 0 ? (cpuMs / elapsedMs) * 100 : 0,
      mem_mb: memoryUsage().heapUsed / (1024 * 1024),
      req_per_sec: elapsedMs > 0 ? requestCount / (elapsedMs / 1000) : 0,
      error_rate: requestCount === 0 ? 0 : errorCount / requestCount,
      p95_latency_ms: percentile(latencies, 0.95),
    };

    requestCount = 0;
    errorCount = 0;
    latencies = [];

    return metrics;
  }

  return { recordRequest, sample };
}

// Nearest-rank percentile over a small in-memory sample set (bounded by
// one interval's request volume, so sorting on read is cheap).
function percentile(samples, p) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

// Fires on a 15s interval: samples the recorder and hands the result to
// onTick, then ships it via shipMetrics (e.g. POST /v1/metrics) if given.
// Shipping failures are swallowed — a dead ingest endpoint shouldn't crash
// the service being monitored.
export function startMetricsSampler({
  intervalMs = METRICS_INTERVAL_MS,
  recorder = createMetricsRecorder(),
  onTick = () => {},
  shipMetrics,
  serviceName,
  host,
} = {}) {
  return reportOnTrigger({
    trigger: intervalTrigger(intervalMs, () => recorder.sample()),
    onTick,
    ship: shipMetrics && ((metrics) => shipMetrics({ service: serviceName, host, ...metrics })),
    serviceName,
    kind: 'metrics',
  });
}
