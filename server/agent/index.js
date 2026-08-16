import { createListServicesQuery } from '../query/services.js';
import { createLivenessQuery } from '../query/liveness.js';
import { createDependenciesQuery, createSharedDependencyQuery, createBlastRadiusQuery } from '../query/topology.js';
import { createMetricsQuery } from '../query/metrics.js';
import { createLogsQuery, createLogSamplesQuery } from '../query/logs.js';
import {
  createListServicesTool,
  createCheckLivenessTool,
  createGetDependenciesTool,
  createFindSharedDependencyTool,
  createGetBlastRadiusTool,
} from './tools.js';
import { createQueryMetricsTool, createSearchLogsTool, createGetLogSamplesTool } from './summarizing-tools.js';
import { createSubmitFindingsTool } from './submit-findings-tool.js';
import { createToolDispatch } from './dispatch.js';

// Single entry point for the investigation loop (#14): takes the same
// store clients buildApp() does, wires them through the shared query/
// layer (never straight to a store — that's the point of the split), and
// returns a dispatch exposing all nine tools (fleet-monitor-docs.md §7.1):
// #12's five thin tools, #13's three summarizing tools, and #14's
// submit_findings terminal tool (which needs no store — it only validates).
export function createAgentTools({ postgres, redis, neo4j, influx, clickhouse, getMetricsSince }) {
  const listServices = createListServicesQuery({ postgres });
  const queryLiveness = createLivenessQuery({ redis });
  const queryDependencies = createDependenciesQuery({ neo4j });
  const querySharedDependency = createSharedDependencyQuery({ neo4j });
  const queryBlastRadius = createBlastRadiusQuery({ neo4j });
  const queryMetrics = createMetricsQuery({ influx });
  const searchLogs = createLogsQuery({ clickhouse });
  const getLogSamples = createLogSamplesQuery({ clickhouse });

  return createToolDispatch({
    tools: [
      createListServicesTool({ listServices }),
      createCheckLivenessTool({ queryLiveness, listServices }),
      createGetDependenciesTool({ queryDependencies }),
      createFindSharedDependencyTool({ querySharedDependency }),
      createGetBlastRadiusTool({ queryBlastRadius }),
      createQueryMetricsTool({ queryMetrics, getSince: getMetricsSince }),
      createSearchLogsTool({ searchLogs }),
      createGetLogSamplesTool({ getLogSamples }),
      createSubmitFindingsTool(),
    ],
  });
}
