import { LOGBUF_KEY, FLUSH_BATCH_SIZE } from './flusher.js';
import { toClickhouseTimestamp } from '../db/clickhouse-timestamp.js';

const DEFAULT_LEVEL = 'info';

// A batched line from the probe's logger.js is either a bare string
// (treated as the message, level defaults to 'info') or an object with
// level/message/trace_id/ts — matches how `probe.log()` is called at the
// service call site.
export function normalizeLogEntry(service, line) {
  const raw = typeof line === 'string' ? { message: line } : line;
  if (!raw.message) {
    throw new Error('log line missing required field: message');
  }
  return {
    ts: toClickhouseTimestamp(raw.ts ?? Date.now()),
    service,
    level: raw.level ?? DEFAULT_LEVEL,
    message: String(raw.message),
    trace_id: raw.trace_id ?? '',
  };
}

// RPUSHes the batch onto `logbuf` and returns fast (fleet-monitor-docs.md
// §5.2) — the flusher drains it into ClickHouse on its own schedule. If
// this RPUSH pushes the buffer over the flusher's batch size, an eager
// flush is kicked off rather than waiting for the 2s timer, so the size
// trigger doesn't depend on polling.
export function createLogsIngestHandler({ redis, flusher, batchSize = FLUSH_BATCH_SIZE }) {
  return async function ingestLogs(payload) {
    if (!payload.service) {
      throw new Error('logs payload missing required field: service');
    }
    if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
      throw new Error('logs payload requires a non-empty lines array');
    }

    const entries = payload.lines.map((line) => normalizeLogEntry(payload.service, line));
    const length = await redis.rpush(LOGBUF_KEY, entries.map((entry) => JSON.stringify(entry)));

    if (flusher && length >= batchSize) {
      flusher.flushOnce().catch((err) => console.error('[logs ingest] eager flush failed:', err.message));
    }
  };
}
