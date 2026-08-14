// Synthetic chart history only — never evidence (fleet-monitor-docs.md
// §12.4, "the credibility line"). This writes a week of plausible metrics
// with historical timestamps so the Overview page's charts aren't empty
// on a cold start. Nothing it writes is ever fed to the agent as evidence
// of an incident; investigations only ever read real, chaos-induced
// telemetry from the running mesh.
import { pathToFileURL } from 'node:url';
import { createInfluxClient } from '../server/db/influx.js';
import { services } from '../mesh/config.js';
import { toLineProtocol as toMetricsLineProtocol } from '../server/ingest/metrics.js';

const DAYS = 7;
const BUCKET_MINUTES = 5;
const HOST = 'local';
const BATCH_SIZE = 5_000;

// A handful of past incidents: a random service gets a rough patch for a
// few hours, driving up latency/error rate/CPU together. Fixed count and
// bounded duration so a run doesn't accidentally cover the whole week.
const INCIDENT_COUNT = 3;
const INCIDENT_DURATION_HOURS = [2, 5];

const BASELINES = {
  cpu_pct: 18,
  mem_mb: 140,
  req_per_sec: 8,
  error_rate: 0.004,
  p95_latency_ms: 90,
};

function dailyCycleMultiplier(date) {
  // Peaks around midday, troughs overnight — a single sine cycle per 24h.
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const radians = ((hour - 6) / 24) * 2 * Math.PI;
  return 0.55 + 0.45 * Math.max(0, Math.sin(radians));
}

function weekendMultiplier(date) {
  const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6 ? 0.6 : 1;
}

function jitter(spread) {
  return 1 + (Math.random() * 2 - 1) * spread;
}

function pickIncidentWindows(startMs, endMs) {
  const windows = [];
  for (let i = 0; i < INCIDENT_COUNT; i++) {
    const service = services[Math.floor(Math.random() * services.length)].name;
    const durationMs =
      (INCIDENT_DURATION_HOURS[0] + Math.random() * (INCIDENT_DURATION_HOURS[1] - INCIDENT_DURATION_HOURS[0])) *
      60 *
      60 *
      1000;
    const start = startMs + Math.random() * (endMs - startMs - durationMs);
    windows.push({ service, start, end: start + durationMs });
  }
  return windows;
}

function isDuringIncident(windows, service, timeMs) {
  return windows.some((w) => w.service === service && timeMs >= w.start && timeMs < w.end);
}

function generatePoint({ service, timeMs, incidentWindows }) {
  const date = new Date(timeMs);
  const load = dailyCycleMultiplier(date) * weekendMultiplier(date);
  const inIncident = isDuringIncident(incidentWindows, service, timeMs);

  const reqPerSec = BASELINES.req_per_sec * load * jitter(0.15);
  const cpuPct = Math.min(98, BASELINES.cpu_pct * load * jitter(0.2) * (inIncident ? 3.5 : 1));
  const memMb = BASELINES.mem_mb * (0.85 + load * 0.3) * jitter(0.05) * (inIncident ? 1.4 : 1);
  const errorRate = Math.min(1, BASELINES.error_rate * jitter(0.5) + (inIncident ? 0.35 * jitter(0.3) : 0));
  const p95LatencyMs = BASELINES.p95_latency_ms * jitter(0.25) * (inIncident ? 6 * jitter(0.3) : 1);

  return {
    service,
    host: HOST,
    cpu_pct: cpuPct,
    mem_mb: memMb,
    req_per_sec: reqPerSec,
    error_rate: errorRate,
    p95_latency_ms: p95LatencyMs,
  };
}

// Reuses the real ingest path's line-protocol encoding (tag escaping and
// all) rather than re-deriving it, and just appends the historical
// timestamp that live ingest never needs (it writes at "now").
function toLineProtocol(point, timeMs) {
  return `${toMetricsLineProtocol(point)} ${timeMs}`;
}

export async function backfill({ influx = createInfluxClient(), now = Date.now() } = {}) {
  const endMs = now;
  const startMs = endMs - DAYS * 24 * 60 * 60 * 1000;
  const bucketMs = BUCKET_MINUTES * 60 * 1000;
  const incidentWindows = pickIncidentWindows(startMs, endMs);

  let lines = [];
  let written = 0;

  for (const { name: service } of services) {
    for (let timeMs = startMs; timeMs < endMs; timeMs += bucketMs) {
      const point = generatePoint({ service, timeMs, incidentWindows });
      lines.push(toLineProtocol(point, timeMs));
      if (lines.length >= BATCH_SIZE) {
        await influx.writeLineProtocol(lines.join('\n'));
        written += lines.length;
        lines = [];
      }
    }
  }
  if (lines.length > 0) {
    await influx.writeLineProtocol(lines.join('\n'));
    written += lines.length;
  }

  return { written, incidentWindows };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  console.log(
    `[backfill] writing ${DAYS} days of SYNTHETIC chart history (${services.length} services, ` +
      `${BUCKET_MINUTES}m buckets). This is fabricated data for chart density only — it is never ` +
      `read as investigation evidence.`,
  );
  const { written, incidentWindows } = await backfill();
  console.log(`[backfill] wrote ${written} points.`);
  console.log(
    `[backfill] synthetic incidents: ${incidentWindows
      .map((w) => `${w.service} (${new Date(w.start).toISOString()} → ${new Date(w.end).toISOString()})`)
      .join(', ')}`,
  );
}
