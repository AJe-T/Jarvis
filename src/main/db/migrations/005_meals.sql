-- Everyday tools: meal / nutrition log (ideas from isair/jarvis). Numbers are Claude's estimates.
CREATE TABLE meals (
  id              TEXT PRIMARY KEY,
  ts              TEXT NOT NULL,
  day             TEXT NOT NULL,
  description     TEXT NOT NULL,
  calories        REAL,
  protein_g       REAL,
  carbs_g         REAL,
  fat_g           REAL,
  conversation_id TEXT
);
CREATE INDEX idx_meals_day ON meals(day);
