import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDependenciesQuery,
  createBlastRadiusQuery,
  createSharedDependencyQuery,
} from '../query/topology.js';

function fakeInt(n) {
  return { toNumber: () => n };
}

test('queryDependencies runs a direct downstream MATCH scoped to the service', async () => {
  let captured;
  const queryDependencies = createDependenciesQuery({
    neo4j: {
      run: async (cypher, params) => {
        captured = { cypher, params };
        return [{ service: 'auth-service', tier: 'internal' }];
      },
    },
  });

  const rows = await queryDependencies({ service: 'api-gateway' });

  assert.match(captured.cypher, /-\[:DEPENDS_ON\]->/);
  assert.deepEqual(captured.params, { service: 'api-gateway' });
  assert.deepEqual(rows, [{ service: 'auth-service', tier: 'internal' }]);
});

test('queryDependencies requires a service', async () => {
  const queryDependencies = createDependenciesQuery({ neo4j: { run: async () => [] } });
  await assert.rejects(() => queryDependencies({}), /service/);
});

test('queryBlastRadius walks DEPENDS_ON backwards up to 8 hops and unwraps Integer hop counts', async () => {
  let captured;
  const queryBlastRadius = createBlastRadiusQuery({
    neo4j: {
      run: async (cypher, params) => {
        captured = { cypher, params };
        return [{ service: 'web', tier: 'user-facing', hops: fakeInt(3) }];
      },
    },
  });

  const rows = await queryBlastRadius({ service: 'session-store' });

  assert.match(captured.cypher, /<-\[:DEPENDS_ON\*1\.\.8\]-/);
  assert.deepEqual(captured.params, { service: 'session-store' });
  assert.deepEqual(rows, [{ service: 'web', tier: 'user-facing', hops: 3 }]);
});

test('queryBlastRadius requires a service', async () => {
  const queryBlastRadius = createBlastRadiusQuery({ neo4j: { run: async () => [] } });
  await assert.rejects(() => queryBlastRadius({}), /service/);
});

test('querySharedDependency walks forward from every alerting service and unwraps covers', async () => {
  let captured;
  const querySharedDependency = createSharedDependencyQuery({
    neo4j: {
      run: async (cypher, params) => {
        captured = { cypher, params };
        return [{ service: 'ledger-db', covers: fakeInt(2) }];
      },
    },
  });

  const rows = await querySharedDependency({ services: ['payments', 'inventory'] });

  assert.match(captured.cypher, /-\[:DEPENDS_ON\*1\.\.8\]->/);
  assert.deepEqual(captured.params, { services: ['payments', 'inventory'] });
  assert.deepEqual(rows, [{ service: 'ledger-db', covers: 2 }]);
});

test('querySharedDependency requires a non-empty services list', async () => {
  const querySharedDependency = createSharedDependencyQuery({ neo4j: { run: async () => [] } });
  await assert.rejects(() => querySharedDependency({ services: [] }), /services/);
});
