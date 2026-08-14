import { createClient } from 'redis';

const DEFAULT_URL = 'redis://localhost:6379';

// Thin wrapper over node-redis: SET with an EX expiration for the
// `alive:{service}` liveness key (fleet-monitor-docs.md §4.2), MGET for
// reading several keys at once, and RPUSH/LPOP-count for the `logbuf` log
// buffer (§5.2). Connects lazily on first use.
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

  async function rpush(key, values) {
    await ensureConnected();
    return client.rPush(key, values);
  }

  async function lpopCount(key, count) {
    await ensureConnected();
    const values = await client.lPopCount(key, count);
    return values ?? [];
  }

  async function close() {
    // Quitting a client that never connected (nothing ever called
    // ensureConnected) throws — closing is as lazy as connecting.
    if (connected) await client.quit();
  }

  return { setWithTtl, mget, rpush, lpopCount, close };
}
