-- Richer task lists (PRD F25): a description, a "Doing" limit for the board, and archiving.
ALTER TABLE todo_lists ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE todo_lists ADD COLUMN wip_limit INTEGER;          -- NULL = no limit on "Doing"
ALTER TABLE todo_lists ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
