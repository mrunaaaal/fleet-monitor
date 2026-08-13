import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLivenessQuery } from '../query/liveness.js';

test('queryLiveness MGETs alive:{service} for each service and reports up/down', async () => {
  let capturedKeys;
  const queryLiveness = createLivenessQuery({
    redis: {
      mget: async (keys) => {
        capturedKeys = keys;
        return ['1786652060', null];
      },
    },
  });

  const results = await queryLiveness({ services: ['web', 'checkout'] });

  assert.deepEqual(capturedKeys, ['alive:web', 'alive:checkout']);
  assert.deepEqual(results, [
    { service: 'web', up: true },
    { service: 'checkout', up: false },
  ]);
});

test('queryLiveness requires a non-empty services list', async () => {
  const queryLiveness = createLivenessQuery({ redis: { mget: async () => [] } });

  await assert.rejects(() => queryLiveness({ services: [] }), /services/);
  await assert.rejects(() => queryLiveness({}), /services/);
});
