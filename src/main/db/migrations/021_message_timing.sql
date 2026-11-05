-- 2.63: how long each reply took, shown small under it. Set on the turn's last assistant row:
-- from Sir's message to the first word of the reply, and to the end of the reply (ms).
ALTER TABLE messages ADD COLUMN first_word_ms INTEGER;
ALTER TABLE messages ADD COLUMN total_ms INTEGER;
