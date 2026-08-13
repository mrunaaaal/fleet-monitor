import { startInterval } from './interval-trigger.js';

export const DEPS_INTERVAL_MS = 60_000;

// Skeleton: reports the statically configured downstream targets on a
// 60s interval. Shipping to `POST /v1/topology` lands with the topology
// ingest ticket — at that point discovery from observed traffic can
// replace this static list.
export function startDepsReporter({ downstream = [], intervalMs = DEPS_INTERVAL_MS, onTick = () => {} } = {}) {
  return startInterval(intervalMs, () => onTick(downstream));
}
