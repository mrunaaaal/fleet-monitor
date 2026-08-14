import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createQueryMetricsTool,
  createSearchLogsTool,
  createGetLogSamplesTool,
} from '../agent/summarizing-tools.js';
import { estimateTokens, TOOL_TOKEN_LIMIT } from '../agent/token-budget.js';

// Seam 2 (spec issue #1 / #13): against known query-layer output, assert
// each tool's semantic content and the ~800-token ceiling. The reduction
// itself (never raw datapoints/lines) is the point of this ticket, unlike
// #12's tools which just reshape already-tiny query results.

test('query_metrics tool reduces bucketed rows to overall stats, trend, and largest-change timestamp', async () => {
  let captured;
  const queryMetrics = async (args) => {
    captured = args;
    return [
      { bucket: '2024-01-01T00:00:00Z', min: 10, max: 20, mean: 15, p95: 18 },
      { bucket: '2024-01-01T00:05:00Z', min: 10, max: 22, mean: 16, p95: 20 },
      { bucket: '2024-01-01T00:10:00Z', min: 30, max: 60, mean: 45, p95: 58 },
    ];
  };
  const tool = createQueryMetricsTool({ queryMetrics });

  assert.equal(tool.name, 'query_metrics');
  assert.deepEqual(tool.input_schema.required, ['service', 'field']);

  const result = await tool.handler({ service: 'web', field: 'p95_latency_ms', windowMinutes: 15 });

  assert.deepEqual(captured, { service: 'web', field: 'p95_latency_ms', windowMinutes: 15 });
  assert.equal(result.service, 'web');
  assert.equal(result.field, 'p95_latency_ms');
  assert.equal(result.min, 10);
  assert.equal(result.max, 60);
  assert.equal(result.p95, 58);
  assert.equal(result.trend, 'up');
  assert.equal(result.largest_change_at, '2024-01-01T00:10:00Z');
  assert.ok(estimateTokens(result) < TOOL_TOKEN_LIMIT);
});

test('query_metrics tool reports a down trend when the window is decreasing', async () => {
  const queryMetrics = async () => [
    { bucket: 't0', min: 50, max: 60, mean: 55, p95: 58 },
    { bucket: 't1', min: 10, max: 20, mean: 15, p95: 18 },
  ];
  const tool = createQueryMetricsTool({ queryMetrics });

  const result = await tool.handler({ service: 'web', field: 'cpu_pct' });

  assert.equal(result.trend, 'down');
});

test('query_metrics tool reports a flat trend when the window barely moves', async () => {
  const queryMetrics = async () => [
    { bucket: 't0', min: 10, max: 12, mean: 11, p95: 11.5 },
    { bucket: 't1', min: 10, max: 12, mean: 11.1, p95: 11.6 },
  ];
  const tool = createQueryMetricsTool({ queryMetrics });

  const result = await tool.handler({ service: 'web', field: 'cpu_pct' });

  assert.equal(result.trend, 'flat');
});

test('query_metrics tool reports insufficient_data for zero or one bucket, never raw datapoints', async () => {
  const toolEmpty = createQueryMetricsTool({ queryMetrics: async () => [] });
  const emptyResult = await toolEmpty.handler({ service: 'web', field: 'cpu_pct' });
  assert.equal(emptyResult.trend, 'insufficient_data');
  assert.equal(emptyResult.min, null);
  assert.equal(emptyResult.largest_change_at, null);

  const toolOne = createQueryMetricsTool({
    queryMetrics: async () => [{ bucket: 't0', min: 1, max: 2, mean: 1.5, p95: 1.9 }],
  });
  const oneResult = await toolOne.handler({ service: 'web', field: 'cpu_pct' });
  assert.equal(oneResult.trend, 'insufficient_data');
  assert.equal(oneResult.largest_change_at, null);
});

test('search_logs tool thinly wraps the already-clustered searchLogs query', async () => {
  let captured;
  const searchLogs = async (args) => {
    captured = args;
    return { total: 4, by_level: { error: 3, warn: 1 }, time_range: { first: 'a', last: 'b' }, patterns: [] };
  };
  const tool = createSearchLogsTool({ searchLogs });

  assert.equal(tool.name, 'search_logs');
  assert.deepEqual(tool.input_schema.required, ['service', 'from', 'to']);

  const result = await tool.handler({ service: 'web', from: 'a', to: 'b' });

  assert.deepEqual(captured, { service: 'web', from: 'a', to: 'b' });
  assert.deepEqual(result, { total: 4, by_level: { error: 3, warn: 1 }, time_range: { first: 'a', last: 'b' }, patterns: [] });
  assert.ok(estimateTokens(result) < TOOL_TOKEN_LIMIT);
});

test('get_log_samples tool thinly wraps getLogSamples', async () => {
  let captured;
  const getLogSamples = async (args) => {
    captured = args;
    return [{ ts: 'a', level: 'error', message: 'timeout' }];
  };
  const tool = createGetLogSamplesTool({ getLogSamples });

  assert.equal(tool.name, 'get_log_samples');
  assert.deepEqual(tool.input_schema.required, ['service', 'from', 'to']);

  const result = await tool.handler({ service: 'web', from: 'a', to: 'b' });

  assert.deepEqual(captured, { service: 'web', from: 'a', to: 'b' });
  assert.deepEqual(result, { samples: [{ ts: 'a', level: 'error', message: 'timeout' }] });
  assert.ok(estimateTokens(result) < TOOL_TOKEN_LIMIT);
});

test('get_log_samples tool output stays under the token ceiling even at 5 max-length samples', async () => {
  const getLogSamples = async () =>
    Array.from({ length: 5 }, (_, i) => ({ ts: `2024-01-01T00:0${i}:00Z`, level: 'error', message: 'x'.repeat(200) }));
  const tool = createGetLogSamplesTool({ getLogSamples });

  const result = await tool.handler({ service: 'web', from: 'a', to: 'b' });

  assert.ok(estimateTokens(result) < TOOL_TOKEN_LIMIT);
});
