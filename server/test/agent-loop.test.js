import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInvestigationLoop } from '../agent/loop.js';

// Seam 3 (spec issue #1, "Testing Decisions"): script an injected fake
// model's tool-call sequence and assert the guardrails deterministically.
// The model client is the injection point, so this loop is free of any
// real API and any real store — dispatch is faked too.

function modelResponse(content, { inputTokens = 100, outputTokens = 50, costUsd = 0.001 } = {}) {
  return { content, usage: { inputTokens, outputTokens }, costUsd };
}

function toolUse(name, input, id = `call-${name}`) {
  return { type: 'tool_use', id, name, input };
}

function scriptedModel(responses) {
  let i = 0;
  return async () => {
    const res = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return res;
  };
}

test('terminates cleanly on submit_findings, dispatching it through the tool dispatch like any other call', async () => {
  const dispatchCalls = [];
  const dispatch = async (name, input) => {
    dispatchCalls.push({ name, input });
    if (name === 'check_liveness') return { liveness: [{ service: 'web', up: true }] };
    if (name === 'submit_findings') return input; // the real submit_findings tool just echoes valid input
    throw new Error(`unexpected dispatch: ${name}`);
  };
  const findings = {
    root_cause_services: [{ service: 'ledger-db', category: 'latency', confidence: 'high' }],
    summary: 's',
    evidence: [],
    affected_services: [],
    suggested_remediation: 'r',
  };
  const callModel = scriptedModel([
    modelResponse([toolUse('check_liveness', {})]),
    modelResponse([toolUse('submit_findings', findings)]),
  ]);
  const loop = createInvestigationLoop({ dispatch });

  const result = await loop.investigate('checkout is slow', { callModel, systemPrompt: 'sys', tools: [] });

  assert.deepEqual(result.findings, findings);
  assert.equal(result.terminated, null);
  assert.equal(result.iterations, 2);
  assert.equal(result.toolCalls, 2);
  assert.deepEqual(dispatchCalls.map((c) => c.name), ['check_liveness', 'submit_findings']);
});

test('stops when the model returns no tool calls, with no findings', async () => {
  const callModel = scriptedModel([modelResponse([{ type: 'text', text: 'thinking out loud' }])]);
  const loop = createInvestigationLoop({ dispatch: async () => ({}) });

  const result = await loop.investigate('checkout is slow', { callModel, systemPrompt: 'sys', tools: [] });

  assert.equal(result.findings, null);
  assert.equal(result.terminated, 'no_tool_call');
});

test('iteration cap halts the loop when the model never calls submit_findings', async () => {
  // Each iteration calls get_dependencies for a different service, so this
  // test isolates the iteration cap from the duplicate-call guardrail.
  const callModel = scriptedModel([
    modelResponse([toolUse('get_dependencies', { service: 'a' })]),
    modelResponse([toolUse('get_dependencies', { service: 'b' })]),
    modelResponse([toolUse('get_dependencies', { service: 'c' })]),
  ]);
  const loop = createInvestigationLoop({ dispatch: async () => ({ downstream: [] }), maxIterations: 3 });

  const result = await loop.investigate('checkout is slow', { callModel, systemPrompt: 'sys', tools: [] });

  assert.equal(result.terminated, 'max_iterations');
  assert.equal(result.iterations, 3);
  assert.equal(result.findings, null);
});

test('cost cap halts the loop once cumulative cost exceeds the budget', async () => {
  const callModel = scriptedModel([modelResponse([toolUse('check_liveness', {})], { costUsd: 0.2 })]);
  const loop = createInvestigationLoop({ dispatch: async () => ({ ok: true }), maxIterations: 10, maxCostUsd: 0.25 });

  const result = await loop.investigate('checkout is slow', { callModel, systemPrompt: 'sys', tools: [] });

  // 0.2 + 0.2 = 0.4 > 0.25, so it should stop after the 2nd iteration, well under the iteration cap
  assert.equal(result.terminated, 'budget_exceeded');
  assert.equal(result.iterations, 2);
});

test('duplicate calls (same name + input) are refused with a corrective message, not re-dispatched', async () => {
  const dispatchCalls = [];
  const dispatch = async (name, input) => {
    dispatchCalls.push({ name, input });
    return { result: 'real data' };
  };
  const model = scriptedModel([
    modelResponse([toolUse('check_liveness', { services: ['web'] })]),
    modelResponse([toolUse('check_liveness', { services: ['web'] })]), // identical call
    modelResponse([toolUse('submit_findings', {
      root_cause_services: [],
      summary: 's',
      evidence: [],
      affected_services: [],
      suggested_remediation: 'r',
    })]),
  ]);
  const loop = createInvestigationLoop({
    dispatch: async (name, input) => {
      if (name === 'submit_findings') return input;
      return dispatch(name, input);
    },
  });

  const result = await loop.investigate('checkout is slow', { callModel: model, systemPrompt: 'sys', tools: [] });

  assert.equal(dispatchCalls.length, 1, 'the duplicate must not be re-dispatched');
  assert.equal(result.trace.length, 3, 'both attempts (real + refused) plus submit_findings are recorded');
  assert.match(result.trace[1].out.error, /already made/i);
  assert.equal(result.terminated, null);
});

test('a dispatch error on a normal tool call is recovered as a corrective tool_result, not a crash', async () => {
  const callModel = scriptedModel([
    modelResponse([toolUse('get_dependencies', {})]), // missing required "service"
    modelResponse([toolUse('submit_findings', {
      root_cause_services: [],
      summary: 's',
      evidence: [],
      affected_services: [],
      suggested_remediation: 'r',
    })]),
  ]);
  const loop = createInvestigationLoop({
    dispatch: async (name, input) => {
      if (name === 'submit_findings') return input;
      if (name === 'get_dependencies') throw new Error('queryDependencies requires a service');
      throw new Error(`unexpected dispatch: ${name}`);
    },
  });

  const result = await loop.investigate('checkout is slow', { callModel, systemPrompt: 'sys', tools: [] });

  assert.equal(result.terminated, null);
  assert.match(result.trace[0].out.error, /requires a service/);
});

test('an invalid submit_findings call is not treated as terminal — the model gets the validation error back and can retry', async () => {
  const dispatchCalls = [];
  const callModel = scriptedModel([
    modelResponse([toolUse('submit_findings', { summary: 'incomplete' })]), // fails validation
    modelResponse([toolUse('submit_findings', {
      root_cause_services: [],
      summary: 's',
      evidence: [],
      affected_services: [],
      suggested_remediation: 'r',
    })]),
  ]);
  const loop = createInvestigationLoop({
    dispatch: async (name, input) => {
      dispatchCalls.push({ name, input });
      if (input.root_cause_services === undefined) throw new Error('submit_findings requires root_cause_services');
      return input;
    },
  });

  const result = await loop.investigate('checkout is slow', { callModel, systemPrompt: 'sys', tools: [] });

  assert.equal(dispatchCalls.length, 2, 'both the failed and the retried submit_findings call were dispatched');
  assert.equal(result.terminated, null);
  assert.deepEqual(result.findings.root_cause_services, []);
  assert.match(result.trace[0].out.error, /requires root_cause_services/);
});

test('trace entries carry a stable signature derived from name + input', async () => {
  const callModel = scriptedModel([modelResponse([toolUse('get_dependencies', { service: 'web' })])]);
  const loop = createInvestigationLoop({ dispatch: async () => ({ downstream: [] }), maxIterations: 1 });

  const result = await loop.investigate('checkout is slow', { callModel, systemPrompt: 'sys', tools: [] });

  assert.equal(result.trace[0].signature, "get_dependencies:{\"service\":\"web\"}");
});

test('reports input/output tokens and cost summed across iterations', async () => {
  const callModel = scriptedModel([
    modelResponse([toolUse('check_liveness', {})], { inputTokens: 100, outputTokens: 20, costUsd: 0.01 }),
    modelResponse([toolUse('submit_findings', {
      root_cause_services: [],
      summary: 's',
      evidence: [],
      affected_services: [],
      suggested_remediation: 'r',
    })], { inputTokens: 150, outputTokens: 40, costUsd: 0.02 }),
  ]);
  const loop = createInvestigationLoop({
    dispatch: async (name, input) => (name === 'submit_findings' ? input : { ok: true }),
  });

  const result = await loop.investigate('checkout is slow', { callModel, systemPrompt: 'sys', tools: [] });

  assert.equal(result.inputTokens, 250);
  assert.equal(result.outputTokens, 60);
  assert.equal(result.costUsd, 0.03);
  assert.ok(typeof result.durationMs === 'number' && result.durationMs >= 0);
});

test('fires onEvent for each tool call, in order, for the SSE route to stream', async () => {
  const events = [];
  const callModel = scriptedModel([
    modelResponse([toolUse('check_liveness', {}), toolUse('get_dependencies', { service: 'web' })]),
    modelResponse([toolUse('submit_findings', {
      root_cause_services: [],
      summary: 's',
      evidence: [],
      affected_services: [],
      suggested_remediation: 'r',
    })]),
  ]);
  const loop = createInvestigationLoop({
    dispatch: async (name, input) => (name === 'submit_findings' ? input : { ok: true }),
  });

  await loop.investigate('checkout is slow', { callModel, systemPrompt: 'sys', tools: [], onEvent: (e) => events.push(e) });

  assert.deepEqual(events.map((e) => e.type), ['tool_call', 'tool_call', 'tool_call', 'terminated']);
  assert.equal(events[0].name, 'check_liveness');
  assert.equal(events[1].name, 'get_dependencies');
  assert.equal(events[2].name, 'submit_findings');
});
