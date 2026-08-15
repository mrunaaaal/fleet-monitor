import { reportOnTrigger, sizeOrTimeTrigger } from './report-on-trigger.js';

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
  const { push, stop } = reportOnTrigger({
    trigger: sizeOrTimeTrigger({ intervalMs, maxBatchSize }),
    onTick: onFlush,
    ship: shipLogs && ((batch) => shipLogs({ service: serviceName, lines: batch })),
    serviceName,
    kind: 'logs',
  });

  return { log: push, stop };
}
