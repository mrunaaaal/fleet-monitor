import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRedisClient } from '../db/redis.js';

function fakeRedisClient() {
  const calls = { connect: 0, set: [], mGet: [], rPush: [], lPopCount: [], quit: 0 };
  const client = {
    on: () => {},
    connect: async () => {
      calls.connect += 1;
    },
    set: async (key, value, opts) => {
      calls.set.push({ key, value, opts });
    },
    mGet: async (keys) => {
      calls.mGet.push(keys);
      return keys.map(() => null);
    },
    rPush: async (key, values) => {
      calls.rPush.push({ key, values });
      return values.length;
    },
    lPopCount: async (key, count) => {
      calls.lPopCount.push({ key, count });
      return null;
    },
    quit: async () => {
      calls.quit += 1;
    },
  };
  return { client, calls };
}

test('setWithTtl connects then SETs the key with an EX expiration', async () => {
  const { client, calls } = fakeRedisClient();
  const redis = createRedisClient({ url: 'redis://redis:6379', clientFactory: () => client });

  await redis.setWithTtl('alive:web', '12345', 45);

  assert.equal(calls.connect, 1);
  assert.deepEqual(calls.set, [
    { key: 'alive:web', value: '12345', opts: { expiration: { type: 'EX', value: 45 } } },
  ]);
});

test('mget connects then MGETs the given keys', async () => {
  const { client, calls } = fakeRedisClient();
  const redis = createRedisClient({ url: 'redis://redis:6379', clientFactory: () => client });

  const values = await redis.mget(['alive:web', 'alive:checkout']);

  assert.equal(calls.connect, 1);
  assert.deepEqual(calls.mGet, [['alive:web', 'alive:checkout']]);
  assert.deepEqual(values, [null, null]);
});

test('rpush connects then RPUSHes the given values, returning the new length', async () => {
  const { client, calls } = fakeRedisClient();
  const redis = createRedisClient({ url: 'redis://redis:6379', clientFactory: () => client });

  const length = await redis.rpush('logbuf', ['{"a":1}', '{"a":2}']);

  assert.equal(calls.connect, 1);
  assert.deepEqual(calls.rPush, [{ key: 'logbuf', values: ['{"a":1}', '{"a":2}'] }]);
  assert.equal(length, 2);
});

test('lpopCount connects then LPOPs up to count values', async () => {
  const { client, calls } = fakeRedisClient();
  client.lPopCount = async (key, count) => {
    calls.lPopCount.push({ key, count });
    return ['{"a":1}', '{"a":2}'];
  };
  const redis = createRedisClient({ url: 'redis://redis:6379', clientFactory: () => client });

  const values = await redis.lpopCount('logbuf', 1000);

  assert.equal(calls.connect, 1);
  assert.deepEqual(calls.lPopCount, [{ key: 'logbuf', count: 1000 }]);
  assert.deepEqual(values, ['{"a":1}', '{"a":2}']);
});

test('lpopCount returns an empty array rather than null when the key does not exist', async () => {
  const { client } = fakeRedisClient();
  const redis = createRedisClient({ url: 'redis://redis:6379', clientFactory: () => client });

  const values = await redis.lpopCount('logbuf', 1000);

  assert.deepEqual(values, []);
});

test('connects only once across multiple operations', async () => {
  const { client, calls } = fakeRedisClient();
  const redis = createRedisClient({ url: 'redis://redis:6379', clientFactory: () => client });

  await redis.setWithTtl('alive:web', '1', 45);
  await redis.mget(['alive:web']);

  assert.equal(calls.connect, 1);
});

test('close() quits the client', async () => {
  const { client, calls } = fakeRedisClient();
  const redis = createRedisClient({ url: 'redis://redis:6379', clientFactory: () => client });

  await redis.setWithTtl('alive:web', '1', 45);
  await redis.close();

  assert.equal(calls.quit, 1);
});

test('close() is a no-op when the client never connected', async () => {
  const { client, calls } = fakeRedisClient();
  const redis = createRedisClient({ url: 'redis://redis:6379', clientFactory: () => client });

  await redis.close();

  assert.equal(calls.quit, 0);
});

test('defaults url for local dev when not configured', () => {
  let passedOptions;
  createRedisClient({
    clientFactory: (options) => {
      passedOptions = options;
      return fakeRedisClient().client;
    },
  });

  assert.equal(passedOptions.url, 'redis://localhost:6379');
});
