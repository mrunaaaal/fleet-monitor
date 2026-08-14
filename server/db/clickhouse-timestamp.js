// Shared by ingest/logs.js and ingest/nginx-logs.js — both need to convert
// a Date/epoch/ISO-8601 timestamp into the format ClickHouse's default
// (non-best-effort) DateTime64 JSON parsing expects:
// 'YYYY-MM-DD HH:MM:SS.mmm', not ISO 8601's 'T'/'Z' separators.
export function toClickhouseTimestamp(value) {
  return new Date(value).toISOString().replace('T', ' ').replace('Z', '');
}
