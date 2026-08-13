import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../shared/service.js';

async function listen(app) {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address();
  return `http://127.0.0.1:${port}`;
}

async function setChaos(app, mode) {
  return app.inject({ method: 'POST', url: '/chaos', payload: { mode } });
}

test('GET /health reports the service name and tier', async () => {
  const app = createService({ name: 'web', tier: 'user-facing', downstream: [] });
  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', service: 'web', tier: 'user-facing' });

  await app.close();
});

test('POST /chaos rejects an invalid mode', async () => {
  const app = createService({ name: 'web', tier: 'user-facing', downstream: [] });
  const res = await app.inject({ method: 'POST', url: '/chaos', payload: { mode: 'bogus' } });

  assert.equal(res.statusCode, 400);

  await app.close();
});

test('POST /chaos accepts each of ok/slow/error/dead', async () => {
  const app = createService({ name: 'web', tier: 'user-facing', downstream: [] });

  for (const mode of ['ok', 'slow', 'error', 'dead']) {
    const res = await setChaos(app, mode);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { service: 'web', mode });
  }

  await app.close();
});

test('GET /work returns ok with no downstream targets by default', async () => {
  const app = createService({ name: 'ledger-db', tier: 'datastore', downstream: [] });
  const res = await app.inject({ method: 'GET', url: '/work' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { service: 'ledger-db', status: 'ok' });

  await app.close();
});

test('GET /work returns 500 in error mode', async () => {
  const app = createService({ name: 'ledger-db', tier: 'datastore', downstream: [] });
  await setChaos(app, 'error');

  const res = await app.inject({ method: 'GET', url: '/work' });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().status, 'error');

  await app.close();
});

test('GET /work delays by slowDelayMs in slow mode', async () => {
  const app = createService(
    { name: 'ledger-db', tier: 'datastore', downstream: [] },
    { slowDelayMs: 30 },
  );
  await setChaos(app, 'slow');

  const start = Date.now();
  const res = await app.inject({ method: 'GET', url: '/work' });
  const elapsed = Date.now() - start;

  assert.equal(res.statusCode, 200);
  assert.ok(elapsed >= 30, `expected at least 30ms delay, got ${elapsed}ms`);

  await app.close();
});

test('GET /work never resolves in dead mode', async () => {
  const app = createService({ name: 'ledger-db', tier: 'datastore', downstream: [] });
  await setChaos(app, 'dead');

  const injectPromise = app.inject({ method: 'GET', url: '/work' }).catch(() => {});
  const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('timeout'), 100));

  const result = await Promise.race([injectPromise, timeoutPromise]);
  assert.equal(result, 'timeout');

  await app.close();
});

test('GET /work fans out to downstream targets and aggregates success', async () => {
  const leaf = createService({ name: 'ledger-db', tier: 'datastore', downstream: [] });
  const leafUrl = await listen(leaf);

  const gateway = createService(
    { name: 'payments', tier: 'internal', downstream: ['ledger-db'] },
    { resolveUrl: (name) => (name === 'ledger-db' ? leafUrl : `http://${name}:3000`) },
  );

  const res = await gateway.inject({ method: 'GET', url: '/work' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { service: 'payments', status: 'ok' });

  await gateway.close();
  await leaf.close();
});

test('GET /work returns 502 when a downstream target errors', async () => {
  const leaf = createService({ name: 'ledger-db', tier: 'datastore', downstream: [] });
  const leafUrl = await listen(leaf);
  await setChaos(leaf, 'error');

  const gateway = createService(
    { name: 'payments', tier: 'internal', downstream: ['ledger-db'] },
    { resolveUrl: () => leafUrl },
  );

  const res = await gateway.inject({ method: 'GET', url: '/work' });
  assert.equal(res.statusCode, 502);
  assert.equal(res.json().status, 'error');

  await gateway.close();
  await leaf.close();
});

test('GET /work reports a downstream failure within downstreamTimeoutMs when a target is dead', async () => {
  const leaf = createService({ name: 'ledger-db', tier: 'datastore', downstream: [] });
  const leafUrl = await listen(leaf);
  await setChaos(leaf, 'dead');

  const gateway = createService(
    { name: 'payments', tier: 'internal', downstream: ['ledger-db'] },
    { resolveUrl: () => leafUrl, downstreamTimeoutMs: 50 },
  );

  const start = Date.now();
  const res = await gateway.inject({ method: 'GET', url: '/work' });
  const elapsed = Date.now() - start;

  assert.equal(res.statusCode, 502);
  assert.ok(elapsed < 1000, `expected the downstream timeout to bound the wait, took ${elapsed}ms`);

  await gateway.close();
  await leaf.close();
});

test('routesByFeature restricts which downstream targets a feature call reaches', async () => {
  const auth = createService({ name: 'auth-service', tier: 'internal', downstream: [] });
  const authUrl = await listen(auth);
  await setChaos(auth, 'error');

  const payments = createService({ name: 'payments', tier: 'internal', downstream: [] });
  const paymentsUrl = await listen(payments);

  const gateway = createService(
    {
      name: 'api-gateway',
      tier: 'internal',
      downstream: ['auth-service', 'payments'],
      routesByFeature: {
        web: ['auth-service', 'payments'],
        checkout: ['payments'],
      },
    },
    {
      resolveUrl: (name) => (name === 'auth-service' ? authUrl : paymentsUrl),
    },
  );

  const webRes = await gateway.inject({ method: 'GET', url: '/work?feature=web' });
  assert.equal(webRes.statusCode, 502, 'web routes through the broken auth-service');

  const checkoutRes = await gateway.inject({ method: 'GET', url: '/work?feature=checkout' });
  assert.equal(checkoutRes.statusCode, 200, 'checkout never calls auth-service');

  await gateway.close();
  await auth.close();
  await payments.close();
});

test('wires a probe for the service and stops it on close', async () => {
  let metricsTicks = 0;
  const app = createService(
    { name: 'web', tier: 'user-facing', downstream: [] },
    { probeHooks: { onMetricsTick: () => (metricsTicks += 1) } },
  );
  await app.ready();
  await app.close();

  // No assertion on metricsTicks value itself (real 15s interval, not mocked
  // here) — this just proves startProbe/stop wiring doesn't throw.
  assert.equal(metricsTicks, 0);
});
