-- AI Router (2.30): every attempt the free pool made, answered or not. Drives the limit tracker
-- (requests and tokens per minute / per day), the scores and the AI Router page.
-- Never holds prompts or answers: only who was asked, how it went and how many tokens.
CREATE TABLE pool_calls (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job            TEXT NOT NULL,              -- one sub-task; its failed rows are the trail
  task           TEXT NOT NULL DEFAULT '',   -- the sub-task's title (Claude's words, never Sir's data)
  at             TEXT NOT NULL,              -- ISO time
  day            TEXT NOT NULL,              -- UTC day (free tiers reset at UTC midnight)
  connection_id  TEXT NOT NULL,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  tier           INTEGER NOT NULL CHECK (tier IN (2, 3)),
  ok             INTEGER NOT NULL CHECK (ok IN (0, 1)),
  status         INTEGER,                    -- HTTP status of a failure
  reason         TEXT,                       -- short, redacted reason of a failure
  ms             INTEGER NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_pool_calls_route ON pool_calls(connection_id, model, at);
CREATE INDEX idx_pool_calls_day ON pool_calls(day);
CREATE INDEX idx_pool_calls_job ON pool_calls(job);
