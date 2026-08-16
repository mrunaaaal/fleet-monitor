#!/usr/bin/env node
// Eval harness CLI (spec issue #17, fleet-monitor-docs.md §8): wires the
// real stores/agent/model together, runs the 20 scenarios end to end, and
// prints the results table (§8.5).
//
// Modes:
//   (default)   live    — reset/settle/apply chaos/warmup against the real mesh
//   --capture           — same as live, but also snapshots each scenario's
//                          tool-call trace to evals/fixtures/<id>.json
//   --replay            — skips chaos and warmup; tool calls are served from
//                          fixtures captured earlier (~1 minute for all 20)
//   --scenario=<id>     — run a single scenario instead of the full suite
//
// The model is always called live, in every mode — replay only shortcuts
// the store-backed tool calls and the mesh chaos/warmup, not the agent
// itself, since capture/replay exists to iterate on prompts fast (§8.4).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createPostgresClient } from '../server/db/postgres.js';
import { createRedisClient } from '../server/db/redis.js';
import { createNeo4jClient } from '../server/db/neo4j.js';
import { createInfluxClient } from '../server/db/influx.js';
import { createClickhouseClient } from '../server/db/clickhouse.js';
import { createAgentTools } from '../server/agent/index.js';
import { createAnthropicModelClient } from '../server/agent/model-client.js';
import { buildSystemPrompt } from '../server/agent/system-prompt.js';
import { createListServicesQuery } from '../server/query/services.js';
import { createPersistInvestigationQuery } from '../server/query/investigations.js';
import { validateScenarios } from '../server/eval/scenario-schema.js';
import { services as meshServices } from '../mesh/config.js';

import { createChaosController } from './chaos.js';
import { createEvalRunner } from './runner.js';
import { formatResultsTable, formatFailures, summarize } from './report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_PATH = path.join(__dirname, 'scenarios.json');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const RESULTS_DIR = path.join(__dirname, 'results');

export function parseArgs(argv) {
  const mode = argv.includes('--capture') ? 'capture' : argv.includes('--replay') ? 'replay' : 'live';
  const scenarioArg = argv.find((arg) => arg.startsWith('--scenario='));
  return { mode, only: scenarioArg ? scenarioArg.slice('--scenario='.length) : undefined };
}

async function selectScenarios({ only }) {
  const all = validateScenarios(JSON.parse(await readFile(SCENARIOS_PATH, 'utf8')));
  if (!only) return all;
  const selected = all.filter((scenario) => scenario.id === only);
  if (selected.length === 0) throw new Error(`no scenario matches --scenario=${only}`);
  return selected;
}

export async function main({ argv = process.argv.slice(2), log = console.log } = {}) {
  const { mode, only } = parseArgs(argv);
  const scenarios = await selectScenarios({ only });

  const postgres = createPostgresClient();
  const redis = createRedisClient();
  const neo4j = createNeo4jClient();
  const influx = createInfluxClient();
  const clickhouse = createClickhouseClient();

  try {
    // metricsWindow (issue #26): mutable handoff between the runner, which
    // stamps .since at the start of each scenario, and the agent tools,
    // which read it on every query_metrics call — keeps a scenario's
    // metrics queries from reaching back into an earlier scenario's chaos.
    const metricsWindow = {};
    const agentTools = createAgentTools({
      postgres,
      redis,
      neo4j,
      influx,
      clickhouse,
      getMetricsSince: () => metricsWindow.since,
    });
    const listServices = createListServicesQuery({ postgres });
    const persistInvestigation = createPersistInvestigationQuery({ postgres });

    // Replay is meant to run without any live store reachable, including
    // Postgres — the service list for the prompt falls back to the mesh's
    // static topology instead of a registry query.
    const promptServices =
      mode === 'replay' ? meshServices.map((s) => ({ name: s.name, tier: s.tier })) : await listServices();
    const systemPrompt = buildSystemPrompt({ services: promptServices });

    const runner = createEvalRunner({
      mode,
      chaos: createChaosController(),
      dispatch: agentTools.invoke,
      callModel: createAnthropicModelClient(),
      systemPrompt,
      tools: agentTools.list(),
      persistInvestigation: mode === 'replay' ? undefined : persistInvestigation,
      fixturesDir: FIXTURES_DIR,
      metricsWindow,
    });

    const rows = await runner.run(scenarios);

    const table = formatResultsTable(rows);
    log(table);
    log('');
    log(formatFailures(rows));

    await mkdir(RESULTS_DIR, { recursive: true });
    const resultsPath = path.join(RESULTS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(
      resultsPath,
      JSON.stringify(
        {
          mode,
          ranAt: new Date().toISOString(),
          summary: summarize(rows),
          rows: rows.map(({ scenario, result, score, categoryCorrect }) => ({
            id: scenario.id,
            category: scenario.category,
            findings: result.findings,
            terminated: result.terminated,
            toolCalls: result.toolCalls,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
            score,
            categoryCorrect,
          })),
        },
        null,
        2,
      ),
    );
    log(`\nresults written to ${resultsPath}`);

    return { rows, resultsPath };
  } finally {
    await postgres.close();
    await redis.close();
    await neo4j.close();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
