// The five ingest routes (metrics, heartbeat, logs, nginx-logs, topology)
// all translate "handler resolved" -> 202/accepted and "handler threw" ->
// 400/{ error: message } identically; this is that shape, factored once.
export function registerIngestRoute(app, path, handler) {
  app.post(path, async (req, reply) => {
    try {
      await handler(req.body ?? {});
    } catch (err) {
      reply.code(400);
      return { error: err.message };
    }
    reply.code(202);
    return { status: 'accepted' };
  });
}
