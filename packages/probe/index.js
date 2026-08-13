import { startMetricsSampler, createMetricsRecorder } from './metrics.js';
import { startLogger } from './logger.js';
import { startDepsReporter } from './deps.js';
import { startHeartbeat } from './heartbeat.js';

// Imported by every mesh service. Wires up the four interval/trigger
// mechanisms a probe needs. Metrics ship via shipMetrics (POST
// /v1/metrics) and heartbeats via shipHeartbeat (POST /v1/heartbeat) if
// given; logs/deps ship with their own ingest tickets.
export function startProbe({
  serviceName,
  downstream = [],
  hooks = {},
  shipMetrics,
  host,
  shipHeartbeat,
} = {}) {
  if (!serviceName) throw new Error('startProbe requires a serviceName');

  const metricsRecorder = createMetricsRecorder();
  const stopMetrics = startMetricsSampler({
    recorder: metricsRecorder,
    onTick: hooks.onMetricsTick,
    shipMetrics,
    serviceName,
    host,
  });
  const stopDeps = startDepsReporter({ downstream, onTick: hooks.onDepsTick });
  const stopHeartbeat = startHeartbeat({ onTick: hooks.onHeartbeatTick, shipHeartbeat, serviceName });
  const logger = startLogger({ onFlush: hooks.onLogFlush });

  return {
    log: logger.log,
    recordRequest: metricsRecorder.recordRequest,
    stop() {
      stopMetrics();
      stopDeps();
      stopHeartbeat();
      logger.stop();
    },
  };
}
