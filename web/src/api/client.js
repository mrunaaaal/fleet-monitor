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

// POST /v1/investigate streams `data: <json>\n\n` frames (server/app.js's
// runInvestigation) — EventSource can't POST a body, so this reads the
// fetch response body itself and splits on the same "\n\n" frame boundary
// the server writes and investigate-route.test.js asserts against. Events
// are delivered via onEvent as they arrive rather than buffered into a
// return value, so the caller can render the trace live.
export async function investigate({ symptom }, { onEvent, signal } = {}) {
  const res = await fetch(`${BASE}/v1/investigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symptom }),
    signal,
  });
  if (!res.ok) throw new Error(`POST /v1/investigate failed: ${res.status}`);
  if (!res.body) throw new Error('POST /v1/investigate: streaming response body unavailable');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop();
    for (const frame of frames) {
      if (!frame.startsWith('data: ')) continue;
      onEvent?.(JSON.parse(frame.slice('data: '.length)));
    }
  }
}
