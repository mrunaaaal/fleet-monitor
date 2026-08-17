import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicModelClient } from '../agent/model-client.js';

// The model client is the loop's injection point (Seam 3) — this test
// injects the underlying SDK call itself, so it never touches the network
// or needs a real API key.

test('callModel sends system/messages/tools through to the SDK and maps the response', async () => {
  let captured;
  const fakeResponse = {
    content: [{ type: 'text', text: 'hi' }],
    usage: { input_tokens: 1000, output_tokens: 200 },
  };
  const callModel = createAnthropicModelClient({
    apiKey: 'test-key',
    model: 'claude-test-model',
    createMessage: async (client, params) => {
      captured = params;
      return fakeResponse;
    },
    clientFactory: () => ({}),
  });

  const result = await callModel({ system: 'sys prompt', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 't' }] });

  assert.equal(captured.model, 'claude-test-model');
  assert.deepEqual(captured.messages, [{ role: 'user', content: 'hi' }]);
  assert.deepEqual(result.content, fakeResponse.content);
  assert.deepEqual(result.usage, { inputTokens: 1000, outputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0 });
});

test('callModel computes cost from token usage and the configured per-million prices', async () => {
  const callModel = createAnthropicModelClient({
    apiKey: 'test-key',
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    createMessage: async () => ({ content: [], usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } }),
    clientFactory: () => ({}),
  });

  const result = await callModel({ system: 's', messages: [], tools: [] });

  assert.equal(result.costUsd, 18);
});

test('callModel scales cost correctly for small token counts', async () => {
  const callModel = createAnthropicModelClient({
    apiKey: 'test-key',
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    createMessage: async () => ({ content: [], usage: { input_tokens: 2000, output_tokens: 500 } }),
    clientFactory: () => ({}),
  });

  const result = await callModel({ system: 's', messages: [], tools: [] });

  assert.equal(result.costUsd, (2000 / 1_000_000) * 3 + (500 / 1_000_000) * 15);
});

// Prompt caching (cost optimization): the system prompt and tool schemas
// are identical across every iteration of one investigation, and across
// every scenario in an eval run (same service list) — marking them
// cacheable turns repeated re-sends into cheap cache reads instead of
// full-priced input tokens.

test('callModel marks the system prompt as an ephemeral cache breakpoint', async () => {
  let captured;
  const callModel = createAnthropicModelClient({
    apiKey: 'test-key',
    createMessage: async (client, params) => {
      captured = params;
      return { content: [], usage: { input_tokens: 0, output_tokens: 0 } };
    },
    clientFactory: () => ({}),
  });

  await callModel({ system: 'sys prompt', messages: [], tools: [] });

  assert.deepEqual(captured.system, [{ type: 'text', text: 'sys prompt', cache_control: { type: 'ephemeral' } }]);
});

test('callModel marks only the last tool as an ephemeral cache breakpoint, caching the whole tools array', async () => {
  let captured;
  const callModel = createAnthropicModelClient({
    apiKey: 'test-key',
    createMessage: async (client, params) => {
      captured = params;
      return { content: [], usage: { input_tokens: 0, output_tokens: 0 } };
    },
    clientFactory: () => ({}),
  });

  await callModel({ system: 's', messages: [], tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] });

  assert.deepEqual(captured.tools, [
    { name: 'a' },
    { name: 'b' },
    { name: 'c', cache_control: { type: 'ephemeral' } },
  ]);
});

test('callModel leaves an empty tools array empty, not crashing on the last-element marker', async () => {
  let captured;
  const callModel = createAnthropicModelClient({
    apiKey: 'test-key',
    createMessage: async (client, params) => {
      captured = params;
      return { content: [], usage: { input_tokens: 0, output_tokens: 0 } };
    },
    clientFactory: () => ({}),
  });

  await callModel({ system: 's', messages: [], tools: [] });

  assert.deepEqual(captured.tools, []);
});

test('callModel reports cache write/read token counts from the SDK response', async () => {
  const callModel = createAnthropicModelClient({
    apiKey: 'test-key',
    createMessage: async () => ({
      content: [],
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 500, cache_read_input_tokens: 2000 },
    }),
    clientFactory: () => ({}),
  });

  const result = await callModel({ system: 's', messages: [], tools: [] });

  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 500, cacheReadTokens: 2000 });
});

test('callModel prices cache writes and reads at their default multipliers of the input price', async () => {
  const callModel = createAnthropicModelClient({
    apiKey: 'test-key',
    inputPricePerMillion: 10,
    outputPricePerMillion: 0,
    createMessage: async () => ({
      content: [],
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 },
    }),
    clientFactory: () => ({}),
  });

  const result = await callModel({ system: 's', messages: [], tools: [] });

  // default write multiplier 1.25x, default read multiplier 0.1x of the $10 input price
  assert.equal(result.costUsd, 12.5 + 1);
});

test('callModel accepts explicit cache write/read prices overriding the default multipliers', async () => {
  const callModel = createAnthropicModelClient({
    apiKey: 'test-key',
    inputPricePerMillion: 10,
    outputPricePerMillion: 0,
    cacheWritePricePerMillion: 20,
    cacheReadPricePerMillion: 1,
    createMessage: async () => ({
      content: [],
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 },
    }),
    clientFactory: () => ({}),
  });

  const result = await callModel({ system: 's', messages: [], tools: [] });

  assert.equal(result.costUsd, 21);
});
