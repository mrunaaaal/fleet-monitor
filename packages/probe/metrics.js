import { startInterval } from './interval-trigger.js';

export const METRICS_INTERVAL_MS = 15_000;

// Skeleton: fires on a 15s interval so every service has the scaffolding
// in place. Sampling CPU/heap/request-count/error-count/p95 and shipping
// to `POST /v1/metrics` lands with the metrics-path ticket.
export function startMetricsSampler({ intervalMs = METRICS_INTERVAL_MS, onTick = () => {} } = {}) {
  return startInterval(intervalMs, onTick);
}
