import { createClient } from 'redis';

const DEFAULT_URL = 'redis://localhost:6379';

// Thin wrapper over node-redis: SET with an EX expiration for the
// `alive:{service}` liveness key (fleet-monitor-docs.md §4.2), and MGET
// for reading several keys at once. Connects lazily on first use.
export function createRedisClient({
  url = process.env.REDIS_URL ?? DEFAULT_URL,
  clientFactory = createClient,
} = {}) {
  const client = clientFactory({ url });
  // The client emits 'error' for connection issues; without a listener
  // Node treats it as an unhandled error and crashes the process. Actual
  // failures still surface to callers via the rejected connect()/command
  // promises.
  client.on('error', () => {});

  let connected;
  function ensureConnected() {
    if (!connected) connected = client.connect();
    return connected;
  }

  async function setWithTtl(key, value, ttlSeconds) {
    await ensureConnected();
    await client.set(key, value, { expiration: { type: 'EX', value: ttlSeconds } });
  }

  async function mget(keys) {
    await ensureConnected();
    return client.mGet(keys);
  }

  async function close() {
    await client.quit();
  }

  return { setWithTtl, mget, close };
}
