import { statSync, createReadStream } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { extractLines, parseAccessLogLine } from './nginx-log-tailer-lines.js';

export const TAIL_POLL_INTERVAL_MS = 500;
export const TAIL_FLUSH_INTERVAL_MS = 2_000;
export const TAIL_FLUSH_BATCH_SIZE = 50;

function readNewBytes(path, start, end) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    createReadStream(path, { start, end: end - 1 })
      .on('data', (chunk) => chunks.push(chunk))
      .on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      .on('error', reject);
  });
}

// Polls the access log for growth like `tail -f` and ships parsed JSON
// lines to POST /v1/nginx-logs on the same size-or-time trigger as the
// buffered log path (fleet-monitor-docs.md §12.2). Config and I/O are
// injectable (mirrors ingest/flusher.js's DI shape) so pollOnce can be
// exercised with fakes instead of a real file and network call.
export function createNginxLogTailer({
  accessLogPath = process.env.ACCESS_LOG_PATH ?? '/var/log/nginx/access.log',
  ingestUrl = process.env.INGEST_URL ?? 'http://fastify:3000',
  pollIntervalMs = TAIL_POLL_INTERVAL_MS,
  flushIntervalMs = TAIL_FLUSH_INTERVAL_MS,
  flushBatchSize = TAIL_FLUSH_BATCH_SIZE,
  statFn = statSync,
  readBytesFn = readNewBytes,
  fetchImpl = fetch,
} = {}) {
  let offset = null;
  let buffer = [];
  let partial = '';
  let lastFlush = Date.now();

  async function shipBatch(lines) {
    if (lines.length === 0) return;
    try {
      const res = await fetchImpl(`${ingestUrl}/v1/nginx-logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
      if (!res.ok) throw new Error(`ingest returned ${res.status}`);
    } catch (err) {
      console.error('[nginx-log-tailer] failed to ship batch:', err.message);
    }
  }

  async function flush() {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    lastFlush = Date.now();
    await shipBatch(batch);
  }

  // One tick: pick up growth since the last call (starting from the
  // file's current end on the very first call, so only lines written
  // after the tailer starts are shipped), then flush on the size-or-time
  // trigger.
  async function pollOnce() {
    let size;
    try {
      size = statFn(accessLogPath).size;
    } catch {
      return;
    }

    if (offset === null) {
      offset = size;
      return;
    }

    if (size > offset) {
      const text = await readBytesFn(accessLogPath, offset, size);
      offset = size;
      const { lines, partial: nextPartial } = extractLines(partial, text);
      partial = nextPartial;
      for (const line of lines) {
        const parsed = parseAccessLogLine(line);
        if (parsed) buffer.push(parsed);
      }
    }

    if (buffer.length >= flushBatchSize || (buffer.length > 0 && Date.now() - lastFlush >= flushIntervalMs)) {
      await flush();
    }
  }

  let running = false;
  async function run() {
    running = true;
    console.log(`[nginx-log-tailer] tailing ${accessLogPath}`);
    while (running) {
      await pollOnce();
      await delay(pollIntervalMs);
    }
  }

  return {
    pollOnce,
    run,
    stop() {
      running = false;
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tailer = createNginxLogTailer();
  tailer.run().catch((err) => {
    console.error('[nginx-log-tailer] fatal:', err);
    process.exit(1);
  });
}
