export const LOG_FLUSH_INTERVAL_MS = 2_000;
export const LOG_FLUSH_SIZE = 50;

// Batches log lines in memory and flushes on a size-or-time trigger,
// shipping the batch to `POST /v1/logs` via shipLogs (e.g.
// defaultShipLogs in mesh/shared/service.js) if given.
export function startLogger({
  intervalMs = LOG_FLUSH_INTERVAL_MS,
  maxBatchSize = LOG_FLUSH_SIZE,
  onFlush = () => {},
  shipLogs,
  serviceName,
} = {}) {
  let buffer = [];

  function flush() {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    onFlush(batch);
    if (shipLogs) {
      Promise.resolve()
        .then(() => shipLogs({ service: serviceName, lines: batch }))
        .catch((err) => console.error(`[probe] failed to ship logs for ${serviceName}:`, err.message));
    }
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
