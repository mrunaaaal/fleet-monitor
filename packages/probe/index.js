import { startMetricsSampler, createMetricsRecorder } from './metrics.js';
import { startLogger } from './logger.js';
import { startDepsReporter } from './deps.js';
import { startHeartbeat } from './heartbeat.js';

// Imported by every mesh service. Wires up the four interval/trigger
// mechanisms a probe needs. Metrics ship on interval via shipMetrics
// (e.g. POST /v1/metrics) if provided; logs/deps/heartbeat ship with
// their own ingest tickets.
export function startProbe({ serviceName, downstream = [], hooks = {}, shipMetrics, host } = {}) {
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
  const stopHeartbeat = startHeartbeat({ onTick: hooks.onHeartbeatTick });
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
