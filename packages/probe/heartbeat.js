import { startInterval } from './interval-trigger.js';

export const HEARTBEAT_INTERVAL_MS = 15_000;

// Fires on a 15s interval, refreshing the Redis `alive:{service}` TTL key
// via shipHeartbeat (e.g. POST /v1/heartbeat) if given. Shipping failures
// are swallowed — a dead ingest endpoint shouldn't crash the service
// being monitored (it will simply read as down once the TTL expires).
export function startHeartbeat({
  intervalMs = HEARTBEAT_INTERVAL_MS,
  onTick = () => {},
  shipHeartbeat,
  serviceName,
} = {}) {
  return startInterval(intervalMs, () => {
    onTick();
    if (shipHeartbeat) {
      Promise.resolve()
        .then(() => shipHeartbeat({ service: serviceName }))
        .catch((err) => console.error(`[probe] failed to ship heartbeat for ${serviceName}:`, err.message));
    }
  });
}
