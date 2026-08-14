import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTopologyIngestHandler } from '../ingest/topology.js';

test('ingestTopology MERGEs the service and each downstream edge in one run', async () => {
  const runs = [];
  const ingestTopology = createTopologyIngestHandler({
    neo4j: { run: async (cypher, params) => runs.push({ cypher, params }) },
  });

  await ingestTopology({ service: 'api-gateway', tier: 'internal', downstream: ['auth-service', 'payments'] });

  assert.equal(runs.length, 1);
  assert.match(runs[0].cypher, /MERGE \(a:Service \{name: \$service\}\)/);
  assert.match(runs[0].cypher, /MERGE \(a\)-\[r:DEPENDS_ON\]->\(b\)/);
  assert.deepEqual(runs[0].params, { service: 'api-gateway', tier: 'internal', downstream: ['auth-service', 'payments'] });
});

test('ingestTopology upserts a leaf service with no downstream targets', async () => {
  const runs = [];
  const ingestTopology = createTopologyIngestHandler({
    neo4j: { run: async (cypher, params) => runs.push({ cypher, params }) },
  });

  await ingestTopology({ service: 'ledger-db', tier: 'datastore', downstream: [] });

  assert.equal(runs.length, 1);
  assert.doesNotMatch(runs[0].cypher, /UNWIND/);
  assert.deepEqual(runs[0].params, { service: 'ledger-db', tier: 'datastore', downstream: [] });
});

test('ingestTopology defaults downstream to an empty list when omitted', async () => {
  const runs = [];
  const ingestTopology = createTopologyIngestHandler({
    neo4j: { run: async (cypher, params) => runs.push({ cypher, params }) },
  });

  await ingestTopology({ service: 'web' });

  assert.deepEqual(runs[0].params, { service: 'web', tier: null, downstream: [] });
});

test('ingestTopology rejects a payload missing service', async () => {
  const ingestTopology = createTopologyIngestHandler({ neo4j: { run: async () => {} } });

  await assert.rejects(() => ingestTopology({ downstream: [] }), /service/);
});
