// Tool output is designed for a model, not a human (fleet-monitor-docs.md
// §7.2): every tool stays under a hard ~800-token ceiling so a single call
// can never blow the investigation loop's context or its cost. No
// tokenizer dependency for wrappers this thin — ~4 characters per token is
// the standard rough estimate and matches the "~" in the spec's own limit.
const CHARS_PER_TOKEN = 4;

export const TOOL_TOKEN_LIMIT = 800;

export function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
