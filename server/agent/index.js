import { createListServicesQuery } from '../query/services.js';
import { createLivenessQuery } from '../query/liveness.js';
import { createDependenciesQuery, createSharedDependencyQuery, createBlastRadiusQuery } from '../query/topology.js';
import {
  createListServicesTool,
  createCheckLivenessTool,
  createGetDependenciesTool,
  createFindSharedDependencyTool,
  createGetBlastRadiusTool,
} from './tools.js';
import { createToolDispatch } from './dispatch.js';

// Single entry point for the investigation loop (#14): takes the same
// store clients buildApp() does, wires them through the shared query/
// layer (never straight to a store — that's the point of the split), and
// returns a dispatch exposing this ticket's five thin tools. #13 will add
// the summarizing tools (query_metrics, search_logs, get_log_samples) and
// #14 the submit_findings terminal tool alongside these.
export function createAgentTools({ postgres, redis, neo4j }) {
  const listServices = createListServicesQuery({ postgres });
  const queryLiveness = createLivenessQuery({ redis });
  const queryDependencies = createDependenciesQuery({ neo4j });
  const querySharedDependency = createSharedDependencyQuery({ neo4j });
  const queryBlastRadius = createBlastRadiusQuery({ neo4j });

  return createToolDispatch({
    tools: [
      createListServicesTool({ listServices }),
      createCheckLivenessTool({ queryLiveness, listServices }),
      createGetDependenciesTool({ queryDependencies }),
      createFindSharedDependencyTool({ querySharedDependency }),
      createGetBlastRadiusTool({ queryBlastRadius }),
    ],
  });
}
