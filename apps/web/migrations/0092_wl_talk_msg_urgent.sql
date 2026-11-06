CREATE INDEX IF NOT EXISTS wl_talk_msg_urgent ON wl_talk_msg(at) WHERE who = 'agent' AND deleted_at IS NULL AND text LIKE ':rotating_light: *급함*%';
