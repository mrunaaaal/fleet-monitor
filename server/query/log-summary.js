// Shared by logs.js's searchLogs and nginx-logs.js's searchNginxLogs: both
// group rows by one field, cluster another field into templates via a
// caller-supplied templateFn, take the top N templates by count, and report
// the first/last timestamp. Only the group field, the response's grouped-count
// key name (by_level vs by_status — a public contract, kept caller-specific),
// and the template function differ between callers.
export const TOP_N_PATTERNS = 5;

export function summarizeByPattern(rows, { groupField, groupKey, templateFn }) {
  const grouped = {};
  const counts = new Map();

  for (const row of rows) {
    grouped[row[groupField]] = (grouped[row[groupField]] ?? 0) + 1;
    const template = templateFn(row);
    counts.set(template, (counts.get(template) ?? 0) + 1);
  }

  const patterns = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_PATTERNS)
    .map(([template, count]) => ({ template, count }));

  return {
    total: rows.length,
    [groupKey]: grouped,
    time_range: rows.length > 0 ? { first: rows[0].ts, last: rows[rows.length - 1].ts } : null,
    patterns,
  };
}
