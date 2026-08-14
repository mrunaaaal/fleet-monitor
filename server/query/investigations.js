// Written once, consumed by the investigation loop's HTTP route (#14) —
// persists one row per completed or terminated run into `investigations`
// (server/db/migrations/0001_service_registry.sql).
const INSERT_SQL = `
  INSERT INTO investigations
    (symptom, findings, trace, iterations, tool_calls, input_tokens, output_tokens, cost_usd, duration_ms, terminated, eval_scenario)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`;

export function createPersistInvestigationQuery({ postgres }) {
  return async function persistInvestigation({
    symptom,
    findings = null,
    trace,
    iterations,
    toolCalls,
    inputTokens,
    outputTokens,
    costUsd,
    durationMs,
    terminated = null,
    evalScenario = null,
  } = {}) {
    if (!symptom) throw new Error('persistInvestigation requires a symptom');
    if (!trace) throw new Error('persistInvestigation requires a trace');
    if (iterations === undefined) throw new Error('persistInvestigation requires iterations');
    if (toolCalls === undefined) throw new Error('persistInvestigation requires toolCalls');

    await postgres.query(INSERT_SQL, [
      symptom,
      findings === null ? null : JSON.stringify(findings),
      JSON.stringify(trace),
      iterations,
      toolCalls,
      inputTokens,
      outputTokens,
      costUsd,
      durationMs,
      terminated,
      evalScenario,
    ]);
  };
}
