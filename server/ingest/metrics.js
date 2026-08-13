import { TAG_NAMES, FIELD_NAMES } from '../db/metrics-schema.js';

// Only TAG_NAMES ever become InfluxDB tags — any other payload field is
// ignored rather than risking a cardinality explosion (fleet-monitor-
// docs.md §4.4: tags are indexed and must stay bounded).
export function toLineProtocol(payload) {
  const tags = TAG_NAMES.map((name) => `${name}=${escapeTag(payload[name])}`).join(',');
  const fields = FIELD_NAMES.map((name) => `${name}=${Number(payload[name])}`).join(',');
  return `metrics,${tags} ${fields}`;
}

function escapeTag(value) {
  return String(value).replace(/([ ,=])/g, '\\$1');
}

export function createMetricsIngestHandler({ influx }) {
  return async function ingestMetrics(payload) {
    const missing = [...TAG_NAMES, ...FIELD_NAMES].filter((name) => payload[name] === undefined);
    if (missing.length > 0) {
      throw new Error(`metrics payload missing required field(s): ${missing.join(', ')}`);
    }
    await influx.writeLineProtocol(toLineProtocol(payload));
  };
}
