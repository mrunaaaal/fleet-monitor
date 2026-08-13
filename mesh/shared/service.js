import Fastify from 'fastify';
import { startProbe } from '../../packages/probe/index.js';
import { downstreamName, downstreamQuery, resolveServiceUrl } from '../config.js';

const CHAOS_MODES = ['ok', 'slow', 'error', 'dead'];
const DEFAULT_SLOW_DELAY_MS = 3_000;
// Must exceed DEFAULT_SLOW_DELAY_MS so a `slow` downstream target is
// observed as a delay rather than a caller-side timeout, but stay bounded
// so a `dead` downstream target can't hang a caller forever.
const DEFAULT_DOWNSTREAM_TIMEOUT_MS = 5_000;

// Builds one mesh service from a topology entry (mesh/config.js). All
// eight services are the same factory call with a different config —
// the mesh shape lives entirely in data.
export function createService(
  serviceConfig,
  {
    resolveUrl = resolveServiceUrl,
    slowDelayMs = DEFAULT_SLOW_DELAY_MS,
    downstreamTimeoutMs = DEFAULT_DOWNSTREAM_TIMEOUT_MS,
    probeHooks,
    logger = false,
  } = {},
) {
  const { name, tier, downstream = [] } = serviceConfig;
  let mode = 'ok';

  const app = Fastify({ logger });

  app.get('/health', async () => ({ status: 'ok', service: name, tier }));

  app.post('/chaos', async (req, reply) => {
    const requestedMode = req.body?.mode;
    if (!CHAOS_MODES.includes(requestedMode)) {
      reply.code(400);
      return { error: `mode must be one of ${CHAOS_MODES.join(', ')}` };
    }
    mode = requestedMode;
    return { service: name, mode };
  });

  app.get('/work', async (req, reply) => {
    if (mode === 'dead') {
      // Stops responding entirely; the connection hangs until the caller
      // (or its own downstream timeout) gives up.
      await new Promise(() => {});
    }
    if (mode === 'slow') {
      await sleep(slowDelayMs);
    }
    if (mode === 'error') {
      reply.code(500);
      return { service: name, status: 'error', message: `${name} is failing` };
    }

    const targets = targetsFor(serviceConfig, req.query.feature);
    const results = await Promise.all(
      targets.map((target) => callDownstream(target, resolveUrl, downstreamTimeoutMs)),
    );
    const failedCount = results.filter((r) => !r.ok).length;
    if (failedCount > 0) {
      reply.code(502);
      return { service: name, status: 'error', message: 'downstream failure', failedCount };
    }
    return { service: name, status: 'ok' };
  });

  const probe = startProbe({
    serviceName: name,
    downstream: downstream.map(downstreamName),
    hooks: probeHooks,
  });
  app.addHook('onClose', async () => probe.stop());

  return app;
}

function targetsFor(serviceConfig, feature) {
  const featureTargets = feature && serviceConfig.routesByFeature?.[feature];
  if (!featureTargets) return serviceConfig.downstream ?? [];
  return serviceConfig.downstream.filter((entry) => featureTargets.includes(downstreamName(entry)));
}

async function callDownstream(entry, resolveUrl, timeoutMs) {
  const name = downstreamName(entry);
  const query = downstreamQuery(entry);
  const url = new URL('/work', resolveUrl(name));
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
