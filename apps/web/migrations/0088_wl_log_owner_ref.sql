CREATE INDEX IF NOT EXISTS wl_log_owner_ref ON wl_log(ref, id) WHERE pane = 'owner';
