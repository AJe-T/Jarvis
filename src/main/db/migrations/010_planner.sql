-- Tasks and Calendar (PRD F25/F26). Dates and times are local wall-clock text ("2026-10-09T17:30").
CREATE TABLE todo_lists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT '',
  sort_order  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE todos (
  id               TEXT PRIMARY KEY,
  list_id          TEXT REFERENCES todo_lists(id) ON DELETE SET NULL,   -- NULL = Inbox
  parent_id        TEXT REFERENCES todos(id) ON DELETE CASCADE,         -- subtasks
  title            TEXT NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
  priority         INTEGER NOT NULL DEFAULT 4 CHECK (priority BETWEEN 1 AND 4),
  due_date         TEXT,
  due_time         TEXT,
  duration_min     INTEGER,
  remind_at        TEXT,
  reminded         INTEGER NOT NULL DEFAULT 0,
  recurrence_json  TEXT,
  tags_json        TEXT NOT NULL DEFAULT '[]',
  starred          INTEGER NOT NULL DEFAULT 0,
  sort_order       REAL NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  completed_at     TEXT
);
CREATE INDEX idx_todos_due ON todos(status, due_date);
CREATE INDEX idx_todos_remind ON todos(reminded, remind_at);

CREATE TABLE calendars (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  visible     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE events (
  id               TEXT PRIMARY KEY,
  calendar_id      TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  location         TEXT NOT NULL DEFAULT '',
  start_at         TEXT NOT NULL,
  end_at           TEXT NOT NULL,
  all_day          INTEGER NOT NULL DEFAULT 0,
  recurrence_json  TEXT,
  exdates_json     TEXT NOT NULL DEFAULT '[]',
  reminders_json   TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_events_start ON events(start_at);

-- Event reminders already delivered (one row per occurrence and offset) so a restart never repeats them.
CREATE TABLE event_reminders_fired (
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence  TEXT NOT NULL,
  minutes     INTEGER NOT NULL,
  fired_at    TEXT NOT NULL,
  PRIMARY KEY (event_id, occurrence, minutes)
);
