// Mirrors server/db/metrics-schema.js FIELD_NAMES — kept as a separate
// list here because the frontend also needs a display label, unit, and
// scale (error_rate is stored as a 0..1 fraction, not a percentage).
export const FIELDS = [
  { value: 'p95_latency_ms', label: 'p95 latency', unit: 'ms', scale: 1 },
  { value: 'cpu_pct', label: 'CPU', unit: '%', scale: 1 },
  { value: 'mem_mb', label: 'Memory', unit: 'MB', scale: 1 },
  { value: 'req_per_sec', label: 'Requests/sec', unit: '/s', scale: 1 },
  { value: 'error_rate', label: 'Error rate', unit: '%', scale: 100 },
];

export const POLL_INTERVAL_MS = 15_000;
