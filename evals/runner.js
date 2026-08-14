// The eval runner (spec issue #17, fleet-monitor-docs.md §8.3): for each
// scenario, reset chaos, let metrics settle, apply the scenario's chaos,
// warm up, invoke the agent, score the result, and persist it. Capture and
// replay (§8.4) only change how chaos/warmup and the tool dispatch are
// wired — everything else (scoring, persistence, iteration) is identical.
import { createInvestigationLoop } from '../server/agent/loop.js';
import { scoreFindings } from '../server/eval/scorer.js';
import { loadFixture as defaultLoadFixture, saveFixture as defaultSaveFixture, createReplayDispatch } from './fixtures.js';

// §8.3 says only "wait for metrics to settle" with no fixed duration — 15s
// is a few traffic-generator request cycles' worth of margin (~5 req/s,
// §3.4) for the previous scenario's chaos to actually clear the pipeline
// before the next one's baseline reads. Override per invocation if that
// proves too short or too slow in practice.
const DEFAULT_SETTLE_SECONDS = 15;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// category is scored separately from scoreFindings (server/eval/scorer.js
// only scores service identity): every *named* cause's category must match
// its expected category — mirrors correctness's no-false-positives rule but
// for category, so a correct-but-incomplete diagnosis (one of two causes
// named) can still score category-true for the cause it did name. null
// means not applicable: nothing was expected and nothing was named.
export function scoreCategory(findings, expected) {
  const named = findings?.root_cause_services ?? [];
  const expectedCauses = expected.root_causes ?? [];
  if (expectedCauses.length === 0 && named.length === 0) return null;
  if (!findings) return false;

  const expectedByService = new Map(expectedCauses.map((cause) => [cause.service, cause.category]));
  return named.every((cause) => expectedByService.get(cause.service) === cause.category);
}

export function createEvalRunner({
  mode = 'live',
  chaos,
  dispatch,
  callModel,
  systemPrompt,
  tools,
  persistInvestigation,
  sleep = defaultSleep,
  settleSeconds = DEFAULT_SETTLE_SECONDS,
  maxIterations,
  maxCostUsd,
  fixturesDir,
  loadFixture = defaultLoadFixture,
  saveFixture = defaultSaveFixture,
  createLoop = createInvestigationLoop,
} = {}) {
  async function scenarioDispatch(scenario) {
    if (mode !== 'replay') return dispatch;
    const trace = await loadFixture(fixturesDir, scenario.id);
    return createReplayDispatch(trace, { liveDispatch: dispatch });
  }

  async function runScenario(scenario) {
    if (mode !== 'replay') {
      await chaos.reset();
      await sleep(settleSeconds * 1000);
      await chaos.apply(scenario.chaos);
      await sleep(scenario.warmup_seconds * 1000);
    }

    const loop = createLoop({ dispatch: await scenarioDispatch(scenario), maxIterations, maxCostUsd });
    const result = await loop.investigate(scenario.symptom, { callModel, systemPrompt, tools });

    if (mode === 'capture') {
      await saveFixture(fixturesDir, scenario.id, result.trace);
    }

    const score = result.findings
      ? scoreFindings(result.findings, scenario.expected)
      : { correctness: false, root_cause_completeness: 0, blast_radius_completeness: 0 };
    const categoryCorrect = scoreCategory(result.findings, scenario.expected);

    if (persistInvestigation) {
      await persistInvestigation({
        symptom: scenario.symptom,
        findings: result.findings,
        trace: result.trace,
        iterations: result.iterations,
        toolCalls: result.toolCalls,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        terminated: result.terminated,
        evalScenario: scenario.id,
      });
    }

    return { scenario, result, score, categoryCorrect };
  }

  async function run(scenarios) {
    const rows = [];
    for (const scenario of scenarios) {
      rows.push(await runScenario(scenario));
    }
    if (mode !== 'replay') await chaos.reset();
    return rows;
  }

  return { run, runScenario };
}
