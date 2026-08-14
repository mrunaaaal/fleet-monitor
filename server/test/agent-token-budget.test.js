import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, TOOL_TOKEN_LIMIT } from '../agent/token-budget.js';

test('estimateTokens counts a string at ~4 chars per token', () => {
  assert.equal(estimateTokens('a'.repeat(400)), 100);
});

test('estimateTokens JSON-stringifies non-string values before counting', () => {
  const value = { a: 1 };
  assert.equal(estimateTokens(value), Math.ceil(JSON.stringify(value).length / 4));
});

test('TOOL_TOKEN_LIMIT is the ~800 token ceiling from fleet-monitor-docs.md §7.2', () => {
  assert.equal(TOOL_TOKEN_LIMIT, 800);
});
