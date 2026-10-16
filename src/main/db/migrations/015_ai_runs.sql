-- Integrations step 4: one request sent to several AIs (compare side by side, one reviews another,
-- or a chain where each builds on the last), with every step's result, timing, tokens and cost.
CREATE TABLE ai_runs (
  id           TEXT PRIMARY KEY,
  mode         TEXT NOT NULL CHECK (mode IN ('compare', 'review', 'chain')),
  prompt       TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('running', 'done', 'partial', 'failed', 'cancelled')),
  created_at   TEXT NOT NULL,
  finished_at  TEXT
);

CREATE TABLE ai_run_steps (
  run_id         TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  idx            INTEGER NOT NULL,
  brain          TEXT NOT NULL,              -- BrainRef (shared/llm-providers.ts)
  label          TEXT NOT NULL,              -- the brain's name when it ran
  role           TEXT NOT NULL CHECK (role IN ('answer', 'review', 'stage')),
  instruction    TEXT NOT NULL DEFAULT '',   -- chain stages: what this step should do
  status         TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  output         TEXT NOT NULL DEFAULT '',
  error          TEXT,
  model          TEXT,
  started_at     TEXT,
  finished_at    TEXT,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, idx)
);

CREATE INDEX idx_ai_runs_created ON ai_runs(created_at);
