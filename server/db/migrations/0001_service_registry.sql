-- Service registry + investigation history (fleet-monitor-docs.md §4.1).
-- IF NOT EXISTS makes this safe to re-run — no migrations-tracking table
-- for a schema this small.

CREATE TABLE IF NOT EXISTS services (
  name       text PRIMARY KEY,
  tier       text NOT NULL
               CHECK (tier IN ('user-facing','internal','datastore')),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investigations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symptom        text NOT NULL,
  findings       jsonb,                -- submit_findings payload, null if terminated
  trace          jsonb NOT NULL,       -- full tool-call sequence
  iterations     int NOT NULL,
  tool_calls     int NOT NULL,
  input_tokens   int NOT NULL,
  output_tokens  int NOT NULL,
  cost_usd       numeric(10,5) NOT NULL,
  duration_ms    int NOT NULL,
  terminated     text,                 -- null | 'budget_exceeded' | 'max_iterations'
  eval_scenario  text,                 -- set when run from the harness
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investigations_scenario_idx
  ON investigations (eval_scenario, created_at DESC)
  WHERE eval_scenario IS NOT NULL;
