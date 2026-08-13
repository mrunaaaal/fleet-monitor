import Fastify from 'fastify';
import { createInfluxClient } from './db/influx.js';
import { createMetricsIngestHandler } from './ingest/metrics.js';

export function buildApp({ influx = createInfluxClient() } = {}) {
  const app = Fastify({ logger: true });
  const ingestMetrics = createMetricsIngestHandler({ influx });

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

  return app;
}
