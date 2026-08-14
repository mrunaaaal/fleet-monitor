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
  assert.equal(captured.system, 'sys prompt');
  assert.deepEqual(captured.messages, [{ role: 'user', content: 'hi' }]);
  assert.deepEqual(captured.tools, [{ name: 't' }]);
  assert.deepEqual(result.content, fakeResponse.content);
  assert.deepEqual(result.usage, { inputTokens: 1000, outputTokens: 200 });
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
