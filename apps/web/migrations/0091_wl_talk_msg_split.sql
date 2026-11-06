CREATE INDEX IF NOT EXISTS wl_talk_msg_split ON wl_talk_msg(ref) WHERE source = 'node-split' AND deleted_at IS NULL;
