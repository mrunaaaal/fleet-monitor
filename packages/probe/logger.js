export const LOG_FLUSH_INTERVAL_MS = 2_000;
export const LOG_FLUSH_SIZE = 50;

// Skeleton: batches log lines in memory and flushes on a size-or-time
// trigger. Shipping the batch to `POST /v1/logs` lands with the
// logs-path ticket.
export function startLogger({
  intervalMs = LOG_FLUSH_INTERVAL_MS,
  maxBatchSize = LOG_FLUSH_SIZE,
  onFlush = () => {},
} = {}) {
  let buffer = [];

  function flush() {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    onFlush(batch);
  }

  const timer = setInterval(flush, intervalMs);
  timer.unref?.();

  function log(line) {
    buffer.push(line);
    if (buffer.length >= maxBatchSize) flush();
  }

  function stop() {
    clearInterval(timer);
    flush();
  }

  return { log, stop };
}
