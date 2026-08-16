import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../run.js';

test('parseArgs defaults to live mode with no scenario filter', () => {
  assert.deepEqual(parseArgs([]), { mode: 'live', only: undefined, maxIterations: undefined });
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

// --max-iterations (issue #27): a weaker/cheaper model needs more than the
// loop's default cap of 10 to actually reach submit_findings, so the CLI
// exposes an override rather than baking one into the loop's default.

test('parseArgs defaults maxIterations to undefined so the loop keeps its own default', () => {
  assert.equal(parseArgs([]).maxIterations, undefined);
});

test('parseArgs extracts --max-iterations=<n> as a number', () => {
  assert.equal(parseArgs(['--max-iterations=20']).maxIterations, 20);
});

test('parseArgs rejects a non-positive-integer --max-iterations', () => {
  assert.throws(() => parseArgs(['--max-iterations=0']), /max-iterations/);
  assert.throws(() => parseArgs(['--max-iterations=-5']), /max-iterations/);
  assert.throws(() => parseArgs(['--max-iterations=abc']), /max-iterations/);
  assert.throws(() => parseArgs(['--max-iterations=3.5']), /max-iterations/);
});
