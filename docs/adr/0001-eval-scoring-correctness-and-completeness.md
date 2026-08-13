# Eval scoring: correctness and completeness, with multiple root causes

An incident can have more than one independent root cause (e.g. a simultaneous double failure), so `submit_findings` reports `root_cause_services` as a **list** of `{ service, category, confidence }` entries — `category` is per-cause, because an `auth`-*dead* + `payments`-*error* incident has two different categories. The eval harness scores two orthogonal axes: **correctness** (every named cause is a real induced cause — no false positives) and **completeness** (the fraction of true elements found, scored fractionally as two independent sub-scores: root-cause completeness and blast-radius completeness).

We chose this over the original single `root_cause_service` answer key because that key would mark a *true but incomplete* diagnosis — naming one real cause out of two — as simply "wrong," which measures the answer key rather than the analyst. Separating the axes lets the headline result be precise: "correct root cause 17/20, but completeness drops on multi-cause incidents because it commits to the first cause and stops."

This is hard to reverse once the 20 scenarios, their fixtures, and the `submit_findings` schema are built, which is why it is recorded here.
