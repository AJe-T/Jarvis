-- Telegram channel (ideas from OpenJarvis): approvals sent from Sir's paired phone are recorded as
-- 'user_remote'. Rebuilds tool_calls because SQLite can't alter a CHECK constraint.
CREATE TABLE tool_calls_new (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id       TEXT REFERENCES messages(id) ON DELETE SET NULL,
  tool_use_id      TEXT NOT NULL,
  tool_name        TEXT NOT NULL,
  toolset_name     TEXT,
  source           TEXT NOT NULL CHECK (source IN ('native','mcp','anthropic')),
  input_json       TEXT NOT NULL,
  human_summary    TEXT NOT NULL,
  tier             TEXT NOT NULL CHECK (tier IN ('SAFE','CONFIRM','BLOCKED')),
  decision         TEXT NOT NULL CHECK (decision IN ('auto','approved','denied','blocked','cancelled','skipped')),
  decided_by       TEXT CHECK (decided_by IN ('policy','user_click','user_voice','user_remote','kill_switch','timeout')),
  status           TEXT NOT NULL CHECK (status IN ('pending','running','success','error','not_run')),
  output_preview   TEXT,
  error            TEXT,
  untrusted_output INTEGER NOT NULL DEFAULT 0,
  started_at       TEXT,
  finished_at      TEXT,
  duration_ms      INTEGER,
  created_at       TEXT NOT NULL
);
INSERT INTO tool_calls_new SELECT id, conversation_id, message_id, tool_use_id, tool_name, toolset_name, source,
  input_json, human_summary, tier, decision, decided_by, status, output_preview, error, untrusted_output,
  started_at, finished_at, duration_ms, created_at FROM tool_calls;
DROP TABLE tool_calls;
ALTER TABLE tool_calls_new RENAME TO tool_calls;
CREATE INDEX idx_tool_calls_conv ON tool_calls(conversation_id, created_at);
CREATE INDEX idx_tool_calls_name ON tool_calls(tool_name, created_at);
