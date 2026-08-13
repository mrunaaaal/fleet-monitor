import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  services,
  TIERS,
  userFacingServices,
  getServiceConfig,
  downstreamName,
  downstreamQuery,
} from '../config.js';

test('defines exactly eight services', () => {
  assert.equal(services.length, 8);
});

test('every service has a unique name, valid tier, and unique port', () => {
  const names = new Set();
  const ports = new Set();
  for (const service of services) {
    assert.ok(TIERS.includes(service.tier), `${service.name} has invalid tier ${service.tier}`);
    assert.ok(!names.has(service.name), `duplicate name ${service.name}`);
    assert.ok(!ports.has(service.port), `duplicate port ${service.port}`);
    names.add(service.name);
    ports.add(service.port);
  }
});

test('every downstream target refers to a real service', () => {
  const names = new Set(services.map((s) => s.name));
  for (const service of services) {
    for (const target of service.downstream) {
      const targetName = downstreamName(target);
      assert.ok(names.has(targetName), `${service.name} depends on unknown service ${targetName}`);
    }
  }
});

test('has depth 4 from a user-facing service to a datastore', () => {
  // web -> api-gateway -> auth-service -> session-store
  const byName = Object.fromEntries(services.map((s) => [s.name, s]));
  let depth = 0;
  let current = byName.web;
  const visited = [current.name];
  while (current.downstream.length > 0) {
    current = byName[downstreamName(current.downstream[0])];
    visited.push(current.name);
    depth += 1;
  }
  assert.equal(depth, 3, `expected 3 hops (4 nodes), got path ${visited.join(' -> ')}`);
  assert.equal(current.tier, 'datastore');
});

test('has a diamond: payments and inventory share ledger-db', () => {
  const byName = Object.fromEntries(services.map((s) => [s.name, s]));
  assert.ok(byName.payments.downstream.includes('ledger-db'));
  assert.ok(byName.inventory.downstream.includes('ledger-db'));
});

test('has asymmetric impact: only web routes through auth-service, checkout does not', () => {
  const apiGateway = getServiceConfig('api-gateway');
  assert.ok(apiGateway.routesByFeature.web.includes('auth-service'));
  assert.ok(!apiGateway.routesByFeature.checkout.includes('auth-service'));
});

test('web and checkout tag their api-gateway call with a distinct feature', () => {
  const web = getServiceConfig('web');
  const checkout = getServiceConfig('checkout');
  assert.equal(downstreamQuery(web.downstream[0]).feature, 'web');
  assert.equal(downstreamQuery(checkout.downstream[0]).feature, 'checkout');
});

test('tiers match fleet-monitor-docs.md §3.2', () => {
  assert.deepEqual(
    userFacingServices.map((s) => s.name).sort(),
    ['checkout', 'web'],
  );
  assert.deepEqual(
    services.filter((s) => s.tier === 'internal').map((s) => s.name).sort(),
    ['api-gateway', 'auth-service', 'inventory', 'payments'],
  );
  assert.deepEqual(
    services.filter((s) => s.tier === 'datastore').map((s) => s.name).sort(),
    ['ledger-db', 'session-store'],
  );
});

test('getServiceConfig looks up by name', () => {
  assert.equal(getServiceConfig('web').tier, 'user-facing');
  assert.equal(getServiceConfig('nonexistent'), undefined);
});

test('downstreamName/downstreamQuery handle both string and object entries', () => {
  assert.equal(downstreamName('ledger-db'), 'ledger-db');
  assert.equal(downstreamQuery('ledger-db'), undefined);
  assert.equal(downstreamName({ name: 'api-gateway', query: { feature: 'web' } }), 'api-gateway');
  assert.deepEqual(downstreamQuery({ name: 'api-gateway', query: { feature: 'web' } }), { feature: 'web' });
});
