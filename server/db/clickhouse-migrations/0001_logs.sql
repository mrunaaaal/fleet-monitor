-- Log storage (fleet-monitor-docs.md §4.3). LowCardinality dictionary-encodes
-- service/level; ORDER BY (service, ts) because nearly every query filters by
-- service first, then time range; the token bloom filter lets substring
-- searches skip granules instead of scanning every row.
CREATE TABLE IF NOT EXISTS logs (
  ts        DateTime64(3),
  service   LowCardinality(String),
  level     LowCardinality(String),
  message   String,
  trace_id  String,
  INDEX msg_idx message TYPE tokenbf_v1(8192, 3, 0) GRANULARITY 4
) ENGINE = MergeTree
ORDER BY (service, ts)
TTL toDateTime(ts) + INTERVAL 7 DAY
