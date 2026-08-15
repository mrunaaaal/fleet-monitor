import { startInterval } from './interval-trigger.js';

// Shared "schedule -> sample -> ship -> swallow-and-log" shape used by
// every probe telemetry kind (metrics, heartbeat, deps/topology, and the
// logger's flush). `trigger` owns *when* a report fires and what data it
// carries; this module owns turning a fire into an onTick call plus a
// best-effort, failure-swallowing ship — a dead ingest endpoint should
// never crash the service being monitored.
export function reportOnTrigger({ trigger, onTick = () => {}, ship, serviceName, kind }) {
  return trigger((data) => {
    onTick(data);
    if (ship) {
      Promise.resolve()
        .then(() => ship(data))
        .catch((err) => console.error(`[probe] failed to ship ${kind} for ${serviceName}:`, err.message));
    }
  });
}

// Fixed-interval trigger used by metrics, heartbeat, and deps: samples on
// every tick and reports whatever `sample()` returns.
export function intervalTrigger(intervalMs, sample) {
  return (report) => startInterval(intervalMs, () => report(sample()));
}

// Size-or-time trigger used by the logger: batches pushed items and
// reports the batch once it hits `maxBatchSize` or `intervalMs` elapses,
// whichever comes first. Never reports an empty batch. Returns `push` (to
// feed items in) alongside `stop` (which flushes any remainder), rather
// than just a stop function like `intervalTrigger` — the logger needs a
// way to feed data in, not just a way to shut the trigger down.
export function sizeOrTimeTrigger({ intervalMs, maxBatchSize }) {
  return (report) => {
    let buffer = [];

    function flush() {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      report(batch);
    }

    const timer = setInterval(flush, intervalMs);
    timer.unref?.();

    function push(item) {
      buffer.push(item);
      if (buffer.length >= maxBatchSize) flush();
    }

    return {
      push,
      stop() {
        clearInterval(timer);
        flush();
      },
    };
  };
}
