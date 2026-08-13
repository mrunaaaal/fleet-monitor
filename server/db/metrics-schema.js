// The InfluxDB `metrics` measurement (fleet-monitor-docs.md §4.4). Tags
// are indexed and must stay bounded (service: 8, host: 1); fields are
// the five sampled vitals. Shared by ingest (writes) and query (reads)
// so the schema is defined once.
export const TAG_NAMES = ['service', 'host'];
export const FIELD_NAMES = ['cpu_pct', 'mem_mb', 'req_per_sec', 'error_rate', 'p95_latency_ms'];
