ALTER TABLE board_log ADD COLUMN task TEXT;
ALTER TABLE board_log ADD COLUMN device TEXT;
ALTER TABLE board_log ADD COLUMN phase TEXT;
ALTER TABLE board_log ADD COLUMN wait_cond TEXT;
CREATE INDEX IF NOT EXISTS board_log_owner_task ON board_log(owner, task, at) WHERE task IS NOT NULL;
