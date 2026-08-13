import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jitteredIntervalMs, startTrafficGenerator } from '../traffic-generator.js';

test('jitteredIntervalMs stays within +/- jitterRatio of the base', () => {
  for (let i = 0; i < 50; i += 1) {
    const value = jitteredIntervalMs(200, 0.2, Math.random);
    assert.ok(value >= 160 && value <= 240, `value ${value} out of range`);
  }
});

test('jitteredIntervalMs is deterministic given a fixed random source', () => {
  assert.equal(jitteredIntervalMs(200, 0.2, () => 0.5), 200);
  assert.equal(jitteredIntervalMs(200, 0.2, () => 1), 240);
  assert.equal(jitteredIntervalMs(200, 0.2, () => 0), 160);
});

test('startTrafficGenerator requires at least one target', () => {
  assert.throws(() => startTrafficGenerator({ targets: [] }));
});

test('drives requests to targets in round-robin order at roughly the configured rate', async () => {
  const calls = [];
  const stop = startTrafficGenerator({
    targets: ['web', 'checkout'],
    ratePerSecond: 1000,
    jitterRatio: 0,
    fetchImpl: async (url) => {
      calls.push(url);
      return { status: 200, ok: true };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  stop();

  assert.ok(calls.length >= 4, `expected several requests in 20ms, got ${calls.length}`);
  const targets = calls.map((url) => (url.includes('checkout') ? 'checkout' : 'web'));
  assert.equal(targets[0], 'web');
  assert.equal(targets[1], 'checkout');
  assert.equal(targets[2], 'web');
});

test('stop halts further requests', async () => {
  const calls = [];
  const stop = startTrafficGenerator({
    targets: ['web'],
    ratePerSecond: 1000,
    jitterRatio: 0,
    fetchImpl: async (url) => {
      calls.push(url);
      return { status: 200, ok: true };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stop();
  const countAtStop = calls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(calls.length, countAtStop, 'no requests should fire after stop');
});

test('reports each request outcome via onRequest, including failures', async () => {
  const events = [];
  const stop = startTrafficGenerator({
    targets: ['web'],
    ratePerSecond: 1000,
    jitterRatio: 0,
    fetchImpl: async () => {
      throw new Error('connection refused');
    },
    onRequest: (event) => events.push(event),
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  stop();

  assert.ok(events.length >= 1);
  assert.equal(events[0].target, 'web');
  assert.equal(events[0].ok, false);
  assert.equal(events[0].error, 'connection refused');
});

test('a target that never responds does not stall requests to the other target', async () => {
  const events = [];
  const stop = startTrafficGenerator({
    targets: ['web', 'checkout'],
    ratePerSecond: 1000,
    jitterRatio: 0,
    requestTimeoutMs: 15,
    fetchImpl: async (url) => {
      if (url.includes('checkout')) return { status: 200, ok: true };
      return new Promise(() => {}); // simulates a `dead` chaos target: never resolves
    },
    onRequest: (event) => events.push(event),
  });

  await new Promise((resolve) => setTimeout(resolve, 60));
  stop();

  const checkoutEvents = events.filter((e) => e.target === 'checkout');
  const webEvents = events.filter((e) => e.target === 'web');
  assert.ok(checkoutEvents.length >= 1, 'checkout should keep receiving traffic');
  assert.ok(checkoutEvents.every((e) => e.ok === true));
  assert.ok(webEvents.length >= 1, 'the hung target is still retried on schedule');
  assert.ok(webEvents.every((e) => e.ok === false), 'hung requests report as failed once timed out');
});
