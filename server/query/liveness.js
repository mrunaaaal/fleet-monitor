// Written once, consumed by both the liveness view and the agent's
// check_liveness tool (fleet-monitor-docs.md §6). No reaper: a service
// reads as down once its `alive:{service}` key has expired (MGET
// returns null for that key).
export function createLivenessQuery({ redis }) {
  return async function queryLiveness({ services } = {}) {
    if (!services || services.length === 0) {
      throw new Error('queryLiveness requires a non-empty services list');
    }

    const keys = services.map((service) => `alive:${service}`);
    const values = await redis.mget(keys);
    return services.map((service, i) => ({ service, up: values[i] != null }));
  };
}
