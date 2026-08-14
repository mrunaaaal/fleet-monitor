// Thin fetch wrapper over the query API — nginx proxies /api/ to the
// Fastify server's root, so a call to /api/v1/services hits GET /v1/services.
const BASE = '/api';

export async function fetchServices() {
  const res = await fetch(`${BASE}/v1/services`);
  if (!res.ok) throw new Error(`GET /v1/services failed: ${res.status}`);
  return res.json();
}

export async function fetchMetrics({ service, field, windowMinutes = 60, bucketMinutes = 5 }) {
  const params = new URLSearchParams({
    service,
    field,
    windowMinutes: String(windowMinutes),
    bucketMinutes: String(bucketMinutes),
  });
  const res = await fetch(`${BASE}/v1/metrics?${params}`);
  if (!res.ok) throw new Error(`GET /v1/metrics failed: ${res.status}`);
  return res.json();
}
