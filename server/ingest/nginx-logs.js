import { NGINX_LOGBUF_KEY, FLUSH_BATCH_SIZE } from './flusher.js';
import { toClickhouseTimestamp } from '../db/clickhouse-timestamp.js';

// A batched line from nginx-log-tailer.js is one parsed JSON object from
// the access log's json_access log_format (nginx/nginx.conf) — all fields
// are required because nginx always emits every one of them.
export function normalizeNginxLogEntry(line) {
  const required = ['time', 'remote_addr', 'method', 'path', 'status'];
  for (const field of required) {
    if (line[field] === undefined || line[field] === null) {
      throw new Error(`nginx log line missing required field: ${field}`);
    }
  }
  return {
    ts: toClickhouseTimestamp(line.time),
    remote_addr: String(line.remote_addr),
    method: String(line.method),
    path: String(line.path),
    status: Number(line.status),
    bytes_sent: Number(line.bytes_sent ?? 0),
    request_time: Number(line.request_time ?? 0),
    referer: String(line.referer ?? ''),
    user_agent: String(line.user_agent ?? ''),
  };
}

// Mirrors ingest/logs.js: RPUSHes the batch onto the edge-log buffer and
// returns fast, letting the flusher drain it into nginx_logs on its own
// schedule (fleet-monitor-docs.md §12.2).
export function createNginxLogsIngestHandler({ redis, flusher, batchSize = FLUSH_BATCH_SIZE }) {
  return async function ingestNginxLogs(payload) {
    if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
      throw new Error('nginx logs payload requires a non-empty lines array');
    }

    const entries = payload.lines.map((line) => normalizeNginxLogEntry(line));
    const length = await redis.rpush(NGINX_LOGBUF_KEY, entries.map((entry) => JSON.stringify(entry)));

    if (flusher && length >= batchSize) {
      flusher.flushOnce().catch((err) => console.error('[nginx logs ingest] eager flush failed:', err.message));
    }
  };
}
