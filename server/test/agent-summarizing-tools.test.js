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
  const calls = [];
  const queryMetrics = async (args) => {
    calls.push(args);
    if (args.field === 'req_per_sec') return [{ bucket: 't0', min: 5, max: 5, mean: 5, p95: 5 }];
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

  assert.deepEqual(calls[0], { service: 'web', field: 'p95_latency_ms', windowMinutes: 15 });
  assert.equal(result.service, 'web');
  assert.equal(result.field, 'p95_latency_ms');
  assert.equal(result.min, 10);
  assert.equal(result.max, 60);
  assert.equal(result.p95, 58);
  assert.equal(result.trend, 'up');
  assert.equal(result.largest_change_at, '2024-01-01T00:10:00Z');
  assert.ok(estimateTokens(result) < TOOL_TOKEN_LIMIT);
});

// getSince (issue #26): the eval harness supplies getSince to keep each
// scenario's query_metrics calls from reaching back into an earlier
// scenario's chaos window; production callers omit it and get today's
// unclamped behavior. Both the primary field query and the traffic-status
// query below must honor it identically, or the traffic check would leak
// across scenarios the same way #26 fixed for the field being investigated.

test('query_metrics tool forwards getSince() as since to both the primary and traffic queries', async () => {
  const calls = [];
  const queryMetrics = async (args) => {
    calls.push(args);
    return [];
  };
  const tool = createQueryMetricsTool({ queryMetrics, getSince: () => '2026-08-16T11:50:00.000Z' });

  await tool.handler({ service: 'web', field: 'cpu_pct' });

  assert.deepEqual(calls, [
    { service: 'web', field: 'cpu_pct', since: '2026-08-16T11:50:00.000Z' },
    { service: 'web', field: 'req_per_sec', since: '2026-08-16T11:50:00.000Z' },
  ]);
});

test('query_metrics tool omits since when getSince is absent', async () => {
  const calls = [];
  const queryMetrics = async (args) => {
    calls.push(args);
    return [];
  };
  const tool = createQueryMetricsTool({ queryMetrics });

  await tool.handler({ service: 'web', field: 'cpu_pct' });

  assert.deepEqual(calls, [{ service: 'web', field: 'cpu_pct' }, { service: 'web', field: 'req_per_sec' }]);
});

test('query_metrics tool omits since when getSince() returns undefined', async () => {
  const calls = [];
  const queryMetrics = async (args) => {
    calls.push(args);
    return [];
  };
  const tool = createQueryMetricsTool({ queryMetrics, getSince: () => undefined });

  await tool.handler({ service: 'web', field: 'cpu_pct' });

  assert.deepEqual(calls, [{ service: 'web', field: 'cpu_pct' }, { service: 'web', field: 'req_per_sec' }]);
});

// traffic_status (issue #29): a dead service in this mesh stops completing
// requests rather than erroring loudly, so its own p95_latency_ms/
// error_rate look clean — nothing failed, because nothing finished. A
// prose warning in the system prompt tried to get the model to catch this
// by cross-checking req_per_sec itself and made things worse (traded the
// original misdiagnosis for false alarms on legitimately idle services).
// Doing the check in the tool instead makes it a fact the model reads,
// not an inference it has to make correctly every time.

test('query_metrics tool reports traffic_status "no_traffic" when req_per_sec is near zero, even if the requested field looks clean', async () => {
  const queryMetrics = async ({ field }) => {
    if (field === 'req_per_sec') return [{ bucket: 't0', min: 0, max: 0.1, mean: 0.05, p95: 0.1 }];
    return [{ bucket: 't0', min: 0.4, max: 0.6, mean: 0.5, p95: 0.6 }];
  };
  const tool = createQueryMetricsTool({ queryMetrics });

  const result = await tool.handler({ service: 'session-store', field: 'p95_latency_ms' });

  assert.equal(result.traffic_status, 'no_traffic');
});

test('query_metrics tool reports traffic_status "active" when req_per_sec is above the no-traffic threshold', async () => {
  const queryMetrics = async ({ field }) => {
    if (field === 'req_per_sec') return [{ bucket: 't0', min: 4, max: 6, mean: 5, p95: 6 }];
    return [{ bucket: 't0', min: 0.4, max: 0.6, mean: 0.5, p95: 0.6 }];
  };
  const tool = createQueryMetricsTool({ queryMetrics });

  const result = await tool.handler({ service: 'web', field: 'p95_latency_ms' });

  assert.equal(result.traffic_status, 'active');
});

test('query_metrics tool reports traffic_status "unknown" when there is no data to compute a req_per_sec mean', async () => {
  const queryMetrics = async () => [];
  const tool = createQueryMetricsTool({ queryMetrics });

  const result = await tool.handler({ service: 'web', field: 'p95_latency_ms' });

  assert.equal(result.traffic_status, 'unknown');
});

test('query_metrics tool does not double-query when the requested field is itself req_per_sec', async () => {
  const calls = [];
  const queryMetrics = async (args) => {
    calls.push(args);
    return [{ bucket: 't0', min: 0, max: 0, mean: 0, p95: 0 }];
  };
  const tool = createQueryMetricsTool({ queryMetrics });

  const result = await tool.handler({ service: 'session-store', field: 'req_per_sec' });

  assert.equal(calls.length, 1);
  assert.equal(result.traffic_status, 'no_traffic');
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
