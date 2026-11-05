-- 2.63: Sir can pin a chat so it stays at the top of Conversations.
ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
