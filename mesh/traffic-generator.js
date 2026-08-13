import { userFacingServices, resolveServiceUrl } from './config.js';

const DEFAULT_RATE_PER_SECOND = 5;
const DEFAULT_JITTER_RATIO = 0.2;
// Bounds how long a single request can block the round-robin loop, so a
// target set to the `dead` chaos mode (which never responds) can't stall
// traffic to every other target.
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

// +/- jitterRatio around baseMs, e.g. jitteredIntervalMs(200, 0.2) is
// somewhere in [160, 240].
export function jitteredIntervalMs(baseMs, jitterRatio = DEFAULT_JITTER_RATIO, random = Math.random) {
  const spread = baseMs * jitterRatio * (random() * 2 - 1);
  return Math.max(0, baseMs + spread);
}

// Drives the user-facing services' /work endpoint round-robin at a
// steady, jittered combined rate (fleet-monitor-docs.md §3.4).
export function startTrafficGenerator({
  targets = userFacingServices.map((s) => s.name),
  ratePerSecond = DEFAULT_RATE_PER_SECOND,
  jitterRatio = DEFAULT_JITTER_RATIO,
  resolveUrl = resolveServiceUrl,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  fetchImpl = fetch,
  random = Math.random,
  onRequest = () => {},
} = {}) {
  if (targets.length === 0) {
    throw new Error('startTrafficGenerator requires at least one target');
  }

  const baseIntervalMs = 1000 / ratePerSecond;
  let stopped = false;
  let index = 0;
  let timer;

  function scheduleNext() {
    if (stopped) return;
    timer = setTimeout(fireAndScheduleNext, jitteredIntervalMs(baseIntervalMs, jitterRatio, random));
    timer.unref?.();
  }

  async function fireAndScheduleNext() {
    const target = targets[index % targets.length];
    index += 1;

    const controller = new AbortController();
    const timeout = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new Error('request timed out'));
      }, requestTimeoutMs);
      timer.unref?.();
    });

    try {
      const res = await Promise.race([
        fetchImpl(`${resolveUrl(target)}/work`, { signal: controller.signal }),
        timeout,
      ]);
      onRequest({ target, status: res.status, ok: res.ok });
    } catch (err) {
      onRequest({ target, status: 0, ok: false, error: err.message });
    }

    scheduleNext();
  }

  scheduleNext();

  return function stop() {
    stopped = true;
    clearTimeout(timer);
  };
}
