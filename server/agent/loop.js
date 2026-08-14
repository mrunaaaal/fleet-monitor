// The investigation loop (spec issue #14, fleet-monitor-docs.md §7.4): the
// model client and the tool dispatch are both injected, so this loop has
// no real API and no real store — it is deterministic and free to test
// (Seam 3). Four guardrails, each addressing an observed failure mode:
// iteration cap, cost cap, duplicate-call detection, and the structured
// terminal tool as the only clean way to finish.
//
// 'no_tool_call' isn't in server/db/migrations/0001_service_registry.sql's
// inline comment for the `terminated` column (only budget_exceeded/
// max_iterations are) — that comment predates this loop; the column has
// no CHECK constraint, so a fourth value is schema-compatible and more
// informative than folding "the model just stopped" into budget_exceeded
// the way fleet-monitor-docs.md §7.4's illustrative pseudocode does.
export const TERMINATED = {
  NO_TOOL_CALL: 'no_tool_call',
  BUDGET_EXCEEDED: 'budget_exceeded',
  MAX_ITERATIONS: 'max_iterations',
};

export function createInvestigationLoop({ dispatch, maxIterations = 10, maxCostUsd = 0.25 } = {}) {
  return {
    async investigate(symptom, { callModel, systemPrompt, tools, onEvent } = {}) {
      const messages = [{ role: 'user', content: symptom }];
      const trace = [];
      let inputTokens = 0;
      let outputTokens = 0;
      let costUsd = 0;
      const startedAt = Date.now();

      // Dedup is by name+input signature, not by output — a call with the
      // same arguments as one already in the trace is refused even if the
      // underlying data would have changed, because that's the confusion
      // this guardrail targets (re-calling with slightly shifted
      // arguments), not staleness. A dispatch error (e.g. a tool's own
      // input validation) is caught here too, the same as a duplicate: the
      // model gets a corrective tool_result and can retry, rather than the
      // whole investigation crashing on one malformed call.
      async function runCall(call) {
        const signature = `${call.name}:${JSON.stringify(call.input)}`;
        const alreadyMade = trace.find((t) => t.signature === signature);
        let out;
        if (alreadyMade) {
          out = { error: 'Identical call already made. Use those results or try a different approach.' };
        } else {
          try {
            out = await dispatch(call.name, call.input);
          } catch (err) {
            out = { error: err.message };
          }
        }
        const entry = { signature, name: call.name, input: call.input, out };
        trace.push(entry);
        onEvent?.({ type: 'tool_call', name: call.name, input: call.input, out });
        return { toolUseId: call.id, out };
      }

      function finish({ findings, terminated, iterations }) {
        onEvent?.({ type: 'terminated', terminated });
        return {
          findings,
          terminated,
          trace,
          iterations,
          toolCalls: trace.length,
          inputTokens,
          outputTokens,
          costUsd,
          durationMs: Date.now() - startedAt,
        };
      }

      for (let i = 0; i < maxIterations; i += 1) {
        const res = await callModel({ system: systemPrompt, messages, tools });
        inputTokens += res.usage?.inputTokens ?? 0;
        outputTokens += res.usage?.outputTokens ?? 0;
        costUsd += res.costUsd ?? 0;
        messages.push({ role: 'assistant', content: res.content });

        const calls = res.content.filter((c) => c.type === 'tool_use');
        if (calls.length === 0) {
          return finish({ findings: null, terminated: TERMINATED.NO_TOOL_CALL, iterations: i + 1 });
        }

        const finishCall = calls.find((c) => c.name === 'submit_findings');
        if (finishCall) {
          // Dispatched through the same runCall path as any other tool so
          // submit_findings' own validation runs — the loop trusts the
          // tool, not the model's raw input, for what "findings" means.
          const { toolUseId, out } = await runCall(finishCall);
          if (out?.error === undefined) {
            return finish({ findings: out, terminated: null, iterations: i + 1 });
          }
          // Invalid findings (bad category/confidence, missing field):
          // treat like any other failed call — give the model the error
          // back and let it retry, rather than terminating on garbage.
          messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(out) }] });
          if (costUsd > maxCostUsd) {
            return finish({ findings: null, terminated: TERMINATED.BUDGET_EXCEEDED, iterations: i + 1 });
          }
          continue;
        }

        const results = [];
        for (const call of calls) {
          const { toolUseId, out } = await runCall(call);
          results.push({ type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(out) });
        }
        messages.push({ role: 'user', content: results });

        if (costUsd > maxCostUsd) {
          return finish({ findings: null, terminated: TERMINATED.BUDGET_EXCEEDED, iterations: i + 1 });
        }
      }

      return finish({ findings: null, terminated: TERMINATED.MAX_ITERATIONS, iterations: maxIterations });
    },
  };
}
