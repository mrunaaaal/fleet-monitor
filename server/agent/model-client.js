import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
const DEFAULT_MAX_TOKENS = 2048;
// Anthropic's published per-million-token USD rates for the default model
// above — configurable via env because pricing (and the configured model)
// can change without a code change; cost_usd is stored per investigation
// (fleet-monitor-docs.md §4.1) so getting this right matters.
const DEFAULT_INPUT_PRICE_PER_MILLION = Number(process.env.ANTHROPIC_INPUT_PRICE_PER_MILLION ?? 3);
const DEFAULT_OUTPUT_PRICE_PER_MILLION = Number(process.env.ANTHROPIC_OUTPUT_PRICE_PER_MILLION ?? 15);

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
  clientFactory = (key) => new Anthropic({ apiKey: key }),
  createMessage = (client, params) => client.messages.create(params),
} = {}) {
  const client = clientFactory(apiKey);

  return async function callModel({ system, messages, tools }) {
    const res = await createMessage(client, { model, max_tokens: maxTokens, system, messages, tools });
    const inputTokens = res.usage.input_tokens;
    const outputTokens = res.usage.output_tokens;
    const costUsd =
      (inputTokens / 1_000_000) * inputPricePerMillion + (outputTokens / 1_000_000) * outputPricePerMillion;

    return { content: res.content, usage: { inputTokens, outputTokens }, costUsd };
  };
}
