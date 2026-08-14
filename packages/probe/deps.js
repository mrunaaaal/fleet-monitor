import { startInterval } from './interval-trigger.js';

export const DEPS_INTERVAL_MS = 60_000;

// Reports the statically configured downstream targets on a 60s interval,
// shipping to `POST /v1/topology` via shipTopology (e.g. metrics.js's
// shipMetrics) if given. Shipping failures are swallowed — a dead ingest
// endpoint shouldn't crash the service being monitored. Static targets
// today; discovery from observed traffic could replace this list later.
export function startDepsReporter({
  downstream = [],
  intervalMs = DEPS_INTERVAL_MS,
  onTick = () => {},
  shipTopology,
  serviceName,
  tier,
} = {}) {
  return startInterval(intervalMs, () => {
    onTick(downstream);
    if (shipTopology) {
      Promise.resolve()
        .then(() => shipTopology({ service: serviceName, ...(tier !== undefined ? { tier } : {}), downstream }))
        .catch((err) => console.error(`[probe] failed to ship topology for ${serviceName}:`, err.message));
    }
  });
}
