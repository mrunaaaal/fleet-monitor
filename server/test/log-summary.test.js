import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeByPattern } from '../query/log-summary.js';

const opts = { groupField: 'level', groupKey: 'by_level', templateFn: (row) => row.message };

test('summarizeByPattern returns a null time_range and empty patterns for no rows', () => {
  const result = summarizeByPattern([], opts);

  assert.equal(result.total, 0);
  assert.deepEqual(result.by_level, {});
  assert.equal(result.time_range, null);
  assert.deepEqual(result.patterns, []);
});

test('summarizeByPattern reports the first and last row ts as the time range', () => {
  const rows = [
    { ts: 't1', level: 'error', message: 'a' },
    { ts: 't2', level: 'error', message: 'b' },
    { ts: 't3', level: 'warn', message: 'c' },
  ];

  const result = summarizeByPattern(rows, opts);

  assert.deepEqual(result.time_range, { first: 't1', last: 't3' });
});

test('summarizeByPattern groups counts by groupField under the given groupKey', () => {
  const rows = [
    { ts: 't1', level: 'error', message: 'a' },
    { ts: 't2', level: 'error', message: 'b' },
    { ts: 't3', level: 'warn', message: 'c' },
  ];

  const result = summarizeByPattern(rows, opts);

  assert.deepEqual(result.by_level, { error: 2, warn: 1 });
});

test('summarizeByPattern caps patterns at the top 5 by count', () => {
  const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
  const rows = [];
  words.forEach((word, i) => {
    for (let j = 0; j < 6 - i; j += 1) {
      rows.push({ ts: `t${i}-${j}`, level: 'info', message: word });
    }
  });

  const result = summarizeByPattern(rows, opts);

  assert.equal(result.patterns.length, 5);
  assert.equal(result.patterns[0].template, 'alpha');
  assert.equal(result.patterns[0].count, 6);
});

test('summarizeByPattern breaks ties in count deterministically by first-seen order', () => {
  const rows = [
    { ts: 't1', level: 'info', message: 'b' },
    { ts: 't2', level: 'info', message: 'a' },
  ];

  const result = summarizeByPattern(rows, opts);

  assert.deepEqual(result.patterns, [
    { template: 'b', count: 1 },
    { template: 'a', count: 1 },
  ]);
});

test('summarizeByPattern applies templateFn to cluster rows into templates', () => {
  const rows = [
    { ts: 't1', status: 200, method: 'GET', path: '/a' },
    { ts: 't2', status: 200, method: 'GET', path: '/b' },
  ];

  const result = summarizeByPattern(rows, {
    groupField: 'status',
    groupKey: 'by_status',
    templateFn: (row) => `${row.method} template`,
  });

  assert.deepEqual(result.by_status, { 200: 2 });
  assert.deepEqual(result.patterns, [{ template: 'GET template', count: 2 }]);
});
