// Capture/replay fixtures (fleet-monitor-docs.md §8.4): a captured fixture
// is exactly the investigation loop's own `trace` array (server/agent/
// loop.js) — {signature, name, input, out} per call — so capture mode needs
// no separate recording wrapper, it just persists result.trace.
//
// submit_findings is never served from the trace during replay: its free-
// text input (summary/evidence) almost never repeats byte-for-byte across
// model calls, so a signature match would fail on nearly every replay run.
// It has no store dependency (the real tool only validates its input), so
// replay dispatches it live instead via the injected liveDispatch.
//
// search_logs/get_log_samples take model-generated `from`/`to` ISO
// timestamps (server/agent/summarizing-tools.js) with no fixed "now"
// anchored anywhere in the loop — a replay run's model call will pick
// different wall-clock-relative timestamps than the capture run did, so
// matching on those fields would miss on almost every replay. The
// underlying store state was frozen at capture time regardless of which
// window the model asks for, so those two fields are dropped before
// building the signature.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const IGNORED_INPUT_FIELDS = {
  search_logs: ['from', 'to'],
  get_log_samples: ['from', 'to'],
};

function callSignature(name, input) {
  const ignored = IGNORED_INPUT_FIELDS[name];
  if (!ignored) return `${name}:${JSON.stringify(input ?? {})}`;

  const normalized = { ...(input ?? {}) };
  for (const field of ignored) delete normalized[field];
  return `${name}:${JSON.stringify(normalized)}`;
}

function fixtureFile(dir, scenarioId) {
  return path.join(dir, `${scenarioId}.json`);
}

export async function saveFixture(dir, scenarioId, trace) {
  await mkdir(dir, { recursive: true });
  await writeFile(fixtureFile(dir, scenarioId), JSON.stringify(trace, null, 2));
}

export async function loadFixture(dir, scenarioId) {
  const raw = await readFile(fixtureFile(dir, scenarioId), 'utf8');
  return JSON.parse(raw);
}

export function createReplayDispatch(trace, { liveDispatch } = {}) {
  const byName = new Map(trace.map((entry) => [callSignature(entry.name, entry.input), entry.out]));

  return async function dispatch(name, input) {
    if (name === 'submit_findings' && liveDispatch) {
      return liveDispatch(name, input);
    }

    const signature = callSignature(name, input);
    if (!byName.has(signature)) {
      throw new Error(`no fixture recorded for ${signature} — recapture this scenario (evals/run.js --capture)`);
    }
    return byName.get(signature);
  };
}
