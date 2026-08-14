// Results table + failure explanations (fleet-monitor-docs.md §8.5): "Cat"
// is null/not-applicable on healthy scenarios (nothing expected, nothing
// named), rendered as a dash rather than a checkmark or cross.
function average(rows, fn) {
  if (rows.length === 0) return 0;
  return rows.reduce((sum, row) => sum + fn(row), 0) / rows.length;
}

export function summarize(rows) {
  const categoryApplicable = rows.filter((row) => row.categoryCorrect !== null);
  return {
    total: rows.length,
    correct: rows.filter((row) => row.score.correctness).length,
    categoryApplicable: categoryApplicable.length,
    categoryCorrect: categoryApplicable.filter((row) => row.categoryCorrect).length,
    avgRootCauseCompleteness: average(rows, (row) => row.score.root_cause_completeness),
    avgBlastRadiusCompleteness: average(rows, (row) => row.score.blast_radius_completeness),
    avgCalls: average(rows, (row) => row.result.toolCalls),
    avgCostUsd: average(rows, (row) => row.result.costUsd),
  };
}

function mark(value) {
  if (value === null) return '—';
  return value ? '✓' : '✗';
}

function pad(text, width) {
  return String(text).padEnd(width);
}

export function formatResultsTable(rows) {
  const idWidth = Math.max(8, ...rows.map((row) => row.scenario.id.length)) + 2;
  const header = `${pad('Scenario', idWidth)}Correct  Cat  RC-Compl  BR-Compl  Calls   Cost`;
  const divider = '─'.repeat(header.length + 6);

  const lines = rows.map((row) => {
    const rc = row.score.root_cause_completeness.toFixed(1);
    const br = row.score.blast_radius_completeness.toFixed(1);
    const cost = `$${row.result.costUsd.toFixed(3)}`;
    return (
      `${pad(row.scenario.id, idWidth)}` +
      `${pad(mark(row.score.correctness), 9)}` +
      `${pad(mark(row.categoryCorrect), 5)}` +
      `${pad(rc, 10)}` +
      `${pad(br, 10)}` +
      `${pad(row.result.toolCalls, 8)}` +
      `${cost}`
    );
  });

  const summary = summarize(rows);
  const summaryLine =
    `correct ${summary.correct}/${summary.total} · ` +
    `category ${summary.categoryCorrect}/${summary.categoryApplicable} · ` +
    `root-cause completeness ${summary.avgRootCauseCompleteness.toFixed(2)} · ` +
    `blast-radius completeness ${summary.avgBlastRadiusCompleteness.toFixed(2)} · ` +
    `avg ${summary.avgCalls.toFixed(1)} calls · ` +
    `avg $${summary.avgCostUsd.toFixed(3)}`;

  return [header, divider, ...lines, divider, summaryLine].join('\n');
}

function explainFailure(named, expected) {
  const namedSet = new Set(named);
  const falsePositives = named.filter((service) => !expected.includes(service));

  if (falsePositives.length > 0 && expected.length === 0) {
    return 'flagged a cause on a healthy scenario (false alarm)';
  }
  if (falsePositives.length > 0) {
    return `named a false cause (${falsePositives.join(', ')})`;
  }
  if (expected.length > 0 && expected.every((service) => !namedSet.has(service))) {
    return 'missed every real cause';
  }
  return 'incorrect result';
}

export function formatFailures(rows) {
  const failures = rows.filter((row) => !row.score.correctness);
  if (failures.length === 0) return 'No incorrect scenarios.';

  return failures
    .map((row) => {
      const named = (row.result.findings?.root_cause_services ?? []).map((cause) => cause.service);
      const expected = (row.scenario.expected.root_causes ?? []).map((cause) => cause.service);
      const reason = explainFailure(named, expected);
      return `- ${row.scenario.id}: named [${named.join(', ') || 'none'}], expected [${expected.join(', ') || 'none'}] — ${reason}`;
    })
    .join('\n');
}
