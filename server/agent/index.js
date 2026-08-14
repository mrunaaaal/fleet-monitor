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
import { createToolDispatch } from './dispatch.js';

// Single entry point for the investigation loop (#14): takes the same
// store clients buildApp() does, wires them through the shared query/
// layer (never straight to a store — that's the point of the split), and
// returns a dispatch exposing #12's five thin tools plus #13's three
// summarizing tools. #14 adds the submit_findings terminal tool alongside
// these.
export function createAgentTools({ postgres, redis, neo4j, influx, clickhouse }) {
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
      createQueryMetricsTool({ queryMetrics }),
      createSearchLogsTool({ searchLogs }),
      createGetLogSamplesTool({ getLogSamples }),
    ],
  });
}
