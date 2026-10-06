-- Database.md §3. Never edit after release; add a new migration instead.

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE conversations (
  id             TEXT PRIMARY KEY,
  title          TEXT,
  started_at     TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  ended_at       TEXT,
  summary        TEXT,
  summary_upto_seq INTEGER NOT NULL DEFAULT 0,
  source         TEXT NOT NULL CHECK (source IN ('text','voice','mixed')),
  is_private     INTEGER NOT NULL DEFAULT 0,
  vault_log_path TEXT,
  total_input_tokens  INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd   REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_conversations_last_active ON conversations(last_active_at DESC);

CREATE TABLE messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content_json     TEXT NOT NULL,
  text_plain       TEXT NOT NULL DEFAULT '',
  source           TEXT CHECK (source IN ('text','voice','system')),
  model            TEXT,
  stop_reason      TEXT,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  cache_read_tokens   INTEGER,
  cache_write_tokens  INTEGER,
  created_at       TEXT NOT NULL,
  UNIQUE (conversation_id, seq)
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, seq);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  text_plain,
  content='messages', content_rowid='rowid',
  tokenize='porter unicode61'
);
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text_plain) VALUES (new.rowid, new.text_plain);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text_plain) VALUES ('delete', old.rowid, old.text_plain);
END;
CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text_plain) VALUES ('delete', old.rowid, old.text_plain);
  INSERT INTO messages_fts(rowid, text_plain) VALUES (new.rowid, new.text_plain);
END;

CREATE TABLE tool_calls (
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
  decided_by       TEXT CHECK (decided_by IN ('policy','user_click','user_voice','kill_switch','timeout')),
  status           TEXT NOT NULL CHECK (status IN ('pending','running','success','error','not_run')),
  output_preview   TEXT,
  error            TEXT,
  untrusted_output INTEGER NOT NULL DEFAULT 0,
  started_at       TEXT,
  finished_at      TEXT,
  duration_ms      INTEGER,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_tool_calls_conv ON tool_calls(conversation_id, created_at);
CREATE INDEX idx_tool_calls_name ON tool_calls(tool_name, created_at);

CREATE TABLE memories (
  id             TEXT PRIMARY KEY,
  vault_path     TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('profile','preference','person','project','fact','routine','note')),
  tags_json      TEXT NOT NULL DEFAULT '[]',
  body           TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('curator','memory_tool','user_edit','import')),
  source_conversation_id TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  file_mtime_ms  INTEGER NOT NULL
);
CREATE INDEX idx_memories_kind ON memories(kind);

-- External-content FTS kept in sync by triggers (same pattern as messages_fts).
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, body, tags_json,
  content='memories', content_rowid='rowid',
  tokenize='porter unicode61'
);
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, title, body, tags_json) VALUES (new.rowid, new.title, new.body, new.tags_json);
END;
CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, body, tags_json) VALUES ('delete', old.rowid, old.title, old.body, old.tags_json);
END;
CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, title, body, tags_json) VALUES ('delete', old.rowid, old.title, old.body, old.tags_json);
  INSERT INTO memories_fts(rowid, title, body, tags_json) VALUES (new.rowid, new.title, new.body, new.tags_json);
END;

CREATE TABLE memory_review_queue (
  id          TEXT PRIMARY KEY,
  op          TEXT NOT NULL CHECK (op IN ('ADD','UPDATE','DELETE')),
  target_path TEXT,
  proposed_markdown TEXT,
  reason      TEXT NOT NULL,
  conversation_id TEXT,
  created_at  TEXT NOT NULL,
  resolved    TEXT CHECK (resolved IN ('accepted','rejected'))
);

CREATE TABLE routines (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  vault_path      TEXT NOT NULL UNIQUE,
  trigger_phrases_json TEXT NOT NULL,
  steps_json      TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  error           TEXT,
  last_run_at     TEXT,
  updated_at      TEXT NOT NULL
);

CREATE TABLE reminders (
  id           TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  due_at       TEXT NOT NULL,
  recurrence   TEXT,
  status       TEXT NOT NULL CHECK (status IN ('scheduled','fired','dismissed','cancelled')),
  speak        INTEGER NOT NULL DEFAULT 1,
  created_from_conversation_id TEXT,
  created_at   TEXT NOT NULL,
  fired_at     TEXT
);
CREATE INDEX idx_reminders_due ON reminders(status, due_at);

CREATE TABLE mcp_servers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  transport       TEXT NOT NULL CHECK (transport IN ('stdio','http')),
  command         TEXT,
  args_json       TEXT NOT NULL DEFAULT '[]',
  url             TEXT,
  env_secret_names_json TEXT NOT NULL DEFAULT '{}',
  enabled         INTEGER NOT NULL DEFAULT 1,
  trust_level     TEXT NOT NULL CHECK (trust_level IN ('official','community','experimental')),
  default_tier    TEXT NOT NULL DEFAULT 'CONFIRM' CHECK (default_tier IN ('SAFE','CONFIRM','BLOCKED')),
  tool_overrides_json TEXT NOT NULL DEFAULT '{}',
  untrusted_output INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE usage_ledger (
  id               TEXT PRIMARY KEY,
  ts               TEXT NOT NULL,
  day              TEXT NOT NULL,
  model            TEXT NOT NULL,
  purpose          TEXT NOT NULL CHECK (purpose IN ('chat','curator','title','summary','desktop_agent','eval')),
  conversation_id  TEXT,
  input_tokens     INTEGER NOT NULL,
  output_tokens    INTEGER NOT NULL,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
  est_cost_usd     REAL NOT NULL
);
CREATE INDEX idx_usage_day ON usage_ledger(day);

CREATE TABLE audit_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  actor        TEXT NOT NULL CHECK (actor IN ('user','agent','system')),
  event        TEXT NOT NULL,
  details_json TEXT NOT NULL,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL
);

CREATE TABLE vault_files (
  vault_path    TEXT PRIMARY KEY,
  content_hash  TEXT NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  indexed_at    TEXT NOT NULL,
  last_writer   TEXT NOT NULL CHECK (last_writer IN ('jarvis','external'))
);
