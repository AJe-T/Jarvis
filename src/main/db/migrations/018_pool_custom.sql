-- AI Router (2.31, ADR-045): Sir's own OpenAI-compatible providers. Always tier 3.
-- The address is checked when saved (HTTPS, public host, no bare IP) and never edited:
-- a change is remove + add. The key lives in secrets.bin as custom_ai_<n>, never here.
CREATE TABLE pool_custom (
  id          TEXT PRIMARY KEY,               -- custom_<n>; a number is never reused
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  removed     INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1))
);
