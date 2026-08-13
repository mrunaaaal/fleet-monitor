import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createListServicesQuery } from '../query/services.js';

test('listServices runs a name/tier select and maps the rows', async () => {
  const calls = [];
  const postgres = {
    query: async (text, params) => {
      calls.push({ text, params });
      return [
        { name: 'api-gateway', tier: 'internal' },
        { name: 'web', tier: 'user-facing' },
      ];
    },
  };
  const listServices = createListServicesQuery({ postgres });

  const services = await listServices();

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /SELECT name, tier FROM services/);
  assert.equal(calls[0].params, undefined);
  assert.deepEqual(services, [
    { name: 'api-gateway', tier: 'internal' },
    { name: 'web', tier: 'user-facing' },
  ]);
});

test('listServices returns an empty array when the registry is empty', async () => {
  const postgres = { query: async () => [] };
  const listServices = createListServicesQuery({ postgres });

  assert.deepEqual(await listServices(), []);
});
