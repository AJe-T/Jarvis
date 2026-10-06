-- Scheduled agents (ideas from OpenJarvis): morning briefing, recurring tasks, proactive check-ins.
CREATE TABLE scheduled_tasks (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('briefing','task','checkin')),
  prompt         TEXT NOT NULL,
  schedule_json  TEXT NOT NULL,           -- {"type":"daily","time":"07:30","days":[1,2,3,4,5]} | {"type":"interval","minutes":60}
  enabled        INTEGER NOT NULL DEFAULT 1,
  speak          INTEGER NOT NULL DEFAULT 0,
  save_to_vault  INTEGER NOT NULL DEFAULT 0,
  next_run_at    TEXT,
  last_run_at    TEXT,
  last_status    TEXT,
  last_conversation_id TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_tasks_next ON scheduled_tasks(enabled, next_run_at);
