// Pure line-framing/parsing helpers for nginx-log-tailer.js, split out so
// they're testable without driving the polling loop.

// Splits newly-read text into complete lines plus a trailing partial line
// (the tail end of the file that nginx hasn't newline-terminated yet).
// `previousPartial` is prepended so a line split across two reads still
// comes out whole.
export function extractLines(previousPartial, newText) {
  const combined = previousPartial + newText;
  const lines = combined.split('\n');
  const partial = lines.pop() ?? '';
  return { lines, partial };
}

// One malformed line (e.g. a truncated write mid-flush) shouldn't drop the
// rest of the batch, so parse failures are logged and skipped rather than
// thrown.
export function parseAccessLogLine(line) {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch (err) {
    console.error('[nginx-log-tailer] skipping unparsable line:', err.message);
    return null;
  }
}
