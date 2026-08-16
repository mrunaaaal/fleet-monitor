import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../agent/system-prompt.js';

// §7.3: role, format, method, cheap-first, aggregate-before-sample,
// termination, context — in that order — and never the answer.
test('buildSystemPrompt states the read-only SRE role', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /read-only/i);
  assert.match(prompt, /SRE/);
});

// issue #28: a weaker model explored as much as Sonnet but rarely
// converged — 2 of 20 scenarios stopped mid-investigation with a
// plain-text reply instead of a tool call, rather than either continuing
// or calling submit_findings.
test('buildSystemPrompt requires every turn to call a tool, never reply with plain text alone', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /every turn/i);
  assert.match(prompt, /plain text/i);
});

test('buildSystemPrompt states the symptom-toward-cause, downstream method', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /downstream/i);
});

test('buildSystemPrompt states the cheap-first heuristic naming check_liveness', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /check_liveness/);
});

test('buildSystemPrompt states aggregate-before-sample naming both log tools in order', () => {
  const prompt = buildSystemPrompt();
  const searchIdx = prompt.indexOf('search_logs');
  const samplesIdx = prompt.indexOf('get_log_samples');
  assert.ok(searchIdx >= 0 && samplesIdx >= 0 && searchIdx < samplesIdx);
});

test('buildSystemPrompt states honest termination: submit_findings, low confidence over guessing', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /submit_findings/);
  assert.match(prompt, /low.confidence/i);
});

// issue #28: a weaker model explored as much as Sonnet but rarely
// converged — it kept gathering evidence past the point of having enough,
// exhausting its iteration budget without ever calling submit_findings.
// Sonnet's implicit "I have enough evidence" judgment needed to be
// spelled out for a model that doesn't reproduce it on its own.

test('buildSystemPrompt tells the model to stop once independent signals agree, rather than keep gathering evidence', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /two independent signals/i);
});

test('buildSystemPrompt tells the model to stop once a single service is conclusive on its own, not just on agreement between two', () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /single service's liveness, metrics, and logs/i);
});

test('buildSystemPrompt includes tier meanings and lists the given services', () => {
  const prompt = buildSystemPrompt({
    services: [
      { name: 'web', tier: 'user-facing' },
      { name: 'ledger-db', tier: 'datastore' },
    ],
  });
  assert.match(prompt, /user-facing/);
  assert.match(prompt, /web/);
  assert.match(prompt, /ledger-db/);
});

test('buildSystemPrompt never names which services commonly fail', () => {
  const prompt = buildSystemPrompt();
  assert.doesNotMatch(prompt, /ledger-db is (often|usually|commonly)/i);
});
