import Fastify from 'fastify';
import { createInfluxClient } from './db/influx.js';
import { createRedisClient } from './db/redis.js';
import { createMetricsIngestHandler } from './ingest/metrics.js';
import { createHeartbeatIngestHandler } from './ingest/heartbeat.js';

export function buildApp({
  influx = createInfluxClient(),
  redis = createRedisClient(),
  heartbeatTtlSeconds,
} = {}) {
  const app = Fastify({ logger: true });
  const ingestMetrics = createMetricsIngestHandler({ influx });
  const ingestHeartbeat = createHeartbeatIngestHandler({ redis, ttlSeconds: heartbeatTtlSeconds });

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

  return app;
}
