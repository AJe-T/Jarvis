-- NPCs (2.21): Sir's team of single-purpose agents. Jarvis is their head: he can read every NPC's
-- memory note (vault NPCs/<name>/Memory.md) and give them work. Chats live here, not in
-- conversations: channel 'office' (everyone, with @tags), 'dm:<npc id>', 'meeting:<meeting id>'.
CREATE TABLE npcs (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role             TEXT NOT NULL,
  emoji            TEXT NOT NULL,
  color            TEXT NOT NULL,
  brain            TEXT NOT NULL,            -- BRAIN_IDS (shared/llm-providers.ts)
  instructions     TEXT NOT NULL,            -- standing brief: what it does and how
  tools_json       TEXT NOT NULL,            -- ["deep_research","fetch_web_page"]; Jarvis's policy still applies
  enabled          INTEGER NOT NULL DEFAULT 1,
  template_id      TEXT,
  desk             INTEGER NOT NULL,         -- seat in the office
  conversation_id  TEXT NOT NULL REFERENCES conversations(id),  -- hidden; tool calls and usage attach to it
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE npc_messages (
  id            TEXT PRIMARY KEY,
  channel       TEXT NOT NULL,
  author        TEXT NOT NULL,             -- 'sir', 'jarvis' or an npc id
  text          TEXT NOT NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]', -- npc ids (and 'jarvis') tagged in it
  tainted       INTEGER NOT NULL DEFAULT 0, -- written after reading outside content (Security.md §6.3)
  created_at    TEXT NOT NULL
);
CREATE INDEX npc_messages_channel ON npc_messages(channel, created_at);

CREATE TABLE npc_meetings (
  id            TEXT PRIMARY KEY,
  topic         TEXT NOT NULL,
  attendees_json TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('running', 'done', 'stopped')),
  summary       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

-- NPC work conversations hold their tool calls and costs but are not chats with Sir.
ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
