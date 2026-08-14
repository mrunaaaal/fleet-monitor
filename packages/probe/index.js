import { startMetricsSampler, createMetricsRecorder } from './metrics.js';
import { startLogger } from './logger.js';
import { startDepsReporter } from './deps.js';
import { startHeartbeat } from './heartbeat.js';

// Imported by every mesh service. Wires up the four interval/trigger
// mechanisms a probe needs. Metrics ship via shipMetrics (POST
// /v1/metrics), heartbeats via shipHeartbeat (POST /v1/heartbeat), logs
// via shipLogs (POST /v1/logs), and deps via shipTopology (POST
// /v1/topology) if given.
export function startProbe({
  serviceName,
  tier,
  downstream = [],
  hooks = {},
  shipMetrics,
  host,
  shipHeartbeat,
  shipLogs,
  shipTopology,
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
  const stopDeps = startDepsReporter({ downstream, onTick: hooks.onDepsTick, shipTopology, serviceName, tier });
  const stopHeartbeat = startHeartbeat({ onTick: hooks.onHeartbeatTick, shipHeartbeat, serviceName, tier });
  const logger = startLogger({ onFlush: hooks.onLogFlush, shipLogs, serviceName });

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
