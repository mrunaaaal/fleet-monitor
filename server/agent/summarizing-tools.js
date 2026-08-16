// The three tools whose output is designed for a language model, not a
// human (spec issue #13, fleet-monitor-docs.md §7.2): reduced metrics,
// clustered log search, and capped samples. Unlike #12's five thin tools,
// these do real aggregation — never raw datapoints or raw log lines.

// A window barely moving is more useful reported as "flat" than as "up"
// or "down" by a fraction of a percent — this threshold is what draws
// that line.
const FLAT_TREND_THRESHOLD = 0.05;

// getSince is an internal seam, not part of the model-facing schema: the
// eval harness (issue #26) uses it to pin every query_metrics call to the
// current scenario's start, so a stale-but-in-window query can't surface
// an earlier scenario's chaos. Production callers omit it.
export function createQueryMetricsTool({ queryMetrics, getSince }) {
  return {
    name: 'query_metrics',
    description:
      'Get reduced metric statistics for a service over a time window: min/max/mean/p95, ' +
      'trend direction, and the timestamp of the largest single change. Never raw datapoints.',
    input_schema: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        field: { type: 'string', description: 'e.g. cpu_pct, p95_latency_ms, error_rate' },
        windowMinutes: { type: 'number', description: 'optional; defaults to the query layer default' },
      },
      required: ['service', 'field'],
    },
    async handler({ service, field, windowMinutes } = {}) {
      const args = { service, field };
      if (windowMinutes !== undefined) args.windowMinutes = windowMinutes;
      const since = getSince?.();
      if (since !== undefined) args.since = since;

      const buckets = await queryMetrics(args);
      return { service, field, ...reduceBuckets(buckets) };
    },
  };
}

function reduceBuckets(buckets) {
  if (buckets.length === 0) {
    return { min: null, max: null, mean: null, p95: null, trend: 'insufficient_data', largest_change_at: null };
  }

  const min = Math.min(...buckets.map((b) => b.min));
  const max = Math.max(...buckets.map((b) => b.max));
  const mean = buckets.reduce((sum, b) => sum + b.mean, 0) / buckets.length;
  // A true window-wide p95 needs raw datapoints, which this tool
  // deliberately never touches — the max of the per-bucket p95s is a
  // conservative (never-underestimating) stand-in for the window's tail.
  const p95 = Math.max(...buckets.map((b) => b.p95));

  if (buckets.length < 2) {
    return { min, max, mean, p95, trend: 'insufficient_data', largest_change_at: null };
  }

  const first = buckets[0].mean;
  const last = buckets[buckets.length - 1].mean;
  const relativeChange = first === 0 ? (last === 0 ? 0 : Infinity) : (last - first) / Math.abs(first);
  const trend = Math.abs(relativeChange) < FLAT_TREND_THRESHOLD ? 'flat' : relativeChange > 0 ? 'up' : 'down';

  let largestChangeAt = buckets[1].bucket;
  let largestChange = Math.abs(buckets[1].mean - buckets[0].mean);
  for (let i = 2; i < buckets.length; i += 1) {
    const change = Math.abs(buckets[i].mean - buckets[i - 1].mean);
    if (change > largestChange) {
      largestChange = change;
      largestChangeAt = buckets[i].bucket;
    }
  }

  return { min, max, mean, p95, trend, largest_change_at: largestChangeAt };
}

export function createSearchLogsTool({ searchLogs }) {
  return {
    name: 'search_logs',
    description:
      'Search logs for a service in a time window. Returns error counts and clustered message ' +
      'patterns, not individual lines. Use get_log_samples for specific examples once you know ' +
      'which pattern matters.',
    input_schema: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        level: { type: 'string', enum: ['error', 'warn', 'info'] },
        pattern: { type: 'string', description: 'optional substring filter' },
        from: { type: 'string', description: 'ISO 8601 timestamp' },
        to: { type: 'string', description: 'ISO 8601 timestamp' },
      },
      required: ['service', 'from', 'to'],
    },
    async handler(input = {}) {
      return searchLogs(input);
    },
  };
}

export function createGetLogSamplesTool({ getLogSamples }) {
  return {
    name: 'get_log_samples',
    description:
      'Get up to 5 raw, truncated log lines matching a filter. Use only after search_logs has ' +
      'identified which pattern matters — this returns examples, not aggregates.',
    input_schema: {
      type: 'object',
      properties: {
        service: { type: 'string' },
        level: { type: 'string', enum: ['error', 'warn', 'info'] },
        pattern: { type: 'string', description: 'optional substring filter' },
        from: { type: 'string', description: 'ISO 8601 timestamp' },
        to: { type: 'string', description: 'ISO 8601 timestamp' },
      },
      required: ['service', 'from', 'to'],
    },
    async handler(input = {}) {
      return { samples: await getLogSamples(input) };
    },
  };
}
