export const FLUSH_INTERVAL_MS = 2_000;
export const FLUSH_BATCH_SIZE = 1_000;
export const LOGBUF_KEY = 'logbuf';

// Drains `logbuf` into ClickHouse on a 2s-or-1000-entries trigger
// (fleet-monitor-docs.md §5.2): one INSERT per flush, never one per line.
// ClickHouse writes each INSERT as a new on-disk part and merges parts in
// the background — one insert per log line produces a merge queue that
// can't keep up and eventually a write-halting TOO_MANY_PARTS error. The
// size trigger is driven by the ingest handler calling flushOnce() eagerly
// when the buffer crosses batchSize; the timer here covers the time
// trigger and otherwise just drains whatever accumulated since the last
// tick (a no-op when the buffer is empty).
export function startFlusher({
  redis,
  clickhouse,
  intervalMs = FLUSH_INTERVAL_MS,
  batchSize = FLUSH_BATCH_SIZE,
  onFlush = () => {},
} = {}) {
  async function flushOnce() {
    const raw = await redis.lpopCount(LOGBUF_KEY, batchSize);
    if (raw.length === 0) return;
    await clickhouse.insertRows('logs', raw.map((entry) => JSON.parse(entry)));
    onFlush(raw.length);
  }

  const timer = setInterval(() => {
    flushOnce().catch((err) => console.error('[flusher] flush failed:', err.message));
  }, intervalMs);
  timer.unref?.();

  return {
    flushOnce,
    stop() {
      clearInterval(timer);
    },
  };
}
