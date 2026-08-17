import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
const DEFAULT_MAX_TOKENS = 2048;
// Anthropic's published per-million-token USD rates for the default model
// above — configurable via env because pricing (and the configured model)
// can change without a code change; cost_usd is stored per investigation
// (fleet-monitor-docs.md §4.1) so getting this right matters.
const DEFAULT_INPUT_PRICE_PER_MILLION = Number(process.env.ANTHROPIC_INPUT_PRICE_PER_MILLION ?? 3);
const DEFAULT_OUTPUT_PRICE_PER_MILLION = Number(process.env.ANTHROPIC_OUTPUT_PRICE_PER_MILLION ?? 15);
// Anthropic's standard 5-minute ephemeral cache rates, both relative to the
// base input price (so they scale with whatever inputPricePerMillion is
// actually in effect, env or override, rather than being pinned to it at
// import time): writing to the cache costs a 25% premium, reading from it
// costs 90% less — a worthwhile trade since the system prompt and tool
// schemas are identical across every iteration of an investigation.
// Env-configurable like the sibling prices above, since Anthropic can
// change these rates independently of the input price.
const DEFAULT_CACHE_WRITE_MULTIPLIER = Number(process.env.ANTHROPIC_CACHE_WRITE_MULTIPLIER ?? 1.25);
const DEFAULT_CACHE_READ_MULTIPLIER = Number(process.env.ANTHROPIC_CACHE_READ_MULTIPLIER ?? 0.1);
const EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' };

// The loop's injection point (Seam 3, fleet-monitor-docs.md §7.4): adapts
// the Anthropic Messages API to the loop's callModel({system, messages,
// tools}) -> {content, usage, costUsd} shape. createMessage/clientFactory
// are overridable so this is unit-testable without a real API key or
// network call — the loop never imports @anthropic-ai/sdk directly.
export function createAnthropicModelClient({
  apiKey = process.env.ANTHROPIC_API_KEY,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  inputPricePerMillion = DEFAULT_INPUT_PRICE_PER_MILLION,
  outputPricePerMillion = DEFAULT_OUTPUT_PRICE_PER_MILLION,
  cacheWritePricePerMillion = inputPricePerMillion * DEFAULT_CACHE_WRITE_MULTIPLIER,
  cacheReadPricePerMillion = inputPricePerMillion * DEFAULT_CACHE_READ_MULTIPLIER,
  clientFactory = (key) => new Anthropic({ apiKey: key }),
  createMessage = (client, params) => client.messages.create(params),
} = {}) {
  const client = clientFactory(apiKey);

  return async function callModel({ system, messages, tools }) {
    // Prompt caching: the system prompt and tool schemas don't change
    // between iterations of one investigation, or between scenarios in an
    // eval run (same service list) — marking the last tool caches the
    // whole tools array (Anthropic caches everything up to a breakpoint),
    // and the system prompt gets its own breakpoint since it's a separate
    // field in the request.
    const cachedSystem = [{ type: 'text', text: system, cache_control: EPHEMERAL_CACHE_CONTROL }];
    const cachedTools = tools.map((tool, i) =>
      i === tools.length - 1 ? { ...tool, cache_control: EPHEMERAL_CACHE_CONTROL } : tool,
    );

    const res = await createMessage(client, {
      model,
      max_tokens: maxTokens,
      system: cachedSystem,
      messages,
      tools: cachedTools,
    });
    const inputTokens = res.usage.input_tokens;
    const outputTokens = res.usage.output_tokens;
    const cacheWriteTokens = res.usage.cache_creation_input_tokens ?? 0;
    const cacheReadTokens = res.usage.cache_read_input_tokens ?? 0;
    const costUsd =
      (inputTokens / 1_000_000) * inputPricePerMillion +
      (outputTokens / 1_000_000) * outputPricePerMillion +
      (cacheWriteTokens / 1_000_000) * cacheWritePricePerMillion +
      (cacheReadTokens / 1_000_000) * cacheReadPricePerMillion;

    return { content: res.content, usage: { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens }, costUsd };
  };
}
