import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTools } from '../agent/index.js';

// Smoke test for the wiring #14 (the investigation loop) will import: given
// the same store clients buildApp() takes, createAgentTools() must produce
// a dispatch exposing exactly the five tools this ticket implements.
test('createAgentTools wires the query layer into a dispatch with the five thin tools', async () => {
  const postgres = { query: async () => [{ name: 'web', tier: 'user-facing' }] };
  const redis = { mget: async (keys) => keys.map(() => '1') };
  const neo4j = { run: async () => [] };

  const dispatch = createAgentTools({ postgres, redis, neo4j });

  const names = dispatch.list().map((t) => t.name).sort();
  assert.deepEqual(names, [
    'check_liveness',
    'find_shared_dependency',
    'get_blast_radius',
    'get_dependencies',
    'list_services',
  ]);

  const result = await dispatch.invoke('list_services');
  assert.deepEqual(result, { services: [{ name: 'web', tier: 'user-facing' }] });
});
