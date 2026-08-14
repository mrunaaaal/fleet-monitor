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

export async function fetchTopology() {
  const res = await fetch(`${BASE}/v1/topology`);
  if (!res.ok) throw new Error(`GET /v1/topology failed: ${res.status}`);
  return res.json();
}

export async function fetchBlastRadius({ service }) {
  const params = new URLSearchParams({ service });
  const res = await fetch(`${BASE}/v1/topology/blast-radius?${params}`);
  if (!res.ok) throw new Error(`GET /v1/topology/blast-radius failed: ${res.status}`);
  return res.json();
}

export async function fetchLiveness() {
  const res = await fetch(`${BASE}/v1/liveness`);
  if (!res.ok) throw new Error(`GET /v1/liveness failed: ${res.status}`);
  return res.json();
}
