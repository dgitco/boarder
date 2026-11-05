CREATE INDEX IF NOT EXISTS board_log_owner_win ON board_log(owner, win, id);
CREATE INDEX IF NOT EXISTS agent_token_owner_win ON agent_token(owner, win, created_at);
