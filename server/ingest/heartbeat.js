// Liveness (fleet-monitor-docs.md §4.2): `alive:{service}` STRING, 45s
// TTL, value is a timestamp. Expiry *is* the death detector — no reaper.
const DEFAULT_TTL_SECONDS = 45;

// Registry upsert (fleet-monitor-docs.md §4.1): a heartbeat is also the
// self-reported signal that a service exists. first_seen is set once by
// the column default on insert; every heartbeat after that refreshes
// last_seen and the self-reported tier.
const UPSERT_SERVICE_SQL = `
  INSERT INTO services (name, tier)
  VALUES ($1, $2)
  ON CONFLICT (name) DO UPDATE SET tier = EXCLUDED.tier, last_seen = now()
`;

export function createHeartbeatIngestHandler({ redis, postgres, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  return async function ingestHeartbeat(payload) {
    if (!payload.service) {
      throw new Error('heartbeat payload missing required field: service');
    }
    if (!payload.tier) {
      throw new Error('heartbeat payload missing required field: tier');
    }
    await Promise.all([
      redis.setWithTtl(`alive:${payload.service}`, String(Date.now()), ttlSeconds),
      postgres.query(UPSERT_SERVICE_SQL, [payload.service, payload.tier]),
    ]);
  };
}
