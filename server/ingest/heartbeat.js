// Liveness (fleet-monitor-docs.md §4.2): `alive:{service}` STRING, 45s
// TTL, value is a timestamp. Expiry *is* the death detector — no reaper.
const DEFAULT_TTL_SECONDS = 45;

export function createHeartbeatIngestHandler({ redis, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  return async function ingestHeartbeat(payload) {
    if (!payload.service) {
      throw new Error('heartbeat payload missing required field: service');
    }
    await redis.setWithTtl(`alive:${payload.service}`, String(Date.now()), ttlSeconds);
  };
}
