import { startInterval } from './interval-trigger.js';

export const HEARTBEAT_INTERVAL_MS = 15_000;

// Skeleton: fires on a 15s interval. Refreshing the Redis `alive:{service}`
// TTL key lands with the liveness-path ticket.
export function startHeartbeat({ intervalMs = HEARTBEAT_INTERVAL_MS, onTick = () => {} } = {}) {
  return startInterval(intervalMs, onTick);
}
