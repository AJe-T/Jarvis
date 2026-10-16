-- Approaches that worked (idea from ruflo's ReasoningBank): which tools, in which order, handled a
-- kind of request. Tool names only, never their inputs or results. Private chats are never recorded.
CREATE TABLE strategies (
  id          TEXT PRIMARY KEY,
  request     TEXT NOT NULL,            -- Sir's request that first used this approach (≤ 300 chars)
  tools_json  TEXT NOT NULL,            -- ["open_app","set_volume"]
  successes   INTEGER NOT NULL DEFAULT 0,
  failures    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX strategies_updated ON strategies(updated_at);
