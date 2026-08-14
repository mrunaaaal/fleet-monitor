import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTools } from '../agent/index.js';

// Smoke test for the wiring #14's route uses: given the same store clients
// buildApp() takes, createAgentTools() must produce a dispatch exposing
// all nine tools from fleet-monitor-docs.md §7.1 — #12's five thin tools,
// #13's three summarizing tools, and #14's submit_findings terminal tool.
test('createAgentTools wires the query layer into a dispatch with all nine tools', async () => {
  const postgres = { query: async () => [{ name: 'web', tier: 'user-facing' }] };
  const redis = { mget: async (keys) => keys.map(() => '1') };
  const neo4j = { run: async () => [] };
  const influx = { querySql: async () => [] };
  const clickhouse = { querySql: async () => [] };

  const dispatch = createAgentTools({ postgres, redis, neo4j, influx, clickhouse });

  const names = dispatch.list().map((t) => t.name).sort();
  assert.deepEqual(names, [
    'check_liveness',
    'find_shared_dependency',
    'get_blast_radius',
    'get_dependencies',
    'get_log_samples',
    'list_services',
    'query_metrics',
    'search_logs',
    'submit_findings',
  ]);

  const result = await dispatch.invoke('list_services');
  assert.deepEqual(result, { services: [{ name: 'web', tier: 'user-facing' }] });
});
