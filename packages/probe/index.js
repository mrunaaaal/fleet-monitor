import { startMetricsSampler } from './metrics.js';
import { startLogger } from './logger.js';
import { startDepsReporter } from './deps.js';
import { startHeartbeat } from './heartbeat.js';

// Imported by every mesh service. Skeleton only: wires up the four
// interval/trigger mechanisms a probe needs, but none of them ship
// telemetry anywhere yet — that lands service-by-service with the
// ingest tickets (metrics, liveness, logs, topology).
export function startProbe({ serviceName, downstream = [], hooks = {} } = {}) {
  if (!serviceName) throw new Error('startProbe requires a serviceName');

  const stopMetrics = startMetricsSampler({ onTick: hooks.onMetricsTick });
  const stopDeps = startDepsReporter({ downstream, onTick: hooks.onDepsTick });
  const stopHeartbeat = startHeartbeat({ onTick: hooks.onHeartbeatTick });
  const logger = startLogger({ onFlush: hooks.onLogFlush });

  return {
    log: logger.log,
    stop() {
      stopMetrics();
      stopDeps();
      stopHeartbeat();
      logger.stop();
    },
  };
}
