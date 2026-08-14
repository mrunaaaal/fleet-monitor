import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createListServicesTool,
  createCheckLivenessTool,
  createGetDependenciesTool,
  createFindSharedDependencyTool,
  createGetBlastRadiusTool,
} from '../agent/tools.js';
import { estimateTokens, TOOL_TOKEN_LIMIT } from '../agent/token-budget.js';

// Seam 2 (spec issue #1, "Testing Decisions"): against a known store state
// (here, fake query-layer functions standing in for the real Postgres/
// Redis/Neo4j-backed ones already tested at the query layer), call each
// tool and assert both semantic content and the ~800-token ceiling.

test('list_services tool wraps listServices with a name/description/schema', async () => {
  const listServices = async () => [
    { name: 'api-gateway', tier: 'internal' },
    { name: 'web', tier: 'user-facing' },
  ];
  const tool = createListServicesTool({ listServices });

  assert.equal(tool.name, 'list_services');
  assert.deepEqual(tool.input_schema, { type: 'object', properties: {}, required: [] });

  const result = await tool.handler();

  assert.deepEqual(result, {
    services: [
      { name: 'api-gateway', tier: 'internal' },
      { name: 'web', tier: 'user-facing' },
    ],
  });
  assert.ok(estimateTokens(result) < TOOL_TOKEN_LIMIT);
});

test('check_liveness tool defaults to every registered service when none are given', async () => {
  const listServices = async () => [{ name: 'web', tier: 'user-facing' }, { name: 'checkout', tier: 'user-facing' }];
  let captured;
  const queryLiveness = async ({ services }) => {
    captured = services;
    return services.map((service) => ({ service, up: service === 'web' }));
  };
  const tool = createCheckLivenessTool({ queryLiveness, listServices });

  const result = await tool.handler();

  assert.deepEqual(captured, ['web', 'checkout']);
  assert.deepEqual(result, { liveness: [{ service: 'web', up: true }, { service: 'checkout', up: false }] });
  assert.ok(estimateTokens(result) < TOOL_TOKEN_LIMIT);
});

test('check_liveness tool scopes to the given services when provided', async () => {
  const listServices = async () => {
    throw new Error('listServices should not be called when services are given');
  };
  const queryLiveness = async ({ services }) => services.map((service) => ({ service, up: true }));
  const tool = createCheckLivenessTool({ queryLiveness, listServices });

  const result = await tool.handler({ services: ['web'] });

  assert.deepEqual(result, { liveness: [{ service: 'web', up: true }] });
});

test('check_liveness tool treats an explicitly empty services array as "check nothing", not "default to all"', async () => {
  const listServices = async () => {
    throw new Error('listServices should not be called when services is explicitly []');
  };
  const queryLiveness = async () => {
    throw new Error('queryLiveness should not be called with an empty target list');
  };
  const tool = createCheckLivenessTool({ queryLiveness, listServices });

  const result = await tool.handler({ services: [] });

  assert.deepEqual(result, { liveness: [] });
});

test('get_dependencies tool wraps queryDependencies scoped to the given service', async () => {
  let captured;
  const queryDependencies = async (args) => {
    captured = args;
    return [{ service: 'auth-service', tier: 'internal' }];
  };
  const tool = createGetDependenciesTool({ queryDependencies });

  assert.deepEqual(tool.input_schema.required, ['service']);

  const result = await tool.handler({ service: 'api-gateway' });

  assert.deepEqual(captured, { service: 'api-gateway' });
  assert.deepEqual(result, { service: 'api-gateway', downstream: [{ service: 'auth-service', tier: 'internal' }] });
  assert.ok(estimateTokens(result) < TOOL_TOKEN_LIMIT);
});

test('find_shared_dependency tool wraps querySharedDependency with the alerting services', async () => {
  let captured;
  const querySharedDependency = async (args) => {
    captured = args;
    return [{ service: 'ledger-db', covers: 2 }];
  };
  const tool = createFindSharedDependencyTool({ querySharedDependency });

  const result = await tool.handler({ services: ['payments', 'inventory'] });

  assert.deepEqual(captured, { services: ['payments', 'inventory'] });
  assert.deepEqual(result, {
    services: ['payments', 'inventory'],
    shared_dependencies: [{ service: 'ledger-db', covers: 2 }],
  });
  assert.ok(estimateTokens(result) < TOOL_TOKEN_LIMIT);
});

test('get_blast_radius tool wraps queryBlastRadius scoped to the given service', async () => {
  let captured;
  const queryBlastRadius = async (args) => {
    captured = args;
    return [
      { service: 'payments', tier: 'internal', hops: 1 },
      { service: 'web', tier: 'user-facing', hops: 3 },
    ];
  };
  const tool = createGetBlastRadiusTool({ queryBlastRadius });

  const result = await tool.handler({ service: 'ledger-db' });

  assert.deepEqual(captured, { service: 'ledger-db' });
  assert.deepEqual(result, {
    service: 'ledger-db',
    affected: [
      { service: 'payments', tier: 'internal', hops: 1 },
      { service: 'web', tier: 'user-facing', hops: 3 },
    ],
  });
  assert.ok(estimateTokens(result) < TOOL_TOKEN_LIMIT);
});

test('a full 8-service mesh blast radius has comfortable headroom under the token ceiling', async () => {
  const affected = Array.from({ length: 8 }, (_, i) => ({
    service: `service-${i}-with-a-reasonably-long-name`,
    tier: 'internal',
    hops: i + 1,
  }));
  const tool = createGetBlastRadiusTool({ queryBlastRadius: async () => affected });

  const result = await tool.handler({ service: 'ledger-db' });

  assert.ok(estimateTokens(result) < TOOL_TOKEN_LIMIT);
});

// The assertions above only prove real tool output stays under the
// ceiling — none of them prove the ceiling check can actually fail.
// Without this, `estimateTokens(result) < TOOL_TOKEN_LIMIT` could pass
// vacuously for any output this small mesh will ever produce.
test('the token ceiling assertion actually catches an oversized payload', async () => {
  const affected = Array.from({ length: 200 }, (_, i) => ({
    service: `service-${i}-with-a-much-longer-synthetic-name-to-inflate-payload-size`,
    tier: 'internal',
    hops: i + 1,
  }));
  const tool = createGetBlastRadiusTool({ queryBlastRadius: async () => affected });

  const result = await tool.handler({ service: 'ledger-db' });

  assert.ok(estimateTokens(result) >= TOOL_TOKEN_LIMIT);
});
