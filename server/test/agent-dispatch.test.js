import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToolDispatch } from '../agent/dispatch.js';

function fakeTool(overrides = {}) {
  return {
    name: 'fake_tool',
    description: 'a fake tool',
    input_schema: { type: 'object', properties: {}, required: [] },
    handler: async () => ({ ok: true }),
    ...overrides,
  };
}

test('list() returns name/description/input_schema for every tool, never the handler', () => {
  const dispatch = createToolDispatch({ tools: [fakeTool()] });

  const listed = dispatch.list();

  assert.deepEqual(listed, [
    { name: 'fake_tool', description: 'a fake tool', input_schema: { type: 'object', properties: {}, required: [] } },
  ]);
  assert.equal(listed[0].handler, undefined);
});

test('invoke() calls the named tool\'s handler with the given input', async () => {
  let captured;
  const dispatch = createToolDispatch({
    tools: [fakeTool({ handler: async (input) => { captured = input; return { result: 'ran' }; } })],
  });

  const result = await dispatch.invoke('fake_tool', { service: 'web' });

  assert.deepEqual(captured, { service: 'web' });
  assert.deepEqual(result, { result: 'ran' });
});

test('invoke() defaults input to {} when omitted', async () => {
  let captured = 'not called';
  const dispatch = createToolDispatch({
    tools: [fakeTool({ handler: async (input) => { captured = input; } })],
  });

  await dispatch.invoke('fake_tool');

  assert.deepEqual(captured, {});
});

test('invoke() rejects an unknown tool name', async () => {
  const dispatch = createToolDispatch({ tools: [fakeTool()] });

  await assert.rejects(() => dispatch.invoke('nope', {}), /unknown tool: nope/);
});
