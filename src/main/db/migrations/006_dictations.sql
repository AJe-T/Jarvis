-- Dictation history (ideas from isair/jarvis): what was typed into other apps by voice. Kept locally,
-- trimmed to the newest 200, cleared from Settings.
CREATE TABLE dictations (
  id          TEXT PRIMARY KEY,
  ts          TEXT NOT NULL,
  raw_text    TEXT NOT NULL,
  final_text  TEXT NOT NULL,
  target_app  TEXT
);
CREATE INDEX idx_dictations_ts ON dictations(ts);
