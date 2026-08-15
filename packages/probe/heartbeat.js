import { reportOnTrigger, intervalTrigger } from './report-on-trigger.js';

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
  tier,
} = {}) {
  return reportOnTrigger({
    trigger: intervalTrigger(intervalMs, () => undefined),
    onTick,
    ship: shipHeartbeat && (() => shipHeartbeat({ service: serviceName, ...(tier !== undefined ? { tier } : {}) })),
    serviceName,
    kind: 'heartbeat',
  });
}
