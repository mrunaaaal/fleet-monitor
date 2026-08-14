import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../run.js';

test('parseArgs defaults to live mode with no scenario filter', () => {
  assert.deepEqual(parseArgs([]), { mode: 'live', only: undefined });
});

test('parseArgs recognizes --capture and --replay', () => {
  assert.equal(parseArgs(['--capture']).mode, 'capture');
  assert.equal(parseArgs(['--replay']).mode, 'replay');
});

test('parseArgs prefers --capture over --replay if both are somehow given', () => {
  assert.equal(parseArgs(['--replay', '--capture']).mode, 'capture');
});

test('parseArgs extracts --scenario=<id>', () => {
  assert.equal(parseArgs(['--replay', '--scenario=ledger_slow_diamond']).only, 'ledger_slow_diamond');
});
