import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRedisClient } from '../db/redis.js';

function fakeRedisClient() {
  const calls = { connect: 0, set: [], mGet: [], quit: 0 };
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
