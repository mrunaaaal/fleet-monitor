-- Edge access logs (fleet-monitor-docs.md §4.3/§12.2), same engine as
-- `logs` (0001_logs.sql) so the two tables are directly comparable. No
-- `service` column here — nginx is the single source — so ORDER BY leads
-- with `status` instead, since "show me the errors" is the equivalent
-- first filter an edge-log query reaches for.
CREATE TABLE IF NOT EXISTS nginx_logs (
  ts           DateTime64(3),
  remote_addr  String,
  method       LowCardinality(String),
  path         String,
  status       UInt16,
  bytes_sent   UInt64,
  request_time Float32,
  referer      String,
  user_agent   String
) ENGINE = MergeTree
ORDER BY (status, ts)
TTL toDateTime(ts) + INTERVAL 7 DAY
