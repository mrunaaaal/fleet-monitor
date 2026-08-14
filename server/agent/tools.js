// The five thin agent tools (spec issue #12, fleet-monitor-docs.md §7.1):
// each wraps an existing query/ function and shapes its result for the
// model. None of these need the clustering/reduction #13's tools do — the
// underlying queries are already small (a handful of services at most) —
// so "formatter" here is just adding the field names a model expects
// around data the query layer already returns.
export function createListServicesTool({ listServices }) {
  return {
    name: 'list_services',
    description:
      'List every service in the mesh with its tier (user-facing/internal/datastore). ' +
      'Cheap orientation call — use before anything else.',
    input_schema: { type: 'object', properties: {}, required: [] },
    async handler() {
      return { services: await listServices() };
    },
  };
}

export function createCheckLivenessTool({ queryLiveness, listServices }) {
  return {
    name: 'check_liveness',
    description:
      'Check whether each service is currently reporting a heartbeat (up/down). ' +
      'Cheap — check this before running any other tool.',
    input_schema: {
      type: 'object',
      properties: {
        services: {
          type: 'array',
          items: { type: 'string' },
          description: 'optional; defaults to every registered service',
        },
      },
      required: [],
    },
    async handler({ services } = {}) {
      // services === [] (explicitly, not omitted) means "check nothing",
      // not "fall back to every service" — only an omitted arg defaults.
      const targets = services === undefined ? (await listServices()).map((s) => s.name) : services;
      if (targets.length === 0) return { liveness: [] };
      return { liveness: await queryLiveness({ services: targets }) };
    },
  };
}

export function createGetDependenciesTool({ queryDependencies }) {
  return {
    name: 'get_dependencies',
    description:
      'Get the services a given service calls downstream. Walk this from a symptomatic ' +
      'service toward its dependencies to find a cause.',
    input_schema: {
      type: 'object',
      properties: { service: { type: 'string' } },
      required: ['service'],
    },
    async handler({ service } = {}) {
      const downstream = await queryDependencies({ service });
      return { service, downstream };
    },
  };
}

export function createFindSharedDependencyTool({ querySharedDependency }) {
  return {
    name: 'find_shared_dependency',
    description:
      'Given several independently-alerting services, find the downstream service they all ' +
      'depend on — narrows a diamond or multi-failure incident to one shared cause.',
    input_schema: {
      type: 'object',
      properties: {
        services: { type: 'array', items: { type: 'string' }, description: 'the alerting services' },
      },
      required: ['services'],
    },
    async handler({ services } = {}) {
      const sharedDependencies = await querySharedDependency({ services });
      return { services, shared_dependencies: sharedDependencies };
    },
  };
}

export function createGetBlastRadiusTool({ queryBlastRadius }) {
  return {
    name: 'get_blast_radius',
    description:
      'Get every service upstream of a failing service, with hop distance and tier, to report impact.',
    input_schema: {
      type: 'object',
      properties: { service: { type: 'string' } },
      required: ['service'],
    },
    async handler({ service } = {}) {
      const affected = await queryBlastRadius({ service });
      return { service, affected };
    },
  };
}
