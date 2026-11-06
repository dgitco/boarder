CREATE INDEX IF NOT EXISTS agent_token_owner_win_rev ON agent_token(owner, win, revoked_at, pane);
