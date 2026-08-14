import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfill } from '../backfill.js';
import { services } from '../../mesh/config.js';
import { TAG_NAMES, FIELD_NAMES } from '../../server/db/metrics-schema.js';

test('backfill writes one line-protocol point per service per 5-minute bucket over 7 days', async () => {
  const writes = [];
  const influx = { writeLineProtocol: async (line) => writes.push(line) };
  const now = Date.parse('2026-08-14T00:00:00.000Z');

  const { written } = await backfill({ influx, now });

  const expectedPerService = (7 * 24 * 60) / 5; // 7 days of 5-minute buckets
  assert.equal(written, expectedPerService * services.length);
});

test('backfill writes historical timestamps within the 7-day window, oldest first', async () => {
  const writes = [];
  const influx = { writeLineProtocol: async (line) => writes.push(line) };
  const now = Date.parse('2026-08-14T00:00:00.000Z');
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  await backfill({ influx, now });

  const allLines = writes.join('\n').trim().split('\n');
  const timestamps = allLines.map((line) => Number(line.split(' ').at(-1)));

  for (const ts of timestamps) {
    assert.ok(ts >= now - weekMs && ts < now, `timestamp ${ts} outside the 7-day backfill window`);
  }
  assert.ok(Math.min(...timestamps) < Math.max(...timestamps), 'timestamps should span a real range, not a single instant');
});

test('backfill writes valid metrics line protocol with every tag and field', async () => {
  const writes = [];
  const influx = { writeLineProtocol: async (line) => writes.push(line) };
  const now = Date.parse('2026-08-14T00:00:00.000Z');

  await backfill({ influx, now });

  const firstLine = writes[0].split('\n')[0];
  assert.match(firstLine, /^metrics,/);
  for (const tag of TAG_NAMES) {
    assert.match(firstLine, new RegExp(`(?:,| )${tag}=`));
  }
  for (const field of FIELD_NAMES) {
    assert.match(firstLine, new RegExp(`${field}=[0-9.]+`));
  }
});

test('backfill reports a small, bounded number of synthetic incident windows within range', async () => {
  const influx = { writeLineProtocol: async () => {} };
  const now = Date.parse('2026-08-14T00:00:00.000Z');
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  const { incidentWindows } = await backfill({ influx, now });

  assert.ok(incidentWindows.length > 0 && incidentWindows.length <= 5);
  for (const w of incidentWindows) {
    assert.ok(services.some((s) => s.name === w.service));
    assert.ok(w.start >= now - weekMs && w.end <= now);
    assert.ok(w.end > w.start);
  }
});
