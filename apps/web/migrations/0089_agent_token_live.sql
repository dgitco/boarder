CREATE INDEX IF NOT EXISTS agent_token_live ON agent_token(created_at) WHERE revoked_at IS NULL;
