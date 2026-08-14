import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChaosController } from '../chaos.js';
import { services } from '../../mesh/config.js';

function fakeFetch(calls) {
  return async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true };
  };
}

test('reset sets every mesh service to ok, addressed by host + configured port', async () => {
  const calls = [];
  const chaos = createChaosController({ host: 'localhost', fetchImpl: fakeFetch(calls) });

  await chaos.reset();

  assert.equal(calls.length, services.length);
  for (const service of services) {
    const call = calls.find((c) => c.url === `http://localhost:${service.port}/chaos`);
    assert.ok(call, `expected a chaos call for ${service.name}`);
    assert.deepEqual(call.body, { mode: 'ok' });
  }
});

test('apply sets only the services named in the given chaos steps', async () => {
  const calls = [];
  const chaos = createChaosController({ host: 'localhost', fetchImpl: fakeFetch(calls) });

  await chaos.apply([
    { service: 'ledger-db', mode: 'slow' },
    { service: 'auth-service', mode: 'dead' },
  ]);

  assert.equal(calls.length, 2);
  assert.ok(calls.some((c) => c.url === 'http://localhost:4008/chaos' && c.body.mode === 'slow'));
  assert.ok(calls.some((c) => c.url === 'http://localhost:4004/chaos' && c.body.mode === 'dead'));
});

test('setMode rejects an unknown service name before making a request', async () => {
  const calls = [];
  const chaos = createChaosController({ fetchImpl: fakeFetch(calls) });

  await assert.rejects(() => chaos.setMode('not-a-real-service', 'ok'), /unknown service/);
  assert.equal(calls.length, 0);
});

test('setMode throws when the mesh service responds with a non-2xx status', async () => {
  const chaos = createChaosController({
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });

  await assert.rejects(() => chaos.setMode('web', 'slow'), /500/);
});
