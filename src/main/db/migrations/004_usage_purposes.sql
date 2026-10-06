-- New features (voice intent judge, research, briefing, reply copilot, scheduled tasks) record their own
-- purpose. SQLite can't alter a CHECK constraint, so the table is rebuilt with the same columns.
CREATE TABLE usage_ledger_new (
  id               TEXT PRIMARY KEY,
  ts               TEXT NOT NULL,
  day              TEXT NOT NULL,
  model            TEXT NOT NULL,
  purpose          TEXT NOT NULL CHECK (purpose IN ('chat','curator','title','summary','desktop_agent','eval','intent','research','briefing','copilot','task')),
  conversation_id  TEXT,
  input_tokens     INTEGER NOT NULL,
  output_tokens    INTEGER NOT NULL,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
  est_cost_usd     REAL NOT NULL,
  billing          TEXT NOT NULL DEFAULT 'api' CHECK (billing IN ('api', 'subscription'))
);
INSERT INTO usage_ledger_new SELECT id, ts, day, model, purpose, conversation_id, input_tokens, output_tokens,
  cache_read_tokens, cache_write_tokens, est_cost_usd, billing FROM usage_ledger;
DROP TABLE usage_ledger;
ALTER TABLE usage_ledger_new RENAME TO usage_ledger;
CREATE INDEX idx_usage_day ON usage_ledger(day);
