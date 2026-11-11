-- 2.67: event triggers for automations. One row per thing an automation already reacted to
-- (a calendar occurrence, a task's due moment), so it fires once even across restarts.
-- Rows older than 7 days are deleted at startup.
CREATE TABLE automation_fired (
  task_id TEXT NOT NULL,
  key TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (task_id, key)
);
