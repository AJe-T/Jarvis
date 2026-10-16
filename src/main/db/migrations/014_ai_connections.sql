-- Integrations step 3 (docs/Integrations.md): several connections (keys) per AI provider, and a
-- registry of the models each one offers. Keys stay in secrets.bin; only the secret's name is here.
CREATE TABLE ai_connections (
  id          TEXT PRIMARY KEY,            -- conn_<provider> (the provider's own key) or conn_<provider>_<n>
  provider    TEXT NOT NULL,               -- CLOUD_PROVIDERS id (shared/llm-providers.ts)
  label       TEXT NOT NULL,
  secret      TEXT NOT NULL UNIQUE,        -- name in secrets.bin, never the key
  model       TEXT NOT NULL DEFAULT '',    -- chosen model; the provider's own key keeps it in llm.cloud.models
  -- 1 = removed (its key is deleted). The row stays so its id is never given to a new key: an NPC
  -- still pointing at conn_openai_2 must not start billing a different account.
  removed     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE ai_models (
  connection_id TEXT NOT NULL REFERENCES ai_connections(id) ON DELETE CASCADE,
  model         TEXT NOT NULL,
  -- live = in the provider's latest list; manual = typed by Sir; cached = listed before, not any more
  source        TEXT NOT NULL CHECK (source IN ('live', 'manual', 'cached')),
  favourite     INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  seen_at       TEXT,
  PRIMARY KEY (connection_id, model)
);
