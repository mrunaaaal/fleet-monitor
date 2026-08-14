import Fastify from 'fastify';
import { createInfluxClient } from './db/influx.js';
import { createRedisClient } from './db/redis.js';
import { createPostgresClient } from './db/postgres.js';
import { createClickhouseClient } from './db/clickhouse.js';
import { createNeo4jClient } from './db/neo4j.js';
import { createMetricsIngestHandler } from './ingest/metrics.js';
import { createHeartbeatIngestHandler } from './ingest/heartbeat.js';
import { createLogsIngestHandler } from './ingest/logs.js';
import { createTopologyIngestHandler } from './ingest/topology.js';
import { startFlusher } from './ingest/flusher.js';

export function buildApp({
  influx = createInfluxClient(),
  redis,
  postgres = createPostgresClient(),
  clickhouse = createClickhouseClient(),
  neo4j = createNeo4jClient(),
  heartbeatTtlSeconds,
  logsFlushIntervalMs,
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
  const ingestLogs = createLogsIngestHandler({ redis: redisClient, flusher });
  const ingestTopology = createTopologyIngestHandler({ neo4j });
  app.addHook('onClose', async () => {
    flusher.stop();
    if (ownsRedis) await redisClient.close();
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/v1/metrics', async (req, reply) => {
    try {
      await ingestMetrics(req.body ?? {});
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
    reply.code(202);
    return { status: 'accepted' };
  });

  app.post('/v1/heartbeat', async (req, reply) => {
    try {
      await ingestHeartbeat(req.body ?? {});
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
    reply.code(202);
    return { status: 'accepted' };
  });

  app.post('/v1/logs', async (req, reply) => {
    try {
      await ingestLogs(req.body ?? {});
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
    reply.code(202);
    return { status: 'accepted' };
  });

  app.post('/v1/topology', async (req, reply) => {
    try {
      await ingestTopology(req.body ?? {});
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
    reply.code(202);
    return { status: 'accepted' };
  });

  return app;
}
