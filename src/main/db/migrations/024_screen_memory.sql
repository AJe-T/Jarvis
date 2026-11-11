-- 2.72: screen memory. The text Windows OCR read on the main screen (never an image), with the
-- app and window that were in front, while the setting is on. Kept for screenMemory.keepDays
-- (default 7). Secrets are redacted before a row is written; private windows are never read.
CREATE TABLE screen_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  process TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX screen_memory_at ON screen_memory (at);
