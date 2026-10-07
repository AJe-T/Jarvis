-- Semantic memory search (idea from isair/jarvis): on-device MiniLM vectors for memory notes and
-- conversation messages. 384 float32 values per row; `hash` re-embeds a note when its text changes.
CREATE TABLE embeddings (
  kind    TEXT NOT NULL CHECK (kind IN ('memory', 'message')),
  ref     TEXT NOT NULL,
  hash    TEXT NOT NULL,
  vector  BLOB NOT NULL,
  PRIMARY KEY (kind, ref)
);
