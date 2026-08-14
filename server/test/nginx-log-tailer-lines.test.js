import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLines, parseAccessLogLine } from '../nginx-log-tailer-lines.js';

test('extractLines splits complete lines from a trailing partial line', () => {
  const { lines, partial } = extractLines('', 'one\ntwo\nthree');

  assert.deepEqual(lines, ['one', 'two']);
  assert.equal(partial, 'three');
});

test('extractLines prepends the previous partial to the new text', () => {
  const { lines, partial } = extractLines('thr', 'ee\nfour\n');

  assert.deepEqual(lines, ['three', 'four']);
  assert.equal(partial, '');
});

test('extractLines returns no complete lines when the read has no newline', () => {
  const { lines, partial } = extractLines('', 'partial-only');

  assert.deepEqual(lines, []);
  assert.equal(partial, 'partial-only');
});

test('parseAccessLogLine parses a JSON access log line', () => {
  const parsed = parseAccessLogLine('{"status":200,"path":"/api/health"}');

  assert.deepEqual(parsed, { status: 200, path: '/api/health' });
});

test('parseAccessLogLine returns null for a blank line', () => {
  assert.equal(parseAccessLogLine(''), null);
  assert.equal(parseAccessLogLine('   '), null);
});

test('parseAccessLogLine returns null and does not throw for unparsable JSON', () => {
  assert.equal(parseAccessLogLine('not json'), null);
});
