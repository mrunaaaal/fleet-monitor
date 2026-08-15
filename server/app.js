import Fastify from 'fastify';
import { createInfluxClient } from './db/influx.js';
import { createRedisClient } from './db/redis.js';
import { createPostgresClient } from './db/postgres.js';
import { createClickhouseClient } from './db/clickhouse.js';
import { createNeo4jClient } from './db/neo4j.js';
import { createMetricsIngestHandler } from './ingest/metrics.js';
import { createHeartbeatIngestHandler } from './ingest/heartbeat.js';
import { createLogsIngestHandler } from './ingest/logs.js';
import { createNginxLogsIngestHandler } from './ingest/nginx-logs.js';
import { createTopologyIngestHandler } from './ingest/topology.js';
import { registerIngestRoute } from './ingest/register-route.js';
import { startFlusher, NGINX_LOGBUF_KEY } from './ingest/flusher.js';
import { createListServicesQuery } from './query/services.js';
import { createMetricsQuery } from './query/metrics.js';
import { createLivenessQuery } from './query/liveness.js';
import { createBlastRadiusQuery, createGraphQuery } from './query/topology.js';
import { createPersistInvestigationQuery } from './query/investigations.js';
import { createAgentTools } from './agent/index.js';
import { createInvestigationLoop } from './agent/loop.js';
import { createAnthropicModelClient } from './agent/model-client.js';
import { buildSystemPrompt } from './agent/system-prompt.js';

// Query-string values arrive as strings or are absent; queryMetrics wants
// either a real number or undefined (to fall through to its own default).
function parseOptionalNumber(value) {
  return value === undefined ? undefined : Number(value);
}

export function buildApp({
  influx = createInfluxClient(),
  redis,
  postgres = createPostgresClient(),
  clickhouse = createClickhouseClient(),
  neo4j = createNeo4jClient(),
  heartbeatTtlSeconds,
  logsFlushIntervalMs,
  callModel = createAnthropicModelClient(),
  investigationMaxIterations,
  investigationMaxCostUsd,
} = {}) {
  const app = Fastify({ logger: true });
  // Unlike the other stores, the flusher polls redis on its own timer
  // regardless of request traffic — so a self-created default client
  // actually opens a connection during the app's lifetime, not just
  // lazily on first request. Close it on shutdown so the process can
  // exit; a caller-supplied client remains the caller's to close.
  const ownsRedis = redis === undefined;
  const redisClient = redis ?? createRedisClient();
  const ingestMetrics = createMetricsIngestHandler({ influx });
  const ingestHeartbeat = createHeartbeatIngestHandler({ redis: redisClient, postgres, ttlSeconds: heartbeatTtlSeconds });
  const flusher = startFlusher({
    redis: redisClient,
    clickhouse,
    ...(logsFlushIntervalMs !== undefined ? { intervalMs: logsFlushIntervalMs } : {}),
  });
  const nginxLogsFlusher = startFlusher({
    redis: redisClient,
    clickhouse,
    bufferKey: NGINX_LOGBUF_KEY,
    table: 'nginx_logs',
    ...(logsFlushIntervalMs !== undefined ? { intervalMs: logsFlushIntervalMs } : {}),
  });
  const ingestLogs = createLogsIngestHandler({ redis: redisClient, flusher });
  const ingestNginxLogs = createNginxLogsIngestHandler({ redis: redisClient, flusher: nginxLogsFlusher });
  const ingestTopology = createTopologyIngestHandler({ neo4j });
  const listServices = createListServicesQuery({ postgres });
  const queryMetrics = createMetricsQuery({ influx });
  const queryLiveness = createLivenessQuery({ redis: redisClient });
  const queryGraph = createGraphQuery({ neo4j });
  const queryBlastRadius = createBlastRadiusQuery({ neo4j });
  const persistInvestigation = createPersistInvestigationQuery({ postgres });
  const agentTools = createAgentTools({ postgres, redis: redisClient, neo4j, influx, clickhouse });
  const investigationLoop = createInvestigationLoop({
    dispatch: agentTools.invoke,
    ...(investigationMaxIterations !== undefined ? { maxIterations: investigationMaxIterations } : {}),
    ...(investigationMaxCostUsd !== undefined ? { maxCostUsd: investigationMaxCostUsd } : {}),
  });
  app.addHook('onClose', async () => {
    flusher.stop();
    nginxLogsFlusher.stop();
    if (ownsRedis) await redisClient.close();
  });

  app.get('/health', async () => ({ status: 'ok' }));

  registerIngestRoute(app, '/v1/metrics', ingestMetrics);
  registerIngestRoute(app, '/v1/heartbeat', ingestHeartbeat);
  registerIngestRoute(app, '/v1/logs', ingestLogs);
  registerIngestRoute(app, '/v1/nginx-logs', ingestNginxLogs);
  registerIngestRoute(app, '/v1/topology', ingestTopology);

  app.get('/v1/services', async () => listServices());

  app.get('/v1/topology', async (req, reply) => {
    try {
      return await queryGraph();
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
  });

  app.get('/v1/topology/blast-radius', async (req, reply) => {
    const { service } = req.query ?? {};
    try {
      return await queryBlastRadius({ service });
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
  });

  app.get('/v1/liveness', async (req) => {
    const { services: servicesParam } = req.query ?? {};
    const services = servicesParam
      ? servicesParam.split(',').map((s) => s.trim()).filter(Boolean)
      : (await listServices()).map((s) => s.name);
    if (services.length === 0) return [];
    return queryLiveness({ services });
  });

  app.get('/v1/metrics', async (req, reply) => {
    const { service, field, windowMinutes, bucketMinutes } = req.query ?? {};
    try {
      return await queryMetrics({
        service,
        field,
        windowMinutes: parseOptionalNumber(windowMinutes),
        bucketMinutes: parseOptionalNumber(bucketMinutes),
      });
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
  });

  // The investigation loop's trace streams to the client as it unfolds
  // (fleet-monitor-docs.md §7.4: "that is the demo") — hijack() hands the
  // raw response to us so Fastify never tries to send its own reply once
  // we've already started writing SSE frames.
  app.post('/v1/investigate', (req, reply) => {
    const { symptom, evalScenario } = req.body ?? {};
    if (!symptom) {
      reply.code(400);
      return { error: 'investigate requires a symptom' };
    }

    reply.hijack();
    runInvestigation({ symptom, evalScenario, res: reply.raw, log: req.log });
  });

  async function runInvestigation({ symptom, evalScenario, res, log }) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    // Once headers are sent there's no HTTP status left to report a
    // failure with — an 'error' frame is the only way the client (and
    // eventually the Investigate page, #15) learns the stream ended
    // abnormally rather than just going silent.
    try {
      const systemPrompt = buildSystemPrompt({ services: await listServices() });
      const result = await investigationLoop.investigate(symptom, {
        callModel,
        systemPrompt,
        tools: agentTools.list(),
        onEvent: send,
      });

      await persistInvestigation({
        symptom,
        findings: result.findings,
        trace: result.trace,
        iterations: result.iterations,
        toolCalls: result.toolCalls,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        terminated: result.terminated,
        evalScenario,
      });

      send({ type: 'result', ...result });
    } catch (err) {
      log.error(err);
      send({ type: 'error', message: err.message });
    } finally {
      res.end();
    }
  }

  return app;
}
