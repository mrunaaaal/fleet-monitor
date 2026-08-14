// The eval scorer (spec issue #16, ADR-0001, Seam 4 per spec issue #1 "Testing
// Decisions"): a pure function, unit-tested directly, because a wrong scorer
// would silently corrupt every published number. Correctness only penalizes
// false positives; completeness is scored fractionally on two independent
// axes so a true-but-partial diagnosis (e.g. one of two simultaneous causes)
// reads as "correct but incomplete" rather than "wrong".
export function scoreFindings(findings, expected) {
  const namedCauseServices = (findings.root_cause_services ?? []).map((cause) => cause.service);
  const expectedCauseServices = (expected.root_causes ?? []).map((cause) => cause.service);
  const expectedCauseSet = new Set(expectedCauseServices);

  const correctness = namedCauseServices.every((service) => expectedCauseSet.has(service));

  return {
    correctness,
    root_cause_completeness: fractionFound(expectedCauseServices, namedCauseServices),
    blast_radius_completeness: fractionFound(expected.affected_services ?? [], findings.affected_services ?? []),
  };
}

function fractionFound(expectedItems, foundItems) {
  if (expectedItems.length === 0) return 1;
  const found = new Set(foundItems);
  const hits = expectedItems.filter((item) => found.has(item)).length;
  return hits / expectedItems.length;
}
